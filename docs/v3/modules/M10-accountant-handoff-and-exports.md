# M10: Accountant hand-off and exports

**Phase:** 1 (basic export: ZIP of consistently named files + register CSV/XLSX) and 2 (full accountant package: completeness score, bank reconciliation, Q&A, Pohoda XML, ISDOC, share link, accountant seat, acknowledgment). Money S3 XML is **Later** (outline in §4.9).
**Package:** `packages/exports` (pure builders: register, file naming, Pohoda, ISDOC, Money S3, CSV, ZIP manifest), `apps/worker/src/packages/*` (generation jobs), `apps/web` screen **Pro účetní**.
**Depends on:** M01 (documents, `entry_mode`, `substitute_reason`, supporting links, `expected_documents`), M03 (validation results), M04 (categories, ledgers), M05 (VAT ledger, filings), M07 (transactions, links, radar, statement imports), M12 (storage, signed URLs, outbound mailer = Amazon SES per D-07, audit). **Consumed by:** M09 (package card, `package.state_changed`).

This module is **the core output of the product** (`01 §1`): the accountant is the destination. Design rule for every decision below: *the accountant opens one link, downloads one ZIP or one XML, imports it, and never has to ask the client anything* (`01 §7`: ≥ 90 % of packages).

---

## 1. Purpose and scope

**In scope**
1. **Phase 1 basic export:** per period, a ZIP with all bookable documents (consistently named PDFs), supporting documents in their own folder, and the register (`Soupis_….xlsx` + `.csv`). No completeness, no XML, no sharing.
2. **Phase 2 accountant package** per period (`month` / `quarter` / `year`):
   - completeness check and score (documents vs bank movements, open questions, unresolved validations, missing-documents radar);
   - contents: PDFs, register XLSX with all fields, categories and VAT treatment, bank reconciliation sheet, supporting documents and decoys list, notes and Q&A, generated substitute-document PDFs, a one-page summary;
   - delivery: ZIP download, e-mail link with expiry, accountant seat access;
   - accountant UX: read, comment, export, mark acknowledged ("Převzato");
   - exports: **Pohoda XML dataPack 2.0** (received/issued invoices, receipts, internal documents, optional bank), **ISDOC 6.0.2** per document, generic CSV/XLSX; Money S3 outline;
   - versions and re-export rules ("what changed since the last package").

**Out of scope:** double-entry postings, account numbers of a chart of accounts (we only pass the accountant's own předkontace codes), depreciation, closing entries, payroll, direct import into the accountant's software (no Pohoda agent/mServer: the accountant imports the file; Competitor A's Windows agent is exactly the setup cost we avoid, internal research (not published)), the accountant multi-client portal (Later, `02`), billing of seats.

## 2. User stories

| # | Persona | Story |
|---|---|---|
| US1 | P2 Tomáš | At year end I press "Připravit pro účetní". I see "Kompletní z 92 %: 3 platby bez dokladu" and fix two of them in a minute. Then I send the link. |
| US2 | P3 Lucie | Every month my accountant gets an e-mail with a link. She downloads `pohoda_….xml`, imports it into Pohoda and the received invoices land with her own předkontace and členění DPH. |
| US3 | P4 Josef | The August package contains the Booking invoice with "ř. 5: 13 700 / 2 877" and a note that it matches my filed DPHDP3; the settlement statements, tourist-fee reports and the filed return are in "Podpůrné doklady", never in the XML. |
| US4 | P2 Tomáš | I lost a fuel receipt. I record a náhradní doklad; the package contains a one-page "Náhradní doklad" PDF with my confirmation and the card payment, and the summary flags it. |
| US5 | Accountant | I open the package, see 2 open points at the top, comment on one document ("Je to soukromé?"), and the client answers in the app. When done I click "Převzato". |
| US6 | Accountant | Next month I get version 2 of August with "Změny: 1 nový doklad, 1 opravený". The XML contains only the new one; the corrected one is listed with what changed. |
| US7 | Accountant | My file naming convention is "IČO_číslo dokladu". I pick it once in my settings and every package follows it. |
| US8 | P1 Petra | I have no accountant. I still download a clean ZIP and register for my own archive. |

## 3. Inputs and outputs

**Inputs:** `documents` (+ `document_lines`, `document_vat_summary`, `document_fields`, `document_links`, `document_revisions` (05 §4)), `source_files`, `partners`, `categories`, `vat_ledger_entries`, `tax_ledger_entries`, `transactions`, `payment_links`, `money_accounts`, `statement_imports` (M07), `validation_results`, `review_questions`, `comments`, `filings`, `expected_documents` (M01), `taxpayer_profiles`, export profile settings, rule tables (rates for labels only).

**Outputs:** `accountant_packages` (+ `accountant_package_items`, `package_shares`, `export_profiles`, `export_mappings`, 05 §8), files in `org/{org_id}/exports/packages/{package_id}/v{n}/…` (ADR-004), events `package.state_changed`, `package.generated`, `package.shared`, `package.acknowledged`, notifications.

## 4. Detailed behavior and algorithms

### 4.1 Period and document membership

**Period kind default** (user can change per package): `vat_status ∈ (platce)` → `vat_period` (month/quarter); `identifikovana_osoba` → `month`; `neplatce` with `has_accountant` → `year` (with optional monthly "průběžný" packages); otherwise `month` for the Phase-1 export.

**Period key date** of a bookable document `d` (the single date that decides which package it belongs to):
- If the org's profile at `d`'s date is `platce` or `identifikovana_osoba` and `d` has VAT ledger entries: `vat_point_date` (`04 §3.3`), so the package matches the VAT period the accountant files.
- Else: `coalesce(duzp, issue_date, received_date)`.

Membership rules:
1. **Bookable** = classes ✅ in `04 §2.1` (`received_invoice`, `received_receipt`, `received_credit_note`, `received_advance_tax_doc`, `issued_invoice`, `issued_credit_note`, `platform_statement`), status `ready`/`finalized`/`needs_review`, not deleted, not `duplicate`/`supporting`. `needs_review` documents are included but flagged (and lower the score).
2. **Supporting** = everything else that is not `non_document`, with a document date in the period **or** a `document_links` row to a bookable member (`supports`, `fulfills`, `same_period_reconciles`, `reported_in`, `corrects`, `settles`). `received_proforma` is supporting.
3. **Transactions**: `booked_on` within the period on accounts with `is_business = true`.
4. **Late arrivals:** a bookable document whose key date falls in a period that already has a `sent`/`acknowledged` package and which is not in that package's items is put into the **next** package generated for any period, marked `late_from_period = <its period start>` ("Dodatečně doručený doklad, patří do 08/2026"). A sent package is never mutated. The user may instead regenerate the old period as a new version (§4.10).
5. **Personal** (`business_flag = 'personal'`) bookable documents are listed in the register sheet "Soukromé" and their PDFs go to `05_Soukrome/`; they are **excluded** from Pohoda/ISDOC/Money exports and from the score. `mixed` documents are exported with lines' `business_share_pct`.

### 4.2 Completeness check and score

`computeCompleteness(ctx, period) → CompletenessReport` (pure core over loaded views). Components, each a ratio in [0,1]:

| Id | Component | Ratio | Weight (`package.completeness_weights`) |
|---|---|---|---|
| C1 | Bank coverage | days of the period covered by `statement_imports` (state `parsed`/`partially_parsed`, `balance_check ≠ 'mismatch'`) per business bank/card account, averaged; accounts fed only by e-mail notices count 0.5 per day; no money accounts → component skipped (weight redistributed) | 0.20 |
| C2 | Outgoing movements explained | Σ\|amount\| of outgoing business transactions in state `matched`/`no_document_needed`/`ignored` ÷ Σ\|amount\| of all outgoing (partial counts its linked share) | 0.30 |
| C3 | Incoming movements explained | same for incoming | 0.10 |
| C4 | Documents ready | bookable members in `ready`/`finalized` ÷ all bookable members | 0.20 |
| C5 | No blocking validations | 1 if no `validation_results` with `severity = 'blocking'`, `state = 'open'` on members; else 1 − min(1, n/5) | 0.10 |
| C6 | No open questions | 1 − min(1, open `review_questions` (document or transaction in period, `answered_at` null) ÷ 10) | 0.10 |

`score = round(100 × Σ w_i·C_i / Σ w_i)` (over non-skipped components). Weights are product config in `packages/exports/src/completeness/config.ts` (versioned, not law).

**Missing items list** (`completeness.missing[]`, ordered by severity then amount desc), each `{ kind, ref, amount?, label_key, params }`:
- `missing_document` / `missing_credit_note` / `unexplained_income` / `substitute_unpaid` from M07 `radarItems()` for the period;
- `statement_gap` (account, from, to) from C1;
- `blocking_validation` (document, rule_id);
- `open_question` (question id, kind);
- `needs_review_document`;
- `expected_invoice` (open `expected_documents` with `expected_by` ≤ period end + 7 days);
- info only (not in the score): `substitute_document` (every member with `substitute_reason`), `no_file` (members with `source_file_id` null), `personal_documents` count, `late_arrivals`, `unpaid_due` (received documents past due without `paid_at`, only when C1 > 0.9).

Status label: score ≥ 95 and no `blocking_validation` → **Kompletní**; 80–94 → **Skoro hotovo**; < 80 → **Chybí podklady**. `completeness` JSONB (`05`) shape: `{ version, score, label, components: {C1..C6}, missing: [...], counts: {bookable, supporting, transactions, substitute, no_file, personal}, computed_at }`. M09 reads `completeness.score` and `completeness.missing.length` (`M09 §4.10`).

**Never block the hand-off.** A package can always be sent; the summary and the share page show the open items first ("Odesláno se 3 otevřenými body"). The only hard stop: a Phase-2 package whose selected export format fails its validation (Pohoda/ISDOC XSD) cannot reach `ready` (§4.7.6).

Refresh: job `package.completeness.refresh` runs debounced (60 s, singleton per org+period) on `transactions.imported`, `bank.link_created|link_removed`, `document.status_changed`, `ledger.document_rebuilt`, review answers; it updates `draft` packages only.

### 4.3 Package lifecycle (`package_state`)

```
draft ──generate──► ready ──share/download by accountant──► sent ──"Převzato"──► acknowledged
  ▲                   │                                       │
  └── data changed ───┘ (ready → draft automatically)         └── data changed: nothing happens to v_n; a new version v_{n+1} is offered
```
- `draft`: created on first open of "Pro účetní" for a period, or by the monthly scheduler (`package.auto_draft`, 1st day 06:00 Europe/Prague for the previous period when `has_accountant`). Completeness is live.
- `ready`: files generated and validated; snapshot frozen (`accountant_package_items`, `content_hash`). Any change to a member afterwards flips it back to `draft` (files kept until regenerated).
- `sent`: set when the user shares it (e-mail link or "Označit jako předané"), or when the accountant first downloads it.
- `acknowledged`: the accountant (or owner on the accountant's behalf, audited) clicks "Převzato". Only `sent` → `acknowledged`.
- New version: generating for a period whose latest version is `sent`/`acknowledged` creates a new row with `version = n + 1` and `supersedes_package_id`, starting in `draft`. Old versions stay downloadable.

### 4.4 Package contents (ZIP layout)

Root folder `{org_short}_{ICO}_{periodLabel}_v{n}/` where `periodLabel` = `2026-08`, `2026-Q3` or `2026`:

```
00_Souhrn_{ICO}_{periodLabel}.pdf        one-page summary (§4.4.1)
Soupis_{ICO}_{periodLabel}.xlsx          register workbook (§4.5)
Soupis_{ICO}_{periodLabel}.csv           register sheet "Doklady" as CSV
01_Doklady/
   Prijate/        received invoices, credit notes, ZDD
   Uctenky/        received receipts
   Vydane/         issued invoices and credit notes
   Platformy/      platform_statement
   Nahradni/       generated "Interní / náhradní doklad" PDFs (§4.4.2), next to the user's photo if any
02_Podpurne/       supporting documents (settlement statements, order confirmations, government filings, contracts…)
03_Banka/          original statement files of the period + Parovani_{ICO}_{periodLabel}.xlsx (= reconciliation sheet as a standalone file)
04_Export/
   pohoda_{ICO}_{periodLabel}_v{n}.xml        (Phase 2, if the profile target is Pohoda)
   isdoc/{file base}.isdoc                     (Phase 2, if enabled)
   money_s3_{ICO}_{periodLabel}_v{n}.xml      (Later)
05_Soukrome/       personal documents (for transparency; not exported)
manifest.json      machine-readable list: every file, sha256, document id, revision, item kind
```
Rules:
- PDFs: original PDF pages `page_from..page_to` (split with `pdf-lib`); images (JPEG/PNG/HEIC) converted to a one-page A4 PDF (HEIC via `sharp`), original image not repeated; ISDOC-only documents rendered to PDF with the same template as substitute PDFs plus the original `.isdoc` in `04_Export/isdoc/`.
- **No file** (`entry_mode ∈ ('manual','imported')` and `source_file_id` null, and not a substitute document): no PDF is invented; the register row carries the marker **"bez souboru"** (`exports.marker.no_file`) in the column "Soubor", the Pohoda/Money item gets the same marker in `note`, and the summary counts them. Substitute documents always have the generated PDF (§4.4.2), so they are never "bez souboru".
- Duplicates are excluded (only the original is exported; the golden IKEA NFC/NFD pair yields one file).
- ZIP: `yazl`, deflate, UTF-8 file names with the language-encoding flag (bit 11) set; file names are ASCII-folded by default anyway (§4.6) because Windows unzip tools mishandle UTF-8.
- Max package size 2 GB; above 500 MB the share page offers per-folder downloads.

#### 4.4.1 Summary PDF (`00_Souhrn`)
One A4 page (react-pdf, `packages/exports` templates): org name/IČO/DIČ, period, version, generated at, profile (VAT status, regime, VAT period); completeness score + label; counts (bookable received/issued, receipts, supporting, transactions matched/unmatched); **flags block**: substitute documents (count and list of numbers), documents without file, personal documents excluded, late arrivals, needs-review documents, VAT notes (e.g. "Faktura Booking.com 08/2026 nemá DIČ odběratele"); open items (top 10 from `missing[]`); user's notes; "Změny oproti v{n−1}" (§4.10); for VAT-relevant periods a box with the period's DPHDP3 row totals from `vat_ledger_entries` and, when a `government_filing` (own filed DPHDP3) or M05 filing exists for the period, "Souhlasí s podaným přiznáním" / "Nesouhlasí: ř. 5 rozdíl 120 Kč".

#### 4.4.2 Substitute document PDF ("Interní / náhradní doklad")
Generated for every member with `substitute_reason` set (`04 §2.2a`). Pure renderer `renderSubstituteDocumentPdf(view)`; one A4 page; file `01_Doklady/Nahradni/{file base}_nahradni.pdf`.

Contents (all from the database, nothing typed again):
| Block | Source |
|---|---|
| Title | "Interní / náhradní doklad č. {internal number}" where the internal number is `ND-{YYYY}-{seq}` (sequence per org and year in `accountant_package_items.internal_number`, stable across versions) |
| Who (vystavil) | taxpayer profile `legal_name`, IČO, DIČ, address valid at `issue_date` |
| Supplier (whom it was paid to) | `partner_snapshot` or `partners` (name, IČO/DIČ if known, address if known) |
| What | `summary_cs` + each line: description, quantity, net/VAT/gross, category label (`categories.label_cs`) |
| Amount | `total_gross` `currency` (+ CZK at `fx_rate` if foreign) |
| Dates | `issue_date` (date of the expense), `duzp` if different, recorded at (`documents.created_at`) |
| Reason | `substitute_reason` label: `lost` "Originální doklad byl ztracen", `damaged` "Originální doklad je poškozený / nečitelný", `never_issued` "Doklad nebyl vystaven", `other` "Jiný důvod" + user note (`document_fields` key `substitute.note`) |
| Linked payment | every `payment_links` row: date (`transactions.booked_on`), amount, account name, counterparty, VS, card last 4, match method label; none → "Platba zatím nespárována" (and the M07 `substitute_unpaid` item exists) |
| Attachment | "Přiložena fotografie poškozeného dokladu" when `source_file_id` is set (the photo PDF follows in the same folder) |
| Confirmation line | "Potvrzuji, že výdaj byl skutečně vynaložen v souvislosti s mou podnikatelskou činností a že údaje odpovídají skutečnosti." + "Potvrdil(a) {user display name} v aplikaci {timestamp Europe/Prague}" from `document_fields` key `substitute.confirmation` (`source = 'user'`, `set_by`, `created_at`, written by M01's manual-entry flow). Missing confirmation → the line reads "Nepotvrzeno uživatelem" and the item `substitute_unconfirmed` (warning) is added to `missing[]` |
| VAT note | "Náhradní doklad není daňovým dokladem; DPH se standardně neuplatňuje." (`tax_doc_status = not_tax_document`, `04 §2.2a`; the accountant may decide otherwise, **[verify ZDPH §73(5)]** per 04) |
| Footer | "Vygenerováno aplikací Shoebox · dokument {id} r{revision}" |

In the summary flags block and in the register (column "Náhradní doklad" = reason label; row highlighted), and in Pohoda `note` ("NÁHRADNÍ DOKLAD: {reason}"), substitute documents are always visibly flagged.

### 4.5 Register workbook (`Soupis_….xlsx`, `exceljs`)

All sheets: header row frozen, autofilter, Czech headers (i18n `exports.register.col.*`), money as numbers with format `# ##0,00`, dates as real dates, no formulas except totals rows (`SUBTOTAL(9, …)`).

**Sheet "Doklady"** (one row per bookable member, sorted by key date, then partner, then number):
`Č. v soupisu` (`P-2026-08-001` received / `V-…` issued / `U-…` receipt / `X-…` platform; stable per document across versions) · `Typ dokladu` (class label from M01 `classify.class.*`) · `Stav` · `Změna` (added/changed/unchanged vs previous version) · `Patří do období` (late arrivals) · `Partner` · `IČO` · `DIČ / VAT ID` · `Země` · `Číslo dokladu` · `VS` · `Datum vystavení` · `DUZP` · `Datum přijetí` · `Splatnost` · `Období DPH` · `Měna` · `Kurz` · `Datum kurzu` · `Základ 21 %` · `DPH 21 %` · `Základ 12 %` · `DPH 12 %` · `Bez DPH / mimo předmět` · `Zaokrouhlení` · `Celkem` · `Celkem CZK` · `K úhradě` · `Uhrazeno dne` (`paid_at`) · `Uhrazeno částkou CZK` (Σ `amount_account_currency`) · `Způsob úhrady` · `Účet dodavatele` · `Kategorie` (label) · `Kód kategorie` · `Daňový efekt` · `Režim DPH` (`vat_treatment` label) · `Řádky DPHDP3` · `Oddíl KH` · `Daňový doklad` (`tax_doc_status` label) · `Firemní/soukromé/napůl` · `Podíl firemní %` · `Náhradní doklad` · `Způsob zadání` (`entry_mode` label: Naskenováno / Zadáno ručně / Importováno) · `Soubor` (relative hyperlink into the ZIP, or **"bez souboru"**) · `Zdroj údajů` (dominant `field_source`: ISDOC/QR/PDF/AI/uživatel) · `Jistota` (min field confidence, %) · `Kontroly` (open validation rule labels) · `Poznámky a dotazy` · `Odkaz do aplikace`.
Multi-category or multi-treatment documents: one row per document with the dominant category; the split is in sheet "Řádky".

**Sheet "Řádky"**: one row per `document_lines` row of members: `Č. v soupisu`, position, `line_type`, description, quantity, unit, unit price, net, VAT, gross, rate %, `vat_treatment`, category, business share.
**Sheet "DPH"**: one row per `vat_ledger_entries` of the period: document, `vat_point_date`, treatment, rate, `base_czk`, `vat_czk`, `dphdp3_rows`, `kh_section`, counterparty VAT ID, `evidence_number`; totals by DPHDP3 row with the form rounding (whole CZK, `03` ADR-007) side by side with the exact sums.
**Sheet "Banka"** (bank reconciliation, also as `03_Banka/Parovani_….xlsx`): per business money account a block: account name/number, statement coverage intervals, opening balance (first import), Σ incoming, Σ outgoing, closing balance computed vs statement closing balance (`statement_imports.closing_balance`), status "Sedí" / "Rozdíl {x}" / "Chybí výpis {from}–{to}". Then one row per transaction: date, amount, currency, original amount, counterparty, account, VS/KS/SS, message, source (výpis/upozornění/doklad), `match_state` label, linked documents (`Č. v soupisu` list), link types, match method label, confidence, category (no-document transactions), "jen z upozornění" marker for `email_notice` rows not confirmed by a statement, note.
**Sheet "Chybí doklad"**: M07 radar items of the period (date, amount, counterparty, guessed partner, state "požádáno {date}" when requested).
**Sheet "Podpůrné"**: supporting members: type, partner, date, amount if any, description, linked bookable documents with link kind label ("Vyúčtování správce 08/2026 → podporuje P-2026-08-004"), file. Decoys appear here, explicitly marked "Nezaúčtováno – nejde o daňový doklad".
**Sheet "Soukromé"**: personal documents excluded from exports.
**Sheet "Otázky a poznámky"**: answered `review_questions` (question text, answer, who, when), comments threads (document/transaction/package, author role, body, resolved), user's notes, system notes.
**Sheet "Změny"**: diff vs the previous version (§4.10).

CSV (`Soupis_….csv`): sheet "Doklady" only; UTF-8 **with BOM**, `;` delimiter, decimal comma, dates `DD.MM.YYYY`, CRLF (opens correctly in Czech Excel).

### 4.6 File naming

`nameFile(doc, pattern, ctx) → string` (pure). Tokens: `{date}` (key date `YYYY-MM-DD`), `{issue}`, `{dir}` (`P` received, `V` issued, `U` receipt, `X` platform, `N` substitute), `{seq}` (`Č. v soupisu`), `{partner}` (short name: partner name without legal form, max 30), `{ico}` (partner IČO or VAT ID, else `bezICO`), `{number}` (document number, else VS, else `bezCisla`), `{gross}` (`12960,84`), `{cur}`, `{orig}` (original file name without extension, NFC), `{erp}` (number assigned by the export profile's numbering, §4.7.3, else `{seq}`).

Eight presets (Competitor A offers 8 variants built from file name / supplier name / supplier IČO / document number / internal ERP id, internal research (not published) `exports.bulk_options`):

| Preset | Pattern | Example |
|---|---|---|
| `date_partner_number` (default) | `{date}_{dir}_{partner}_{number}` | `2026-08-31_P_Spravce-Novak_2026-0815` |
| `partner_date_number` | `{partner}_{date}_{number}` | `Booking-com_2026-08-03_1234567890` |
| `ico_number` | `{ico}_{number}` | `12345678_2026-0815` |
| `number_only` | `{number}` | `2026-0815` |
| `seq_date_partner` | `{seq}_{date}_{partner}` | `P-2026-08-004_2026-08-31_Spravce-Novak` |
| `erp_number` | `{erp}_{partner}` | `PF26-0123_Spravce-Novak` |
| `date_amount_partner` | `{date}_{gross}{cur}_{partner}` | `2026-08-31_12960,84CZK_Spravce-Novak` |
| `original` | `{orig}` | `faktura_srpen` |

Sanitisation (always, in this order): NFC normalise → ASCII-fold (unless the profile sets `keep_diacritics`) → replace `<>:"/\|?*` and control chars with `-` → collapse whitespace to `-` → collapse repeated `-`/`_` → trim to 120 chars before the extension → collision within the same folder: append `_2`, `_3` in `Č. v soupisu` order. Deterministic: the same document and pattern always produce the same name across versions (property test).

### 4.7 Pohoda XML (dataPack 2.0)

Source of element names: `research/registries-and-formats.md §8` (observed in `data.xsd`, `invoice.xsd`, `type.xsd` [O] unless marked). **Every element/attribute not listed in §8 there is marked [verify against Stormware XSD]**, and CI validates every generated file against the vendored XSD set (`packages/exports/xsd/pohoda/version_2/*.xsd`, downloaded from `https://www.stormware.cz/xml/schema/version_2/`), so a wrong guess fails the build, not the accountant.

#### 4.7.1 Envelope
```xml
<dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:inv="…/invoice.xsd" xmlns:int="…/intDoc.xsd" xmlns:vch="…/voucher.xsd" xmlns:bnk="…/bank.xsd" xmlns:typ="…/type.xsd"
  version="2.0" id="SB-{ICO}-{periodLabel}-v{n}" ico="{org IČO}" application="Shoebox" note="Doklady {periodLabel} v{n}">
  <dat:dataPackItem version="2.0" id="{dataPackItemId}"> … one document … </dat:dataPackItem>
</dat:dataPack>
```
- `dataPack@id` (string64, required) and `dataPackItem@id` are used by Pohoda to detect duplicate imports (`§8.2` [O]). `dataPackItemId = 'SB' + first 12 hex of document_id + '-r' + revision` → re-importing the same revision is rejected by Pohoda as a duplicate; a new revision has a new id (and is handled per §4.10).
- Exactly one document per item (`§8.2` [O]). Encoding UTF-8 with XML declaration; Pohoda accepts Windows-1250 as well **[verify]**; we use UTF-8 and test the import in the pilot.

#### 4.7.2 Agenda per document class (default, configurable in `export_mappings` key_kind `document_class` → target_field `agenda`)

| Our `class` (+ condition) | Pohoda agenda | Type element |
|---|---|---|
| `received_invoice` | `inv:invoice` | `invoiceType = receivedInvoice` |
| `received_credit_note` | `inv:invoice` | `receivedCreditNotice` |
| `received_advance_tax_doc` | `int:intDoc` (daňový doklad k přijaté záloze is booked as an internal document by many accountants) **[verify with pilot accountant]** | — |
| `received_receipt`, `payment_method = 'cash'` | `vch:voucher` | `voucherType = expense`, requires profile `cashAccount` (`typ:ids`, e.g. `HP`) |
| `received_receipt`, card / other | `int:intDoc` (default) or `inv:invoice receivedInvoice` with `paymentType creditcard` (profile option `receipts_as`) | — |
| `issued_invoice` | `inv:invoice` | `issuedInvoice` |
| `issued_credit_note` | `inv:invoice` | `issuedCreditNotice` |
| `platform_statement` | `int:intDoc` (income evidence, e.g. Airbnb/ComGate payout statement) | — |
| `received_proforma` | not exported by default (option: `receivedProformaInvoice`) | — |
| supporting, `non_document`, personal | never exported | — |
| bank transactions | `bnk:bank` **only if** profile `export_bank = true` (default **false**: most accountants import statements straight from the bank into Pohoda, and exporting ours would duplicate them) | `bankType = receipt | expense` |

#### 4.7.3 Header mapping: `inv:invoiceHeader` (`xsd:all`, order free, §8.3 [O])

| Pohoda element | From | Rule |
|---|---|---|
| `inv:invoiceType` | class map | §4.7.2 |
| `inv:number` | export profile numbering | omitted by default (Pohoda assigns from its own series); with profile `number_series` set: `inv:number/typ:numberRequested` = `{prefix}{seq}` **[verify element name]** |
| `inv:symVar` | `variable_symbol` | digits, ≤ 10; else digits of `document_number` if ≤ 10; else omitted |
| `inv:originalDocument` | `document_number` | supplier's number (received side), max length per XSD **[verify]**; truncated with a warning |
| `inv:symConst`, `inv:symSpec` | `constant_symbol`, `specific_symbol` | |
| `inv:symPar` | our stable short id | `SB{seq digits}` so the accountant's own bank pairing can reference it **[verify semantics]** |
| `inv:date` | `issue_date` | received side: profile option `date_from = issue_date | received_date` (default `issue_date`) |
| `inv:dateTax` | `duzp` | |
| `inv:dateAccounting` | `received_date ?? issue_date` | |
| `inv:dateKHDPH` | `vat_point_date` | only for `platce` |
| `inv:dateApplicationVAT` | `vat_point_date` | only for `platce`, received side |
| `inv:dateDue` | `due_date` | |
| `inv:accounting/typ:ids` | `export_mappings` (category → `accounting`) | předkontace code; omitted if unmapped (Pohoda uses the agenda default) and listed in the summary as "bez předkontace" |
| `inv:classificationVAT/typ:ids` or `…/typ:classificationVATType` | `export_mappings` (vat_treatment → `classificationVAT`) | §4.7.5; for `neplatce`: `classificationVATType = nonSubsume` |
| `inv:classificationKVDPH/typ:ids` | `export_mappings` (kh_section → `classificationKVDPH`) | only `platce`; from the line's `vat_ledger_entries.kh_section` **[verify code values]** |
| `inv:text` | `summary_cs` | ≤ 240 chars **[verify max]**; prefixed "NÁHRADNÍ DOKLAD: " when `substitute_reason` set |
| `inv:partnerIdentity/typ:address` | `partner_snapshot` ⊕ `partners` | `typ:company` (name), `typ:city`, `typ:street`, `typ:zip`, `typ:ico`, `typ:dic` (CZ DIČ or foreign VAT ID **[verify field for foreign VAT ID: `typ:dic` vs `typ:icDph`]**), `typ:country/typ:ids` (ISO 2) **[verify]** |
| `inv:paymentType/typ:paymentType` | `payment_method` | `bank_transfer`→`draft`, `card`→`creditcard`, `cash`→`cash`, `cod`→`delivery`, `platform_offset`→`compensation`, `other`→`draft` (values §8.3 [O]) |
| `inv:paymentAccount` | `pay_to_account` | `typ:accountNo`, `typ:bankCode` (§8.3 [I]) **[verify]**; foreign IBAN only in `inv:note` |
| `inv:account/typ:ids` | export mapping `money_account` → Pohoda bank account code | issued invoices: our receiving account; optional |
| `inv:note` | generated | "Shoebox {app link}" + "bez souboru" marker + open questions (≤ 3) + VAT notes |
| `inv:intNote` | generated | `Shoebox doc {document_id} r{revision}; zdroj {field_source}` |
| foreign currency | `currency ≠ CZK` | `inv:invoiceSummary/inv:foreignCurrency/typ:currency/typ:ids`, `typ:rate` (`fx_rate`), `typ:amount` (1, or ČNB unit count), `typ:priceSum` (`total_gross`) **[verify]**; CZK amounts in `homeCurrency` |

`int:intDoc` header uses the analogous elements listed in §8.4 [O] (`number`, `symVar`, `symPar`, `originalDocumentNumber`, `date`, `dateTax`, `dateAccounting`, `dateKHDPH`, `accounting`, `classificationVAT`, `classificationKVDPH`, `text`, `partnerIdentity`). `vch:voucher` header: `voucherType`, `cashAccount`, `originalDocument`, `date`, `datePayment` (`paid_at ?? issue_date`), `dateTax`, `dateKHDPH`, `accounting`, `classificationVAT`, `classificationKVDPH`, `text`, `partnerIdentity` (§8.4 [O]). `bnk:bank` (optional): `bankType`, `account` (profile mapping of the money account), `statementNumber`, `symVar`, `dateStatement`, `datePayment` (`booked_on`), `text`, `partnerIdentity`, `paymentAccount`, `symConst`, `symSpec`, `symPar` (= the paid document's `symPar` when linked) (§8.4 [O]).

#### 4.7.4 Items and summary

Profile `line_mode`:
- `summary` (default, what accountants usually want for daňová evidence): one `inv:invoiceItem` per group `(category_code, vat_treatment, vat_rate_type)` with `text` = category label (+ "(2 položky)"), `quantity` 1, `payVAT = false`, `rateVAT`, `homeCurrency/typ:unitPrice` = Σ net, `typ:price` = Σ net, `typ:priceVAT` = Σ VAT, item-level `accounting` and `classificationVAT` from the mappings (so a mixed invoice gets two předkontace).
- `lines`: one item per `document_lines` row with `line_type ≠ 'text'`.

`rateVAT` (values §8.3 [O]): `vat_rate_type` `standard` → `high`, `reduced` → `low`, `zero`/`none` → `none`. `percentVAT` = `vat_rate_pct` **[verify that sending both is allowed]**.
Reverse-charge received documents (EU/non-EU services, EU goods): items carry the base with `rateVAT` = the self-assessed rate and the členění for self-assessment; the payable total excludes VAT (matches Pohoda's own handling of RC, by analogy with Flexi `research/abra-flexi-accounting-model.md §3.4`) **[verify with pilot accountant on a Booking invoice]**. For `identifikovana_osoba` the same document is exported with the IO členění (§4.7.5).
`rounding` lines → `inv:invoiceSummary/inv:roundingDocument` **[verify: element is an enum of rounding methods, not an amount]**; fallback: an item with `rateVAT none` and text "Zaokrouhlení" (default until verified).
`inv:invoiceSummary/inv:homeCurrency` (`typCurrencyHome`, §8.3 [O]): `typ:priceNone` (zero/none/out-of-scope bases), `typ:priceLow`/`priceLowVAT`/`priceLowSum` (12 %), `typ:priceHigh`/`priceHighVAT`/`priceHighSum` (21 %), `typ:round`; `price3*` unused (`§8.3`: since 2024 21 % → high, 12 % → low). Values from `document_vat_summary`, never recomputed; the M03 math gate guarantees they reconcile.

#### 4.7.5 Classification → Pohoda předkontace and členění DPH

Two mapping layers, both rows in `export_mappings` per export profile, editable by the accountant in a single table screen ("Moje kódy pro Pohodu"); pasted codes are validated as non-empty strings ≤ 20 chars (Pohoda code length **[verify]**).

**(a) Členění DPH (`classificationVAT`)** keyed by `vat_treatment` × `vat_status` of the org. Default profile `pohoda-default` ships the following **suggested codes, all [verify against Pohoda's "Členění DPH" číselník and the Stormware XSD]**; until the pilot accountant confirms them, the default profile emits `classificationVATType` only where it is certain and leaves the rest to the accountant's mapping:

| `vat_treatment` | `platce` | `identifikovana_osoba` | `neplatce` |
|---|---|---|---|
| `rcv_domestic_vat` | `PD` (tuzemské přijaté s odpočtem) [verify] | `nonSubsume` | `nonSubsume` |
| `rcv_domestic_no_vat` | `PN`/`nonSubsume` [verify] | `nonSubsume` | `nonSubsume` |
| `rcv_eu_service_reverse_charge` | EU service self-assessment code [verify] | IO self-assessment code without deduction [verify] | — (cannot occur: an IO trigger) |
| `rcv_non_eu_service_reverse_charge` | non-EU service self-assessment code [verify] | IO code [verify] | — |
| `rcv_eu_goods_acquisition` | EU acquisition code [verify] | IO code [verify] | `nonSubsume` |
| `rcv_foreign_vat_charged`, `rcv_out_of_scope` | `nonSubsume` | `nonSubsume` | `nonSubsume` |
| `rcv_domestic_reverse_charge`, `rcv_import_customs` | left empty + note "řeší účetní" (not simple, `04 §3.2`) | same | same |
| `iss_domestic_vat` | `UD` (uskutečněné tuzemské) [verify] | — | — |
| `iss_eu_service`, `iss_eu_goods`, `iss_non_eu_service`, `iss_export_goods` | codes [verify] | — | — |
| `iss_no_vat` | `nonSubsume` | `nonSubsume` | `nonSubsume` |

`classificationVATType` values `inland` | `nonSubsume` are [O] (`§8.3`).

**(b) Předkontace (`accounting`)** keyed by `category_code` (and optionally `direction`). Pohoda předkontace codes are user-defined per accountant, so there is no universal default; `pohoda-default` maps **category groups** to placeholders that are only emitted after the accountant fills them: `exp_*` deductible → `{exp_default}`, `exp_representation`/`exp_fines_penalties`/`exp_other_non_deductible` → `{exp_non_deductible}`, `asset_long_term` → `{asset}`, `exp_small_assets` → `{small_asset}`, `income_*` taxable → `{income_default}`, `pt_*` → `{pass_through}`, `tax_*`/`ins_*` → `{tax_insurance}`. One code per group fills all categories in it; per-category overrides are optional. Unmapped → `accounting` omitted and the summary says "Předkontaci doplňte v Pohodě" with the count.
Resolution order for one item: per-category row → group row → omitted. Pure function `resolveMapping(profile, keyKind, key, targetField)`.

#### 4.7.6 Validation and failure behaviour
`buildPohodaDataPack(input, profile) → { xml, items: {documentId, itemId, agenda}[], warnings[] }` (pure), then `validateXml(xml, 'pohoda')` with `xmllint --schema data.xsd` (vendored set). Any XSD error → the package cannot go `ready`; the user sees "Export pro Pohodu se nepodařil (chyba u dokladu P-2026-08-004)" and the maintainer gets Sentry with the XSD message (no document content). Warnings (truncations, unmapped codes) are listed in the summary. Phase 2 exit (`02`): the export validates against the Stormware XSD, and the pilot accountant imports one month with no manual fixes (manual checklist §9.3).

### 4.8 ISDOC 6.0.2 export (per document)

Per `research/registries-and-formats.md §7`. `buildIsdoc(doc) → string`, validated against vendored `isdoc-invoice-6.0.2.xsd`.
- **Pass-through first:** if the document came with an embedded/attached ISDOC (`source_files.has_embedded_isdoc`) and `revision = 1` with no `document_fields` of `source = 'user'`, export the original ISDOC bytes unchanged.
- Otherwise generate. Mapping: `DocumentType` from class + `tax_doc_status` (`received_invoice`/`issued_invoice` with full tax doc → 1; credit note → 2; `received_advance_tax_doc` → 5; `simplified_tax_document` → 7; `not_tax_document` invoices → 1 with `VATApplicable = false` and a `Note` "Není daňový doklad"; proformas → 4 when exported at all); `ID` = `document_number` (or `{seq}`); `UUID` = original ISDOC UUID if known else UUIDv5(namespace = org_id, name = document_id); `IssuingSystem` = "Shoebox (přepis dokladu)"; `IssueDate`; `TaxPointDate` = `duzp`; `VATApplicable` = any VAT > 0; `LocalCurrencyCode` = `CZK`; `ForeignCurrencyCode`, `CurrRate` = `fx_rate`, `RefCurrRate` = 1 (CZK documents: both 1, §7.3 [O]); `AccountingSupplierParty` / `AccountingCustomerParty` = partner and org (direction-dependent; `PartyIdentification/ID` = IČO, `PartyTaxScheme/CompanyID` = DIČ/VAT ID, `PostalAddress`); `OriginalDocumentReferences` for credit notes (`corrects` link; required for types 2/3/6, §7.3 [O]); `InvoiceLines` from `document_lines` (`LineExtensionAmount`, `LineExtensionAmountTaxInclusive`, `LineExtensionTaxAmount`, `UnitPrice`, `UnitPriceTaxInclusive`, `ClassifiedTaxCategory/Percent`, `VATCalculationMethod` 0, `Item/Description`); `TaxTotal` from `document_vat_summary` (TaxAmount = Σ subtotals, §7.4 [O]); `LegalMonetaryTotal` (`PayableRoundingAmount` = `rounding`, `PayableAmount` = `amount_due`); `PaymentMeans/Payment/Details` with VS, account, IBAN, due date, `PaymentMeansCode` from `payment_method` (42 bank, 48 card, 10 cash, 50 COD, 97 offset; §7.4 [I]).
- Element order follows the XSD sequence (§7.3 is partly [I]); the XSD validation in CI is the authority.
- Files: `04_Export/isdoc/{file base}.isdoc`. Substitute documents and documents without amounts are **not** exported as ISDOC (an ISDOC asserts a supplier-issued document); they are listed as skipped in the summary.

### 4.9 Money S3 XML (Later, outline only)

Per `research/registries-and-formats.md §9` (element names there are [I]; verify against `schemas.zip` and the sample XMLs before building): root `MoneyData` (`ICAgendy`, `KodAgendy`, `HospRokOd`, `HospRokDo`, `description`, `ExpZkratka`, `ExpDate`, `ExpTime`, `VyberZaznamu="0"`); lists `SeznamFaktPrij/FaktPrij` (received), `SeznamFaktVyd/FaktVyd` (issued), `SeznamIntDokl/IntDokl` (receipts, platform statements), `SeznamPokDokl/PokDokl` (cash), `SeznamBankDokl/BankDokl` (optional bank). `FaktPrij` mapping sketch: `Doklad` (numbering) · `Popis` ← `summary_cs` · `DatUcPr` ← received date · `DatVyst` ← issue · `DatPln` ← DUZP · `DatSplat` ← due · `DatSkPoh` ← `vat_point_date` · `VarSymbol` · `PrijatDokl` ← `document_number` · `KonstSym` · `DodOdb` (partner) · `PrKont` ← předkontace mapping · `Cleneni` ← členění mapping · `SouhrnDPH` (legacy rate slots: map 21 % / 12 % to the slots the XSD names, **[verify]**) · `Celkem` · `Valuty` for foreign currency. Matching in Money is by document number or "Doklad došlý" + partner (`§9` [O]), so `PrijatDokl` must be set. Storno is not supported by the import (`§9` [O]) → corrections go only as new documents. Uses the same `export_profiles`/`export_mappings` with `target = 'money_s3'`. Effort estimate: 4–6 days incl. pilot.

### 4.10 Versions, idempotency and re-export

**Snapshot.** On `ready`, `accountant_package_items` stores one row per exported item: `item_kind`, `document_id` + `document_revision` (or `transaction_id`), `file_name`, `sha256`, `register_seq`, `internal_number` (substitute docs), `change_kind`, `late_from_period`. `content_hash` = sha256 over the sorted manifest. Generating twice from unchanged data yields byte-identical files (deterministic ordering, fixed timestamps inside files = `generated_at` of the version, ZIP entry mtime = same) and the same `content_hash` → the second generation is a no-op.

**Diff vs previous version** (`diffPackages(prevItems, nextItems)`, pure):
- `added`: document in next, not in prev (includes late arrivals);
- `changed`: same document, higher `revision`; the changed fields come from `document_revisions`/`audit_log` (field keys mapped to register column labels), e.g. "Kategorie: Služby → Software", "DUZP 31.07. → 31.08.";
- `removed`: in prev, not in next (deleted, reclassified non-bookable, marked personal, or moved to another period);
- bank: new transactions, new/removed links, changed `match_state`.

**Re-export rules (Pohoda/Money):**
1. Profile option `delta_export` (default **true** for versions ≥ 2): the XML contains only `added` documents. `changed` documents are **not** re-sent automatically, because Pohoda would either reject the duplicate item id (old revision) or create a second invoice (new id). They are listed in the summary and the "Změny" sheet with an instruction "V Pohodě doklad opravte ručně, nebo ho smažte a naimportujte soubor `pohoda_…_zmeny.xml`". That second file (`…_zmeny.xml`) contains the changed documents with new item ids, so the accountant chooses.
2. `removed` documents → listed with "V Pohodě doklad stornujte/smažte".
3. Full export (option): everything, new item ids for changed revisions only; unchanged documents keep their item ids, so Pohoda skips them as duplicates (`§8.2` [O]).
4. ISDOC: always per current revision; file names unchanged across versions (pattern-based), so a changed document overwrites cleanly in the accountant's folder.
5. Update-in-place via Pohoda's import action types (`actionType`/`update` with a filter) is **not** used in V3 **[verify existence and safety; Later]**.

### 4.11 Delivery

1. **Download ZIP** (owner/member/accountant): signed storage URL, 15 min TTL (ADR-004), audit `package.downloaded`.
2. **E-mail link with expiry**: `sharePackage(packageId, { email, ttlDays })`. Creates `package_shares` with a random 32-byte token (base64url), stores `sha256(token)` only, `expires_at = now + ttlDays` (default `package.share_ttl_days` = 30, max 90). The link opens `/p/{token}`: a public read-only page (no login) showing period, score, open items, notes and download buttons (ZIP, Pohoda XML, register). Rate-limited (M12), `noindex`, revocable ("Zrušit odkaz"), every open increments `open_count`/`last_opened_at`. First download by the link sets the package `sent`. E-mail delivery uses Amazon SES through M12's `OutboundMailer` (D-07); the UI also offers "Zkopírovat odkaz". We never e-mail a ZIP attachment (size, privacy).
3. **Accountant seat**: the owner invites the accountant by e-mail (membership `role = 'accountant'`, invite flow per M12/ADR-012). The accountant sees the org in "Pro účetní" with all packages, live completeness of drafts, and can comment, export and acknowledge. RLS per `05 §10`: accountant writes only `comments`, `review_questions.answer` and `accountant_packages` (here: `state` → `acknowledged`, `acknowledged_*`, `notes` is owner-only, enforced by a column-level trigger).

### 4.12 Accountant role UX (keep it extremely simple)

One screen per package, top to bottom:
1. Header: "{Firma} · Srpen 2026 · verze 2" + status chip (Kompletní 96 % / Skoro hotovo / Chybí podklady) + state chip (Připraveno / Předáno / Převzato).
2. Three buttons only: **Stáhnout vše (ZIP)**, **Stáhnout pro Pohodu** (or the profile's target), **Převzato**.
3. "Co je potřeba vědět" box: open items (max 5, "zobrazit vše"), flags (náhradní doklady, bez souboru, dodatečně doručené, změny oproti minulé verzi), the client's notes.
4. Documents table (Č. v soupisu, partner, number, date, total, category, VAT treatment label, paid, flags) with a search box; clicking a row opens the PDF side-by-side with the fields; a comment icon on every row ("Zeptat se klienta").
5. Bank tab (reconciliation per account), "Chybí doklad" tab.
6. "Moje nastavení exportu" (accountant-owned export profile): target software, file naming preset, line mode, receipts agenda, bank export on/off, the code mapping table (§4.7.5). Changing it regenerates `draft`/`ready` packages, never `sent` ones (those get a new version on request).

No accounting jargon for the client; the accountant-facing labels may use Pohoda terms (předkontace, členění DPH).

## 5. Data

### 5.1 Read / written

| Table | Read | Written |
|---|---|---|
| `accountant_packages` | all | insert, state, completeness, files, `sent_*`, notes (owner), acknowledged (accountant) |
| `documents`, `document_lines`, `document_vat_summary`, `document_fields`, `document_links`, `document_revisions` | members | — |
| `source_files` | storage paths | — |
| `partners`, `categories`, `taxpayer_profiles` | | — |
| `vat_ledger_entries`, `tax_ledger_entries` | period rows | — |
| `transactions`, `payment_links`, `money_accounts`, `statement_imports` (M07) | period rows | — |
| `validation_results`, `review_questions`, `comments` | members | `comments` (insert by owner/member/accountant) |
| `filings` | VAT cross-check | — |
| `expected_documents` (M01) | open rows | — |
| `audit_log`, `notifications` | | insert |

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §8 `accountant_packages` (period_kind, version, supersedes_package_id, export_profile_id, completeness_score, content_hash, manifest_path, acknowledged_*), `accountant_package_items`, `package_shares`, `export_profiles`, `export_mappings`, and the RLS exceptions in 05 §10.2 (accountant writes export profiles and mappings; owner/member share). Product config (not law): `package.completeness_weights`, `package.share_ttl_days` (06 §2).

## 6. Interfaces

### 6.1 Types and functions (`packages/exports`)

```ts
export type PeriodKind = 'month'|'quarter'|'year';
export interface Period { kind: PeriodKind; start: IsoDate; end: IsoDate; label: string }   // '2026-08' | '2026-Q3' | '2026'
export interface CompletenessReport { version: number; score: number; label: 'complete'|'almost'|'missing';
  components: Record<'C1'|'C2'|'C3'|'C4'|'C5'|'C6', { ratio: number; weight: number; skipped?: boolean }>;
  missing: MissingItem[]; counts: { bookable: number; supporting: number; transactions: number; substitute: number; noFile: number; personal: number } }
export interface MissingItem { kind: 'missing_document'|'missing_credit_note'|'unexplained_income'|'substitute_unpaid'|'substitute_unconfirmed'
  |'statement_gap'|'blocking_validation'|'open_question'|'needs_review_document'|'expected_invoice'; ref: string; amount?: Money; labelKey: string; params: Record<string,string> }
export function periodKeyDate(doc: DocView, profileAt: (d: IsoDate) => ProfileView): IsoDate;            // pure
export function selectMembers(input: MembershipInput, period: Period): Members;                          // pure, §4.1
export function computeCompleteness(m: Members, radar: RadarItem[], cfg?: CompletenessConfig): CompletenessReport; // pure
export function nameFile(doc: DocView, pattern: NamingPreset | string, ctx: NamingCtx): string;          // pure
export function buildRegisterWorkbook(m: Members, opts: RegisterOpts): Promise<Uint8Array>;             // exceljs
export function buildRegisterCsv(m: Members): Uint8Array;
export function renderSummaryPdf(v: SummaryView): Promise<Uint8Array>;
export function renderSubstituteDocumentPdf(v: SubstituteView): Promise<Uint8Array>;
export function buildPohodaDataPack(i: PohodaInput, p: ExportProfileView): { xml: string; items: PohodaItemRef[]; warnings: ExportWarning[] };
export function buildIsdoc(d: IsdocDocView): { xml: string; passthrough: boolean };
export function buildMoneyS3(i: MoneyInput, p: ExportProfileView): { xml: string; warnings: ExportWarning[] };  // Later
export function resolveMapping(p: ExportProfileView, keyKind: string, key: string, target: string, vatStatus?: VatStatus): string | undefined;
export function validateXml(xml: string, schema: 'pohoda'|'isdoc'|'money_s3'): Promise<{ valid: boolean; errors: string[] }>; // xmllint
export function diffPackages(prev: PackageItemView[], next: PackageItemView[], revisions: RevisionView[]): PackageDiff;
export function buildZip(entries: ZipEntry[], mtime: Date): Promise<Uint8Array | NodeJS.ReadableStream>;

// services (I/O)
export function basicExport(ctx: TenantCtx, period: Period): Promise<{ zipPath: string }>;                // Phase 1
export function ensureDraftPackage(ctx: TenantCtx, period: Period): Promise<PackageRow>;
export function generatePackage(ctx: TenantCtx, packageId: string): Promise<{ state: 'ready'|'draft'; errors: ExportWarning[] }>;
export function sharePackage(ctx: TenantCtx, packageId: string, o: { email?: string; ttlDays?: number }): Promise<{ url: string; expiresAt: string }>;
export function revokeShare(ctx: TenantCtx, shareId: string): Promise<void>;
export function acknowledgePackage(ctx: TenantCtx, packageId: string): Promise<void>;
export function markSent(ctx: TenantCtx, packageId: string): Promise<void>;
```

### 6.2 Jobs (zod payloads)

```ts
export const PackageJobs = {
  'export.basic':               z.object({ orgId: z.string().uuid(), period: PeriodSchema, requestedBy: z.string().uuid() }),
  'package.generate':           z.object({ orgId: z.string().uuid(), packageId: z.string().uuid(), requestedBy: z.string().uuid().optional() }),
  'package.completeness.refresh': z.object({ orgId: z.string().uuid(), periodStart: IsoDateSchema, periodEnd: IsoDateSchema }),
  'package.auto_draft':         z.object({ orgId: z.string().uuid() }),          // monthly scheduler fan-out
  'package.share.email':        z.object({ orgId: z.string().uuid(), shareId: z.string().uuid() }),
  'export.xsd.drift':           z.object({}),                                     // monthly, maintainer alert
};
```
Idempotency: `{org}:package.generate:{packageId}:{inputHash}` where `inputHash` = sha256 of member ids + revisions + profile `updated_at`; a repeat with the same hash is a no-op. Generation failures: retry 2×; XSD failure is not retried (deterministic) → package stays `draft` with `completeness.export_errors`.

### 6.3 API routes (`/api/v1`)

| Method | Route | Role | Purpose |
|---|---|---|---|
| POST | `/exports/basic` `{period}` | owner, member | Phase 1 ZIP → 202 + job id |
| GET | `/packages?year=` | all | list (period, version, state, score) |
| POST | `/packages` `{period}` | owner, member | ensure draft |
| GET | `/packages/{id}` | all | detail, completeness, items, diff |
| POST | `/packages/{id}/generate` | owner, member, accountant | generate → `ready` |
| GET | `/packages/{id}/download?part=zip|pohoda|register|isdoc` | all except viewer for XML | signed URL |
| POST | `/packages/{id}/share` `{email?, ttlDays?}` | owner, member | share link |
| DELETE | `/package-shares/{id}` | owner, member | revoke |
| POST | `/packages/{id}/acknowledge` | accountant (owner allowed, audited) | `sent → acknowledged` |
| POST | `/packages/{id}/mark-sent` | owner, member | |
| PATCH | `/packages/{id}` `{notes}` | owner, member | client notes |
| GET/PUT | `/export-profiles/{id}`, `/export-profiles/{id}/mappings` | owner, accountant | settings + mapping table |
| GET | `/p/{token}` (+ `/p/{token}/download?part=`) | public, token | share page |

Comments use the shared comments API (M11/M12): `POST /comments {packageId|documentId|transactionId, body}`.

### 6.4 Events
`package.state_changed {packageId, from, to}` (consumed by M09), `package.generated {packageId, version, contentHash}`, `package.shared {packageId, shareId}`, `package.acknowledged {packageId, by}`, `export.failed {packageId, format, code}`.

## 7. UX touchpoints

Screen **Pro účetní** (one of the four, `01 §3`). For the client: period picker (month chips), the completeness card, the open-items list with one-tap fixes (each item deep-links to the Inbox question or the M07 radar action), notes field, and two buttons: **Poslat účetní** (share) and **Stáhnout**. For users without an accountant (P1) the screen reads "Archiv a export" with only the download.

| Key | Czech |
|---|---|
| `package.title` | Pro účetní |
| `package.period.month` | {month} {year} |
| `package.score.complete` | Kompletní ({score} %) |
| `package.score.almost` | Skoro hotovo ({score} %) |
| `package.score.missing` | Chybí podklady ({score} %) |
| `package.missing.missing_document` | Platba {amount} ze dne {date} ({counterparty}) nemá doklad |
| `package.missing.statement_gap` | Chybí výpis z účtu {account} za {from}–{to} |
| `package.missing.blocking_validation` | Doklad {number}: {rule} |
| `package.missing.open_question` | Nezodpovězený dotaz: {question} |
| `package.missing.substitute_unconfirmed` | Náhradní doklad {number} ještě nemáte potvrzený |
| `package.flag.substitute` | {count, plural, one {# náhradní doklad} few {# náhradní doklady} other {# náhradních dokladů}} |
| `package.flag.no_file` | {count, plural, one {# doklad bez souboru} few {# doklady bez souboru} other {# dokladů bez souboru}} |
| `package.flag.late` | Dodatečně doručené doklady z dřívějších období: {count} |
| `package.send` | Poslat účetní |
| `package.send.hint` | Účetní dostane odkaz platný {days} dní. Nic nemusí instalovat. |
| `package.send.with_open` | Můžete poslat i teď. Účetní uvidí, co ještě chybí. |
| `package.download` | Stáhnout |
| `package.ack` | Převzato |
| `package.ack.done` | Účetní převzala balíček {date}. |
| `package.version.new` | Od odeslání se změnilo: {added} nových, {changed} opravených dokladů. Připravit verzi {version}? |
| `package.changes.instruction_changed` | V Pohodě doklad opravte ručně, nebo ho smažte a naimportujte soubor se změnami. |
| `exports.marker.no_file` | bez souboru |
| `exports.substitute.title` | Interní / náhradní doklad č. {number} |
| `exports.substitute.reason.lost` | Originální doklad byl ztracen |
| `exports.substitute.reason.damaged` | Originální doklad je poškozený nebo nečitelný |
| `exports.substitute.reason.never_issued` | Doklad nebyl vystaven |
| `exports.substitute.reason.other` | Jiný důvod |
| `exports.substitute.confirmation` | Potvrzuji, že výdaj byl skutečně vynaložen v souvislosti s mou podnikatelskou činností a že údaje odpovídají skutečnosti. |
| `exports.substitute.confirmed_by` | Potvrdil(a) {name} v aplikaci {datetime} |
| `exports.substitute.unconfirmed` | Nepotvrzeno uživatelem |
| `exports.substitute.no_payment` | Platba zatím nespárována |
| `exports.substitute.vat_note` | Náhradní doklad není daňovým dokladem; DPH se standardně neuplatňuje. |
| `exports.pohoda.unmapped` | Předkontaci doplňte v Pohodě ({count} dokladů) |
| `exports.pohoda.failed` | Export pro Pohodu se nepodařil (doklad {seq}). Opravíme to, zkuste to prosím později. |
| `package.share.email.subject` | Podklady {period} – {company} |
| `package.share.email.body` | Dobrý den,\n\npodklady za {period} jsou připravené: {url}\nOdkaz platí do {expires}. Kompletnost {score} %.{openLine}\n\n{company} |

## 8. Edge cases and failure modes

1. **Profile change mid-period** (becomes `platce` on 15 Aug): key date per document uses the profile valid at the document's date; the summary notes "Od 15. 8. plátce DPH".
2. **Document moved between periods after sending** (DUZP corrected): appears as `removed` in v_n+1 of the old period and `added` (late arrival) in the new one; both diffs say why.
3. **Quarterly package while a monthly one was sent** (user changed period kind): a document is in at most one *sent* package per period kind; selecting a quarter that contains sent months shows "Srpen už byl předán ve verzi 1" and includes only unsent/changed items unless "vše" is chosen.
4. **Foreign-currency document without FX rate**: blocking validation (M03); the package is still sendable; the Pohoda item uses the document currency only and the summary flags it.
5. **Partner without IČO** (Apple consumer invoice, foreign suppliers): `partnerIdentity` with name/address/VAT ID only; `{ico}` token → `bezICO`.
6. **Very long names/numbers**: truncated with a warning per element limit from the XSD.
7. **Split PDF pages missing** (`page_to` null): export to the last page.
8. **HEIC conversion fails**: export the original HEIC plus a warning; never drop the file.
9. **Share link forwarded to someone else**: link is read-only, expires, can be revoked, opens are logged and visible to the owner ("Otevřeno 3×, naposledy včera 14:02").
10. **Accountant changes mapping after `sent`**: only new versions use it; existing files stay as delivered (reproducibility).
11. **Substitute document later replaced by the original** (user finds the receipt): M01 dedupes/merges; the next version shows `changed` and the generated substitute PDF is no longer produced; `internal_number` is retired, not reused.
12. **Manual document with a photo** (`entry_mode = 'manual'`, `source_file_id` set): exported with its photo PDF, no "bez souboru" marker.
13. **Imported spreadsheet rows** without files and without amounts split by VAT: exported with `priceNone` = total and a note "importováno z tabulky".
14. **Generation crashes mid-way**: files written to a temp prefix, moved on success; the package stays `draft`; idempotent retry.
15. **Storage outage**: generation retries; download buttons show "Soubor se připravuje".
16. **Package with zero documents** (inactive month): allowed; summary says "Žádné doklady ani platby" so the accountant knows it is intentional.

## 9. Acceptance criteria and test plan

### 9.1 Acceptance criteria
- **A1 (Phase 1)** `basicExport` for golden P4 August 2026 produces a ZIP with every bookable golden document whose key date is in August exactly once (IKEA NFC/NFD pair → one file, Decathlon PNG pair → one file), all 6 decoys only under `02_Podpurne/` (those dated or linked to August), and `Soupis` XLSX + CSV with one row per bookable member.
- **A2** File names follow the default preset, are ASCII-only, ≤ 124 chars incl. extension, unique per folder, and identical across two generations (property test over random documents and all 8 presets).
- **A3** The CSV opens in Czech Excel locale correctly: BOM present, `;`, decimal comma (fixture byte comparison).
- **A4** Membership: with `foreign_service_dppd_policy = 'issue_date'` (P4 history, `04 §1`), the Booking.com July invoice (13 699,77 Kč, issued 3 Aug) is in the August package; its DPH sheet row shows DPHDP3 row 5 with exact base 13 699,77 / tax 2 876,95 and form-rounded 13 700 / 2 877, and the summary reports "Souhlasí s podaným přiznáním" against the filed DPHDP3 (golden decoy). With `service_period_end` it lands in July.
- **A5** No golden decoy (order confirmation, 2 settlement statements, 2 tourist-fee reports, filed DPHDP3) appears in the Pohoda XML, ISDOC set or the "Doklady" sheet; all appear in "Podpůrné" marked "Nezaúčtováno".
- **A6** The Decathlon receipt marked personal is excluded from Pohoda/ISDOC and listed in "Soukromé".
- **A7** The Alza 117 Kč "Faktura" (`not_tax_document`) is exported as `receivedInvoice` with `classificationVATType = nonSubsume` (IO profile) and the note "Není daňový doklad"; the Booking Aug invoice without buyer DIČ carries the VAT note in the summary.
- **A8** Completeness: unit tests for each component and the weighted score; with the M07 golden companion fixture the August score lists the Alza 2 105 Kč `missing_document` with the `expected_invoice` hint and no tourist-fee/tax transactions as missing.
- **A9** Pohoda: every generated dataPack for the golden months and for 200 synthetic documents (all classes × treatments × currencies × statuses) validates against the vendored Stormware XSD (CI); `dataPack@id`/`dataPackItem@id` are deterministic.
- **A10** Pilot (manual checklist, Phase 2 exit): a real accountant imports one month into Pohoda with no manual fixes; the checklist records Pohoda version, agenda counts imported, warnings, and confirms or corrects every **[verify]** element in §4.7 (results recorded in the report and in this spec).
- **A11** ISDOC: every generated file validates against `isdoc-invoice-6.0.2.xsd`; an input document with an embedded ISDOC and no user edits is exported byte-identically.
- **A12** Substitute documents: for a fixture with `substitute_reason = 'lost'`, one card payment link and a `substitute.confirmation` field, the package contains `01_Doklady/Nahradni/…_nahradni.pdf` with all blocks of §4.4.2 (text extraction test for: legal name, partner, amount, date, reason label, payment date + amount, confirmation line with name and timestamp), the register column "Náhradní doklad" = "Originální doklad byl ztracen", the summary flags count = 1, the Pohoda `inv:text` starts with "NÁHRADNÍ DOKLAD:", and no ISDOC is produced for it. Without confirmation → "Nepotvrzeno uživatelem" + `substitute_unconfirmed` in `missing[]`. Without a payment → "Platba zatím nespárována" + `substitute_unpaid`.
- **A13** "Bez souboru": a `manual` and an `imported` document without `source_file_id` appear in the register with "bez souboru" in "Soubor", in Pohoda `inv:note`, and in the summary count; no PDF is generated for them.
- **A14** Versions: generating twice with no data change → same `content_hash`, no new version; after adding 1 and editing 1 document post-`sent`, v2's diff reports exactly 1 added and 1 changed with the changed field labels; delta Pohoda XML contains only the added document; `…_zmeny.xml` contains the changed one with a new item id.
- **A15** Share links: token stored hashed; expired or revoked token → 404 page; first download sets `sent`; accountant `acknowledge` moves `sent → acknowledged` and emits `package.state_changed`; a viewer cannot acknowledge (RLS test).
- **A16** Performance: a 1 000-document month (300 MB of PDFs) generates in < 3 min on the staging worker with streaming ZIP; memory < 1 GB.

### 9.2 Test plan
- **Unit:** `periodKeyDate`, `selectMembers`, `computeCompleteness`, `nameFile`, `resolveMapping`, `diffPackages`, Pohoda builder per agenda (snapshot tests with XML canonicalisation), ISDOC builder, substitute PDF text content, CSV bytes.
- **Property:** naming determinism and uniqueness; diff symmetry (removed in A→B = added in B→A); idempotent generation (same input → same `content_hash`).
- **Integration:** golden P4 months (March, July, August, September) end-to-end through `generatePackage`; XSD validation via `xmllint` in CI; RLS tests for the four new tables and the accountant role.
- **E2E (Playwright):** owner prepares August → fixes one open item → shares link → anonymous opens `/p/{token}` → downloads ZIP; accountant logs in → comments → client answers → accountant clicks Převzato → M09 card shows "Převzato".
- **Fixtures:** `testdata/golden-v1` + M07 companion bank fixture + `packages/exports/fixtures/synthetic-200.json` (generator, seed 20261018) + 3 substitute/manual/imported fixtures.

### 9.3 Pilot import checklist (manual, Phase 2 exit)
1. Accountant fills "Moje kódy pro Pohodu" (předkontace groups + členění).
2. Import `pohoda_….xml` into a copy of the client's Pohoda (Soubor → Datová komunikace → XML import, `research/registries-and-formats.md §8.1` [I]).
3. Record: number of imported documents per agenda = summary counts; zero rejected items; VAT recap totals equal the "DPH" sheet; partner records created/matched by IČO; dates (DUZP, KH date) correct; reverse-charge Booking invoice booked as expected.
4. Re-import the same file → all items reported as duplicates.
5. Each **[verify]** element in §4.7: confirmed or corrected (edit this spec + builder).

## 10. Maintenance

| Source of change | Containment | Monitor | Effort/yr |
|---|---|---|---|
| Stormware XSD (`version_2`) | vendored XSD set, builders are table-driven, CI XSD validation | monthly `export.xsd.drift`: sha256 of each XSD vs vendored (same pattern as `06 §3`), plus a check of Stormware's "plánované změny kompatibility" page | 1 day |
| ISDOC | 6.0.2 unchanged since 2022 (`§7.1` [O]); vendored XSD | same drift job (`isdoc.cz/6.0.2/xsd`) | ~0 |
| Accountants' codes and preferences | user data (`export_mappings`), not code | — | 0 |
| VAT rate slots (Pohoda high/low/third, Money legacy slots) | single mapping function from `vat_rate_type` | rule-change PRs touching `vat.rates` trigger an export test | 0.5 day in a rate-change year |
| Register columns / labels | i18n + one column table | — | ~0 |
| Money S3 (Later) | same pattern | drift on `schemas.zip` | +0.5–1 day once built |

**Total: ~1–2 days/year.**

## 11. Open questions
Consolidated in `22-open-questions.md`: T-06 (Pohoda element names), TA-17 (default členění DPH, receipts agenda, generated ISDOC for received documents; pilot accountant D-02), TA-02 (substitute-document wording and weight). Resolved (22 §F): bank movements are not exported to Pohoda by default; e-mail links go through SES (D-07); the period key for non-payers is the document date (the register shows `paid_at`); share links are deleted 90 days after expiry.
