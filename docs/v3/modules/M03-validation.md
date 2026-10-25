# M03: Validation (rule catalog, math gate, registries, legality)

Phase 1 (MVP). Package `packages/validation` (pure rules) + `apps/worker` stage `validate` (I/O wrapper). Names follow `04-domain-model.md` / `05-data-model.md`. Law numbers come from rule tables (`06 §2`); product tolerances are the `validation.*` and `registry.*` keys of `06 §2.2`, hotfixable via `rules_overrides`. M03 writes no `obligations` rows: M09 is their single writer (04 §9.2).

---

## 1. Purpose and scope

**Purpose.** Decide, deterministically and explainably, whether every extracted document is (a) arithmetically consistent, (b) issued by and to the right parties, (c) legally usable for VAT/income tax, (d) not a duplicate, (e) safe with respect to registries, limits and already-generated filings. Produce `validation_results` rows that gate `ready`, feed the review queue, and travel into the accountant package as notes.

**In scope (Phase 1):** the catalog in §4.4 (69 rules), the rule engine, auto-fix/derivation, registry lookups with caching and graceful degradation, re-validation on edit, two run phases (`pre_categorize` after M02 extraction, `post_categorize` after M04).
**Phase 2+ additions (same engine):** CRPDPH re-check at payment time (called by M07), cash-limit on bank/cash transactions, period lock against filings (needs M05 for generated filings; uploaded own returns already work in Phase 1).
**Out of scope:** extraction confidence calibration (M02), category choice (M04), filing simple-check (M05 consumes our results), payment matching (M07).

**Severity semantics (canonical, used by every module):**
| severity | Effect on document | Effect on ledgers | UI |
|---|---|---|---|
| `blocking` | cannot become `ready`/`finalized`; status → `needs_review` | no ledger entries are built | red row, "Opravte" |
| `warning` | becomes `needs_review` only if the rule's `review` flag is true; otherwise may proceed | entries built | amber badge; if `review`, appears in queue |
| `info` | never stops | entries built | grey badge / tooltip |

A `warning` the user dismisses is stored as `state='dismissed'` and listed in the accountant package ("Klient potvrdil: …"). Registry rules are **never** `blocking` (06 §1).

## 2. User stories

- **P1 Petra:** "When I forward an Adobe invoice, tell me it makes me an identified person and by when I must register." → `IO_TRIGGER_FOREIGN_SERVICE`.
- **P2 Tomáš:** "A blurry thermal receipt whose numbers don't add up must not silently count." → math gate (`MATH_*`, blocking).
- **P3 Lucie:** "Before I pay a supplier, warn me if it is an unreliable payer or the account isn't published." → `REG_CRPDPH_UNRELIABLE`, `REG_CRPDPH_ACCOUNT_NOT_PUBLISHED`.
- **P4 Josef:** "An Alza 'Faktura' that says 'Toto není daňový doklad' should be kept, but I must know it isn't a tax document." → `TAXDOC_NOT_TAX_DOCUMENT`. "The Decathlon backpack is probably private: ask me, don't accuse me." → `PERSONAL_LOOKING_PURCHASE`. "If I add a document into August after I filed August, tell me I need an amendment." → `PERIOD_LOCKED`.
- **Accountant:** "Every exception the client dismissed is visible with the reason, so I don't have to re-check 100 documents." → dismissed results exported in package notes.

## 3. Inputs / outputs

**Inputs:** `documents` (incl. `entry_mode`, `substitute_reason`, nullable `source_file_id`), `document_lines`, `document_vat_summary`, `document_fields` (confidence, source), `partners`, `partner_bank_accounts`, `taxpayer_profiles` (`profile.at(date)`), `organizations.settings`, `registry_cache` (+ live ARES/CRPDPH/VIES via `packages/registries`), `fx_rates`, `filings`, `filing_documents`, other `documents` (duplicates, cross-document), `vat_ledger_entries` (post-categorize, period lock), `rules.at(date)`.
**Outputs:** `validation_results` (upsert per `(document_id, rule_id)`), auto-fixed values in `document_fields` (new current row, `source ∈ {registry, rule, derived}`) and their denormalized columns on `documents`/`document_lines`, `partners` registry columns, `partner_bank_accounts.published_in_crpdph`, `review_questions` (for question-type rules), `notifications`, `document_links` (`duplicate_of`, `reported_in`, `same_period_reconciles`), document `status` transition, events.

## 4. Detailed behavior and algorithms

### 4.1 Engine

Each rule is a pure function in `packages/validation/rules/<group>/<RULE_ID>.ts` exporting `RuleDefinition` (§6.1). The catalog is a static array; `CATALOG_VERSION = sha256(sorted(rule_id:version))` is written to `documents.stage_version.validate`.

`runValidation(ctx, phase)` (pure):
1. **Sanitize** (in place on a copy, recorded as patches with `source='rule'`): IČO → digits only; DIČ → uppercase, strip spaces/dots, add `CZ` if 8–10 digits and supplier country CZ; VS/KS/SS → digits only; IBAN → uppercase, no spaces; CZ account → `[prefix-]number/bank`. Mirrors Competitor A `*_sanitized`.
2. **Smart recalc** (Competitor A "2 of 3"): per line, if exactly one of `(quantity, unit_price, net)` missing → derive; if exactly one of `(net, vat, gross)` missing → derive; if `vat_rate_pct` missing and `net≠0,vat` present → `rate = round(vat/net×100)` snapped to the nearest rate in `vat.rates` (+0) if within 0.5 pp. Header totals missing → sum of lines/recap. Derived values get `source='derived'`, `confidence = min(inputs)`.
3. **Registry autofill** (only in `pre_categorize`, needs `ctx.registry`): fill empty supplier name/address/DIČ from ARES (CZ) or VIES (EU). Never overwrite a non-empty value with `source='user'`.
4. **Evaluate** every rule whose `phase` matches and `appliesTo(ctx)` is true, in group order `REQ → MATH → ID → REG → TAXDOC → DATE → DUP → FX/CASH → PROFILE/XDOC`. A rule returns `RuleOutcome` (pass/fail + params + optional `autoFix` patches). One result per rule per document: per-line failures are aggregated into `params.items[]`.
5. **Apply auto-fixes** whose `autoFix.when` condition holds (each rule defines it, e.g. "flip discount sign only if the sum then reconciles"), then re-evaluate all rules once more (max 2 passes; a fix that does not make its own rule pass is reverted). Fixes never touch fields whose current source is `user`.
6. Return `{outcomes, patches, statusHint}` where `statusHint = 'blocked' | 'review' | 'clear'`.

`validateDocument(orgId, documentId, {phase, trigger})` (I/O):
1. Load context inside `withTenant(orgId)`; prefetch registries in parallel with `registry.timeout_ms` (§4.3).
2. `runValidation`; in one DB transaction: write patches to `document_fields` (`is_current` flip) and denormalized columns; upsert results:
   - fail & no row → insert `state='open'`.
   - fail & row `open` → update `severity, params, field_keys, rule_version`.
   - fail & row `resolved` → set `open` again.
   - fail & row `dismissed` → keep `dismissed` **unless** `params` changed in a material key (each rule lists `materialParams`; e.g. `amount`, `partner_ico`), then reopen.
   - pass & row `open` → `state='resolved', resolved_by=null, resolved_at=now()`.
   - rule no longer applicable → delete row if `open`, keep if `dismissed` (audit).
3. Status: any open `blocking` → `needs_review`; any open `warning` with `review=true` → `needs_review`; else continue pipeline (`pre_categorize` → enqueue `doc.categorize`; `post_categorize` → `ready` if M04 also has no pending questions).
4. Emit `document.validated {documentId, phase, blocking:n, review:n}`.

**Re-validation triggers:** any user edit of a field/line (synchronous both phases, registry from cache only, target < 300 ms p95); `registry.recovered` (re-run `REG_*` for documents with open `REG_UNVERIFIED`); `fx.rates_imported` (re-run `FX_RATE_UNAVAILABLE`); `filing.generated|marked_filed` and `government_filing` finalized (re-run `PERIOD_LOCKED` for that period); profile change (re-run `PROFILE`/`TAXDOC` groups for documents dated ≥ `valid_from`); catalog version change (nightly batch, low priority).

**Non-bookable classes** (`settlement_statement`, `order_confirmation`, `government_filing`, …) run only rules whose `appliesTo` includes them (`DUP_*`, `XDOC_*`, `DATE_IMPLAUSIBLE_YEAR`). `non_document` runs nothing.

**Entry modes** (`documents.entry_mode ∈ {captured, manual, imported}`): manual and imported documents run the **same** catalog: the math gate, duplicates and every other rule. Typed fields carry `field_source='user'`, so `FIELD_LOW_CONFIDENCE` skips them, and auto-fixes never change them. A typed math error therefore stays blocking until the user corrects it. File-based rules (`DUP_EXACT_FILE`, the pHash branch of `DUP_PROBABLE`) are skipped when `source_file_id is null`. Substitute documents (`substitute_reason` set) also get group J (§4.4).

### 4.2 Shared helpers (pure, `packages/validation/lib`)

- `tol(key, n?)`: reads tolerance from `rules.at(issue_date).validation.tol.*`.
- `normName(s)`: NFKD, strip diacritics, lowercase, remove legal forms (`s.r.o.`, `spol. s r.o.`, `a.s.`, `v.o.s.`, `k.s.`, `z.s.`, `B.V.`, `Ltd`, `Limited`, `Inc`, `GmbH`, `S.A.`, `SE`, `LLC`, `Unlimited Company`), punctuation → space, collapse spaces. `nameSim(a,b)` = Jaro-Winkler on `normName`; match if ≥ `validation.name_match_min`.
- `normAddr(a)`: `{street+number, zip(5 digits), city}` normalized like names; match if zip equal and street similarity ≥ 0.85.
- `icoValid(ico)`: 8 digits; `s = Σ d[i]·(8−i), i=0..6`; `r = s mod 11`; `c = r==0 ? 1 : r==1 ? 0 : 11−r`; valid iff `c == d[7]`. Test vector: `27074358` valid.
- `czAccountValid(prefix, number)`: weights from the right `1,2,4,8,5,10,9,7,3,6`; each part `Σ mod 11 == 0`; base part 2–10 digits with ≥ 2 non-zero (`research/registries-and-formats.md §6.1`).
- `ibanValid(iban)`: ISO 7064 mod 97-10 (move 4 chars to end, letters → 10..35, `mod 97 == 1`); CZ length 24 (`§6.2`). `czAccountToIban()` builds IBAN for comparisons with CRPDPH.
- `dicFormat(dic)`: `CZ` + 8 digits (legal person/IČO-based), 9 or 10 digits (natural person; may be rodné-číslo-based or FS-assigned, e.g. `CZ699…`). **[verify]** exact current FS DIČ allocation patterns for natural persons.
- `vatIdFormat(country, id)`: per-country regex table (config `validation.vat_id_patterns`, EU-27 + `XI`; Greece uses `EL`).
- `docCzk(doc)`: CZK amounts for thresholds: if `currency='CZK'` → as is; else `amount × fx(rate at issue_date via vat.cnb_rate_rule)`; if no rate → `null` (rules needing CZK then use the last available rate and set `params.fx_estimated=true`).
- `myIdentity(ctx)`: `{ico, dic, legal_name, address, known_addresses: settings.known_addresses[]}` from `profile.at(issue_date)`.

### 4.3 Registries and graceful degradation

Clients (`packages/registries`): `AresClient.subject(ico)`, `CrpdphClient.status(dics[])` (`getStatusNespolehlivySubjektRozsirenyV2`, batches of ≤ 100, digits without `CZ`), `ViesClient.check(country, number, requester)` (POST `check-vat-number` with our own VAT ID as requester to obtain `requestIdentifier`). Each returns
`RegistryResult<T> = {status:'ok', data:T, fetchedAt} | {status:'not_found', fetchedAt} | {status:'unavailable', reason, cachedData?:T, cachedAt?}`.

Lookup policy per key:
1. `registry_cache` hit younger than `registry.cache_ttl_hours[source]` → use.
2. Else live call with `registry.timeout_ms`; success → upsert cache; copy to `partners` (`name/address` only if empty or source registry, `is_vat_payer`, `is_unreliable_payer`, `registry_checked_at`), `partner_bank_accounts.published_in_crpdph/checked_at`.
3. Failure (timeout, HTTP 5xx, CRPDPH `statusCode 2|3`, VIES `MS_UNAVAILABLE|SERVICE_UNAVAILABLE|TIMEOUT|*_MAX_CONCURRENT_*`): if cache exists younger than `registry.stale_ok_hours` → use it with `params.stale=true, checked_at`; else the dependent rules **pass with state "unverified"**: they are skipped and one `REG_UNVERIFIED` (info) result lists `params.sources[]`. Enqueue `validate.registry_retry` per `registry.retry_schedule_minutes`.
4. CRPDPH 00:00–00:10 outage (`statusCode 2`) → retry after 15 min, never surfaced to users.
5. A daily health job (06 §3) emits `registry.recovered` when a source turns healthy; documents with open `REG_UNVERIFIED` re-run.

UI: an unverified check shows a grey "neověřeno" chip with tooltip „Registr {source} teď neodpovídá. Ověříme automaticky později." Never a red state.

### 4.4 Rule catalog

Legend per rule: **id · version · severity (review?)** — *Applies* — *Logic* — *Deps* — *Message* (`i18n key` + Czech) — *Auto-fix* — *Resolve*. All i18n keys follow `validation.<RULE_ID>.message`; each also has `.title` (short) and `.action` (button), omitted below for brevity. `{x}` = ICU params from `validation_results.params`. "bookable" = classes marked ✅ in 04 §2.1. "rcv" = `direction='in'`.

#### A. Required data and confidence

**REQ_FIELDS_MISSING · v1 · blocking**
- Applies: bookable. Logic: missing any of: `total_gross`, `currency`, (`issue_date` or `duzp`), counterparty name (rcv: supplier; out: customer, except `platform_statement`), ≥ 1 non-`text` line. `params.fields[]`.
- Message: „Chybí povinné údaje: {fields}." Auto-fix: smart recalc (§4.1/2). Resolve: click the value on the PDF (click-to-fill) or type it.

**FIELD_LOW_CONFIDENCE · v1 · warning (review)**
- Applies: bookable. Logic: any current `document_fields` row for a *money, date, IČO/DIČ, VS* key with `source ∈ {llm, llm_escalated, pdf_text}` and `confidence < validation.confidence_review_threshold`, not confirmed by another rule (e.g. totals that reconcile via MATH rules are treated as confirmed: confidence lifted to 0.95). `params.fields[]`.
- Message: „Tyto údaje jsme přečetli nejistě, zkontrolujte je: {fields}." Resolve: confirm (sets `source='user'`) or correct.

#### B. Math gate (beats Competitor A: their mismatches only warn)

Tolerances: `validation.tol.*` (06 §2.2). `n_r` = number of item lines at rate r.

**MATH_LINE_QTY_PRICE · v1 · blocking**
- Applies: lines with `quantity`, `unit_price`, `net` all present. Logic: `|round2(quantity × unit_price) − net| > max(tol.line_qty_price.abs, tol.line_qty_price.rel × |net|)`. If the document states prices incl. VAT (`unit_price ≈ gross/qty`), compare against `gross` instead. `params.items=[{pos, expected, actual}]`.
- Message: „Řádek {pos}: {quantity} × {unit_price} = {expected}, na dokladu je {actual}." Auto-fix: if `|actual × 10 − expected| ≤ tol` or `|actual / 10 − expected| ≤ tol` (decimal-shift OCR error, cf. Competitor A `69,002`) and the line has `source=llm` → set `net = expected`. Resolve: correct the cell.

**MATH_LINE_VAT · v1 · blocking**
- Applies: lines with `vat_rate_pct>0`, `net`, `vat`. Logic: `|round2(net × rate/100) − vat| > tol.line_vat.abs` OR `|net + vat − gross| > tol.sum.abs`. Message: „Řádek {pos}: DPH {rate} % ze {net} je {expected}, na dokladu {actual}." Auto-fix: derive the single low-confidence value. Resolve: correct.

**MATH_LINES_VS_HEADER · v1 · blocking** (Competitor A `line_items_totals_check`)
- Applies: bookable with ≥ 1 non-text line. Logic: `S = Σ gross(lines incl. discount, shipping, fee, rounding, advance_deduction)`; fail if `|S − total_gross| > tol.sum.abs + |rounding|_allowed` where the allowed rounding is handled by MATH_ROUNDING (evaluate after a rounding line exists). Same for `Σ net` vs `total_net` when both present. `params {lines_sum, header}`.
- Message: „Součet řádků ({lines_sum}) nesedí s celkovou částkou ({header})." Auto-fix: MATH_DISCOUNT_SIGN fix; if a single line is missing (difference equals a printed amount found in `document_fields` candidates) → none (ask). Resolve: correct the line or the total.

**MATH_VAT_RECAP_ROW · v1 · blocking** (Competitor A `tax_detail_base_check`)
- Applies: every `document_vat_summary` row with `vat_rate_pct>0`. Logic: `|round2(base × rate/100) − vat| > min(1.00, max(0.01, tol.vat_row_per_line × n_r))`. Message: „Rekapitulace DPH {rate} %: {base} × {rate} % = {expected}, na dokladu je {actual}." Auto-fix: if Σ lines at rate r reproduces one of the two values exactly, fix the other (`source='derived'`). Resolve: correct.

**MATH_RECAP_VS_HEADER · v1 · blocking** (Competitor A `tax_detail_rate_check`, `total_*_check_warning`)
- Applies: recap present. Logic: `|Σ base − total_net| > tol.sum.abs` or `|Σ vat − total_vat| > tol.sum.abs` or recap rate set ≠ set of line rates (ignoring rate 0 lines with net=0). Message: „Rekapitulace DPH nesedí se součty dokladu (základ {recap_base} vs {total_net}, DPH {recap_vat} vs {total_vat})." Auto-fix: if header totals missing → derive from recap (Competitor A `value_derived_from_tax_detail`). Resolve: correct.

**MATH_NET_VAT_GROSS · v1 · blocking**
- Applies: header `total_net, total_vat, total_gross` present. Logic: `|total_net + total_vat + rounding − total_gross| > tol.sum.abs`. Message: „Základ + DPH ≠ celkem ({net} + {vat} ≠ {gross})." Resolve: correct.

**MATH_ROUNDING · v1 · blocking above limit, info otherwise**
- Applies: bookable. Logic: `d = printed_total − computed_gross` (computed = Σ non-rounding lines). If `|d| ≤ validation.rounding.max_czk` (CZK) or `≤ validation.rounding.max_foreign` (other currencies): pass-with-fix (info `params {rounding:d}` shown as "Zaokrouhlení {d}"). Else blocking. Printed totals are authoritative (ADR-007).
- Message (blocking): „Rozdíl {d} mezi vytištěnou a spočtenou částkou je větší než přípustné zaokrouhlení ({max})." Info: „Zaokrouhlení dokladu {d} Kč." Auto-fix: create/update a `line_type='rounding'` line with `net=gross=d, vat=0, vat_rate_type='none'`, set `documents.rounding = d` (`source='rule'`). Resolve: correct amounts.

**MATH_DISCOUNT_SIGN · v1 · blocking (after fix attempt)**
- Applies: lines with `line_type='discount'` or description matching `validation.discount_patterns` (`sleva`, `discount`, `kupón`, `voucher`, `bonus`, `-%`). Logic: discount line with `net > 0` or `gross > 0`. Auto-fix (Competitor A shipped `+16,53` instead of `−16,53`): flip the sign of `net, vat, gross, unit_price` on the line; keep if MATH_LINES_VS_HEADER then passes, else revert and fail. Info after a successful fix: „Slevu na řádku {pos} jsme převedli na zápornou částku." Fail message: „Sleva na řádku {pos} má kladnou částku." Resolve: correct.

**MATH_NEGATIVE_TOTAL · v1 · warning (review)**
- Applies: classes other than `*_credit_note`, `platform_statement`. Logic: `total_gross < 0`. Message: „Doklad má zápornou částku – jde o dobropis?" Auto-fix: none. Resolve: "Ano, je to dobropis" → class `received_credit_note`/`issued_credit_note` (re-run M02 credit-note fields) or correct the sign.

**MATH_AMOUNT_DUE · v1 · warning**
- Applies: bookable with `amount_due` or `is_paid_per_document`. Logic: `expected = total_gross − Σ|advance_deduction lines| − (is_paid_per_document ? total_gross : 0)`; fail if `amount_due` present and `|amount_due − expected| > tol.sum.abs`, or `amount_due > total_gross`. Message: „Částka k úhradě {amount_due} nesedí ({expected} podle dokladu)." Auto-fix: `amount_due` empty → set `expected` (Competitor A `total_due_autofilled_from_total_incl_tax`); `is_paid_per_document=true` ("Zaplaceno kartou", "Nehraďte", "Uhrazeno zálohou") and `amount_due>0` with low confidence → set 0. Resolve: correct.

**MATH_PAID_FLAG_CONFLICT · v1 · info**
- Applies: rcv. Logic: `is_paid_per_document=true` and `payment_method='bank_transfer'` and `due_date > issue_date` and no "uhrazeno/paid" phrase source; or `payment_method∈{card,cash}` and `amount_due>0`. Message: „Doklad tvrdí, že je zaplacený, ale má splatnost převodem – zkontrolujte." Resolve: choose "Zaplaceno" / "K úhradě".

**MATH_VAT_RATE_INVALID · v1 · blocking** (Competitor A `invalid_tax_rate`)
- Applies: lines/recap with `vat_rate_pct` and CZ VAT treatment candidates (supplier with CZ DIČ). Logic: `vat_rate_pct ∉ {rules.at(duzp ?? issue_date).vat.rates.* , 0}`. For foreign VAT (supplier non-CZ, no CZ DIČ) skip. Message: „Sazba DPH {rate} % neplatí k datu {date}." Auto-fix: snap within 0.5 pp (see §4.1/2). Resolve: correct.

#### C. Identity and formats

**ID_ICO_CHECKSUM · v1 · warning (review)** — Applies: any party IČO. Logic: `!icoValid`. Message: „IČO {ico} nemá platný kontrolní součet – nejspíš je špatně přečtené." Auto-fix: if exactly one OCR-confusable substitution (`O↔0, I/l↔1, S↔5, B↔8, Z↔2`) yields a valid IČO that ARES knows with name similarity ≥ threshold → apply (`source='registry'`). Resolve: correct.

**ID_DIC_FORMAT · v1 · warning (review)** — Applies: CZ DIČ present. Logic: `!dicFormat` or (8-digit DIČ and `!icoValid(digits)`). Message: „DIČ {dic} nemá správný tvar." Auto-fix: sanitize; if supplier IČO valid and DIČ digits differ by one confusable char from IČO → set `CZ`+IČO. Resolve: correct.

**ID_VAT_ID_FORMAT · v1 · warning** — Applies: foreign VAT ID. Logic: fails `vatIdFormat`. Message: „DIČ zahraničního dodavatele {vat_id} nemá tvar platný pro {country}." Resolve: correct.

**ID_CZ_ACCOUNT_CHECKSUM · v1 · warning (review)** (Competitor A `bank_account_invalid`) — Applies: `pay_to_account.account`. Logic: `!czAccountValid` or bank code not 4 digits. Message: „Číslo účtu {account} není platné (kontrolní součet)." Auto-fix: bank code missing and IBAN present → derive account+bank from IBAN (`bank_code_autofilled`). Resolve: correct.

**ID_IBAN_CHECKSUM · v1 · warning (review)** — Applies: `pay_to_account.iban`. Logic: `!ibanValid` or wrong length for country. Message: „IBAN {iban} není platný." Resolve: correct.

**ID_BANK_CODE_UNKNOWN · v1 · warning** — Applies: CZ account. Logic: bank code not in the ČNB code list (`bank_codes` seed, monthly refresh, `research/registries-and-formats.md §6.3`). Message: „Kód banky {code} neexistuje." Resolve: correct.

**ID_VS_FORMAT · v1 · warning** (Competitor A `var_sym_length_exceeded`) — Applies: VS/KS/SS. Logic: after sanitize, VS > 10 digits, KS > 4, SS > 10, or VS contained letters. Message: „Variabilní symbol {vs} má víc než 10 číslic." Auto-fix: sanitize. Resolve: correct.

**ID_SUPPLIER_EQUALS_BUYER · v1 · blocking** (Competitor A `sender_register_id_equal_recipient`) — Applies: invoices/credit notes. Logic: supplier IČO = buyer IČO, or supplier DIČ = buyer DIČ (non-empty). Message: „Dodavatel a odběratel jsou stejný subjekt ({ico}) – nejsou prohozené?" Auto-fix: if both equal my identity and the document text has my bank account as `pay_to_account` → propose class `issued_invoice` (creates `review_questions kind='confirm_field' payload {field:'class', proposed:'issued_invoice'}`). Resolve: swap parties / reclassify.

**ID_ISSUED_SUPPLIER_NOT_ME · v1 · blocking** — Applies: `issued_invoice`, `issued_credit_note`. Logic: supplier IČO/DIČ present and ≠ mine, or name sim < threshold with no ids. Message: „Vydaný doklad nevystavila vaše firma ({supplier})." Resolve: reclassify as received / correct.

**ID_BUYER_NOT_MY_ORG · v1 · blocking if an id conflicts, warning (review) if only the name differs** (Competitor A `recipient_register_id_non_matching_workspace`)
- Applies: rcv invoices/credit notes/ZDD with any buyer data (`buyer_snapshot`). Not receipts without a buyer.
- Logic:
  ```
  me = myIdentity(ctx); b = buyer_snapshot
  idConflict = (b.ico && b.ico != me.ico) || (b.dic && b.dic != me.dic) || (b.vat_id && b.vat_id != me.dic)
  idMatch    = (b.ico && b.ico == me.ico) || (b.dic && b.dic == me.dic) || (b.vat_id == me.dic)
  if idConflict → fail blocking params{field, printed, mine}
  elif !idMatch && b.name && nameSim(b.name, me.legal_name) < min && !settings.alias_names.some(match) → fail warning
  ```
- Message: blocking „Doklad je vystaven na jiný subjekt ({printed}), ne na vás ({mine})."; warning „Odběratel {name} neodpovídá vaší firmě." Resolve: "Je to můj doklad" (adds the name to `settings.alias_names`, dismiss) / "Není můj" → status `supporting` (kept, never booked).

**ID_BUYER_CONSUMER_NO_ICO · v1 · warning (no review)** (P4 MacBook)
- Applies: rcv `received_invoice` where buyer name matches me (`nameSim ≥ min`) but `b.ico` and `b.dic` are empty.
- Logic: as stated; params `{gross_czk, is_payer: profile.vat_status=='platce'}`.
- Message: „Doklad je vystaven na vás jako soukromou osobu (bez IČO). Jako výdaj ho použít můžete, pokud jde o pracovní nákup{is_payer, select, true {; DPH si z něj ale neodečtete} other {}}." Resolve: "Rozumím" (dismiss) or "Vyžádat opravu" (drafts e-mail to supplier; Phase 2). **[verify]** income-tax acceptability of a consumer invoice for an OSVČ (advisor).

**ID_BUYER_ADDRESS_MISMATCH · v1 · info**
- Applies: buyer address present. Logic: `!addrMatch(b.address, me.address)` and no match in `settings.known_addresses`. Message: „Adresa odběratele ({address}) se liší od adresy vaší firmy." Resolve: "Je to moje adresa" (adds to `known_addresses`) / dismiss.

#### D. Registries (never blocking; see §4.3)

**REG_ARES_NOT_FOUND · v1 · warning (review)** — Applies: CZ party with valid IČO. Deps: ARES. Logic: `not_found`. Message: „IČO {ico} v registru ARES neexistuje." Resolve: correct IČO / dismiss.

**REG_ARES_AUTOFILL · v1 · info** (Competitor A `name/address_autofilled_from_ares_register`) — Logic: §4.1/3 filled name/address/DIČ. Message: „Název a adresu jsme doplnili z ARES." Resolve: none.

**REG_ARES_NAME_MISMATCH · v1 · warning** — Applies: ARES ok and printed name present. Logic: `nameSim(printed, ares.obchodniJmeno) < min` (also compare against trade name variants in `dalsiUdaje` if present). Message: „Název na dokladu ({printed}) se liší od ARES ({ares})." Auto-fix: none (we keep printed for the evidence, store ARES name on `partners.name`). Resolve: dismiss / correct IČO.

**REG_ARES_SUBJECT_DEFUNCT · v1 · warning (review)** — Logic: `ares.datumZaniku ≤ issue_date`. Message: „Subjekt {name} zanikl {date} – doklad vystavil neexistující subjekt." Resolve: dismiss with reason.

**REG_CRPDPH_UNRELIABLE · v1 · warning; review iff `platce`** (Competitor A `sender_tax_id_reliable_payer_invalid`)
- Applies: supplier CZ DIČ. Deps: CRPDPH. Logic: `nespolehlivyPlatce=='ANO'` or `typSubjektu=='NESPOLEHLIVA_OSOBA'`. Params `{since: datumZverejneniNespolehlivosti}`.
- Message: „Dodavatel {name} je od {since} nespolehlivý plátce DPH. {is_payer, select, true {Pokud mu zaplatíte, ručíte za jeho DPH – DPH zaplaťte raději přímo finančnímu úřadu.} other {Pro vás to nemá daňový dopad, jen pozor na spolehlivost.}}" Resolve: acknowledge. M07 re-runs at payment time.

**REG_CRPDPH_VAT_WITHOUT_REGISTRATION · v1 · warning (review)**
- Applies: supplier CZ, document charges CZ VAT (`total_vat>0`). Logic: CRPDPH `typSubjektu ∉ {PLATCE_DPH, SKUPINA_DPH}` (incl. `NENALEZEN`, `IDENTIFIKOVANA_OSOBA`). Message: „Dodavatel účtuje DPH, ale v registru plátců DPH není." Resolve: dismiss / treat as non-VAT (sets supplier `is_vat_payer=false`; M04 then derives `rcv_domestic_no_vat`).

**REG_CRPDPH_ACCOUNT_NOT_PUBLISHED · v1 · warning (review iff `platce` and unpaid and `docCzk(gross) > vat.ruceni_cash_threshold`), else info** (Competitor A `bank_account_adis_invalid`)
- Applies: supplier is `PLATCE_DPH`, `pay_to_account` present, document unpaid or `payment_method='bank_transfer'`. Deps: CRPDPH `zverejneneUcty`.
- Logic: `toIban(pay_to_account) ∉ {toIban(u) : u published and (datumZverejneniUkonceni null or > today)}`; nonstandard accounts compared as normalized strings.
- Message: „Účet {account} není u dodavatele zveřejněn v registru plátců DPH." Write `partner_bank_accounts.published_in_crpdph`. Valid → info result `REG_CRPDPH_ACCOUNT_NOT_PUBLISHED` passes and the UI shows chip „Účet zveřejněn ✓". Resolve: pay to a published account / acknowledge.

**REG_VIES_INVALID · v1 · warning** (Competitor A `tax_id_invalid_in_register`)
- Applies: supplier (or customer on `iss_eu_*`) with EU VAT ID, country ≠ CZ. Deps: VIES. Logic: `valid==false`. Message: „DIČ {vat_id} je podle VIES neplatné." Severity escalates to warning(review) for issued `iss_eu_service/iss_eu_goods` (our zero-rating depends on it). Resolve: correct / dismiss.

**REG_VIES_AUTOFILL · v1 · info** (Competitor A `name_autofilled_from_vies_register`, `address_autofill_failed_from_vies_register`) — Message: „Název doplněn z VIES." or „Adresu se z VIES doplnit nepodařilo." Store `requestIdentifier` in `document_fields` (`field_key='supplier.vies_request_id'`) as proof of check.

**REG_UNVERIFIED · v1 · info** — Logic: §4.3/3. Params `{sources[], since}`. Message: „Neověřeno: {sources} teď neodpovídá. Zkusíme to znovu automaticky." Resolve: automatic.

#### E. Document legality (`tax_doc_status`)

**TAXDOC_NOT_TAX_DOCUMENT · v1 · info (`neplatce`, `identifikovana_osoba`) / warning (`platce` when the document shows VAT)** (P4 Alza 117 Kč)
- Applies: bookable, `tax_doc_status='not_tax_document'`, `substitute_reason is null` (substitutes use SUBST_NOT_TAX_DOCUMENT). Logic: detection is done by M02 (phrases „není daňový doklad", „nemá náležitosti daňového dokladu", non-payer supplier); rule fires whenever the status is set. Params `{phrase}`.
- Message: „Doklad sám uvádí: „{phrase}". Jako doklad o výdaji pro daň z příjmů ho použít můžete{is_payer, select, true {, ale DPH si z něj neodečtete – vyžádejte si daňový doklad} other {}}." Resolve: acknowledge; for payers "Vyžádat daňový doklad" (Phase 2 draft e-mail). M04 derives `rcv_domestic_no_vat`.

**TAXDOC_SIMPLIFIED_OVER_LIMIT · v1 · warning (review iff `platce`), info otherwise**
- Applies: `tax_doc_status='simplified_tax_document'`. Logic: `docCzk(total_gross) > vat.simplified_document_limit`. Message: „Zjednodušený doklad nad {limit} Kč není platný daňový doklad pro odpočet DPH." Resolve: obtain full invoice / acknowledge (payer: M04 marks deduction blocked).

**TAXDOC_PAYER_MISSING_BUYER_DIC · v1 · warning (review)**
- Applies: profile `platce`, rcv, CZ VAT charged, `tax_doc_status='full_tax_document'`, `docCzk(total_gross) > vat.simplified_document_limit`. Logic: buyer DIČ missing or ≠ mine (§29(1), `research/czech-tax-filings.md §5.2`). Message: „Na dokladu chybí vaše DIČ. Bez něj si DPH {vat} Kč neodečtete." Resolve: "Vyžádat opravený doklad" / "Uplatním až s opravou" (deduction blocked; M04 sets `deduction_pct=0`) / dismiss (accountant decides).

**TAXDOC_PAYER_MISSING_FIELDS · v1 · warning (review)**
- Applies: `platce`, rcv, CZ VAT charged. Logic: missing supplier DIČ, `document_number`, or (`duzp` when it differs from issue date and is not stated) — the minimum §29 elements we can check. Message: „Pro odpočet DPH chybí na dokladu: {fields}." Resolve: correct / request corrected document.

**TAXDOC_RC_BUYER_VAT_ID_MISSING · v1 · info (IO) / warning (payer)** (P4 Booking invoice issued 3 Aug for the July period)
- Applies: rcv foreign supplier, no VAT charged (reverse-charge candidate). Logic: buyer VAT ID missing on the document. The obligation to self-assess does not depend on it. Message: „Na faktuře od {supplier} chybí vaše DIČ. DPH přiznáváte i tak; doplňte DIČ v účtu u dodavatele, aby příští faktury byly v pořádku." Resolve: acknowledge.

**TAXDOC_FOREIGN_VAT_CHARGED_B2B · v1 · warning**
- Applies: rcv, supplier outside CZ without CZ DIČ, foreign VAT charged, and the org is a taxable person (always for OSVČ). Logic: as stated. Message: „{supplier} vám účtoval zahraniční DPH. Jako podnikatel máte dostat fakturu bez DPH – zadejte u dodavatele své DIČ." **[verify]** whether self-assessment still applies when the supplier wrongly charged its VAT; M04 uses `rcv_foreign_vat_charged` meanwhile. Resolve: acknowledge.

**TAXDOC_CREDIT_NOTE_UNLINKED · v1 · warning (review)**
- Applies: `*_credit_note`. Logic: no `document_links kind='corrects'` and no candidate original (same partner, referenced number `order_number`/`ref` found among documents). Message: „Dobropis neodkazuje na původní doklad." Auto-fix: link if exactly one candidate. Resolve: pick the original.

#### F. Dates

`today` = date in `Europe/Prague`.

**DATE_FUTURE · v1 · warning (review)** (Competitor A `date_after_today`) — Applies: `issue_date, duzp, received_date` (not `due_date`, not `service_period_to`). Logic: `date > today + validation.future_date_grace_days`. Message: „Datum {field} {date} je v budoucnosti." Resolve: correct.

**DATE_IMPLAUSIBLE_YEAR · v1 · blocking** (Competitor A `date_after_current_year`, stricter) — Applies: all classes with dates. Logic: `year(issue_date) < year(today) − validation.max_document_age_years` or `> year(today)+1`, or date before `2000-01-01`. Auto-fix: if swapping day/month or fixing a 2-digit year (`26`→`2026`) produces a date within ±400 days of `received_date` → apply when field source is llm/pdf_text. Message: „Datum {date} je nepravděpodobné – zkontrolujte rok." Resolve: correct.

**DATE_DUZP_ISSUE_GAP · v1 · info** — Applies: invoices with both dates. Logic: `issue_date − duzp > validation.duzp_issue_gap_days` (supplier issued late, §28(5)) or `duzp > issue_date` and class not advance. Message: „DUZP {duzp} je {days} dní od data vystavení." Resolve: none (informational; M04 dates VAT by DUZP or policy).

**DATE_DUE_BEFORE_ISSUE · v1 · warning (review)** — Logic: `due_date < issue_date`. Auto-fix: if the two were extracted from the same text block and swapping makes `issue_date ≤ duzp+15 ≤ due_date` plausible → swap (`source='rule'`). Message: „Splatnost {due} je dřív než vystavení {issue}." Resolve: correct.

**DATE_RECEIVED_BEFORE_ISSUE · v1 · warning** — Logic: `received_date < issue_date − 1`. Message: „Doklad jsme přijali dřív, než byl vystaven – zkontrolujte datum vystavení." Resolve: correct.

**DATE_DEDUCTION_WINDOW · v1 · warning (review), `platce` only** (ABRA lesson `dokladDuzpUctoPoDuzpPuvError2025`) — Logic: `vat_point_date` (M04, post phase) later than 31 Dec of `year(duzp) + vat.deduction_deferral_years`. Message: „Nárok na odpočet DPH z dokladu ze dne {duzp} už zanikl." Resolve: accept no deduction (M04 sets `deduction_pct=0`).

#### G. Duplicates

**DUP_EXACT_FILE · v1 · info** — Set by M01 when `source_files.sha256` (bytes) already exists in the org (covers the IKEA NFC/NFD filename variants and the identical Decathlon PNG). The new document is created with `status='duplicate'` + `document_links duplicate_of`. Message: „Tento soubor už máte (nahráno {date})." Resolve: none.

**DUP_SEMANTIC · v1 · info (auto-handled)**
- Applies: bookable, `document_number` present. Called by M02 **before** persisting header fields (the unique index `documents_semantic_dedupe` would otherwise reject the write) via `checkSemanticDuplicate()`.
- Logic: candidate = same org, same `direction`, `deleted_at is null`, status ∉ {duplicate, supporting}, `partner_id` equal (or equal normalized supplier IČO/VAT ID), `normNumber(document_number)` equal (`uppercase, strip spaces, -, /, .`), `|total_gross − c.total_gross| ≤ 0.01`, same currency. Original = finalized first, else earliest `created_at`, tie → lower `id`.
- Effect: new document `status='duplicate'`, link `duplicate_of`. Message: „Tento doklad už máte jako {number} od {partner}." Resolve: "Není to duplikát" is allowed only together with an edit of number/total/partner (else the index forbids it); the edit re-runs the check.

**DUP_PROBABLE · v1 · warning (review)**
- Applies: bookable; skipped when DUP_SEMANTIC hit. Logic (any):
  1. same partner (or `nameSim` of supplier names ≥ 0.92 when no ids) AND `|Δtotal_gross| ≤ validation.dup_fuzzy_amount_tol` AND `|Δissue_date| ≤ validation.dup_fuzzy_days` AND (numbers missing OR numbers equal after OCR-confusable normalization);
  2. M01 recorded a near-duplicate photo (`ingest_items.near_duplicate_candidate_id`, phash distance ≤ `config.dedupe.phash_candidate_distance`) with a document of the same class (re-encoded photo). M03 does not recompute hashes.
  Exclusions: different classes (order confirmation vs invoice → `fulfills`, statement vs invoice → `supports`), opposite signs (credit note vs invoice), both explicitly confirmed "not duplicate" earlier (`params.pair` dismissed).
- Message: „Vypadá to jako duplikát dokladu {other_number} ({other_date}, {amount})." Resolve: "Je to duplikát" (→ `duplicate`, link) / "Není" (dismiss; pair remembered).

#### H. Currency, FX, cash

**FX_CURRENCY_INVALID · v1 · warning (review)** (Competitor A `currency_not_valid`) — Logic: `currency` not ISO 4217 or not in the ČNB daily list and not in the ČNB "other currencies" list. Message: „Měna {currency} není platný kód." Resolve: correct.

**FX_RATE_UNAVAILABLE · v1 · info if the rate date ≥ today − 1, else warning** — Applies: `currency≠'CZK'`. Phase: pre (rate date = `issue_date`) and post (rate date = `vat_point_date`). Logic: no `fx_rates` row for `currency` with `rate_date ≤ d` within `fx.max_lookback_days` (`vat.cnb_rate_rule`). Message: „Kurz ČNB pro {currency} k {date} zatím nemáme. Doplníme ho automaticky." Resolve: automatic on `fx.rates_imported`; M05 treats an open result as "not simple" (04 §8).

**CASH_PAYMENT_LIMIT · v1 · warning (no review)**
- Applies: `payment_method='cash'` documents (Phase 2: also cash-account transactions via M07). Deps: `cash.payment_limit`, `fx_rates` (EUR).
- Logic:
  ```
  d = paid_at ?? issue_date; L = rules.at(d).cash.payment_limit
  limitCzk = L.czk ?? L.eur × eurRate(d)       // from 2027-07-10 the EU limit; if both present use min [verify CZ keeps 270 000]
  dayTotal = Σ docCzk(total_gross) of cash docs with same counterparty key (IČO, else normName) and same d (incl. this)
  docTotal = docCzk(total_gross)                 // a single supply paid in several cash instalments still counts once
  fail if dayTotal > limitCzk or docTotal > limitCzk
  ```
- Message: „Platba v hotovosti {amount} Kč jednomu partnerovi překračuje zákonný limit {limit} Kč. Hrozí pokuta – příště plaťte převodem." Resolve: acknowledge.

#### I. Profile, limits, period, cross-document (phase `post_categorize` unless noted)

**IO_TRIGGER_FOREIGN_SERVICE · v1 · warning (no review)**
- Applies: rcv; any line `vat_treatment ∈ {rcv_eu_service_reverse_charge, rcv_non_eu_service_reverse_charge}`; `profile.at(trigger_date).vat_status='neplatce'` where `trigger_date = vat_point_date` (M04).
- Logic: fires; `deadline` = the due date of M09's `io_registration` generator for this trigger date (`deadlines.generators`, +15 calendar days, shifted; `research/czech-tax-filings.md §3.2`), computed with M09's pure `computeDue()`. No side effects on `obligations` or notifications: M09's IO-trigger detection (§4.5 there) creates the obligation and the one urgent notification.
- Message: „Koupili jste službu od zahraničního dodavatele {supplier}. Tím se z vás stává identifikovaná osoba k DPH: do {deadline} se zaregistrujte a za {month} podejte přiznání k DPH." Resolve: "Už jsem registrován(a)" → opens profile wizard (new effective-dated profile `identifikovana_osoba` from the given date; re-run passes); "Ověřím s účetní" → dismiss.

**IO_TRIGGER_EU_SERVICE_SUPPLIED · v1 · warning** — Applies: issued, line `iss_eu_service`, profile `neplatce`. No side effects (M09 owns the obligation). Message: „Fakturujete službu firmě v EU. Musíte se registrovat jako identifikovaná osoba a podávat souhrnné hlášení." Resolve: as above.

**IO_TRIGGER_EU_GOODS_THRESHOLD · v1 · warning** — Applies: `rcv_eu_goods_acquisition`, profile `neplatce` or `identifikovana_osoba`. Logic: calendar-year Σ base CZK (vat_ledger or derived) `> vat.io_eu_goods_threshold`, fire on the crossing document. Message: „Nákupy zboží z EU letos přesáhly {threshold} Kč – vzniká povinnost přiznat DPH." Resolve: acknowledge / accountant.

**VAT_THRESHOLD_PROXIMITY · v1 · info (≥ warn levels) / warning (exceeded)**
- Applies: income documents (`direction='out'` and `platform_statement`), profile `neplatce`/`identifikovana_osoba`. Uses the **one** turnover function `computeVatTurnover(orgId, asOf)` (§6.2), which wraps M09's pure `isDomesticTurnoverLine` and rule `vat.registration_turnover_policy` (M09 §4.4.1); M03 never re-implements the turnover test.
- Logic: `T_cy` = calendar-year turnover from that function (by `duzp`, fallback `issue_date`). Band = highest of M09's meter levels (`meters.warn_ratio` 0.80, `meters.alert_ratio` 0.95) reached by `T_cy / thresholds.calendar_year`, plus `exceeded_cy` (> calendar_year) and `exceeded_immediate` (> immediate). This result is a document-level note only; the `vat_registration` obligation and notifications come from M09. Fire only on the document whose inclusion raised the band (`params.band`). Legal basis is calendar-year turnover since 2025 (`research/czech-tax-filings.md §3.1` [O]); inclusion of short-term accommodation and platform gross is advisor question TA-05.
- Message: info „Letošní obrat {turnover} Kč je {pct} % limitu pro registraci k DPH ({limit} Kč)."; exceeded_cy „Překročili jste {limit} Kč – od 1. 1. budete plátcem DPH. Přihlášku podejte do 10 pracovních dnů."; exceeded_immediate „Překročili jste {limit} Kč – plátcem DPH jste od zítřka. Přihlášku podejte do 10 pracovních dnů." Resolve: acknowledge; profile wizard.

**PERIOD_LOCKED · v1 · warning (no review) if a filing is `marked_filed` or an own filed return exists; info if `generated`/`downloaded`** (Phase 1: uploaded returns; Phase 3: M05 filings)
- Applies: bookable after M04 built `vat_ledger_entries`; also income docs vs `PODKLADY_DPFO` (info).
- Logic:
  ```
  P = periods of current vat_ledger_entries(doc) ∪ periods recorded for this doc in any filing_documents
  for f in filings where org, type in (DPHDP3, DPHKH1, DPHSHV), state in (generated, downloaded, marked_filed), period overlaps P:
     fd = filing_documents(f, doc)
     if fd and fd.document_revision == doc.revision: ok
     else fail {filing_id, period, kind: fd ? 'changed' : 'added' | 'removed' (doc in fd but no longer in period)}
  for g in government_filing documents (finalized) recognized as DPHDP3 for period p ∈ P and no in-app filing for p:
     fail {external:true, period:p}  // "you filed this period outside the app"
  ```
- Side effects: event `filing.amendment_needed`; M05 owns the amendment flow and M09's generator writes the `vat_amendment` obligation.
- Message: „Doklad patří do {period}, za které už je přiznání {state, select, marked_filed {podané} other {vygenerované}}. {state, select, marked_filed {Bude potřeba podat dodatečné přiznání.} other {Přiznání vygenerujte znovu.}}" Resolve: open the amendment card; or (M04) move the doc to another period only if legally allowed (payer deferral).

**CLS_VAT_TREATMENT_CONFLICT · v1 · warning (review)**
- Applies: lines whose `vat_treatment` source is `user`/`vendor_memory`. Logic: M04 `deriveVatTreatment()` (deterministic, ignoring memory) returns a different treatment *and* the difference is factual (e.g. `rcv_domestic_vat` but `vat=0` and supplier foreign; `rcv_eu_*` but supplier country non-EU). Message: „Zvolený režim DPH ({chosen}) neodpovídá dokladu ({derived})." Resolve: accept derived / keep with reason.

**PERSONAL_LOOKING_PURCHASE · v1 · info + question** (question, not error)
- Applies: rcv item lines; document `business_flag ∈ {business, unknown}` not set by user; vendor profile not pinned and `default_business_flag ≠ 'business'` with confirmations ≥ 2.
- Logic: `score = 0.4·[merchant ∈ validation.personal_purchase.merchants] + 0.3·[line keywords ∈ personal_keywords_cs (oblečení, obuv, batoh, kosmetika, potraviny, alkohol, hračky, sport…)] + {personal:0.4, mixed:0.2}[M04 LLM business_likelihood] − 0.5·[line keywords ∈ org activity keywords (settings.activity_keywords, e.g. ložní prádlo, úklid, apartmán, server, doména)]`; fire if `score ≥ validation.personal_purchase.threshold` and `docCzk(gross) ≤ validation.personal_purchase.max_amount_czk` (above that, M04's normal questions apply).
- Side effect: `review_questions(kind='business_or_personal')` (M04 owns payload/answer). Message: „Je {item} pracovní, nebo osobní nákup?" Resolve: answer (M04 §4.6).

**XDOC_FILED_RETURN_MISMATCH · v1 · info** (P4 own DPHDP3 decoy) — Applies: finalized `government_filing` with M02 fields `filing.type='DPHDP3'`, `filing.period`, `filing.rows{row:{base,tax}}`. Logic: compare with Σ `vat_ledger_entries` for the period per row, rounded to whole Kč; create `document_links reported_in` from each contributing document to the filing document. Fail if any row differs > 1 Kč; if the difference disappears when evaluated under the other `foreign_service_dppd_policy`, set `params.policy_hint`. Message: „Vaše podané přiznání za {period} se liší od dokladů v aplikaci (řádek {row}: {filed} vs {ours}).{policy_hint, select, issue_date { Zdá se, že zahraniční služby datujete podle data vystavení – chcete to nastavit?} other {}}" Resolve: open profile setting / dismiss.

**XDOC_TOURIST_FEE_MISMATCH · v1 · info** — Applies: `government_filing` recognized as municipal tourist-fee report (`filing.form_code='MUNICIPAL_TOURIST_FEE'`, `filing.period_start`, `filing.fee_total`; 04 §9.4). Logic: compare with Σ tourist-fee amounts of `settlement_statement`/`platform_statement` lines for the same month (`category_code='pt_tourist_fee'` or statement column `tourist_fee`); link `same_period_reconciles`. Fail if `|Δ| > 1`. Golden: 3 500 / 4 150 Kč match. Message: „Poplatek z pobytu za {month}: hlášení {reported} Kč, podle vyúčtování {statements} Kč." Resolve: dismiss.

**XDOC_EXPECTED_INVOICE_MISSING · v1 · info** — Applies: `order_confirmation` whose M01 `expected_documents` row is `open` with `expected_by ≤ today` (M01 `config.link.order_invoice_days`, 30). One source of truth for the reminder: M01. Message: „K objednávce {number} ({amount} Kč) zatím nemáme fakturu." Resolve: upload invoice / "Faktura nebude".

#### J. Manual, imported and substitute documents (phase `pre_categorize`)

**SUBST_NOT_TAX_DOCUMENT · v1 · warning (review → accountant)**
- Applies: bookable, `substitute_reason is not null` (`lost | damaged | never_issued | other`).
- Logic: always fires. Auto-fix: force `tax_doc_status='not_tax_document'` (`source='rule'`, even over `user`: a náhradní doklad is never a tax document). M04 then derives `rcv_domestic_no_vat` for CZ suppliers, so no input VAT is deducted. Self-assessed foreign services still create output VAT. Params `{reason, vat_czk, is_payer}`. The result is listed in the accountant package under "K posouzení účetní".
- Message: „Náhradní doklad ({reason}) není daňový doklad{is_payer, select, true {: DPH {vat_czk} Kč si z něj neodečtete, posoudí to účetní} other {}}."
- Resolve: only the accountant (role `accountant`) or the owner, with a reason, may dismiss it. That dismissal sets `deduction_pct=100` on the lines (M04). **[verify]** ZDPH §73(5): can the deduction be proved by other means? This is the reason the override exists.

**SUBST_PROVE_PAYMENT · v1 · warning (no review)**
- Applies: bookable, `substitute_reason is not null`.
- Logic: fail while no `payment_links` row exists for the document (any `link_type` except `refund`). Pass as soon as one exists (M07 event `payment_link.created` re-runs it). The income-tax effect is allowed meanwhile: M04 builds entries normally.
- Message: „Doložte platbu: u náhradního dokladu je výdaj uznatelný hlavně tehdy, když je vidět platba (výpis z účtu)." Resolve: import a bank statement or link the payment. **[verify]** ZDP §24 evidence requirements for expenses supported by a substitute document.

**IMPORT_FILE_MISSING · v1 · info**
- Applies: `entry_mode='imported'` and `source_file_id is null`.
- Logic: fails while no file is attached. Merge: when a captured document matches the imported row via DUP_SEMANTIC or DUP_PROBABLE ("Je to duplikát"), the system does not mark the imported row as the duplicate. Instead it moves the captured `source_file_id` and `page_from/page_to` onto the imported row, keeps the imported row's `user` fields, records the captured values as non-current `document_fields`, and sets the captured document `status='duplicate'` with link `duplicate_of`. Then the rule passes.
- Message: „Chybí soubor dokladu. Nahrajte sken nebo fotku, spojíme je automaticky." Resolve: upload the file.

### 4.5 Competitor A baseline and how we exceed it

| Competitor A message (internal research (not published)) | Our rule | Beyond Competitor A |
|---|---|---|
| `name/address_autofilled_from_ares_register` | REG_ARES_AUTOFILL | + name mismatch, defunct subject, OCR-IČO repair via ARES |
| `name_autofilled_from_vies_register`, `address_autofill_failed_…` | REG_VIES_AUTOFILL | + stored VIES `requestIdentifier` as proof |
| `sender_tax_id_invalid_in_register`, `tax_id_invalid_in_register` | REG_ARES_NOT_FOUND, REG_VIES_INVALID | stricter for our own EU sales |
| `sender_tax_id_reliable_payer_*` | REG_CRPDPH_UNRELIABLE | profile-aware severity, re-check at payment (M07) |
| `bank_account_adis_*` | REG_CRPDPH_ACCOUNT_NOT_PUBLISHED | §109 threshold aware; + VAT charged without registration |
| `recipient_register_id_non_matching_workspace` | ID_BUYER_NOT_MY_ORG | + consumer invoice without IČO, address mismatch, alias names |
| `sender_register_id_equal_recipient` | ID_SUPPLIER_EQUALS_BUYER | + reclassification proposal (issued invoice) |
| `register_id_check / tax_id_check / vat_id_check`, `*_sanitized` | ID_ICO_CHECKSUM, ID_DIC_FORMAT, ID_VAT_ID_FORMAT, sanitize step | real mod-11, per-country patterns |
| `bank_account_invalid`, `bank_code_autofilled`, `iban_not_valid` | ID_CZ_ACCOUNT_CHECKSUM, ID_IBAN_CHECKSUM, ID_BANK_CODE_UNKNOWN | ČNB code list |
| `var_sym_length_exceeded`, `currency_not_valid`, `date_invalid`, `amount_invalid` | ID_VS_FORMAT, FX_CURRENCY_INVALID, M02 parsing | + FX availability |
| `date_after_today`, `date_after_current_year` | DATE_FUTURE, DATE_IMPLAUSIBLE_YEAR | + DUZP gap, due<issue, deduction window |
| `invalid_tax_rate` | MATH_VAT_RATE_INVALID | rate valid **at the date** (rule tables) |
| `tax_detail_base_check`, `tax_detail_rate_check`, `total_*_check_warning`, `line_items_totals_check` | MATH_VAT_RECAP_ROW, MATH_RECAP_VS_HEADER, MATH_NET_VAT_GROSS, MATH_LINES_VS_HEADER, MATH_LINE_* | **blocking**, per-line tolerance, decimal-shift repair |
| `total_rounding_calculated`, `total_rounding_difference_warning` (> 5 CZK) | MATH_ROUNDING | 1.00 CZK limit, explicit rounding line |
| `total_due_autofilled_from_total_incl_tax` | MATH_AMOUNT_DUE | paid-by-card → 0 (their demo left it empty) |
| `invoice_duplicity` | DUP_EXACT_FILE, DUP_SEMANTIC, DUP_PROBABLE | pHash + OCR-confusable numbers |
| — | TAXDOC_*, IO_TRIGGER_*, VAT_THRESHOLD_PROXIMITY, CASH_PAYMENT_LIMIT, PERIOD_LOCKED, PERSONAL_LOOKING_PURCHASE, XDOC_* | tax-legality layer Competitor A lacks entirely |

## 5. Data

### 5.1 Read / written
Read: see §3. Written: `validation_results` (all columns; `rule_version` from definition), `document_fields` (patches), denormalized `documents`/`document_lines` columns for patched keys, `documents.status`, `documents.stage_version.validate`, `partners.{name,address,dic,vat_id,is_vat_payer,is_unreliable_payer,registry_checked_at}`, `partner_bank_accounts.{published_in_crpdph,checked_at}`, `registry_cache`, `review_questions` (kinds `confirm_field`, `business_or_personal`), `notifications`, `document_links`, `audit_log` (every auto-fix: `actor_kind='system'`, diff), `organizations.settings.{alias_names, known_addresses}` (user resolutions).

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §4 `validation_results.dismiss_reason`, 05 §4 `source_files.phash` (one `bit(64)` column, written by M01, read here via `ingest_items.near_duplicate_candidate_id`) and 05 §3 `bank_codes`.

### 5.3 Rule keys
Merged into 06 §2 (law keys §2.1, product keys `validation.*`, `registry.*`, `fx.max_lookback_days` §2.2) on 2026-10-18. Removed as duplicates: `validation.dup_phash_max_distance`, `validation.expected_invoice_days`, `validation.vat_threshold_warn_pcts`, `io_triggers.registration_days`.

## 6. Interfaces

### 6.1 Types (`packages/validation/src/types.ts`)
```ts
export type RuleGroup = 'REQ'|'MATH'|'ID'|'REG'|'TAXDOC'|'DATE'|'DUP'|'FX'|'CASH'|'PROFILE'|'XDOC';
export type Phase = 'pre_categorize'|'post_categorize';
export type RegistryDep = 'ares'|'crpdph'|'vies'|'fx'|'filings'|'history';
export interface RuleDefinition {
  id: RuleId; version: number; group: RuleGroup; phase: Phase; requires: RegistryDep[];
  appliesTo(ctx: ValidationContext): boolean;
  evaluate(ctx: ValidationContext): RuleOutcome;          // pure
  severity(ctx: ValidationContext, o: RuleOutcome): Severity;
  review(ctx: ValidationContext, o: RuleOutcome): boolean;
  materialParams: string[];                               // reopen dismissed results when these change
  messageKey: `validation.${RuleId}.message`;
}
export interface RuleOutcome { passed: boolean; fieldKeys: string[]; params: Record<string, unknown>;
  autoFix?: { patches: FieldPatch[]; keepIf?: RuleId[] } ; sideEffects?: SideEffect[]; }
export interface FieldPatch { fieldKey: string; value: unknown; source: 'rule'|'registry'|'derived'; confidence: number; }
export type SideEffect =
  | { kind: 'question'; questionKind: 'confirm_field'|'business_or_personal'; payload: unknown }
  | { kind: 'link'; to: string; linkKind: DocLinkKind } | { kind: 'notify'; notificationKind: string; payload: unknown }
  | { kind: 'set_status'; status: 'duplicate'|'supporting' };
export interface ValidationContext {
  doc: DocumentSnapshot; lines: LineSnapshot[]; vatSummary: VatSummaryRow[]; fields: FieldSnapshot[];
  me: { ico: string; dic: string|null; legalName: string; address: Address; aliasNames: string[]; knownAddresses: Address[] };
  profileAt: (d: LocalDate) => TaxpayerProfile; rules: (d: LocalDate) => RuleSet; today: LocalDate;
  registry: { ares?: RegistryResult<AresSubject>; crpdph?: RegistryResult<CrpdphSubject>; vies?: RegistryResult<ViesResult> };
  fx: (currency: string, d: LocalDate) => FxRate|null;
  history: { duplicates: DuplicateCandidate[]; cashSameDay: CashDocSummary[]; filings: FilingSnapshot[];
             ownFiledReturns: FiledReturnSnapshot[]; vatLedger: VatLedgerRow[]; turnover: VatTurnover };
}
export interface ValidationRunResult { outcomes: Array<RuleOutcome & { ruleId: RuleId; severity: Severity; review: boolean }>;
  patches: FieldPatch[]; sideEffects: SideEffect[]; statusHint: 'blocked'|'review'|'clear'; catalogVersion: string; }
```

### 6.2 Functions
```ts
export function runValidation(ctx: ValidationContext, phase: Phase): ValidationRunResult;                 // pure
export async function validateDocument(orgId: string, documentId: string,
  opts: { phase: Phase; trigger: ValidationTrigger; registryMode?: 'live'|'cache_only' }): Promise<ValidationSummary>;
export async function checkSemanticDuplicate(tx: Tx, orgId: string, key: { partnerId: string|null; supplierKey: string|null;
  documentNumber: string; totalGross: string; currency: string; direction: 'in'|'out' }): Promise<{ originalId: string }|null>;
export async function dismissValidation(orgId: string, documentId: string, ruleId: RuleId, userId: string, reason?: string): Promise<void>;
export async function resolveByAction(orgId: string, documentId: string, ruleId: RuleId, action: ResolutionAction, userId: string): Promise<void>;
export function canBecomeReady(results: Pick<ValidationResultRow,'severity'|'state'|'rule_id'>[], catalog: RuleDefinition[]): boolean;
export async function computeVatTurnover(orgId: string, asOf: LocalDate): Promise<VatTurnover>;  // {calendarYear, rolling12m, band}
// lib
export function icoValid(ico: string): boolean; export function czAccountValid(prefix: string|null, number: string): boolean;
export function ibanValid(iban: string): boolean; export function czAccountToIban(a: CzAccount): string;
export function dicFormat(dic: string): 'legal'|'natural'|'invalid'; export function nameSim(a: string, b: string): number;
```
`ValidationTrigger = 'pipeline'|'user_edit'|'registry_recovered'|'fx_imported'|'filing_changed'|'profile_changed'|'catalog_upgrade'|'payment_check'`.
`ResolutionAction = 'swap_parties'|'reclassify_issued'|'is_my_document'|'not_my_document'|'is_my_address'|'is_duplicate'|'not_duplicate'|'is_credit_note'|'already_registered_io'|'treat_supplier_as_non_payer'`.

### 6.3 Jobs (pg-boss; payloads zod in `packages/pipeline/jobs.ts`)
```ts
export const ValidateDocumentJob = z.object({ orgId: z.string().uuid(), documentId: z.string().uuid(),
  revision: z.number().int(), phase: z.enum(['pre_categorize','post_categorize']),
  trigger: z.enum(['pipeline','registry_recovered','fx_imported','filing_changed','profile_changed','catalog_upgrade','payment_check']) });
// name 'doc.validate' (03 §3.1), key `${orgId}:validate:${documentId}:${revision}:${phase}:${catalogVersion}`
export const RegistryRetryJob = z.object({ orgId: z.string().uuid(), documentId: z.string().uuid(),
  sources: z.array(z.enum(['ares','crpdph','vies'])).min(1), attempt: z.number().int().min(1) });   // 'validate.registry_retry'
export const RevalidateScopeJob = z.object({ orgId: z.string().uuid(),
  scope: z.discriminatedUnion('kind', [ z.object({ kind: z.literal('period'), periodStart: z.string(), periodEnd: z.string() }),
    z.object({ kind: z.literal('from_date'), from: z.string() }), z.object({ kind: z.literal('unverified') }),
    z.object({ kind: z.literal('fx_missing'), currency: z.string().length(3) }) ]),
  trigger: z.string() });                                                                            // 'validate.scope'
// cron 'validate.catalog_upgrade' 02:30 Europe/Prague: enqueue validate.scope for docs with stage_version.validate != CATALOG_VERSION (non-finalized first; finalized docs only re-run, never auto-patched)
```
Retries: 3 with exponential backoff; dead-letter → Sentry. Registry failures never fail the job (degradation path).

### 6.4 API routes (Route Handlers, `/api/v1`, RLS-scoped)
- `GET /documents/{id}/validations` → `{results: ValidationResultDTO[], canBecomeReady: boolean}` (DTO includes rendered Czech message).
- `POST /documents/{id}/validations/{ruleId}/dismiss` `{reason?: string}` → 204. Not allowed for `blocking` (409).
- `POST /documents/{id}/validations/{ruleId}/resolve` `{action: ResolutionAction}` → 200 updated document.
- `POST /documents/{id}/revalidate` → 202.
- `GET /registry/status` → `{ares, crpdph, vies, cnb: 'ok'|'degraded'|'down', since}` (for the banner).

### 6.5 Events (published as pg-boss jobs on topic queues)
`document.validated`, `validation.result_opened {ruleId, severity}`, `validation.result_resolved`, `registry.recovered {source}`, `filing.amendment_needed {periodStart}`.

## 7. UX touchpoints

- **Document detail:** top strip with chips: „ARES ✓", „Spolehlivý plátce ✓", „Účet zveřejněn ✓", „VIES ✓" or grey „neověřeno". Below: list of open results, blocking first, each with one-sentence Czech message and one primary action ("Opravit" focuses the field and highlights its PDF bbox; "Rozumím"; rule-specific actions).
- **Math failure:** the conflicting cells are outlined red on both the form and the PDF overlay; the message shows the arithmetic ("2 × 499,00 = 998,00, na dokladu je 989,00").
- **Info results** are collapsed under „Upozornění (2)" — never in the review queue.
- **Global banner** when a registry is down > 30 min: „Registr plátců DPH teď nefunguje. Doklady zpracováváme dál, ověříme je později."
- **Copy rules:** no jargon in the default view (say „přiznání k DPH", not „DPHDP3"; „odběratel" is OK). Show amounts with Czech formatting (`12 960,84 Kč`).

## 8. Edge cases and failure modes

- **Multi-rate document with per-line VAT rounding** → `vat_row_per_line` tolerance scales with line count, capped at 1.00.
- **Prices incl. VAT (retail receipts)** → MATH_LINE_QTY_PRICE compares with `gross`; recap base derived by M02 from gross/rate; MATH_VAT_RECAP_ROW then validates the printed recap.
- **Foreign-currency invoice with CZK VAT recap** (CZ-registered foreign supplier, §29 VAT in CZK) → MATH rules run in document currency; the CZK recap is validated as `|vat_czk − round2(vat_foreign × doc_fx)| ≤ 1.00`; mismatch → info only (supplier may use a different legitimate rate, `research/registries-and-formats.md §4.3` time-of-day trap).
- **Booking invoice: two service lines, no VAT, NL supplier** → MATH passes with rate 0/none; TAXDOC_RC_BUYER_VAT_ID_MISSING only on the one issued 3 Aug (July period).
- **Registry returns a *different* subject for the IČO** (OCR error yields a real IČO) → REG_ARES_NAME_MISMATCH warning; ID_ICO_CHECKSUM auto-fix only applies when the corrected IČO name-matches.
- **User edits a field that an auto-fix set** → user value wins forever (`source='user'`), rule may re-fail → shown, not auto-fixed again.
- **Org without DIČ (non-payer without IO)** → buyer-DIČ comparisons skip; buyer IČO and name still compared.
- **OSVČ name vs trade name** ("Josef Novák – Penzion Novák") → `nameSim` against `legal_name` and `alias_names`; first resolution adds the alias.
- **Two cash receipts the same day from the same merchant** → summed by counterparty key; different merchants are not summed.
- **Duplicate detection across years with recycled numbers** → amount equality makes collision unlikely; if it happens the user edits the number (e.g. adds year) per DUP_SEMANTIC.
- **Catalog upgrade on finalized documents** → results recalculated and shown, but patches are never applied to finalized documents (immutable; 03 §3); a new blocking result on a finalized document raises a notification to the owner and accountant instead of changing status.
- **Clock/timezone**: all date rules use `Europe/Prague` local date; a document uploaded at 00:30 local is not "future".
- **Validation job crash mid-way** → single transaction; retried idempotently; partial writes impossible.

## 9. Acceptance criteria and test plan

### 9.1 Acceptance criteria
1. Every rule in §4.4 exists as a `RuleDefinition` with ≥ 1 passing and ≥ 1 failing unit fixture; `CATALOG_VERSION` changes when any rule version changes.
2. A document with any open `blocking` result never reaches `ready`/`finalized` and has no ledger entries (integration test).
3. Registry outage simulation (ARES/CRPDPH/VIES fake returning 503/timeout): documents still reach `ready`; exactly one `REG_UNVERIFIED` per document; after `registry.recovered` the registry rules run and `REG_UNVERIFIED` becomes `resolved`.
4. Dismissed warning stays dismissed across re-runs unless a `materialParams` value changes (property test over random param mutations).
5. `icoValid('27074358') === true`, `icoValid('27074359') === false`; CZ account and IBAN validators pass the ČNB/ISO test vectors in `testkit/vectors/`.
6. Auto-fixes are recorded in `document_fields` with `source ∈ {rule, registry, derived}` and in `audit_log`; no auto-fix ever overwrites `source='user'` (property test).
7. Re-validation after a user edit (cache-only registries) completes in < 300 ms p95 on a 30-line document (benchmark in CI).
8. **Golden set v1** (`testdata/golden-v1`, expected results in `expected/validation.json`):
   - a. Alza „Faktura" 117 Kč: `TAXDOC_NOT_TAX_DOCUMENT` info (profile IO), discount lines negative after extraction or after MATH_DISCOUNT_SIGN fix, MATH_ROUNDING info with rounding line 0,05 (sign as printed), no blocking.
   - b. IKEA NFC/NFD PDFs: second file `DUP_EXACT_FILE`, `status='duplicate'`; IKEA receipt: `simplified_tax_document`, all MATH pass (recap 21 %), no TAXDOC warning (1 198 ≤ 10 000).
   - c. Decathlon PNG twice: second is duplicate (`DUP_EXACT_FILE` or `DUP_PROBABLE` if re-encoded); first: `PERSONAL_LOOKING_PURCHASE` fires and a `business_or_personal` question exists.
   - d. Apple MacBook 26 990 Kč: `ID_BUYER_CONSUMER_NO_ICO` warning (no review), `ID_BUYER_ADDRESS_MISMATCH` info, supplier CZ DIČ → no `REG_CRPDPH_VAT_WITHOUT_REGISTRATION` (fake CRPDPH says payer), no blocking.
   - e. Booking invoice issued 3 Aug (July period): `TAXDOC_RC_BUYER_VAT_ID_MISSING` info; Booking invoice issued 3 Sept (August period): not raised; both: REG_VIES pass (fake VIES valid), no IO trigger (profile IO).
   - f. Property-manager invoices: MATH pass (21 %, 12 960,84 / 9 749,44), `REG_CRPDPH_UNRELIABLE` pass, account check evaluated (fixture published → chip ✓).
   - g. Cleaning invoices (non-payer s.r.o.): no VAT rules fire; ARES autofill info if name missing.
   - h. Cloudflare $10.46 and Anthropic €90: `FX_RATE_UNAVAILABLE` absent when fixture rates are loaded; present (info) and auto-resolved after loading rates.
   - i. Decoys: no MATH/TAXDOC rules run on `order_confirmation`, `settlement_statement`, `government_filing`; the filed DPHDP3 Aug 2026 with profile policy `issue_date` → `XDOC_FILED_RETURN_MISMATCH` passes; with policy `service_period_end` → fails with `params.policy_hint='issue_date'`; tourist-fee reports 3 500 / 4 150 → `XDOC_TOURIST_FEE_MISMATCH` passes.
   - j. With a P4 profile switched to `neplatce` before July 2026, Booking July invoice → `IO_TRIGGER_FOREIGN_SERVICE` with deadline = vat_point_date + 15 days (shifted); the `io_registration` obligation comes from M09's generator, not from M03.
   - k. Adding a new Booking-like invoice into August 2026 after the uploaded filed return → `PERIOD_LOCKED` warning (`external:true`).
9. Entry modes: (a) a manual document with a typed line-sum error gets `MATH_LINES_VS_HEADER` blocking and no auto-fix; (b) a manual copy of an existing invoice gets `DUP_SEMANTIC`; (c) a substitute document gets `tax_doc_status='not_tax_document'`, `SUBST_NOT_TAX_DOCUMENT` (review) and `SUBST_PROVE_PAYMENT`, which resolves after a payment link is inserted; (d) an imported file-less row gets `IMPORT_FILE_MISSING`, and uploading the matching scan merges into it and resolves the rule.
10. Synthetic math set (`testkit/synthetic/math-500`): 0 false "pass" on planted errors (sign, decimal shift, swapped base/VAT, missing line), ≤ 1 % false "fail" on clean documents.

### 9.2 Test plan
- **Unit:** one spec per rule (`rules/**/__tests__`), table-driven fixtures; helpers with vectors.
- **Property (fast-check):** generated consistent documents (random lines, rates from rules, rounding ≤ limit) must pass MATH; any single mutation of an amount by ≥ tolerance must fail exactly the expected rule(s); auto-fix idempotency (`run(run(x)) == run(x)`).
- **Contract:** registry clients against recorded responses (`packages/registries/__recordings__`), incl. CRPDPH status 1/2/3, VIES `MS_UNAVAILABLE`.
- **Integration (testcontainers Postgres):** pipeline from extracted fixture → validate → status; upsert/reopen semantics; DUP_SEMANTIC vs unique index race (two concurrent inserts → one duplicate).
- **E2E (Playwright):** fix a planted math error by clicking the PDF cell; dismiss a warning and see it in the accountant export notes.
- **Golden:** nightly `pnpm eval:golden --module validation` compares results with `expected/validation.json` (exact rule ids and severities).

## 10. Maintenance

| Source of change | Containment | Effort/yr |
|---|---|---|
| VAT rates, simplified-doc/KH limits, IO threshold, cash limit (EU €10 000 from 10 Jul 2027) | rule tables; rules read `rules.at(date)` | 0.5 day |
| Registry API changes (ARES version, CRPDPH host move, VIES error codes) | client + recorded contracts + health monitor (06 §3) | 0.5–1 day |
| ČNB bank code list | monthly automated refresh job, alert on parse failure | ~0 |
| New fraud/legality patterns, false-positive tuning | `validation.*` keys via `rules_overrides`; monthly dismissal-rate report per rule (alert if a rule's dismissal rate > 30 %) | 1 day |
| Total | | **2–3 days/year** |

Monitors: per-rule fire rate and dismissal rate (weekly digest), REG_UNVERIFIED share > 5 % over 24 h → alert, MATH blocking rate jump > 2× baseline → alert (usually an extraction regression).

## 11. Open questions
Consolidated in `22-open-questions.md`: TA-03 (consumer invoice as evidence), TA-04 (foreign VAT charged to a CZ business), TA-05 (turnover definition), TA-02 (substitute documents), T-12 (natural-person DIČ patterns), T-19 (cash limit after 10 Jul 2027). Resolved (22 §F): `PERIOD_LOCKED` before joining applies only to periods with an uploaded own return; the personal-purchase merchant list is curated by the maintainer through data PRs.
