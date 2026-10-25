# 04: Domain model (business concepts and canonical enums)

This file is the **single source of truth for names and enums**. Module specs and the DDL (`05-data-model.md`) must use these exact identifiers. Every enum is a Postgres enum or check constraint *and* a TypeScript union in `packages/domain/src/enums.ts`.

Legal facts cite `research/` files. Numbers that change over time live in rule tables (`06-maintenance-playbook.md`), never in code.

---

## 1. Organization and taxpayer profile

An **organization** is one taxpayer: one OSVČ (IČO) or, later, one company. Users join organizations through memberships with a role (`owner`, `member`, `accountant`, `viewer`).

The **taxpayer profile** is **effective-dated** (`valid_from`, `valid_to`), because status changes mid-year. Examples: becoming an identified person after the first Booking invoice; becoming a VAT payer the day after crossing 2 536 500 Kč. Every computation asks `profile.at(date)`.

| Field | Enum / type | Notes |
|---|---|---|
| `vat_status` | `neplatce` \| `identifikovana_osoba` \| `platce` | IO = §6g–6l. Payer = §6–6f. |
| `vat_period` | `monthly` \| `quarterly` \| `null` | IO is always monthly, filing only for months with a liability. |
| `tax_regime` | `danova_evidence` \| `pausalni_vydaje` \| `pausalni_dan` \| `ucetnictvi` | `ucetnictvi` is reserved (not supported in V3: export-only). |
| `pausal_rate` | `80` \| `60` \| `40` \| `30` \| `null` | `pausalni_vydaje`: the flat-rate %. `pausalni_dan`: the declared dominant activity class (≥ 75 % of income), used for band ceilings (M06 §4.4, M09 §4.4.2). V3 supports one rate per profile; multiple activities with different rates are a checklist item for the accountant (22 §F). |
| `pausal_dan_band` | `1` \| `2` \| `3` \| `null` | Only for `pausalni_dan`. |
| `entity_type` | `osvc` \| `sro` | `sro` is future. |
| `ico`, `dic`, `name`, `address` | | From ARES at onboarding; refreshed monthly. |
| `fu_code`, `ufo_code` | | Tax office codes (from the ARES address, or chosen). |
| `main_activity_nace` | text | From ARES `czNace` if present. |
| `insurer` | `vzp` \| `vozp` \| `cpzp` \| `ozp` \| `zpskoda` \| `zpmv` \| `rbp` | Used for podklady and reminders. |
| `has_accountant` | boolean | Switches defaults: package-first and fewer filings. |
| `foreign_service_dppd_policy` | `service_period_end` \| `issue_date` | How to date self-assessed foreign services (§24). The default is `service_period_end` when the document states a service period, otherwise `issue_date`. P4 historically used `issue_date`. Needs advisor confirmation (`22-open-questions.md`). |

## 2. Documents

### 2.1 Document class: *what is this paper?* (`document_class`)

Classification happens **before** extraction of accounting fields. Only *bookable* classes create ledger entries.

| `document_class` | Bookable | Typical examples | Notes |
|---|---|---|---|
| `received_invoice` | ✅ | supplier invoices (CZ, EU, non-EU), SaaS invoices | Includes foreign invoices without CZ VAT. |
| `received_receipt` | ✅ | cash-register or card receipts (IKEA, Decathlon), fuel | Usually a simplified tax document (≤ 10 000 Kč). |
| `received_credit_note` | ✅ | opravný daňový doklad from a supplier | Links to the original via `corrects_document_id`. |
| `received_advance_tax_doc` | ✅ | daňový doklad k přijaté platbě (ZDD) from a supplier | For payers' VAT. |
| `received_proforma` | ❌ (tracked as payable) | zálohová faktura | Not a tax document. Becomes bookable only via the final invoice or ZDD. |
| `issued_invoice` | ✅ | user's own invoices (uploaded, or later created in-app) | Income side. |
| `issued_credit_note` | ✅ | | |
| `platform_statement` | ✅ (income source) | Airbnb or Booking payout reports, payment-gateway settlements, marketplace statements | Income evidence when there is no issued invoice. Carries gross, fees and payout. |
| `settlement_statement` | ❌ (supporting) | property-manager statements ("Vyúčtování"), commission reports | Used for reconciliation; links to invoices. |
| `order_confirmation` | ❌ (supporting) | e-shop orders ("Objednávka… nemá náležitosti daňového dokladu") | Kept and linked to the later invoice. Creates an expected-invoice reminder. |
| `delivery_note` | ❌ | dodací list | |
| `bank_statement` | ❌ (import source) | PDF or CSV statements | Routed to bank import (M07) if parseable. |
| `government_filing` | ❌ (supporting) | own filed returns (DPHDP3 PDF), municipal fee reports, tax-office notices | Used to verify the profile and history. Never booked. |
| `contract` | ❌ | rental, leasing, service contracts | Optional metadata: recurring obligations. |
| `other_supporting` | ❌ | warranty cards, price quotes | |
| `non_document` | ❌ | newsletters, marketing, photos, signatures | Hidden in the "Ostatní" (other) tab. |
| `unknown` | ❌ (until classified) | anything the classifier could not decide | Default before classification; a `which_class` question resolves it. |

### 2.2 Tax-document status (`tax_doc_status`): *can it support VAT?*

| Value | Meaning | Detection |
|---|---|---|
| `full_tax_document` | Meets §29 ZDPH. | VAT payer supplier, buyer DIČ when the document is > 10 000 Kč, required fields present. |
| `simplified_tax_document` | §30 simplified (≤ 10 000 Kč incl. VAT). | Receipts with supplier DIČ and the VAT recap. |
| `not_tax_document` | Explicitly says so ("Toto není daňový doklad", "nemá náležitosti daňového dokladu"), or the supplier is a non-payer. | Text pattern + supplier VAT status. Still valid evidence for income tax. |
| `foreign_document` | Supplier outside CZ, no CZ VAT charged. | Supplier country + VAT ID. Triggers self-assessment logic. |
| `unknown` | | Ask the user only if VAT-relevant. |

### 2.2a How a document entered (`entry_mode`) and substitute documents

| `entry_mode` | Meaning | Pipeline |
|---|---|---|
| `captured` | Scanned, uploaded, photographed or e-mailed; has a `source_file`. The normal path. | full: classify → extract → validate → categorize |
| `manual` | Typed in by the user ("Přidat ručně"): no paper, a cash expense, or the user prefers typing. A photo is optional; when one is attached, extraction still runs and the user fills the gaps. Typed fields have `field_source = 'user'`. | skips classify/extract → validate → categorize |
| `imported` | One row from the user's old spreadsheet (Phase 2 import, M01). The goal is that nobody keeps a parallel Excel list. | validate → categorize; merges with a later captured document via dedupe |

**Substitute document (náhradní doklad):** when the original is lost, damaged or was never issued, the user sets `substitute_reason`. Then:
- `tax_doc_status = not_tax_document`, so no input VAT is deducted by default. The accountant may override [verify ZDPH §73(5): entitlement can be proven by other means].
- The document still counts for income tax, with a warning until a payment is linked [verify ZDP §24].
- The accountant package contains a generated one-page "Interní / náhradní doklad" PDF (M10).

Manual entry is always available. No document is ever blocked from being recorded because extraction failed.

Canonical names (used by M01, M03, M04, M10, M11 and 05): `documents.entry_mode` (`captured` | `manual` | `imported`), `documents.substitute_reason` (`lost` | `damaged` | `never_issued` | `other`, null when not a substitute), `documents.source_file_id` (null allowed only when `entry_mode ≠ 'captured'`), `documents.import_id` / `import_row` (imported rows). Typed and imported values have `field_source = 'user'`; there is no separate `import` source.

### 2.4 Document status (`document_status`)

The pipeline states are in 03 §3. The terminal non-booking state is **`supporting`**: the document is kept, lightly extracted, linked to the documents it explains and **never booked**. Every non-bookable class ends there (`settlement_statement`, `order_confirmation`, `delivery_note`, `government_filing`, `contract`, `other_supporting`, `bank_statement`, `non_document`); the class decides the Inbox tab (Podklady vs Ostatní). `received_proforma` is the exception: it goes to `ready` for payable tracking but never creates ledger entries. `duplicate` is kept and linked to its original (`duplicate_of`). The UI never says "zamítnuto" (rejected).

> Renamed on 2026-10-18 from `rejected` to `supporting` (no code existed yet; `docs/context/decisions.md`).

### 2.3 Dates (never collapse them)

| Field | Meaning | Used for |
|---|---|---|
| `issue_date` | datum vystavení | numbering, display |
| `duzp` | datum uskutečnění zdanitelného plnění (taxable supply date). For receipts it is the issue date ("datum vystavení je datum zdanit. plnění"). | VAT period (output) |
| `received_date` | when the document reached us (e-mail date or upload date) | VAT deduction timing (payers) |
| `due_date` | splatnost | payables and reminders |
| `service_period_from`, `service_period_to` | billing period stated on the document (Booking "Období") | DPPD for foreign services, accruals info |
| `vat_point_date` | derived: the date that decides the VAT period for this document's VAT entries | VAT ledger (M05) |
| `paid_at` | derived from payment links (M07), or from the document itself for card or cash receipts | Income-tax cash basis (daňová evidence) |

## 3. Lines and classification

Every bookable document has ≥ 1 `document_line`. Classification lives **on the line**, defaulted from the document. A line has:

- `category_code` (§3.1): what the money was for, in plain language.
- `vat_treatment` (§3.2): how VAT applies.
- `vat_rate_type`: `standard` \| `reduced` \| `zero` \| `none`. The percentage is resolved from rules at `vat_point_date`.
- `business_share_pct` (0–100, default 100): private-use split.
- `deductibility` (derived from category + share + rules, stored on the line for display and export): `deductible` \| `non_deductible` \| `partially_deductible` \| `not_applicable`.
- `line_type`: `item` \| `discount` \| `shipping` \| `fee` \| `rounding` \| `advance_deduction` \| `deposit` \| `text`.

**Sign convention:** amounts are stored signed. Discount lines are negative. Credit notes (`received_credit_note`, `issued_credit_note`) store **negative** lines, VAT recap and totals; M02 normalizes a printed-positive "dobropis" at persist time and keeps the printed value in `document_fields`. Downstream code (M03–M10) never flips signs by class.

### 3.1 Categories (`category_code`): seed taxonomy

Plain-language categories mapped to a **tax effect**. Adapted from Competitor E's 60 item types (internal research (not published)), trimmed for OSVČ and extended for the personas. The seed list is in `packages/db/seeds/categories.ts`, with Czech and English labels, an icon, and a one-sentence explanation.

`tax_effect` enum: `taxable_income` \| `non_taxable_income` \| `deductible_expense` \| `non_deductible_expense` \| `asset` \| `pass_through` \| `transfer` \| `tax_or_insurance_payment` \| `private`.

| Group | `category_code` → tax_effect |
|---|---|
| **Income** | `income_services` → taxable_income · `income_goods` → taxable_income · `income_accommodation` → taxable_income (short-term rental with services; §7 vs §9 is the accountant's call, flagged) · `income_platform_payout` → taxable_income (gross recognized; fees as expense) · `income_other_taxable` · `income_interest` → non_taxable_income (taxed at source) · `income_subsidy` → non_taxable_income · `income_loan_received` → non_taxable_income · `income_owner_deposit` → non_taxable_income · `income_vat_refund` → non_taxable_income |
| **Operating expenses (deductible)** | `exp_material` · `exp_goods_for_resale` · `exp_small_assets` (≤ 80 000 Kč) · `exp_services_general` · `exp_software_saas` · `exp_hosting_domains` · `exp_telecom` · `exp_rent` · `exp_energy` · `exp_cleaning` · `exp_property_management` · `exp_platform_commission` (Booking/Airbnb/marketplaces) · `exp_payment_fees` · `exp_bank_fees` · `exp_advertising` · `exp_accounting_legal` · `exp_postage_shipping` · `exp_travel_transport` · `exp_fuel` · `exp_car_operating` · `exp_car_lease` · `exp_repairs` · `exp_insurance_business` · `exp_training_education` · `exp_office_supplies` · `exp_salaries` (future) · `exp_other_deductible` |
| **Non-deductible** | `exp_representation` (meals with clients, gifts) · `exp_fines_penalties` · `exp_other_non_deductible` |
| **Assets** | `asset_long_term` (> 80 000 Kč, depreciated; V3 lists only) |
| **Pass-through** | `pt_tourist_fee` (poplatek z pobytu collected from guests and remitted to the municipality) · `pt_deposit` (kauce) · `pt_customs_vat` |
| **Taxes and insurance** | `tax_vat_payment` · `tax_income_payment` · `tax_pausal_advance` · `ins_social_own` · `ins_health_own` (own insurance: non-deductible for income tax but tracked) · `tax_other_fees` |
| **Transfers** | `transfer_own_accounts` · `transfer_cash_deposit` · `transfer_cash_withdrawal` · `loan_repayment_principal` |
| **Private** | `private_expense` · `private_withdrawal` (výběr podnikatele) |

Rules:
- An `asset_long_term` purchase over 80 000 Kč (rule table) is listed separately in podklady. A single item at or under the threshold maps to `exp_small_assets`.
- `exp_fuel` and `exp_car_*` raise a one-time question about the car regime (actual costs vs flat-rate per km, business share). V3 records the answer for the accountant and does not compute depreciation or km allowances.
- Categories are **data** (seed table, versioned). Users may hide them but not change their tax effect. Custom user labels map onto a base category.

### 3.2 VAT treatment (`vat_treatment`)

Derived from the supplier country + supplier VAT status + document VAT content + the user's `vat_status`. This is a simplified, OSVČ-relevant subset of Competitor E's 61 VAT types (internal research (not published)). DPHDP3 rows and KH sections follow `research/czech-tax-filings.md §1.3.1 and §2`.

**Received side**

| `vat_treatment` | When | DPHDP3 (payer) | DPHDP3 (IO) | KH (payer) | M05 "simple"? |
|---|---|---|---|---|---|
| `rcv_domestic_vat` | CZ payer supplier, CZ VAT charged | 40 (21 %) / 41 (12 %) | — (no deduction; VAT is a cost) | B2 if doc > 10 000 Kč incl. VAT, else B3 | ✅ |
| `rcv_domestic_no_vat` | CZ non-payer supplier, or `not_tax_document` | — | — | — | ✅ |
| `rcv_eu_service_reverse_charge` | EU supplier, service, §9(1), no VAT | 5/6 + deduction 43/44 | 5/6 only | A2 | ✅ |
| `rcv_non_eu_service_reverse_charge` | Non-EU supplier, service with place of supply in CZ | 12/13 + 43/44 | 12/13 only | A2 | ✅ |
| `rcv_eu_goods_acquisition` | EU supplier, goods, no VAT | 3/4 + 43/44 | 3/4 (IO above the 326 000 Kč threshold) | A2 | ⚠️ simple only if a single rate |
| `rcv_domestic_reverse_charge` | CZ §92a (construction, scrap, …) | 10/11 + 43/44 | — | B1 | ❌ → accountant |
| `rcv_import_customs` | Import with customs JSD | 42 | — | — | ❌ → accountant |
| `rcv_foreign_vat_charged` | Foreign VAT charged (hotel abroad, foreign SaaS charging its own VAT) | — | — | — | ✅ (cost only) |
| `rcv_out_of_scope` | Fees, taxes, insurance, tourist fee | — | — | — | ✅ |

**Issued side** (relevant once the user has outgoing documents)

| `vat_treatment` | DPHDP3 | KH | SH |
|---|---|---|---|
| `iss_domestic_vat` | 1 / 2 | A4 (customer CZ DIČ and > 10 000 Kč) else A5 | — |
| `iss_eu_service` | 21 | — | code 3 |
| `iss_eu_goods` | 20 | — | code 0 |
| `iss_non_eu_service` | 26 | — | — |
| `iss_export_goods` | 22 | — | — |
| `iss_domestic_reverse_charge` | 25 | A1 | — ❌ → accountant |
| `iss_exempt` | 50 | — | — ❌ → accountant |
| `iss_no_vat` (non-payer / IO) | — | — | — (IO supplying §9(1) services to EU businesses → SH, ✅) |

### 3.3 VAT point date (`vat_point_date`)
- **Output on issued documents:** `duzp`.
- **Payer deduction on received domestic documents:** `max(duzp, received_date)`, by month or quarter. The user may defer within the legal window (rule table: until the end of the 2nd calendar year).
- **Self-assessed foreign services (rows 5/6, 12/13):** per `profile.foreign_service_dppd_policy`. `service_period_end` (end of the stated service period) when available, else `issue_date`.
- **EU goods (rows 3/4):** the 15th of the month after dispatch, or the invoice date if earlier.
- FX conversion uses the ČNB rate valid on `vat_point_date`: the rate published that day, or the last rate published before it (rule table: `cnb_rate_rule`).

## 4. Money flows and payments

- **Money account** (`money_account_type`): `bank` \| `cash` \| `card` \| `platform` (Airbnb payouts, Booking, ComGate, GoPay, PayPal, Zásilkovna COD).
- **Transaction:** one movement on a money account (from a statement, an e-mail notice, a manual entry, or derived from a receipt paid by card or cash).
- **Payment link:** connects a transaction to a document with an amount (partial and multi-document allowed). `link_type`: `payment` \| `refund` \| `fee` \| `fx_difference` \| `platform_payout` \| `offset`. `match_method`: `vs_amount` \| `vs_only` \| `amount_date_counterparty` \| `card_merchant_fuzzy` \| `platform_statement` \| `manual` \| `document_evidence`.
- A **document's `paid_at`** is the date its links reach the full amount (± rounding). Income-tax entries (daňová evidence) are dated by payment, split pro rata across lines.
- **Unexplained transactions** (no link, not a transfer, not a tax payment) feed the *missing-documents radar*.

## 5. Ledgers (derived, never hand-edited)

1. **Document register:** all bookable documents with their classification. The source of the accountant package.
2. **Income-tax ledger (`tax_ledger_entries`):** cash-basis entries per line × payment link (signed, with `basis` = `payment` | `document_evidence` | `provisional`), with the category's `tax_effect`. Used for podklady (M06), dashboards and limit meters. Paušál users need only `taxable_income`.
3. **VAT ledger (`vat_ledger_entries`):** one entry per document × (`vat_treatment`, `vat_rate_type`) group (`line_id` null), with `vat_point_date`, period, base, tax, rate, ČNB FX used, DPHDP3 rows, KH section, SH code, counterparty VAT ID and `evidence_number` (supplier document number). Built for documents in `ready`/`finalized`; filings require every document of the period to be `finalized` (M05 §4.3). Filings are views over this ledger plus a snapshot at generation time.

Both ledgers are written only by M04's jobs (`ledger.rebuild_document`, `ledger.rebuild_transaction`, `ledger.rebuild_org`); the VAT routing functions they call are owned by M05 (`packages/domain/src/vat`).

## 6. Relationships between documents (`document_links.kind`, enum `doc_link_kind`)

`duplicate_of` · `corrects` (credit note → original) · `settles` (final invoice → proforma) · `supports` (statement or order confirmation → invoice) · `fulfills` (invoice → order confirmation) · `reported_in` (document → government filing, e.g. Booking invoice → filed DPHDP3) · `same_period_reconciles` (manager invoice ↔ settlement statement line).

## 7. Limits, meters, alerts and deadlines (all values in rule tables)

Rule keys are the full keys of 06 §2. Owner of every meter and of every obligation row: M09 (single writer of `obligations`).

| Meter or alert | Rule key | Who |
|---|---|---|
| VAT registration: **calendar-year** domestic turnover vs 2 000 000 Kč (payer from 1 Jan of the next year) and 2 536 500 Kč (payer from the day after exceeding). The calendar-year test applies since 1 Jan 2025 (`research/czech-tax-filings.md §3.1` [O]); a rolling 12-month figure is informational only (expert view, Later). Turnover policy: `vat.registration_turnover_policy` (M09 §4.4.1). | `vat.registration_thresholds` | `neplatce`, `identifikovana_osoba` |
| Identified-person trigger: first foreign service received, service supplied to an EU business, EU goods > 326 000 Kč/year | `vat.io_eu_goods_threshold` + `deadlines.generators` (`io_registration`, +15 days) | `neplatce` |
| Paušální daň band ceiling, and eligibility (≤ 2 000 000 Kč, other income ≤ 50 000 Kč, not a payer) | `pausalni_dan.bands` (with `ceilings`), `pausalni_dan.eligibility` | `pausalni_dan` |
| Flat-rate expense caps (1.6 M / 1.2 M / 0.8 M / 0.6 M Kč) | `pausalni_vydaje.rates_caps` | `pausalni_vydaje` |
| Cash payment limit (270 000 Kč/day/counterparty; €10 000 from 10 Jul 2027) | `cash.payment_limit` | all |
| Unreliable supplier / unpublished bank account before paying > 270 000 Kč (§109) | `vat.ruceni_cash_threshold` | `platce` |
| Deadlines:<br>• VAT return, KH, SH: the 25th<br>• paušální daň advance: the 20th<br>• social advance: end of month<br>• health advance: the 8th<br>• tourist-fee report: municipality rule, e.g. Praha 3 = 15 days after month end<br>• annual DAP dates<br>• shifted by `calendar.cz_public_holidays` | `deadlines.generators` | by profile |

## 8. "Simple" vs "needs accountant" (applies to all tax outputs)

A period is **simple** when every bookable document in it uses only treatments marked ✅ above, there are no credit notes against prior periods, all foreign amounts have an FX rate, and no blocking validation is open. Otherwise the app generates a **VAT workbook for the accountant** instead of a filing, and lists the reasons. Rule key: `vat.simple_period_policy` (data, so it can be widened later). The full check list is M05 §4.3.

## 9. Canonical text values (columns stored as `text`)

Modules may only use these values; adding one is an edit of this section.

### 9.1 `review_questions.kind`

| Kind | Owner |
|---|---|
| `which_class`, `confirm_split`, `possible_duplicate`, `confirm_direction`, `download_link_only`, `foreign_filing`, `encrypted_pdf` | M01 |
| `confirm_field` | M03 |
| `business_or_personal`, `which_category`, `small_asset_business_use`, `asset_over_threshold`, `car_regime`, `supply_kind`, `relearn_vendor` | M04 (M03 raises `business_or_personal` through M04) |
| `confirm_match`, `missing_document`, `overpayment`, `possible_duplicate_tx`, `refund_without_credit_note`, `card_payment_not_found`, `statement_format_needed` | M07 (Phase 2) |
| `confirm_profile` | M11 |

Answer chips for `business_or_personal` are always **Firemní / Soukromé / Napůl** with the question "Je to soukromé, nebo firemní?" (07 §2.3).

### 9.2 `obligations.kind`

`vat_return`, `kh`, `sh`, `vat_payment`, `vat_amendment`, `kh_nasledne` (definitions M05 §4.12) · `pausalni_dan_advance`, `pausalni_dan_entry`, `pausalni_dan_exit`, `dap` (M06 §4.12) · `social_advance`, `health_advance`, `tourist_fee_report`, `io_registration`, `vat_registration` (M09 §4.7). Only M09's generator writes `obligations`; M03, M05 and M06 supply generator definitions or evidence, never rows.

### 9.3 `notifications.kind`

snake_case, no dots. Cross-cutting kinds and the delivery policy: M09 §4.14 (`deadline_upcoming`, `deadline_today`, `deadline_overdue`, `io_trigger`, `vat_threshold`, `pausal_band`, `review_pending`, `filing_ready`, `filing_needs_accountant`, `filing_not_ready`, `filing_matches_filed`, `amendment_needed`, `package_ready`, `podklady_ready`, `podklady_changed`, `missing_documents`). Module-specific kinds: M01 §5.2 (`ingest_failed`, `ingest_infected`, `ingest_unsupported`, `email_rejected`, `email_quarantined`, `inbound_flood`, `expected_invoice_overdue`, `bank_notices_held`). Deadline reminders for VAT, paušální daň and DAP are `deadline_*` kinds, not module kinds.

### 9.4 Extracted fields of a `government_filing` (`document_fields.field_key`)

Written by M02's `filing` profile, read by M01 (linking), M05 (imported filed return) and M09 (obligation evidence): `filing.form_code` (`DPHDP3`, `DPHKH1`, `DPHSHV`, `DPFDP7`, `CSSZ_PREHLED`, `ZP_PREHLED`, `MUNICIPAL_TOURIST_FEE`, `OTHER`), `filing.period_start`, `filing.period_end`, `filing.kind`, `filing.filer_dic`, `filing.rows.{row}.base` / `.tax` (EPO forms; required from Phase 3), `filing.municipality`, `filing.bed_nights`, `filing.rate`, `filing.fee_total` (municipal reports).

### 9.5 Job and event names

Canonical list and naming rule: 03 §3.1.
