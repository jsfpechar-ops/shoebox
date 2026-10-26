# M04: Categorization and derived ledgers

Phase 1 (MVP) for classification, questions, learning and both ledgers. Phase 2 adds payment-link-driven cash dating (M07); Phase 3 consumes the VAT ledger (M05). Packages: `packages/domain/taxonomy`, `packages/domain/vat-routing`, `packages/domain/ledgers` (pure), `packages/pipeline/stages/categorize.ts` + `stages/ledger.ts` (I/O). Names follow `04-domain-model.md` / `05-data-model.md`.

---

## 1. Purpose and scope

**Purpose.** For every line of every bookable document decide *what the money was for* (`category_code`), *how VAT applies* (`vat_treatment`, `vat_rate_type`), *how much is business* (`business_share_pct`) and the resulting `deductibility` (04 §3); explain it in one Czech sentence (`documents.summary_cs`); ask the user only what cannot be derived; learn from confirmations; and derive two rebuildable ledgers: `tax_ledger_entries` (income tax, cash basis) and `vat_ledger_entries` (VAT point date, period, DPHDP3 rows, KH section).

**In scope:** decision cascade (§4.1), deterministic VAT treatment derivation (§4.2), LLM classifier prompt + schema (§4.3), summary generation (§4.4), questions (§4.5–4.6), learning loop (§4.7; cross-tenant global priors: Later), VAT point date and period (§4.8), FX (§4.9), DPHDP3/KH mapping (§4.10), tax ledger (§4.11), VAT ledger (§4.12), rebuild/idempotency (§4.13), finalized/filed edits (§4.14), transaction classification helper for M07 (§4.15).
**Out of scope:** filing generation and the simple-period check (M05), podklady totals (M06), payment matching (M07), depreciation, km allowances, §75 pro-rata deduction maths (flagged → accountant).

## 2. User stories

- **P1 Petra:** "Figma and Canva invoices are categorized as software without me doing anything, and I see that I owe VAT on them this month."
- **P2 Tomáš:** "Fuel and van service ask me once how I use the car; afterwards they are categorized and shared automatically."
- **P3 Lucie:** "Shipping and payment-gateway fees are separated from goods for resale; VAT on domestic invoices lands in row 40 and KH B2/B3 correctly."
- **P4 Josef:** "Manager invoices are 'Správa apartmánu – daňově uznatelný náklad, DPH je součástí nákladu', Booking commission goes into my monthly identified-person return, and the tourist fee is not counted as income or expense."
- **Accountant:** "Every line has a category, a VAT treatment, a source and a confidence; ledgers are reproducible from documents, and I can see what was confirmed by the client."

## 3. Inputs / outputs

**Inputs:** validated documents (`status='categorizing'` after M03 `pre_categorize`), `document_lines`, `document_vat_summary`, `documents.tax_doc_status`, `partners` (country, `is_vat_payer`, VAT ID, ARES `czNace` via `registry_cache`), `vendor_profiles`, `categories` (valid at `issue_date`), `taxpayer_profiles` (`profile.at(date)`), `organizations.settings` (`activity_keywords`, `car`, `share_priors`), `payment_links`, `transactions`, `fx_rates`, `filings`, `filing_documents`, `review_questions` (answers), `rules.at(date)`.
**Outputs:** `document_lines.{category_code, vat_treatment, vat_rate_type, vat_rate_pct, business_share_pct, classification_source, classification_confidence}` (+ `deductibility`), `documents.{summary_cs, business_flag, vat_point_date, fx_rate, fx_rate_date, stage_version.categorize, stage_version.ledger}`, `document_fields` (provenance of each classification value), `review_questions`, `vendor_profiles`, `tax_ledger_entries`, `vat_ledger_entries`, `extraction_runs` (stage `categorize`, LLM cost), events.

## 4. Detailed behavior and algorithms

### 4.1 Decision cascade per line

Processed per document; lines with `line_type='text'` are skipped. For each line the cascade decides `category_code`; the first source producing a valid code (direction matches, category valid at `issue_date`, not hidden-only) with `confidence ≥ its floor` wins. Each stage records `decidedBy`.

| # | Source (`decidedBy`) | Condition | `classification_source` | Confidence |
|---|---|---|---|---|
| 0 | `user_line` | the line's current `category_code` has `document_fields.source='user'` | `user` | 1.00 |
| 1 | `hard_rule` | structural rules H1–H5 below (cannot be overridden except by stage 0) | `rule` | 0.98 |
| 2 | `user_vendor_rule` | `vendor_profiles.pinned=true` (user chose "Vždy takto") and `multi_category=false` | `vendor_memory` | 0.99 |
| 3 | `vendor_memory` | `vendor_profiles.confirmations ≥ classification.vendor_memory_min_confirmations` (2) and `multi_category=false` | `vendor_memory` | `min(0.97, 0.88 + 0.02·confirmations)` |
| 4 | `global_prior` (**Later**; skipped until `global_vendor_priors` exists, 05 §9.1) | `global_vendor_priors` row for supplier IČO (CZ) or VAT ID with `support ≥ classification.global_prior_min_support` (5), org `settings.share_priors≠false` | `rule` | 0.85 |
| 5 | `soft_rule` | keyword/NACE/document-flag rules S1–S4 | `rule` | per rule (0.70–0.92) |
| 6 | `llm` | LLM classifier (§4.3), called once per document for all unresolved lines | `llm` | `min(model_confidence, 0.92)` |
| 7 | `fallback` | nothing applied | `rule` | 0.00 → `which_category` question |

The brief's order "user rule > vendor memory > global priors > deterministic rules > LLM" is kept; **hard rules** are the structural subset of deterministic rules that must outrank memory (a manager's invoice with a tourist-fee line must not inherit "property management" for that line).

**Hard rules (data: `classification.hard_rules`, versioned seed):**
- H1 `line_type ∈ {rounding, shipping}` → category of the document's dominant item line (largest `|gross|`, tie → lowest position); `discount` → category of the nearest preceding item line, else dominant.
- H2 `line_type='advance_deduction'` → same category as dominant; tax ledger handles it as a negative weight (§4.11).
- H3 tourist fee: description matches `poplatek z pobytu | místní poplatek z pobytu | city tax | tourist tax | taxe de séjour | Kurtaxe`, or M02 statement column `tourist_fee` → `pt_tourist_fee`; `kauce | security deposit | damage deposit` → `pt_deposit`.
- H4 supplier is a tax authority / insurer (IČO or account in rule `bank.authority_accounts`, owned by M07 [verify list, T-14]) → `tax_*`/`ins_*` per entry.
- H5 `document_class='received_credit_note'` with `corrects` link → category per line of the original (matched by description similarity ≥ 0.8, else dominant of the original).

**Soft rules (data: `classification.soft_rules`):**
- S1 Platform: supplier name/VAT ID in `classification.platforms` (Booking.com B.V., Airbnb Ireland UC, …) and description matches `commission|provize|Kommission` → `exp_platform_commission` (0.92); `payment(s)? (service|charge|fee)|platební služb` → `exp_payment_fees` (0.92); `platform_statement` reservation/payout gross lines → `income_accommodation` if `settings.activity_keywords` includes accommodation, else `income_platform_payout` (0.90).
- S2 Keyword table `classification.keyword_rules` (cs/en/de, normalized, whole-word): e.g. `úklid|cleaning` → `exp_cleaning`, `správa (nemovitosti|apartmánu)|property management|správce` → `exp_property_management`, `doména|domain|DNS|hosting` → `exp_hosting_domains`, `předplatné|subscription|SaaS|API usage|credits` → `exp_software_saas`, `nafta|benzín|natural 95|diesel` → `exp_fuel`, `poštovné|doprava|shipping` → `exp_postage_shipping` (0.80 each; 0.88 if two keywords agree).
- S3 Supplier NACE (ARES `czNace`) via `classification.nace_category_map` (e.g. `81.21`→`exp_cleaning`, `68.32`→`exp_property_management`, `69.20`→`exp_accounting_legal`, `61.*`→`exp_telecom`, `35.*`→`exp_energy`): 0.75 alone; 0.90 if S2 agrees; applies only if the document has ≤ 2 item lines.
- S4 Issued side defaults: `issued_invoice` → `income_services` (0.70) unless lines look like goods (S2 goods keywords) → `income_goods`.

**Acceptance per line:** `confidence ≥ classification.auto_accept_confidence` (0.80) → accepted. Below → accepted provisionally *and* a `which_category` question (§4.5) is created; the document goes to `needs_review` unless every low-confidence line totals < `classification.low_value_skip_czk` (100 Kč), in which case the line keeps the best guess and an info note.

**Asset check (after category):** for each item line in `exp_material | exp_small_assets | exp_office_supplies | exp_other_deductible | exp_repairs` compute unit acquisition cost `uc = (net_czk + nonDeductibleVat_czk) / max(quantity,1)` where `nonDeductibleVat = vat` unless the profile at `vat_point_date` is `platce` with deduction allowed. If `uc > rules.asset.capitalization_threshold` → category `asset_long_term` (tax_effect `asset`) + question `asset_over_threshold`; else if the item is a durable good (LLM `asset_candidate=true` or S2 durable keywords) → `exp_small_assets`.

**business_share_pct** (cascade): `user` answer > vendor `default_business_flag` (`business`→100, `personal`→0, `mixed`→ask) with confirmations ≥ 2 > car settings for `exp_fuel|exp_car_operating|exp_car_lease` (`settings.car.business_share_pct`) > default 100. If the line category is `private_expense`, share = 0. `documents.business_flag` = `business` if all lines 100, `personal` if all 0, `mixed` otherwise, `unknown` while a `business_or_personal` question is open.

**deductibility** (pure, `deriveDeductibility(category, share, rules)`): tax_effect `deductible_expense` → share=100 `deductible`, 0<share<100 `partially_deductible`, share=0 `non_deductible`; `non_deductible_expense` → `non_deductible`; `asset` → `not_applicable` (depreciation is the accountant's job, listed in podklady); `private` → `non_deductible`; all income, `pass_through`, `transfer`, `tax_or_insurance_payment` → `not_applicable`.

### 4.2 VAT treatment (deterministic, `deriveVatTreatment`)

VAT treatment is **never** taken from memory or the LLM directly; they only resolve the one genuinely ambiguous input, `supply_kind ∈ {service, goods}` for foreign suppliers (order: user > vendor `default_vat_treatment` implying a kind > global prior > S2 goods/service keywords > LLM `supply_kind` > question `supply_kind`).

```
input: line, doc, supplier {country, cz_dic?: CZ…, vat_id?, is_vat_payer?}, category, supplyKind, profile
EU = rules.eu_member_states(doc.issue_date)          // data, excludes CZ
if direction == 'in':
  if category.tax_effect in (pass_through, tax_or_insurance_payment, transfer) or category in rules.vat.out_of_scope_categories
                                                       → rcv_out_of_scope
  if line.rc_commodity_code or doc flag 'reverse_charge_92a' and supplier.cz_dic → rcv_domestic_reverse_charge
  if doc flag 'customs_declaration' (JSD)              → rcv_import_customs
  if supplier.cz_dic:                                  // includes foreign companies registered for CZ VAT (Apple Distribution Intl)
      if doc.tax_doc_status == 'not_tax_document'      → rcv_domestic_no_vat     (04 §3.2)
      if line.vat > 0 or line.vat_rate_pct > 0         → rcv_domestic_vat
      else                                             → rcv_domestic_no_vat
  if supplier.country == 'CZ'                          → rcv_domestic_no_vat
  foreignVat = line.vat > 0 (rate not a CZ rate or supplier without CZ DIČ)
  if foreignVat                                        → rcv_foreign_vat_charged   (+ M03 TAXDOC_FOREIGN_VAT_CHARGED_B2B)
  if supplier.country in EU:
      supplyKind == 'goods'                            → rcv_eu_goods_acquisition
      supplyKind == 'service'                          → rcv_eu_service_reverse_charge
  else (non-EU):
      supplyKind == 'service'                          → rcv_non_eu_service_reverse_charge
      supplyKind == 'goods'                            → rcv_import_customs       (→ accountant; invoice is cost only)
  supplyKind unknown                                   → provisional by category (exp_software_saas|exp_hosting_domains|exp_platform_commission|exp_advertising|exp_services_general → service) else question
if direction == 'out': (issued; M08 later)
  customer.cz_dic or customer.country=='CZ' or B2C   → profile.platce ? (rc_code ? iss_domestic_reverse_charge : iss_domestic_vat) : iss_no_vat
  customer EU with valid VAT ID: service → iss_eu_service, goods → iss_eu_goods (payer) / iss_no_vat (IO, SH only for services)
  customer non-EU: service → iss_non_eu_service, goods → iss_export_goods
  platform_statement income lines                      → profile.platce ? iss_domestic_vat : iss_no_vat   (accommodation in CZ)
```
`vat_rate_type`: CZ VAT lines from the printed rate mapped through `vat.rates` at `vat_point_date` (`standard|reduced|zero`); self-assessed lines default `standard` unless the category is in `rules.vat.reduced_rate_categories` [verify per service]; out-of-scope/no-VAT lines `none`. `vat_rate_pct` is resolved from rules at `vat_point_date` (self-assessed) or copied from the document (domestic).

Place-of-supply exceptions (hotel/event/transport abroad, immovable property abroad) arrive as `rcv_foreign_vat_charged` when foreign VAT is printed; if no VAT is printed for such a service the LLM flag `place_of_supply_abroad=true` routes to `rcv_out_of_scope` + info note "ověřte s účetní" [verify].

### 4.3 LLM classifier

Called only when ≥ 1 line is unresolved after stage 5, or `summary.subject` is missing, or the personal-purchase heuristic needs `business_likelihood`. Model: `classification.llm.model` (default Claude Haiku 5.5, effort low); one retry on invalid JSON or a code outside the enum; escalate to Sonnet 5.5 only if two invalid attempts. Prompt version `categorize.v1` stored in `extraction_runs.prompt_version`. The static part (instructions + category list + few-shots) is prompt-cached. Input text only (no images); descriptions are truncated to 200 chars/line, max 60 lines (beyond: group by identical description).

**System prompt (`packages/extraction/prompts/categorize.v1.md`):**
```
You classify the line items of one Czech business document for a small Czech business (OSVČ).
You are NOT deciding taxes. You choose a spending/income category from a fixed list, say whether each
line is a service or goods, and judge whether the purchase looks business or personal for THIS business.

Rules:
1. Use ONLY category codes from <categories> whose direction equals <document.direction>.
2. Read each category's explanation; pick the most specific one. Prefer the business's own activities
   (<business.activities>) when interpreting ambiguous items (e.g. bed linen for a short-term rental is business).
3. Never invent amounts, dates or suppliers. Do not output VAT rows or tax advice.
4. confidence: your probability (0–1) that category_code is what a Czech accountant would choose.
   Below 0.6, also give alternative_category_code.
5. asset_candidate = true for durable items used > 1 year (laptops, phones, furniture, tools, machines).
   mixed_use_item = true for items commonly used both privately and for business (laptop, phone, car, camera, TV).
6. business_likelihood: "personal" only for items with no plausible link to <business.activities>
   (clothing, sports gear, toys, groceries, cosmetics, alcohol); "mixed" for mixed_use items; else "business".
7. subject_cs: 2–5 Czech words, nominative, no supplier name unless it is the product (e.g. "Provize Booking.com"),
   describing what was bought or sold, e.g. "Úklid apartmánu", "Správa apartmánu", "Prodloužení domény",
   "Předplatné AI nástroje", "Notebook MacBook Air", "Batoh".
8. reason_cs: at most 12 Czech words, plain language, why this category.
9. place_of_supply_abroad = true only for services physically consumed outside the Czech Republic
   (hotel, restaurant, event ticket, local transport abroad).
Return JSON matching the schema. No prose.

<categories>
{{#each categories}}{{code}} | {{direction}} | {{tax_effect}} | {{label_cs}} | {{explanation_cs}}
{{/each}}</categories>
<examples>{{few_shots}}</examples>   // 8 fixed examples from testkit (cleaning, manager, Booking, Cloudflare, IKEA, Decathlon, MacBook, Alza)
```
**User message:**
```json
{"document":{"class":"received_invoice","direction":"in","supplier":{"name":"…","country":"NL","vat_payer":null,"nace":null},
  "tax_doc_status":"foreign_document","currency":"CZK","issue_date":"2026-08-03","service_period":["2026-07-01","2026-07-31"]},
 "business":{"activities":["krátkodobý pronájem apartmánu","vývoj softwaru"],"nace":"55.20","vat_status":"identifikovana_osoba"},
 "lines":[{"position":1,"description":"Commission","gross":"12 990,12","line_type":"item"},
          {"position":2,"description":"Payments service fee","gross":"709,65","line_type":"fee"}],
 "resolved":{"1":null,"2":null}}
```
**Output JSON schema (`categorize.v1.schema.json`, enforced via tool use / structured output):**
```json
{"type":"object","additionalProperties":false,"required":["document","lines"],
 "properties":{
  "document":{"type":"object","additionalProperties":false,
    "required":["subject_cs","dominant_category_code","business_likelihood"],
    "properties":{"subject_cs":{"type":"string","minLength":2,"maxLength":60},
      "dominant_category_code":{"type":"string","enum":["{{codes}}"]},
      "business_likelihood":{"type":"string","enum":["business","personal","mixed","unknown"]},
      "personal_reason_cs":{"type":["string","null"],"maxLength":120}}},
  "lines":{"type":"array","items":{"type":"object","additionalProperties":false,
    "required":["position","category_code","alternative_category_code","confidence","supply_kind",
                "asset_candidate","mixed_use_item","place_of_supply_abroad","reason_cs"],
    "properties":{"position":{"type":"integer","minimum":1},
      "category_code":{"type":"string","enum":["{{codes}}"]},
      "alternative_category_code":{"type":["string","null"],"enum":["{{codes}}",null]},
      "confidence":{"type":"number","minimum":0,"maximum":1},
      "supply_kind":{"type":"string","enum":["service","goods","mixed","not_applicable"]},
      "asset_candidate":{"type":"boolean"},"mixed_use_item":{"type":"boolean"},
      "place_of_supply_abroad":{"type":"boolean"},
      "reason_cs":{"type":"string","maxLength":100}}}}}}
```
`{{codes}}` is expanded at build time from `categories` filtered by direction and validity. Post-processing: positions not in input → dropped; missing positions → fallback; `supply_kind='mixed'` → question `supply_kind`. LLM outputs are stored as `document_fields` (`field_key='lines[i].category_code'`, `source='llm'`, confidence) and `summary.subject` (`source='llm'`).

### 4.4 Plain-language summary (`summary_cs`)

Deterministic template; the LLM only supplies the subject. Regenerated on every classification change; never user-edited (users change the category instead).

```
subject = user subject > fields['summary.subject'] (llm) > vendor_profiles.extraction_hints.subject_cs > category(dominant).label_cs
period  = service_period within one month → " za {monthAcc}"; spans months in one year → " za {m1}–{m2}";
          else if dominant ∈ classification.recurring_categories → " za {monthAcc(duzp ?? issue_date)}"; else ""
          append " {yyyy}" when the year ≠ current year. monthAcc: leden, únor, březen, duben, květen, červen,
          červenec, srpen, září, říjen, listopad, prosinec (accusative = nominative for these nouns).
tax     = by dominant line: deductible → "daňově uznatelný náklad"; partially → "daňově uznatelný z {share} %";
          non_deductible (expense) → "daňově neuznatelný náklad"; private → "soukromý výdaj, do podnikání se nepočítá";
          asset → "dlouhodobý majetek, odpisy řeší účetní"; pass_through → "průběžná položka, není příjem ani náklad";
          taxable_income → "zdanitelný příjem"; non_taxable_income → "nezdanitelný příjem";
          transfer → "převod mezi vlastními účty"; tax_or_insurance_payment → "platba daně nebo pojištění"
vat     = by dominant treatment × profile.at(vat_point_date).vat_status:
          rcv_domestic_no_vat → "bez DPH"; rcv_domestic_vat & (neplatce|IO) → "DPH {rate} % je součástí nákladu";
          rcv_domestic_vat & platce & deduction → "DPH {rate} % si odečtete"; … & deduction blocked → "DPH si neodečtete";
          rcv_eu_*|rcv_non_eu_* & IO → "DPH {rate} % zaplatíte sami v přiznání za {periodMonth}";
          … & platce → "DPH {rate} % přiznáte i odečtete v přiznání za {periodLabel}";
          … & neplatce → "pozor: zakládá povinnost registrace k DPH";
          rcv_foreign_vat_charged → "zahraniční DPH je součástí nákladu"; rcv_out_of_scope, iss_* → omitted unless platce
summary_cs = subject + period + " – " + tax + (vat ? ", " + vat : "")   // ≤ 120 chars; truncate subject with "…"
multi-category documents append " (+ {n} další položky)" when non-dominant lines have another tax_effect.
```
Examples (golden): „Úklid apartmánu za září – daňově uznatelný náklad, bez DPH"; „Správa apartmánu za srpen – daňově uznatelný náklad, DPH 21 % je součástí nákladu"; „Provize Booking.com za červenec – daňově uznatelný náklad, DPH 21 % zaplatíte sami v přiznání za srpen" (policy `issue_date`); „Batoh – soukromý výdaj, do podnikání se nepočítá" (after answer).

### 4.5 Questions to the user (`review_questions.kind`)

Budget: ≤ `classification.max_questions_per_document` (2) per document; further ones are deferred until the first are answered. Questions for the same partner across open documents are grouped into one card with "Platí pro všech {n} dokladů".

| kind | Trigger | Payload | Answer → effect |
|---|---|---|---|
| `business_or_personal` | M03 PERSONAL_LOOKING_PURCHASE, or vendor `default_business_flag='mixed'` | `{line_ids, merchant, item, amount_czk, reason_cs}` | `{flag:'business'\|'personal'\|'mixed', share_pct?, remember:'this'\|'vendor'}` → share 100/0/x; personal → `category_code='private_expense'` (source user) |
| `which_category` | line confidence < accept | `{line_id, top:[{code,label_cs,confidence}] (≤3), reason_cs}` | `{category_code, remember}` |
| `small_asset_business_use` | `exp_small_assets` + `mixed_use_item` (MacBook) | `{line_id, item, amount_czk}` | `{share_pct: 100\|80\|50\|0\|custom}` |
| `asset_over_threshold` | asset check (§4.1) | `{line_ids, item, unit_cost_czk, threshold_czk}` | `{single_item_over_1y: boolean}` → true: `asset_long_term`; false: user picks expense category |
| `car_regime` | first `exp_fuel\|exp_car_*` line in the org (once) | `{trigger_document_id}` | `{regime:'actual_costs'\|'flat_rate_km'\|'not_business_car', business_share_pct}` → `organizations.settings.car`; `flat_rate_km` → fuel lines `non_deductible` with note "paušál na dopravu řeší účetní" [verify]; recorded for the accountant (04 §3.1) |
| `supply_kind` | foreign supplier and kind unresolved | `{line_ids, supplier, description}` | `{kind:'service'\|'goods'}` |
| `relearn_vendor` | user changed category against a vendor profile with confirmations ≥ 2 | `{partner_id, old_code, new_code, count}` | `{scope:'this_only'\|'from_now_on'}` → from_now_on: default replaced, `confirmations=1`, `pinned=true` |

Czech copy (`categorize.question.<kind>.*`): „Je batoh z Decathlonu soukromý, nebo firemní nákup?" [Firemní] [Soukromé] [Napůl] (chips fixed by 07 §2.3 and 04 §9.1); „Používáte MacBook i soukromě? Kolik procent pro podnikání?" [100 %] [80 %] [50 %] [Jiné]; „Notebook za 92 000 Kč je dlouhodobý majetek (nad 80 000 Kč). Je to jedna věc, kterou budete používat déle než rok?"; „Jak používáte auto? Skutečné náklady / Paušál za km / Auto nepoužívám k podnikání"; „Do čeho to patří?" (category picker with the 3 suggestions first, then search).

Answers: `answerQuestion()` writes `review_questions.answer/answered_*`, sets the affected line fields with `source='user'`, updates vendor memory (§4.7) if `remember='vendor'`, re-runs M03 `post_categorize`, regenerates `summary_cs`, enqueues `ledger.rebuild_document`. Accountants may answer (role `accountant`, 05 §10) — recorded as such.

### 4.6 Stage flow (`categorizeDocument`)

1. Load document snapshot, profile at `issue_date`, vendor profile, priors, categories.
2. Run cascade stages 0–5 for all lines; collect unresolved lines.
3. If unresolved or subject missing → LLM (§4.3) → apply stage 6.
4. `deriveVatTreatment` per line; asset check; business share; deductibility.
5. `deriveVatPointDate` (§4.8); resolve `vat_rate_pct`; FX (§4.9) → `documents.fx_rate, fx_rate_date`.
6. Persist line fields + `document_fields` provenance in one transaction; skip fields whose current source is `user`.
7. Create questions (§4.5); `summary_cs`; `business_flag`.
8. Call M03 `validateDocument(phase='post_categorize')`; then status: open blocking/review or open questions → `needs_review`; else `ready` (→ `finalized` if `settings.auto_finalize≠false`, 03 §3).
9. Enqueue `ledger.rebuild_document` (always; non-ready documents produce zero entries, which removes stale ones).

### 4.7 Learning loop

**Confirmation events** (count as one confirmation of the document's *dominant* line classification `(category_code, vat_treatment, business_flag)`): user taps "Potvrdit" on a document in review; user edits any classification field and saves; user answers a question with `remember='vendor'`; accountant marks a package `acknowledged` (each document with no accountant comment counts once, max once per document). **Not** confirmations: auto-finalization, LLM agreement, bulk "approve all" on > 20 documents (counts only for documents the user opened).

`recordConfirmation(org, document)`:
```
p = vendor_profiles(org, partner) or new {confirmations:0}
obs = dominant(document)
if p.default_category_code is null:            p.default_* = obs; p.confirmations = 1
elif p.default_category_code == obs.category:  p.confirmations += 1; p.default_vat_treatment = obs.treatment; p.default_business_flag = obs.flag
elif p.pinned:                                 no change (user rule); question relearn only if the user explicitly changed it
elif p.confirmations <= 1:                     p.default_* = obs; p.confirmations = 1
else:                                          create review_question relearn_vendor (once per (partner,new_code))
multi_category := document has ≥ 2 item lines with different confirmed categories, or the vendor has confirmed ≥ 2 different
                  dominant categories in the last 12 months → true (memory then applies per line only via user_line/LLM)
p.last_confirmed_at = now(); p.extraction_hints.subject_cs = current subject (if user-confirmed)
```
"Zapomenout naučené" (Competitor A parity): `DELETE /vendor-profiles/{id}/memory` resets defaults, confirmations, pinned; documents are not reclassified retroactively unless the user chooses "Přepočítat otevřené doklady" (re-runs categorize for non-finalized documents of that partner).

**Retroactive application:** when a vendor profile reaches the confirmation threshold or is pinned, enqueue `doc.categorize` for that partner's documents in `needs_review|ready` whose lines came from `llm|fallback|soft_rule` (never touches `user` lines or finalized documents).

**Global priors — Later** (moved in the 2026-10-18 review: they need ≥ 5 agreeing orgs per supplier, which the pilot will not have, and raise a GDPR question for natural-person IČOs). Design kept for later (`priors.aggregate`, nightly 03:15 Europe/Prague, service role, cross-tenant read of `vendor_profiles` only):
```
for each public key k (partners.ico for CZ legal persons, partners.vat_id for foreign) across orgs with settings.share_priors != false:
   exclude natural persons: ARES pravniForma in rules.classification.natural_person_legal_forms (101–108…) [verify list]
   votes = distinct org_ids with vendor_profiles.confirmations ≥ 2, grouped by (default_category_code, default_vat_treatment)
   top = argmax(votes); n = |top orgs|; share = n / (distinct orgs with any confirmed profile for k)
   if n ≥ rules.classification.global_prior_min_support (5, k-anonymity) and share ≥ classification.global_prior_min_agreement (0.8):
        upsert global_vendor_priors(k, top.category, top.treatment, support=n, agreement_share=share)
   else delete global_vendor_priors(k)
```
Only `(public company id, category, treatment, count)` leaves a tenant; no amounts, descriptions or org ids are stored. Priors whose support drops below 5 are deleted the same night.

### 4.8 VAT point date (`deriveVatPointDate`, 04 §3.3)

```
P = profile.at(doc.duzp ?? doc.issue_date)
switch:
 issued (direction out)                              → duzp ?? issue_date                         rule 'duzp'
 received_receipt / simplified (payer)               → duzp ?? issue_date (receipt: issue = DUZP)  rule 'duzp'
 rcv_domestic_vat (payer deduction)                  → user override (document_fields 'vat_point_date', source user,
                                                       must be ≥ max(duzp, received_date) and ≤ 31.12.(year(duzp)+vat.deduction_deferral_years))
                                                       else max(duzp ?? issue_date, received_date ?? issue_date)   rule 'max_duzp_received'
 rcv_eu_service_reverse_charge | rcv_non_eu_service_reverse_charge:
     if P.foreign_service_dppd_policy == 'issue_date' → issue_date                                rule 'issue_date'
     else (service_period_end): sp = service_period_to (only if span ≤ classification.max_service_period_days_for_end, 62)
          prepaid = earliest of (paid_at per document evidence, payment links with booked_on < sp) if any
          → min(sp ?? issue_date, prepaid ?? +∞)                                               rule 'service_period_end' | 'prepayment'
 rcv_eu_goods_acquisition                            → min(issue_date, 15th day of month after duzp)  rule 'eu_goods_15th'
 rcv_domestic_reverse_charge                         → duzp                                        rule 'duzp'
 others (no VAT entry)                               → null (vat_point_date stays null)
```
A document with mixed treatments uses the date of its VAT-relevant lines (precedence: self-assessed > domestic). The policy default per D-05 (`22-open-questions.md`); long prepaid periods (annual domain renewal) fall back to issue/payment date to avoid dating a year ahead [verify with advisor]. `documents.vat_point_date` is stored; the rule name goes to `vat_ledger_entries.vat_point_rule`.

**Period** (`periodFor(date, profile)`): `P = profile.at(vat_point_date)`; `vat_status='identifikovana_osoba'` → calendar month; `platce` → month if `vat_period='monthly'`, calendar quarter if `quarterly`; `neplatce` → no VAT entries (M03 IO trigger instead; after the user adds an IO profile effective from the trigger date, the rebuild creates entries).

### 4.9 FX

`resolveFxRate(currency, date)`: `vat.cnb_rate_rule = 'rate_valid_on_date_else_last_published'` → the `fx_rates` row with max `rate_date ≤ date` (within `fx.max_lookback_days`), rate per unit = `rate / amount`. VAT ledger uses `date = vat_point_date`; documents store `fx_rate`, `fx_rate_date`. Per document per rate: `base_czk_doc = round2(Σ net_foreign × rate)`, `vat_czk_doc = round2(base_czk_doc × vat_rate_pct/100)` for self-assessed lines; for `rcv_domestic_vat` in foreign currency use the printed CZK VAT from `document_vat_summary.vat` when the document states it in CZK (§29), else computed. Line amounts are allocated from document amounts (§4.11 allocation). Missing rate → no VAT entries for that document, M03 `FX_RATE_UNAVAILABLE` open; `fx.rates_imported` triggers rebuild. Income tax uses actual CZK of the payment (§4.11).

### 4.10 DPHDP3 rows and KH sections

Rows come from rule data `epo.dphdp3_row_map` (06 §2) keyed by `(vat_treatment, vat_rate_type, vat_status)`; `resolveDphdp3Rows()` never hard-codes numbers. V3 seed content (`research/czech-tax-filings.md §2`, 04 §3.2):

| vat_treatment | rate | `platce` rows | `identifikovana_osoba` rows |
|---|---|---|---|
| `rcv_domestic_vat` | standard / reduced | `{40}` / `{41}` | — (no entry; VAT is cost) |
| `rcv_eu_service_reverse_charge` | standard / reduced | `{5,43}` / `{6,44}` | `{5}` / `{6}` |
| `rcv_non_eu_service_reverse_charge` | standard / reduced | `{12,43}` / `{13,44}` | `{12}` / `{13}` |
| `rcv_eu_goods_acquisition` | standard / reduced | `{3,43}` / `{4,44}` | `{3}` / `{4}` only after `vat.io_eu_goods_threshold` exceeded in the calendar year, else — |
| `rcv_domestic_reverse_charge` | standard / reduced | `{10,43}` / `{11,44}` | — |
| `rcv_import_customs` | any | `{42}` | — |
| `iss_domestic_vat` | standard / reduced | `{1}` / `{2}` | — |
| `iss_eu_service` | — | `{21}` | `{}` (SH only) [verify] |
| `iss_eu_goods` / `iss_non_eu_service` / `iss_export_goods` / `iss_domestic_reverse_charge` / `iss_exempt` | — | `{20}` / `{26}` / `{22}` / `{25}` / `{50}` | — |
| `rcv_domestic_no_vat`, `rcv_foreign_vat_charged`, `rcv_out_of_scope`, `iss_no_vat` | | no entry | no entry |

For payers the deduction row (43/44/40/41) is included only when deduction is allowed: `tax_doc_status ∈ {full_tax_document, simplified_tax_document, foreign_document}`, no open `TAXDOC_PAYER_MISSING_BUYER_DIC`/`TAXDOC_SIMPLIFIED_OVER_LIMIT`/`DATE_DEDUCTION_WINDOW`, `deduction_pct > 0`. `deduction_pct = business_share_pct` (any value < 100 makes the period non-simple for M05: §75 krácení → accountant).

**KH section:** single implementation in M05 §4.2 step 8 (`resolveKhSection`, data `epo.kh_routing`; only when `vat_status='platce'`, else `null`). The sketch below is informative; M05 wins on any difference (e.g. B2 also requires `tax_doc_status='full_tax_document'`):
```
L = rules.vat.kh_document_limit; T = |document total incl. VAT in CZK| (all lines of the document; credit notes: absolute value)
received: rcv_domestic_reverse_charge → B1; self-assessed (rcv_eu_*, rcv_non_eu_*, eu goods) → A2;
          rcv_domestic_vat with deduction: corrective §74a/§46 → B2; T > L and supplier CZ DIČ → B2; else B3; rcv_import_customs → null
issued:   iss_domestic_reverse_charge → A1; iss_domestic_vat: bad-debt §46 → A4; customer CZ DIČ and T > L → A4; else A5; others → null
```

### 4.11 Tax ledger (`tax_ledger_entries`, cash basis)

Built per document (and per uncategorized-document transaction, §4.15). Documents qualify if bookable, `status ∈ {ready, finalized}`, `deleted_at is null`. Lines with `line_type='text'` are skipped; `covered_by_document_id` lines are skipped (§4.11.4).

**4.11.1 Cost basis per line (CZK-neutral, in document currency):**
```
P = profile.at(vat_point_date ?? issue_date)
vatIsCost = !(P.vat_status == 'platce' and line deduction allowed (§4.10))       // IO and neplatce: VAT is cost
basis_l = net_l + (vatIsCost ? vat_l : vat_l × (1 − deduction_pct/100))          // rounding lines: gross
weight_l = gross_l (signed)                     // what the payment pays; advance_deduction lines negative
```
For `platform_statement`: `weight_l` = signed line amount as printed (reservation gross +, commission −, payment fee −, tourist fee +); the payout equals Σ weights.

**4.11.2 Payment evidence (precedence, per document):**
1. `payment_links` (M07) with `link_type ∈ {payment, platform_payout, offset, fee}` → positive; `refund` → negative. Amount in CZK: `amount_account_currency` if the transaction's account currency is CZK, else `amount_account_currency × ČNB rate on transactions.booked_on` (`resolveFxRate`). Date: `transactions.booked_on`. `basis='payment'`.
2. No links and `is_paid_per_document=true` or `payment_method ∈ {card, cash}` on a `received_receipt` → one synthetic payment of the full document on `paid_at ?? issue_date` (CZK via ČNB rate at that date for foreign currency). `basis='document_evidence'`, `payment_link_id null`. (If M07 already created a `document_evidence` transaction + link, rule 1 applies.)
3. `platform_statement` without a payout link → payout date from the statement (`paid_at ?? issue_date`), `basis='document_evidence'`.
4. Otherwise → one provisional entry set dated `due_date ?? issue_date`, `basis='provisional'`. M06 podklady excludes provisional entries and lists them as "nezaplacené/neověřené"; M09 shows them labelled „odhad".
Partial payments: unpaid remainder `D − Σpaid` (doc currency) also gets a provisional set only if `> tol.sum`.

**4.11.3 Allocation (pro rata, deterministic):** for each payment `p` (CZK) with document payable total `W = Σ weight_l` (doc currency): `share_l = p × weight_l / W` (decimal 28 digits), `alloc_l = round2(share_l)`; residual `p − Σ alloc_l` added to the line with the largest `|weight_l|` (tie → lowest position). Then `amount_l = round2(alloc_l × basis_l / gross_l)` for lines with `gross_l ≠ 0` (=`alloc_l` when basis = gross), with the same residual rule applied to keep `Σ amount_l` equal to `round2(p × Σbasis/W)`. Entry per (line × payment): `entry_date = payment date`, `tax_year = year(entry_date)`, `category_code`, `tax_effect` from category, `amount_czk` **signed** (positive increases the tax_effect bucket; credit notes, refunds, statement commission lines on income side are mapped by sign below), `business_share_pct`, `business_amount_czk = round2(amount_czk × share/100)`.

Sign mapping: expense documents → `amount_czk = +amount_l` (credit note lines are negative already → negative entries). Platform statements: income lines `+`, commission/fee lines `−weight` → expense entry with `+|amount|` under the expense category; tourist fee collected → `pass_through` `+`; remitted tourist fee (transaction to the municipality, §4.15) → `pass_through` `−`. Net pass-through per month = owed to the municipality; M06/M09 show "vybráno / odvedeno".

**4.11.4 Platform payouts and double counting.** Income is recognized gross (`income_accommodation`/`income_platform_payout`) and fees as expense (04 §3.1). When the platform also issues a commission invoice for the same period (Booking monthly invoice), the statement's commission lines get `covered_by_document_id = <invoice id>` (set by M04 when a `received_invoice` from the same partner with `service_period` overlapping the statement month exists and |Σ commission lines − invoice gross| ≤ 1 Kč; else a `which_category` note "provize je i na faktuře?"), and the ledger takes the expense from the invoice only. The invoice is then paid by `offset` against the payout (M07) → `entry_date` = payout date.

**4.11.4a Manual, imported and substitute documents.** All three `entry_mode` values classify and ledger the same way as captured ones; typed values (`source='user'`) win at cascade stage 0. Substitutes (`substitute_reason` set) have `tax_doc_status='not_tax_document'` (M03 `SUBST_NOT_TAX_DOCUMENT`), so CZ-supplier lines derive `rcv_domestic_no_vat` and VAT is cost. The deduction is allowed only after the accountant or owner dismisses that rule (sets `deduction_pct=100`) **[verify]** ZDPH §73(5). The income-tax entries are built normally (`basis` per §4.11.2). While `SUBST_PROVE_PAYMENT` is open, M06 lists them as "doložte platbu" **[verify]** ZDP §24.

**4.11.5 Pass-through tourist fee.** `pt_tourist_fee` lines never enter income/expense totals; VAT treatment `rcv_out_of_scope` (received) / `iss_no_vat` (collected); for payers it is outside the VAT base [verify]. Municipal reports (`government_filing`) and manager statements are never ledgered (non-bookable); they reconcile via M03 `XDOC_TOURIST_FEE_MISMATCH`.

### 4.12 VAT ledger (`vat_ledger_entries`)

M04's job writes the VAT ledger; the routing is M05's pure `buildVatLedgerEntries` (M05 §4.2), so this module does not restate it. Contract:
- Qualifying documents as in §4.11 (`ready`/`finalized`, bookable, not deleted), with `vat_point_date` and FX available; `business_flag='personal'` and lines with `business_share_pct = 0` produce no entries.
- **One entry per document × (`vat_treatment`, `vat_rate_type`) group, `line_id = null`** (KH rows and FX conversion are per document × rate; per-line conversion drifts). Columns per 05 §7, including `vat_point_rule`, `deduction_pct`, `currency`, `base_foreign`, `fx_rate`, `fx_amount`, `fx_rate_date`, `kh_document_total_czk`, `shv_code`.
- Amounts keep 2 decimals; whole-Kč rounding happens in M05 per row (golden: 13 699,77 → 13 700; 2 876,95 → 2 877). Credit notes are already negative (04 §3) and land in the period of their own `vat_point_date` (prior-period corrections make the period non-simple, 04 §8).
- After a rebuild M04 enqueues `vat.period.evaluate` for the affected periods (and M05 runs `vat.amendment.detect` where a filed return exists).

### 4.13 Rebuild and idempotency

- **Unit of rebuild:** one document (`ledger.rebuild_document`) or one document-less transaction (`ledger.rebuild_transaction`). In one DB transaction holding `pg_advisory_xact_lock(hashtext(org_id || ':ledger:' || document_id))`: compute drafts (pure `buildTaxLedgerEntries`, `buildVatLedgerEntries`); compute `inputHash = sha256(canonical JSON of all inputs: document revision, lines, classification, profile slices used, payment links, fx rows used, rule-set version, LEDGER_ALGO_VERSION)`; if equal to `documents.stage_version.ledger.h` → no-op; else `delete from tax_ledger_entries where document_id=$1` and same for VAT, insert drafts with `build_version = nextval('ledger_build_version_seq')` (monotonic, global), update `stage_version.ledger = {v, h, build_version}`.
- **Triggers:** `document.categorized`, `document.status_changed` (to/from ready/finalized/duplicate/supporting/deleted), `document.revised`, `payment_link.created|deleted|updated`, `profile.changed` (→ `ledger.rebuild_org {from: valid_from}`), `fx.rates_imported` (documents with null `fx_rate` in that currency), `rules.changed` (→ full org rebuilds, low priority), `vendor_profile.reset` (only via re-categorize).
- **Determinism property:** rebuilding twice yields identical rows except `id`/`build_version`; a nightly `ledger.verify` job rebuilds a 1 % sample in dry-run and alerts on any diff (indicates hidden inputs).
- Job keys: `${orgId}:ledger:${documentId}:${inputHash}`; full org rebuild iterates documents in `issue_date` order in batches of 200.

### 4.14 Finalized and filed documents

- `finalized` documents are immutable (03 §3). An edit (any field, line or classification) by owner/member creates a revision: snapshot into `document_revisions` (05 §4), `documents.revision += 1`, apply the change, status stays `finalized` if all blocking rules still pass (else `needs_review`), audit-log diff.
- Before saving, the UI asks `getEditImpact(documentId, patch)` (dry-run: rebuild drafts and diff against current ledger) and shows: affected VAT periods, whether any filing in `filing_documents` (state `generated|downloaded|marked_filed`) or an uploaded own return covers them, income-tax years with generated podklady. Copy: „Doklad je v přiznání k DPH za srpen 2026, které jste už podali. Po změně bude potřeba podat dodatečné přiznání (rozdíl DPH: +120 Kč)." [Uložit změnu] [Zrušit].
- After save: ledger rebuild; M03 `PERIOD_LOCKED` fires; M05 compares the filing snapshot (`filings.totals`, `filing_documents.document_revision`) with the new ledger. Filed snapshots are never mutated.
- Deleting a finalized document → soft delete with retention (02 guardrails); ledger entries removed by rebuild; `PERIOD_LOCKED` (`kind:'removed'`) on the filing periods.
- Payer deferral of deduction (moving `vat_point_date` later within the window) is an edit like any other; moving into an already filed period is refused (409, "zvolte otevřené období").

### 4.15 Document-less transactions (helper for M07)

`classifyTransaction(tx)` (pure) proposes `transactions.category_code` for movements that need no document (`match_state='no_document_needed'`): own-account transfers (counterparty account ∈ org money accounts) → `transfer_own_accounts`; authority accounts (rule `bank.authority_accounts`, M07: FÚ VAT prefix 705 + VS = DIČ [verify T-14], ČSSZ/OSSZ, health insurers, paušální daň account) → `tax_vat_payment | tax_income_payment | tax_pausal_advance | ins_social_own | ins_health_own`; municipality tourist-fee account (`municipal.tourist_fee.<city>.account` [verify]) → `pt_tourist_fee`; bank fee lines → `exp_bank_fees`. `ledger.rebuild_transaction` creates one entry with `document_id null`, `transaction_id`, signed amount (`−` for remitted pass-through), `basis='payment'`.

### 4.16 Closed months (Phase 2, owner 2026-10-26)

The user closes a month ("Uzavřít měsíc") once it is handed to the accountant or filed. Closing writes a `period_closes` row (05 §8) and an `audit_log` row.
- **Which documents a month holds:** a document belongs to the month of its key date, the same key date M10 uses for the package (`vat_point_date` for payers and identified persons, else DUZP, else issue date).
- **Database lock:** a trigger on `documents`, `document_lines`, `document_vat_summary` and `document_fields` raises `period_closed` on insert, update or delete when the row's document belongs to a closed month, or when an update would move it into one. The check is in the database so no code path (server action, worker, import) can skip it. Rebuilt ledgers (§4.13) are derived and not locked.
- **Late arrivals:** a new document whose key date falls in a closed month is still accepted; it lands with status `needs_review` and question "Doklad patří do uzavřeného měsíce" with two answers: "Otevřít měsíc" or "Zaúčtovat do dalšího otevřeného měsíce" (M10 late arrivals still list it).
- **Reopen:** `public.reopen_period(period_start, reason)` (owner only, reason required) sets `reopened_at/by/reason` and writes `audit_log`. Closing again makes a new row. The accountant package for that month gets a new version on the next generation (M10).
- Filed-period protection (§4.14, M03 `PERIOD_LOCKED`) stays as it is; a closed month is a stronger, user-chosen lock on top.

## 5. Data

### 5.1 Read / written
Read: §3. Written: `document_lines` classification columns, `documents.{summary_cs,business_flag,vat_point_date,fx_rate,fx_rate_date,stage_version}`, `document_fields`, `review_questions`, `vendor_profiles`, `organizations.settings.car`, `tax_ledger_entries`, `vat_ledger_entries`, `extraction_runs`, `llm_usage_daily`, `audit_log`, `document_revisions`.

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §4 `document_lines` (deductibility, covered_by_document_id) and `document_revisions`, 05 §5 `vendor_profiles` (pinned, multi_category), 05 §7 `tax_ledger_entries` (basis, business_amount_czk, signed `amount_czk`), `vat_ledger_entries` (grouped entries; deduction_pct, vat_point_rule, FX columns) and `ledger_build_version_seq`; `global_vendor_priors` is Later (05 §9.1).

### 5.3 Rule keys
Merged into 06 §2 on 2026-10-18 (`classification.*` and `fx.max_lookback_days` in §2.2; `vat.out_of_scope_categories`, `vat.reduced_rate_categories`, `vat.eu_member_states`, `epo.*` in §2.1). `classification.authority_registry` became `bank.authority_accounts` (M07); `classification.llm` became the `llm.models` config (M02).

## 6. Interfaces

### 6.1 Domain types and pure functions (`packages/domain`)
```ts
export type DecisionSource = 'user_line'|'hard_rule'|'user_vendor_rule'|'vendor_memory'|'global_prior'|'soft_rule'|'llm'|'fallback';
export type Deductibility = 'deductible'|'non_deductible'|'partially_deductible'|'not_applicable';
export interface LineClassification { lineId: string; categoryCode: CategoryCode; vatTreatment: VatTreatment|null;
  vatRateType: VatRateType; vatRatePct: Decimal|null; businessSharePct: Decimal; deductibility: Deductibility;
  source: FieldSource; confidence: number; decidedBy: DecisionSource; supplyKind?: 'service'|'goods'; reasonCs?: string; }
export interface ClassificationInput { doc: DocumentSnapshot; lines: LineSnapshot[]; supplier: PartnerSnapshot|null;
  profileAt: (d: LocalDate) => TaxpayerProfile; vendor: VendorProfile|null; prior: GlobalPrior|null;
  categories: Category[]; rules: RuleSet; settings: OrgClassificationSettings; llm?: CategorizeLlmOutput; }
export interface ClassificationResult { lines: LineClassification[]; needsLlm: number[] /*positions*/;
  questions: QuestionDraft[]; summaryCs: string; businessFlag: 'business'|'personal'|'mixed'|'unknown';
  vatPointDate: { date: LocalDate; rule: VatPointRule }|null; fx: { rate: Decimal; rateDate: LocalDate }|null; }
export function classifyDocument(i: ClassificationInput): ClassificationResult;
export function deriveVatTreatment(i: VatTreatmentInput): { treatment: VatTreatment; ambiguous?: 'supply_kind' };
export function deriveDeductibility(c: Category, sharePct: Decimal): Deductibility;
export function deriveVatPointDate(doc: DocumentSnapshot, treatments: VatTreatment[], profile: TaxpayerProfile,
  payments: PaymentEvidence[], rules: RuleSet): { date: LocalDate; rule: VatPointRule }|null;
export function periodFor(date: LocalDate, profile: TaxpayerProfile): { start: LocalDate; end: LocalDate }|null;
export function resolveFxRate(currency: string, date: LocalDate, rates: FxRateRow[], rule: CnbRateRule, maxLookbackDays: number): FxRate|null;
export function resolveDphdp3Rows(t: VatTreatment, r: VatRateType, s: VatStatus, deductionAllowed: boolean, map: Dphdp3RowMap): string[];
export function resolveKhSection(i: KhRoutingInput, routing: KhRouting): KhSection|null;   // 'A1'..'A5','B1'..'B3'
export function allocateProRata(total: Money, weights: Money[]): Money[];                    // residual → largest |weight|, tie lowest index
export function buildSummaryCs(i: SummaryInput): string;
export function buildTaxLedgerEntries(i: TaxLedgerInput): TaxLedgerEntryDraft[];
export function lineTaxAmountCzk(line: LineSnapshot, doc: DocumentSnapshot, profileAt: (d: LocalDate) => TaxpayerProfile): Money;
  // the amount kernel of buildTaxLedgerEntries (net vs gross by VAT status, FX via documents.fx_rate, sign), before business share;
  // exported for M09's document basis so both bases agree (M09 AC-3)
// buildVatLedgerEntries is M05's (packages/domain/src/vat, M05 §4.2); M04's ledger job calls it
export function classifyTransaction(tx: TransactionSnapshot, ctx: TxClassificationContext): { categoryCode: CategoryCode; confidence: number }|null;
```

### 6.2 I/O functions (`packages/pipeline`)
```ts
export async function categorizeDocument(orgId: string, documentId: string, opts: { trigger: CategorizeTrigger }): Promise<CategorizeOutcome>;
export async function setLineClassification(orgId: string, documentId: string, lineId: string,
  patch: { categoryCode?: CategoryCode; vatTreatment?: VatTreatment; businessSharePct?: number; remember?: 'this'|'vendor'|'always' },
  userId: string): Promise<DocumentDTO>;
export async function answerQuestion(orgId: string, questionId: string, answer: QuestionAnswer, userId: string): Promise<void>;
export async function recordConfirmation(orgId: string, documentId: string, actor: { userId: string; role: MemberRole }): Promise<void>;
export async function forgetVendorMemory(orgId: string, vendorProfileId: string, userId: string, reprocessOpen: boolean): Promise<void>;
export async function rebuildLedgerForDocument(orgId: string, documentId: string, reason: LedgerReason): Promise<{ changed: boolean; buildVersion?: number }>;
export async function getEditImpact(orgId: string, documentId: string, patch: DocumentPatch): Promise<EditImpact>; // dry-run diff
export async function aggregateGlobalPriors(): Promise<{ upserted: number; deleted: number }>;   // Later
```

### 6.3 Jobs (zod, `packages/pipeline/jobs.ts`)
```ts
export const CategorizeDocumentJob = z.object({ orgId: z.string().uuid(), documentId: z.string().uuid(), revision: z.number().int(),
  trigger: z.enum(['pipeline','question_answered','vendor_memory_changed','prior_changed','profile_changed','catalog_upgrade','user_reprocess']) });
  // 'doc.categorize' (03 §3.1), key `${orgId}:categorize:${documentId}:${revision}:${categorizeVersion}`
export const LedgerRebuildDocumentJob = z.object({ orgId: z.string().uuid(), documentId: z.string().uuid(),
  reason: z.enum(['categorized','status_changed','revised','deleted','partner_changed','payment_link','profile_changed','fx_imported','rules_changed','verify']) });
  // 'ledger.rebuild_document'
export const LedgerRebuildTransactionJob = z.object({ orgId: z.string().uuid(), transactionId: z.string().uuid() });   // 'ledger.rebuild_transaction'
export const LedgerRebuildOrgJob = z.object({ orgId: z.string().uuid(), from: z.string().date().optional(),
  reason: z.enum(['profile_changed','rules_changed','manual']) });                                                     // 'ledger.rebuild_org'
export const PriorsAggregateJob = z.object({ runDate: z.string().date() });             // Later: cron 'priors.aggregate' 15 3 * * * Europe/Prague
export const LedgerVerifyJob = z.object({ samplePct: z.number().min(0).max(100).default(1) });  // cron 'ledger.verify' 45 3 * * *
```

### 6.4 API routes (`/api/v1`, RLS)
- `PATCH /documents/{id}/lines/{lineId}/classification` body `{category_code?, vat_treatment?, business_share_pct?, remember?}` → document DTO with new `summary_cs`.
- `POST /documents/{id}/confirm` → records confirmation, finalizes if allowed.
- `POST /documents/{id}/edit-impact` body `DocumentPatch` → `EditImpact {periods[], filings[], deltaVatCzk, taxYears[]}`.
- `POST /review-questions/{id}/answer` body `QuestionAnswer` → 204.
- `GET /vendor-profiles?partner_id=` · `DELETE /vendor-profiles/{id}/memory?reprocess=true|false`.
- `GET /ledgers/tax?year=2026&basis=payment,document_evidence` · `GET /ledgers/vat?period_start=2026-08-01` (accountant role allowed).
- `GET /categories?direction=in` (labels, explanations, icons; hidden flags).

### 6.5 Events
`document.categorized {documentId, lowConfidenceLines, questions}`, `question.created|answered`, `vendor_profile.changed`, `ledger.document_rebuilt {documentId, buildVersion, periodsAffected[], taxYearsAffected[]}`, `filing.amendment_needed` (emitted via M03 PERIOD_LOCKED side effect).

## 7. UX touchpoints

- **Document card (Inbox):** one line `summary_cs`; tap opens a bottom sheet "Do čeho to patří?" with the current category (icon + label + explanation), 3 suggestions, search; below a toggle row „Firemní / Soukromé / Napůl" and, for IO/payers only, „DPH: zaplatíte sami v přiznání za srpen" (plain text; no row numbers in the default view; the accountant view shows rows and KH).
- **Remember choice:** after any change: „Používat pro {supplier} vždy?" [Jen teď] [Vždy] (Vždy → `pinned`).
- **Questions** are cards in the review queue, max 2 per document, grouped per supplier; each answers in one tap.
- **Accountant view** (Pro účetní): per line category code + label, treatment, rows, KH, source chip (Vy / Naučeno / AI / Pravidlo) with confidence.
- **Edit of a finalized/filed document:** impact dialog (§4.14).
- i18n namespaces: `categorize.summary.*`, `categorize.question.*`, `categorize.source.*`, `ledger.basis.*` (provisional: „odhad – platbu jsme zatím neviděli").

## 8. Edge cases and failure modes

- **LLM down/timeout** → lines stay at the best deterministic guess or `fallback`; documents with unresolved lines go to `needs_review` with `which_category`; job retried later (03 §4 graceful degradation); no ledger blocking for resolved documents.
- **Supplier lost VAT payer status** → memory says `rcv_domestic_vat` but no VAT on the document → deterministic treatment wins (`rcv_domestic_no_vat`); M03 `CLS_VAT_TREATMENT_CONFLICT` only for user-set values.
- **Same supplier, many categories (Alza, IKEA)** → `multi_category=true`; per-line LLM; vendor memory then contributes only `default_business_flag`.
- **Foreign SaaS paid by CZK card** → VAT base from ČNB rate at `vat_point_date`; tax ledger uses the real CZK debit; difference is expected and not an error.
- **Profile change mid-month** (IO from the 12th) → `profile.at(vat_point_date)` per document; documents before the 12th stay without VAT entries.
- **Quarterly payer switching to monthly** at year start → period per `profile.at(date)`, no cross-period mixing.
- **Credit note for a prior-period invoice** → negative entries in the credit note's period; M05 marks non-simple.
- **Unknown category retired** (`categories.valid_to` passed) → existing lines keep it; new classification maps through `categories` seed `replaced_by` (seed field) if present, else question.
- **Rounding-only differences in allocation** → residual rule guarantees Σ entries = payment exactly (property-tested).
- **Payment larger than the document (overpayment)** → allocation capped at document total; excess left on the transaction for M07 (`match_state='partial'`); no ledger entry for the excess.
- **Mixed-rate payer document > 10 000 Kč with a 0 % line** → KH threshold uses the whole-document total (methodology), all lines B2.
- **Concurrent rebuilds** → advisory lock per document; job dedupe by input hash.

## 9. Acceptance criteria and test plan

### 9.1 Acceptance criteria
1. The cascade picks sources exactly in §4.1 order (table-driven test with all 8 stages present/absent); `user` values are never overwritten (property test).
2. `vat_treatment` is a pure function of the §4.2 inputs; memory/LLM only influence `supply_kind` (mutation test: changing vendor default treatment does not change a CZ-DIČ supplier's treatment).
3. LLM output that violates the schema or uses an invalid code is retried once and never persisted; cost recorded in `extraction_runs` and `llm_usage_daily`.
4. `allocateProRata` sums exactly to the input for any weights (fast-check, 10 000 cases incl. negative weights).
5. Rebuild idempotency: two consecutive rebuilds of any document produce identical ledger rows (excluding `id`, `build_version`); unchanged input hash → no writes.
6. Vendor memory reaches the threshold after 2 confirmations and is applied to the 3rd document without an LLM call (assert zero LLM calls).
7. (Later, with global priors) Global priors: a vendor confirmed by 4 orgs produces no prior; by 5 orgs with ≥ 80 % agreement produces one; natural-person IČO never produces one; no tenant ids/amounts in the table.
8. Editing a document included in a `marked_filed` filing leaves `filings.totals` unchanged, increments `revision`, writes `document_revisions`, rebuilds the ledger and opens `PERIOD_LOCKED`.
9. **Golden set v1** (P4 profile: `identifikovana_osoba`, monthly, `danova_evidence`, `foreign_service_dppd_policy='issue_date'` unless stated; expected in `expected/categorize.json`, `expected/ledgers.json`):
   - a. Property-manager invoices (12 960,84 / 9 749,44 Kč, 21 %, DUZP end of month): all item lines `exp_property_management`, `rcv_domestic_vat`, `deductible`; **no** `vat_ledger_entries`; tax-ledger amounts total 12 960,84 / 9 749,44 (VAT included as cost); summary „Správa apartmánu za srpen – daňově uznatelný náklad, DPH 21 % je součástí nákladu" (month per DUZP).
   - b. Cleaning invoices (11 600 / 8 150 Kč, non-payer s.r.o.): `exp_cleaning`, `rcv_domestic_no_vat`; summary „Úklid apartmánu za září – daňově uznatelný náklad, bez DPH" for the September one.
   - c. Booking July invoice (13 699,77 CZK, issued 3 Aug, period July): commission line `exp_platform_commission`, payment-service line `exp_payment_fees`, dominant `exp_platform_commission`; both `rcv_eu_service_reverse_charge`; VAT entries `dphdp3_rows={'5'}`, `kh_section=null`, Σ base 13 699,77, Σ vat 2 876,95; period **2026-08** with policy `issue_date` (`vat_point_rule='issue_date'`), **2026-07** with `service_period_end` (`vat_point_rule='service_period_end'`). M05 rounding of August (issue_date) gives 13 700 / 2 877 = the filed return.
   - d. Booking August invoice (11 549,94, issued 3 Sept, no buyer DIČ): same categories/treatment, period 2026-09 (issue_date) or 2026-08 (service_period_end); Σ vat 2 425,49.
   - e. Cloudflare (US) $10.46: `exp_hosting_domains`, `rcv_non_eu_service_reverse_charge`, rows `{'12'}`, base = round2(10.46 × fixture USD rate at vat_point_date), `currency='USD'`, `fx_rate_date` ≤ vat_point_date.
   - f. Anthropic Ireland €90: `exp_software_saas`, `rcv_eu_service_reverse_charge`, rows `{'5'}`, period 2026-10, base = round2(90 × fixture EUR rate).
   - g. Tourist fee: a fixture `platform_statement` line „Poplatek z pobytu" and a fixture Praha 3 payment transaction → `pt_tourist_fee`, `rcv_out_of_scope`/`iss_no_vat`, `deductibility='not_applicable'`, pass-through entries `+` and `−`, excluded from income/expense totals; settlement statements and municipal reports create **no** ledger entries.
   - h. Decathlon 249 Kč: `business_or_personal` question created, document `business_flag='unknown'`, `needs_review`; answer "Soukromé" → `private_expense`, `business_share_pct=0`, `non_deductible`, tax-ledger `tax_effect='private'`.
   - i. MacBook 26 990 Kč (March 2026, CZ VAT 21 %): `exp_small_assets` (26 990 < 80 000; IO → cost incl. VAT), `small_asset_business_use` question; answer 80 % → `partially_deductible`, `business_amount_czk = 21 592,00`.
   - j. IKEA 1 198 Kč card receipt: tax-ledger `basis='document_evidence'`, `entry_date=issue_date`; no VAT entries (IO).
   - k. Alza 117 Kč „není daňový doklad": `rcv_domestic_no_vat`; discount and 0,05 rounding lines inherit the item category (H1); Σ tax-ledger amount = printed total.
   - l. Decoys and duplicates: zero ledger entries.
10. A substitute document (lost receipt, CZ payer supplier, 21 %) for a `platce`: `rcv_domestic_no_vat`, no row-40 entry, tax-ledger amount incl. VAT. After the accountant dismisses `SUBST_NOT_TAX_DOCUMENT`: `rcv_domestic_vat`, `deduction_pct=100`, rows `{'40'}`.
11. With profile switched to `platce` (quarterly) for a synthetic variant: manager invoice → rows `{'40'}`, KH `B2` (> 10 000 incl. VAT), tax-ledger amount = net; Booking → rows `{'5','43'}`, KH `A2`.

### 9.2 Test plan
- **Unit:** cascade stages, each hard/soft rule, `deriveVatTreatment` truth table (supplier CZ/EU/non-EU × CZ DIČ × VAT printed × supply kind × tax_doc_status), `deriveVatPointDate` per rule incl. prepayment and long service periods, `periodFor`, `resolveFxRate` (weekend/holiday, before 14:30 publication), `resolveKhSection` 10 000 boundary (= vs >, absolute for credit notes, B2C → A5), summary templates (Czech strings snapshot).
- **Property:** allocation exactness; ledger totals = Σ payments × basis/gross; sign symmetry (invoice + full credit note → net zero per category); rebuild determinism.
- **LLM contract:** recorded responses for the 8 few-shot documents; schema validation; eval harness (M12) category accuracy ≥ 95 % on golden + synthetic 300-line set before any prompt/model change.
- **Integration:** pipeline categorize → validate(post) → ledger; question answer → rebuild; vendor memory retroactive reprocessing; concurrent rebuild lock (priors aggregation: Later).
- **E2E:** answer "Soukromé" on Decathlon and see dashboard expenses drop by 249 Kč; change Booking category with "Vždy" and see the next Booking invoice classified without LLM.

## 10. Maintenance

| Source of change | Containment | Effort/yr |
|---|---|---|
| Category taxonomy tweaks (new category, tax effect correction) | seed table versioned (`valid_from/valid_to`, `replaced_by`); LLM enum generated from seed | 0.5 day |
| DPHDP3 rows / KH routing changes | `epo.dphdp3_row_map`, `epo.kh_routing` data + golden ledger tests (06 §7 `epo-version-bump.md`) | 0.5–1 day |
| VAT rates, thresholds, FX rule, deduction window | rule tables | ~0.5 day (shared with M03/M05) |
| Keyword/platform/NACE/authority lists | data PRs; monitor "fallback rate" and "user-corrected category rate" per category | 1 day |
| LLM model/prompt changes | versioned prompt, eval gate (06 §1) | 0.5–1 day |
| Total | | **3–4 days/year** (above the 3-day bar → justified: categorization is the core product; most is data review in the Annual Update Window) |

Monitors: LLM call share per document (< 30 % target after 3 months), correction rate per category (> 10 % → review rule/prompt), ledger verify diffs (any → alert), provisional-entry share per org (high → nudge bank import).

## 11. Open questions
Consolidated in `22-open-questions.md`: D-05 (dating of foreign services, incl. long prepaid periods), D-06 (§7 vs §9; `income_accommodation` stays one category), TA-06 (IO VAT as an income-tax expense), TA-07 (tourist fee and the VAT base), TA-08 (IO `iss_eu_service`: SH only), TA-09 (`flat_rate_km` and fuel), TA-02 (substitute documents). Resolved (22 §F): global-prior questions are moot (priors Later); auto-finalized documents are not weak confirmations.
