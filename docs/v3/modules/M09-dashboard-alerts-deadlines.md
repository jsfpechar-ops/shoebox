# M09: Dashboard (Přehled), alerts and deadlines

> Phase 1 (core widgets on document basis, limit meters, obligations generator, notifications). Widgets that depend on later modules light up behind flags: cash basis + basis toggle, missing documents and payables ageing (Phase 2, M07), accountant package status (Phase 1 export → Phase 2 package, M10), filing cards "ready / needs accountant" (Phase 3, M05), tax-reserve tile (Phase 4, computed by M06 §4.11). Later: VAT-meter projection, 12-month sparkline, rolling-12-month figure.
> Canonical names: `04-domain-model.md`, `05-data-model.md`. Law numbers: rule keys from `06-maintenance-playbook.md §2`. Screen layout and copy style: `M11-ux-and-screens.md §5.2`.

---

## 1. Purpose and scope

Přehled answers three questions in under five seconds: **"How am I doing?"** (income/expenses), **"Am I about to cross a line?"** (limit meters, identified-person status) and **"What do I have to do, by when?"** (review count, deadlines, filings, accountant package).

**In scope**
1. Read-only aggregation over ledgers and documents: income/expenses month + YTD. Phase 1 uses the document basis; the cash basis and its expert-view toggle arrive with bank data (Phase 2).
2. Limit meters: VAT registration (2 000 000 / 2 536 500 Kč), paušální daň band ceiling and eligibility, flat-rate expense cap.
3. Identified-person (IO) status card and IO trigger detection for non-payers.
4. Counters: "Ke kontrole" (to review), missing documents (Phase 2), payables ageing (Phase 2).
5. **Obligations generator** (`deadlines.generators` rule key): VAT/KH/SH, paušální daň advance, social and health advances, tourist-fee report, DAP, IO registration, VAT registration, paušál entry/exit; weekend/holiday shifting from a Czech public-holiday rule table; auto-completion from evidence (filed returns, municipal reports, filings, bank payments).
6. Filing cards and accountant-package card (display only; state owned by M05/M10).
7. Display of the rough, non-binding tax-reserve estimate computed by M06 §4.11 (Phase 4; M09 does not compute it).
8. Notification policy: in-app + one e-mail digest; urgent exceptions; dedupe; quiet hours.

**Out of scope**
- Computing ledgers (M04), VAT filings (M05), podklady (M06), matching (M07), packages (M10). M09 only reads them.
- Calendar sync (ICS feed), push notifications, SMS (Later).
- Any advice beyond the rule tables. Every number links to "Jak jsme to spočítali".

## 2. User stories

| # | Persona | Story |
|---|---|---|
| US-1 | P1 Petra (paušální daň) | I see my income this year against my band ceiling and get one warning before I cross it. |
| US-2 | P1 | When I buy Adobe from Ireland as a non-payer, I am told I have probably become an identified person, with a 15-day registration clock and a checklist. |
| US-3 | P2 Tomáš (daňová evidence) | I see income and expenses this month and YTD, and roughly how much to set aside for tax and insurance. |
| US-4 | P2 | I am reminded of my social (end of month) and health (8th) advances without being spammed. |
| US-5 | P3 Lucie (quarterly payer) | I see the 25th-day deadlines for DPH + KH (+ SH) for my quarter, and a card that says whether the quarter is "ready" or "needs accountant". |
| US-6 | P4 Josef (IO + rental) | I see each month's self-assessed VAT ("Září: k přiznání {částka} Kč, termín 26. 10."), the Praha 3 tourist-fee report deadline, and the obligation turns "done" when I upload my filed return or municipal report. |
| US-7 | P4 | Tourist fee and settlement statements never inflate my income; decoys never inflate my expenses. |
| US-8 | Accountant | I see the client's package status and open items, and the deadlines I am responsible for, read-only. |
| US-9 | All | I get at most one e-mail per working day (plus rare urgent ones), never at night. |

## 3. Inputs / outputs

**Reads:** `taxpayer_profiles` (effective-dated), `organizations.settings`, `documents`, `document_lines`, `categories`, `partners`, `tax_ledger_entries`, `vat_ledger_entries`, `review_questions`, `validation_results`, `transactions`, `payment_links`, `money_accounts`, `filings`, `filing_documents`, `accountant_packages`, `rules.at(date)`.
**Writes:** `obligations`, `notifications`, `audit_log` (obligation state changes by users).
**Emits events:** `obligation.created`, `obligation.state_changed`, `notification.created`.
**Consumes events:** `ledger.document_rebuilt` (M04 §6.5), `document.status_changed` (M01–M04), `profile.changed` (M11 Nastavení), `filing.state_changed` (M05), `package.state_changed` (M10), `transactions.imported` (M07).

## 4. Detailed behavior and algorithms

### 4.1 Common definitions (used by every number on Přehled)

All dates are legal dates (`date`), "today" is computed in `Europe/Prague` (ADR-007). All money uses `Money` (decimal.js); CZK display rounding happens only in the UI.

```
COUNTED_STATUSES   = {ready, finalized}
PENDING_STATUSES   = {received, splitting, classifying, extracting, validating, categorizing, needs_review}
BOOKABLE_CLASSES   = {received_invoice, received_receipt, received_credit_note, received_advance_tax_doc,
                      issued_invoice, issued_credit_note, platform_statement}            -- 04 §2.1 ✅
INCOME_EFFECTS     = {taxable_income}
EXPENSE_EFFECTS    = {deductible_expense, non_deductible_expense, asset}
IGNORED_EFFECTS    = {non_taxable_income, pass_through, transfer, tax_or_insurance_payment, private}
```

A **counted document** is: `deleted_at is null` AND `status ∈ COUNTED_STATUSES` AND `class ∈ BOOKABLE_CLASSES` AND `business_flag ≠ 'personal'`. Documents with `business_flag = 'unknown'` are not counted; they are "pending". Duplicates (`status = duplicate`) and decoys (`supporting` or non-bookable classes) are never counted. `documents.entry_mode` does not matter: manual (`manual`) and spreadsheet-imported (`imported`) documents are counted like captured ones. A document with `substitute_reason` set counts in income/expenses (income-tax evidence) but contributes no input VAT to any VAT estimate (M04 creates no deduction entries for it).

**Line amount:** M09 never re-implements amount logic. It calls a pure function
`lineTaxAmountCzk(line, document, profileAt): Money` that **exported by M04** from `packages/domain` (the amount kernel inside M04's `buildTaxLedgerEntries`, M04 §4.11 and §6.1): net vs gross by VAT status, FX via `documents.fx_rate`, sign for credit notes) and multiplies by `business_share_pct / 100`. Consequence (tested, AC-3): for a period in which every counted document is fully paid, cash-basis and document-basis totals are equal.

**Document date (document basis):** one date per document, all lines share it:
`doc_date = coalesce(duzp, issue_date, received_date)`; for `platform_statement`: `coalesce(service_period_to, issue_date, received_date)`.

### 4.2 Basis: cash vs document

| Basis | Source | Date | When it is the default |
|---|---|---|---|
| `cash` ("Podle plateb") | `tax_ledger_entries` | `entry_date` (as built by M04: payment date; M04 may use document date for paušál income views) | the org has ≥ 1 `money_accounts` row with ≥ 1 `transactions` row in the current year |
| `document` ("Podle dokladů") | `documents` ⨝ `document_lines` ⨝ `categories` | `doc_date` (§4.1) | otherwise (typical in Phase 1, before bank import) |

- **Phase 2.** The toggle is shown **only in expert view** (`memberships.prefs.ui.expert_view = true`, 05 §2) and only when the org has bank data. The chosen basis is stored in `memberships.prefs.ui.basis` (`'auto' | 'cash' | 'document'`, default `'auto'`).
- The widget always prints its basis in small text ("Podle dokladů · bez plateb z banky"), so a non-expert is never misled.
- Exception: the **VAT registration meter is always document-basis** (turnover is counted by supply date, not payment) and the **paušál meters follow the active basis**; both print it.

### 4.3 Income and expenses (month and YTD)

Inputs: `orgId`, `asOf` (default today), `basis`.
Periods: `month = [first day of asOf's month, asOf]`, `ytd = [1 Jan of asOf's year, asOf]`, `months12` = the 12 calendar months ending with asOf's month (sparkline, expert view only; **Later**).

```
for each period P:
  if basis = cash:
     rows = tax_ledger_entries where org_id = :org and entry_date ∈ P
     income   = Σ amount_czk × business_share_pct/100  where tax_effect ∈ INCOME_EFFECTS
     expenses = Σ amount_czk × business_share_pct/100  where tax_effect ∈ EXPENSE_EFFECTS
     deductible = same where tax_effect = deductible_expense
  else (document):
     docs = counted documents with doc_date ∈ P
     for each line l (line_type ≠ 'text') of docs, effect = categories[l.category_code].tax_effect:
        a = lineTaxAmountCzk(l, doc, profile.at(doc_date)) × l.business_share_pct/100
        income += a if effect ∈ INCOME_EFFECTS; expenses += a if effect ∈ EXPENSE_EFFECTS;
        deductible += a if effect = deductible_expense
     lines with category_code null → the document counts as pending, not counted
  result = income − deductible           (shown as "Výsledek" only for danova_evidence)
pending = { count, grossCzk } over non-deleted, bookable-class documents with status ∈ PENDING_STATUSES
          or business_flag = 'unknown', doc_date ∈ ytd (gross = total_gross × fx_rate, or total_gross if CZK; null amounts skipped)
```

Display rules: paušál users (`pausalni_vydaje`, `pausalni_dan`) see expenses with the note `dashboard.totals.expenses_note_pausal`. Assets (`asset`) are included in expenses but excluded from `deductible` with the note "majetek nad 80 000 Kč se odepisuje" (threshold `asset.capitalization_threshold`).

### 4.4 Limit meters

Shared levels (product config, not law; `packages/domain/config/meters.ts`): `warn_ratio = 0.80`, `alert_ratio = 0.95`; `level = exceeded` if `current > limit`. Meters are shown only to the profiles listed; each carries `ruleKey`, `basis` and an explanation key. **Rendering (owner rule, 07 §6):** every meter is a progress/bullet bar with zone marks at `warn_ratio` and `alert_ratio`, and **always prints the number and the threshold as text beside the bar** ("1 640 000 Kč z 2 000 000 Kč · 82 %"). Colour (`--warning`/`--destructive` tokens from 07) and the level icon are supplementary only; a meter at `ok` uses the neutral token. `LimitMeter` exposes `role="meter"` with `aria-valuenow/min/max` and `aria-valuetext` equal to the printed text.

**Projection (VAT meters only; Later):** if `0 < current < limit` and YTD days ≥ 30: `daily = current / days_elapsed_ytd`; `projected = asOf + ceil((limit − current) / daily)` days; shown only if `projected ≤ 31 Dec`: "Při současném tempu kolem 14. 11."

#### 4.4.1 VAT registration (`vat.registration_thresholds`) — profiles `neplatce`, `identifikovana_osoba`

Law (research `czech-tax-filings.md §3.1`): since 1 Jan 2025 turnover is measured **per calendar year**: above **2 000 000 Kč** → payer from 1 Jan of the next year; above **2 536 500 Kč** → payer from the day after exceeding, registration application within 10 working days. Only domestic turnover counts.

Two bars on one card: `calendar_year` (2 000 000) and `immediate` (2 536 500), both over the same `turnover_ytd`.

```
turnover_ytd = Σ net CZK of lines l on counted documents d where
   d.direction = 'out'  and  doc_date(d) ∈ [1 Jan, asOf]
   and categories[l.category_code].tax_effect = 'taxable_income'
   and isDomesticTurnoverLine(l, d, partner(d), rules.vat.registration_turnover_policy)
isDomesticTurnoverLine:
   1. if l.vat_treatment ∈ policy.exclude_treatments → false        -- default ['iss_eu_service','iss_eu_goods','iss_non_eu_service','iss_export_goods','iss_exempt'] [verify iss_exempt]
   2. if l.category_code ∈ policy.always_include_categories → true   -- default ['income_accommodation'] (real-estate-related, place of supply CZ) [verify]
   3. if partner.country ≠ 'CZ' and partner.vat_id is not null → false   -- foreign B2B service under §9(1) [verify for goods]
   4. → true
```
- Counted on **document basis always**, including `platform_statement` gross income lines (pass-through tourist-fee lines are excluded by tax_effect).
- **Rolling 12 months:** before 2025 the test was 12 consecutive months **[verify]**; it is no longer the legal test. Later, expert view may show an informational figure "Posledních 12 měsíců: X Kč" (`dashboard.meter.vat.rolling_info`); it never drives a level or an alert. 04 §7 was aligned to the calendar-year test on 2026-10-18.
- `isDomesticTurnoverLine` (and the `turnover_ytd` sum built on it) is the **only** turnover implementation; M03's `VAT_THRESHOLD_PROXIMITY` calls them (06 §6).
- On `exceeded` for `immediate`: create obligation `vat_registration` (event, §4.7) and an urgent notification. On `exceeded` for `calendar_year` only: obligation `vat_registration` with the explanation "od 1. 1. příštího roku" and a normal-priority notification.
- Payers (`platce`) never see this meter.

#### 4.4.2 Paušální daň band (`pausalni_dan.bands`, `pausalni_dan.eligibility`) — profile `pausalni_dan`

Band ceilings depend on the activity mix (research `czech-tax-filings.md §4.2`): band I ≤ 1 M (any), ≤ 1.5 M if ≥ 75 % of income is 60 %/80 % type, ≤ 2 M if ≥ 75 % is 80 % type; band II ≤ 1.5 M any, ≤ 2 M if ≥ 75 % is 60 %/80 % type; band III ≤ 2 M. This is data:

```ts
// rule value shape of pausalni_dan.bands[].ceilings (06 §2.1; shared with M06 §4.4)
ceilings: Array<{ max_income: number; requires_dominant_rate_in?: (80|60|40|30)[] }>
// band 1: [{1_000_000}, {1_500_000, [80,60]}, {2_000_000, [80]}]
// band 2: [{1_500_000}, {2_000_000, [80,60]}]   band 3: [{2_000_000}]
```
`ceiling = max(c.max_income for c in band.ceilings if c.requires_dominant_rate_in is absent or contains profile.pausal_rate)` (for `pausalni_dan`, `pausal_rate` is the declared dominant activity class, 04 §1). If `pausal_rate` is null, use the unconditional ceiling and show the hint "Upřesněte typ činnosti v Nastavení" (75 % share is the user's declaration; we do not compute shares).

- `current` = YTD income on the active basis (§4.3). Level warn also when `ceiling − current ≤ meters.pausal_band_warn_czk` (config, 100 000 Kč, borrowed from Competitor C's warning, internal research (not published)).
- Second bar: eligibility `pausalni_dan.eligibility.max_income` (2 000 000). Other-income limit (50 000 Kč) is shown as text only; we do not track other income.
- Copy for `exceeded` stays neutral and sends the user to the accountant: consequences of exceeding a band mid-year are advisor question TA-12.

#### 4.4.3 Flat-rate expense cap (`pausalni_vydaje.rates_caps`) — profile `pausalni_vydaje`

`income_at_cap = caps[pausal_rate] / (pausal_rate / 100)` (2026: 1 600 000 / 0.8 = 2 000 000 for every rate). Bar: YTD income vs `income_at_cap`. Copy: "Nad {income_at_cap} Kč příjmů už se vaše paušální výdaje nezvyšují." A secondary activity rate (04 §1) is not metered in V3.

### 4.5 Identified-person status card

```
detectIoTriggers(orgId, asOf) → IoTrigger[]   (runs only over date ranges where profile.vat_status = 'neplatce')
  T1 foreign service received: first counted (or needs_review with classification_confidence ≥ 0.9) line with
     vat_treatment ∈ {rcv_eu_service_reverse_charge, rcv_non_eu_service_reverse_charge}
     date = coalesce(d.vat_point_date, d.issue_date, d.received_date)
  T2 service supplied to an EU business: counted 'out' line, vat_treatment ∈ {iss_no_vat, iss_eu_service},
     partner.country ∈ EU (≠ CZ), partner.vat_id not null; date = coalesce(duzp, issue_date)
  T3 EU goods acquisitions: running Σ net CZK of rcv_eu_goods_acquisition lines in the calendar year
     > vat.io_eu_goods_threshold (326 000); date = doc_date of the crossing document
  Tie-break: earliest date; equal dates → T1 < T2 < T3; equal again → lowest document id.
```
Source: `czech-tax-filings.md §3.2` (registration within 15 days; DPHDP3 only for months with liability; no KH, no deduction). The threshold lives in `vat.io_eu_goods_threshold`; the registration deadline in the `io_registration` entry of `deadlines.generators`. M09 is the only writer of the `io_registration` obligation and of the `io_trigger` notification (M03's rule only annotates the document).

Card variants:
| Profile | State | Content |
|---|---|---|
| `neplatce` | no trigger | hidden |
| `neplatce` | trigger found | "Pravděpodobně jste se stali identifikovanou osobou" + checklist: (1) přihláška k registraci do `{due}` (obligation `io_registration`), (2) přiznání DPH za `{month}` do 25. dne, (3) zaplatit `{estimate}`. Buttons: "Už jsem registrovaný/á" (opens profile change at `{trigger date}`, M11 §5.4), "Proč?" (lists the triggering documents). |
| `identifikovana_osoba` | any | "Jste identifikovaná osoba k DPH". For the last closed month and the current month: `{period}: K přiznání {vat} Kč, termín {due}` or "Za září nic nepřiznáváte". Link to the filing card (§4.9). |

`vat` for a period = Σ `vat_ledger_entries.vat_czk` for entries whose `dphdp3_rows` contain an **output row** (entries of `epo.dphdp3_row_map` with `side='output'`, 06 §2.1); estimate only, M05 rounds and files.

### 4.6 "Ke kontrole" count

```
Q = review_questions where answered_at is null and (document_id is null or document not deleted)
D = documents where status = 'needs_review' and deleted_at is null and no row of Q references it
review.count   = |Q| + |D|
review.oldestAt = min(created_at over Q ∪ D)
```
Blocking validations are not counted separately: M03 always pairs a blocking result with `needs_review`, so it is in D or has a question in Q. The widget links to the Inbox "Ke kontrole" tab (M11 §5.1).

### 4.7 Obligations generator (`deadlines.generators`)

**Rule value shape** (in `packages/domain/rules/cz/<year>.ts`, zod-validated):

```ts
type ObligationKind = 'vat_return'|'kh'|'sh'|'pausalni_dan_advance'|'social_advance'|'health_advance'
  |'tourist_fee_report'|'dap'|'io_registration'|'vat_registration'|'pausalni_dan_entry'|'pausalni_dan_exit';
type DueRule =
  | { type: 'day_of_month_after_period'; day: number }          // 25th after the period
  | { type: 'day_of_month_in_period'; day: number | 'last' }    // social: last day of the same month
  | { type: 'days_after_period_end'; days: number | { ruleRef: string } }   // tourist fee
  | { type: 'fixed_date'; month: number; day: number; yearOffset: 0 | 1 }   // DAP, paušál 10 Jan
  | { type: 'days_after_event'; days: number; unit: 'calendar' | 'working' }; // IO 15 cal., VAT reg 10 working
type ShiftPolicy = 'next_working_day' | 'previous_working_day' | 'none';
interface DeadlineGenerator {
  kind: ObligationKind;
  appliesIf: { vatStatus?: VatStatus[]; vatPeriod?: VatPeriod[]; taxRegime?: TaxRegime[];
               requires?: Array<'vat_output_in_period'|'eu_supplies_in_period'|'tourist_fee_municipality'
                               |'insurance_self_paid'|'io_trigger'|'vat_threshold_exceeded'|'pausal_entry_eligible'> };
  period: 'month' | 'vat_period' | 'year' | 'event';
  due: DueRule; shift: ShiftPolicy; optional?: boolean;
  amount: 'none'|'vat_estimate'|'pausalni_dan_band_monthly'|'user_insurance_advance'|'tourist_fee_estimate';
  source: string; verifiedAt: string;
}
```

**V3 generator table** (initial data; each row cites research):

| kind | applies if | period | due | shift | amount | source |
|---|---|---|---|---|---|---|
| `vat_return` | `platce` (always) · `identifikovana_osoba` + `vat_output_in_period` | `vat_period` (IO: month) | 25th after period | next_working_day | vat_estimate | tax-filings §3.1, §3.2 |
| `kh` | `platce` | `vat_period` (FO: same as the return) | 25th after period | next_working_day | none | §3.1, §1.3 |
| `sh` | `platce`/`identifikovana_osoba` + `eu_supplies_in_period` | month | 25th after period | next_working_day | none | §3.1 |
| `pausalni_dan_advance` | `pausalni_dan` | month | `pausalni_dan.deadlines.advance_day` (20) of the same month | next_working_day **[verify]** | pausalni_dan_band_monthly | §3.3 |
| `social_advance` | `danova_evidence`/`pausalni_vydaje` + `insurance_self_paid` | month | last day of the same month | previous_working_day (conservative) | user_insurance_advance | §3.3 |
| `health_advance` | same | month | 8th of the next month | previous_working_day (conservative) | user_insurance_advance | §3.3 |
| `tourist_fee_report` | `tourist_fee_municipality` set | month | `municipal.tourist_fee.<m>.report_deadline_days_after_month` (Praha 3: 15) | next_working_day **[verify]** | tourist_fee_estimate | 06 §2 |
| `dap` | `danova_evidence`/`pausalni_vydaje` (not `pausalni_dan`) | year | electronic: 1 May of next year (`dap_via_advisor`: 1 Jul) | next_working_day | none | §3.3 |
| `io_registration` | `neplatce` + `io_trigger` | event (trigger date) | +15 calendar days | next_working_day | none | §3.2 |
| `vat_registration` | `neplatce`/`identifikovana_osoba` + `vat_threshold_exceeded` | event (crossing date) | +10 working days **[verify for the 2 M case]** | none (already working days) | none | §3.1 |
| `pausalni_dan_entry` | `danova_evidence`/`pausalni_vydaje`, not `platce`, + `pausal_entry_eligible` (prior-year income ≤ `pausalni_dan.eligibility.max_income`) | year Y = the tax year being entered | `pausalni_dan.deadlines.entry` (10 Jan) of Y (`yearOffset 0`) | next_working_day | none · **optional** | §3.3 |
| `pausalni_dan_exit` | `pausalni_dan` | year Y = the first tax year outside the regime | `pausalni_dan.deadlines.exit` (10 Jan) of Y | next_working_day | none · **optional** | §3.3 |

Notes: the generator entries `vat_payment`, `vat_amendment`, `kh_nasledne` come from M05 §4.12 (`vatObligationsFor`), and `dap`, `pausalni_dan_*` are defined together with M06 §4.12; M09 runs all of them and is the only writer of `obligations`. DAP is electronic by default because OSVČ file electronically **[verify]**; the paper deadline (1 Apr) is shown as info only. Insurance due dates use `previous_working_day` because whether payment deadlines move is unverified; we never show a date later than the legal one (TA-15). `requires: insurance_self_paid` is `organizations.settings.insurance_reminders !== false` (default true).

**Working-day calendar** (`calendar.cz_public_holidays`, new rule key; source: zákon 245/2000 Sb. **[verify]**):
```ts
{ fixed: ['01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26'],
  movable: { 2026: ['04-03','04-06'], 2027: ['03-26','03-29'], 2028: ['04-14','04-17'],
             2029: ['03-30','04-02'], 2030: ['04-19','04-22'] } }    // Good Friday, Easter Monday
```
`isWorkingDay(d) = weekday(d) ∉ {Sat, Sun} ∧ d ∉ holidays(d.year)`. If `movable[year]` is missing → throw `RuleMissingError('calendar.cz_public_holidays', year)`; the generator logs, alerts the maintainer (rule-freshness monitor, 06 §3) and falls back to weekend-only shifting with `obligations.source_rule` suffixed `#holidays-missing`.

```
shift(date, policy):
  next_working_day:     while !isWorkingDay(date): date += 1
  previous_working_day: while !isWorkingDay(date): date −= 1
  none:                 date
addWorkingDays(date, n): repeat n times: date += 1; while !isWorkingDay(date): date += 1
```

**Generation algorithm** (`generateObligations(orgId, asOf)`; pure core + DB upsert):

```
horizon = [asOf − obligations.lookback_days (100), asOf + obligations.horizon_days (90)]   -- config
segments = taxpayer_profiles of org overlapping horizon (effective-dated)
for gen in rules.at(asOf).deadlines.generators:           -- rules resolved per period: rules.at(period_end)
  for period in enumeratePeriods(gen.period, horizon, segments, events):
     -- a period is in scope if its legal due date ∈ horizon
     profileHit = ∃ segment s overlapping period with s matching gen.appliesIf (any day of the period counts)
     if !profileHit or !requiresSatisfied(gen.requires, period): candidate.state = not_applicable_if_exists; continue
     legal_due = computeDue(gen.due, period, rules.at(period.end))
     due       = shift(legal_due, gen.shift)
     upsert obligations (org_id, kind, period_start) values (…, legal_due_date, due_date, amount_estimate,
                         source_rule = 'deadlines.generators/' || kind || '@' || rule_version, is_optional)
       on conflict: update due_date, legal_due_date, amount_estimate, source_rule, generator_version
                    only where state ∈ (open, overdue)            -- never touch done / not_applicable set by a user
existing open/overdue rows inside the horizon that were not produced this run → state = not_applicable
open rows with due_date < asOf → state = overdue
```

- `enumeratePeriods`: `month` → calendar months; `vat_period` → months or quarters from `profile.vat_period` (IO always monthly); `year` → tax year Y with `period_start = Y-01-01`; `event` → one period per detected event with `period_start = period_end = event date` (IO trigger from §4.5; VAT threshold crossing date from §4.4.1 = `doc_date` of the document that pushed `turnover_ytd` over the limit).
- `requiresSatisfied`: `vat_output_in_period` ⇔ ∃ `vat_ledger_entries` with `period_start` = period start and an output row; `eu_supplies_in_period` ⇔ ∃ counted 'out' line in the period with `vat_treatment ∈ {iss_eu_service, iss_eu_goods}` or (`iss_no_vat` ∧ partner EU ∧ `vat_id`); `tourist_fee_municipality` ⇔ `organizations.settings.tourist_fee_municipality` is a key of `municipal.tourist_fee`.
- **Amounts:** `vat_estimate` = Σ output-row VAT − Σ input-row VAT over `vat_ledger_entries` of the period (rows by `side` in `epo.dphdp3_row_map`; IO has no input rows); `pausalni_dan_band_monthly` = `pausalni_dan.bands[band].monthly`; `user_insurance_advance` = `organizations.settings.insurance_advances.{social|health}` or null (UI then shows "minimum {insurance.min_advances.x} Kč"); `tourist_fee_estimate` = Σ CZK of `pt_tourist_fee` lines on counted documents with `doc_date` in the month, or null.
- **Idempotency:** the job is a pure recompute; running it twice yields identical rows (AC-12).
- **Triggers:** nightly fan-out, and debounced (60 s, pg-boss `singletonKey = org`) on `ledger.document_rebuilt`, `profile.changed`, `document.status_changed` to a counted state or to `government_filing`, `filing.state_changed`, `transactions.imported`.

**Auto-completion (evidence)** — run at the end of every generation, in this order; first match wins; sets `state = done`, `done_at = now()`, `done_source`, `evidence_document_id`:

| Evidence | Obligations closed | done_source |
|---|---|---|
| `filings` row with `state = marked_filed` for the same type and period (DPHDP3 → `vat_return`, DPHKH1 → `kh`, DPHSHV → `sh`) | that period | `filing` |
| `government_filing` document whose extracted fields (M01 classification `form_code` / M03 `filing.type`, and the filing period) identify DPHDP3/DPHKH1/DPHSHV for the period | that period | `evidence_document` |
| `government_filing` document identified as a municipal tourist-fee report for municipality m and month | `tourist_fee_report` of that month | `evidence_document` |
| `transactions` (Phase 2) with `category_code` `tax_pausal_advance` / `ins_social_own` / `ins_health_own` (or matched tax payment link) | the **earliest** open/overdue obligation of the corresponding kind with `due_date ≥ booked_on − 40 days`; one transaction closes at most one obligation | `bank_payment` |
| profile change to `identifikovana_osoba` with `valid_from ≤ trigger date + 30 days` | `io_registration` | `profile_change` |
| user taps "Hotovo" | any | `user` (undo allowed for 7 days; audited) |

### 4.8 Deadlines calendar widget

`deadlines = obligations where state ∈ (open, overdue) and (state = overdue or due_date ≤ asOf + dashboard.deadlines_window_days (60))`.
Sort: `state = overdue` first; then `due_date` asc; then kind priority `vat_return < kh < sh < io_registration < vat_registration < pausalni_dan_advance < social_advance < health_advance < tourist_fee_report < dap < pausalni_dan_entry < pausalni_dan_exit`; then `period_start` asc. Default view shows the first 3 + "Všechny termíny (n)". Expert view adds a month grid. Optional obligations render as "Možnost" without a red state and never become `overdue` (they become `not_applicable` the day after their due date).

Relative labels: `dnes`, `zítra`, `za {n} dní` (n ≤ 14), else the date `25. 9.` (year printed only if ≠ current year). If `due_date ≠ legal_due_date`, the "Proč?" popover says "25. 10. je neděle, termín se posouvá na pondělí 26. 10."

### 4.9 Filing cards (display of M05 state; Phase 3 flag `vat_filings`)

One card per `vat_return` obligation in the deadlines window plus the last closed period. State derivation (first match):

| Card state | Condition | Copy key |
|---|---|---|
| `filed` | obligation `done` | `filing.card.filed` "Podáno" (collapsed) |
| `amendment_needed` | a filing for the period is `generated`/`downloaded`/`marked_filed` and some `filing_documents.document_revision` < current `documents.revision` | `filing.card.amendment_needed` |
| `ready` | latest filing of type DPHDP3 for the period has `state ∈ (generated, downloaded)` and `xsd_valid = true` | `filing.card.ready` "Přiznání DPH za {month} je připraveno" |
| `needs_accountant` | latest filing is `VAT_WORKBOOK` (period not simple, `simple_check.reasons`) | `filing.card.needs_accountant` "{month} potřebuje účetní: {reasons}" |
| `blocked` | period ended and review items exist for documents in the period | `filing.card.blocked` "Vyřiďte {count} věci, pak přiznání připravíme" |
| `collecting` | period not ended | `filing.card.collecting` "{month} se ještě sbírá · zatím {estimate} Kč" |

Before the flag is on (Phases 1–2), only `collecting`, `blocked` and `filed` exist, with the estimate from §4.7. Every card shows the disclaimer key `filing.card.disclaimer` (L-02).

### 4.10 Accountant package card (M10 state)

Shown if `has_accountant = true` or any `accountant_packages` row exists. Latest package by `period_end`: state `draft|ready|sent|acknowledged`, `completeness.score` (0–100), `completeness.missing` count. Phase 1 (no packages yet): "Export za {month}" button calling M10's Phase-1 ZIP + register export.

### 4.11 Missing documents and payables ageing (Phase 2, flag `bank`)

- **Missing documents:** count and Σ |amount| of M07's `listMissingDocuments(orgId, {year})` (definition owned by M07: outgoing `transactions` with `match_state ∈ (unmatched, partial)`, not a transfer/tax/insurance category, `booked_on ≤ asOf − radar.grace_days`). Hidden when the org has no transactions.
- **Unpaid received invoices by age** (borrowed from Competitor D/Competitor E, internal research (not published), internal research (not published)): counted 'in' documents with `due_date` not null, `paid_at` null, `is_paid_per_document` not true; buckets by `asOf − due_date`: `not_due` (< 0), `1–30`, `31–60`, `61–90`, `90+`. Shown only with bank data (otherwise everything would look unpaid). Expert view only in V3.

### 4.12 Tax reserve estimate (non-binding) — Phase 4, computed by M06

Moved out of Phase 1 in the 2026-10-18 review (one implementation per concept, 06 §6): the estimate is M06's `computeTaxReserve` (M06 §4.11, rule keys `income_tax.rates`, `income_tax.credits`, `insurance.rates`). M09 renders it as the "Kolik si odložit" tile: "Kdyby rok skončil dnes", rounded to whole hundreds, prefixed "zhruba", hidden for `ucetnictvi`; `pausalni_dan` shows advances paid vs due instead. If any `income_accommodation` line exists YTD, add caveat `dashboard.reserve.caveat_s9` (D-06).

### 4.13 Alerts strip and ordering

Top of Přehled, max 3 items, highest priority first: (1) overdue obligations, (2) IO trigger, (3) VAT threshold `exceeded`, (4) `amendment_needed`, (5) registry outage banner (M03), (6) VAT/paušál meter `alert`. Each is dismissable per user for 7 days except (1)–(3).

Widget order below the strip (empty widgets are hidden): Ke kontrole → Příjmy a výdaje → Limity → Termíny → Přiznání → Pro účetní → Chybějící doklady (Phase 2) → Kolik si odložit (Phase 4).

### 4.14 Notification policy

**Channels:** `in_app` (bell + Přehled strip) and `email` (one **digest** per working day; rare **urgent** e-mails). No push, no SMS in V3.

| Kind (`notifications.kind`) | Created when | In-app | E-mail | Dedupe key |
|---|---|---|---|---|
| `deadline_upcoming` | open obligation, T−7 and T−2 working days | yes | digest | `deadline:{obligation_id}:{T-7|T-2}` |
| `deadline_today` | open obligation due today (non-optional) | yes | **urgent** at 07:30 | `deadline:{id}:T0` |
| `deadline_overdue` | state → overdue | yes | digest (once) | `deadline:{id}:overdue` |
| `io_trigger` | first IO trigger | yes | **urgent** | `io_trigger:{trigger_date}` |
| `vat_threshold` | meter level changes to warn / alert / exceeded | yes | warn: none; alert: digest; exceeded: **urgent** | `vat_threshold:{year}:{meter}:{level}` |
| `pausal_band` | level → warn / exceeded | yes | digest | `pausal_band:{year}:{level}` |
| `review_pending` | ≥ 1 item older than `notify.review_age_days` (3) | badge only | digest, at most once per 7 days | `review:{iso_week}` |
| `filing_ready` / `filing_needs_accountant` | M05 event | yes | digest | `filing:{filing_id}:{state}` |
| `amendment_needed` | §4.9 | yes | digest | `amend:{filing_id}:{revision_hash}` |
| `filing_not_ready` / `filing_matches_filed` | M05 event | yes | digest | `filing:{filing_id}:{state}` |
| `package_ready` | M10 event | yes | digest | `package:{id}:{state}` |
| `podklady_ready` / `podklady_changed` | M06 event | yes | digest | `podklady:{filing_id}:{state}` |
| `missing_documents` | weekly if count > 0 | badge only | digest Mondays | `missing:{iso_week}` |

Rules:
1. **Dedupe:** unique `(org_id, user_id, dedupe_key)`; a re-run never re-notifies.
2. **Recipients:** `owner` and `member`; `accountant` only for `filing_*`, `package_*`, `amendment_needed` and only if they opted in; `viewer` none.
3. **Digest:** job at 07:30 Europe/Prague on working days (`isWorkingDay`). Content: up to 5 lines sorted like §4.8, then "a {n} dalších". Nothing to say → no e-mail. Subject: "Shoebox: 2 termíny tento týden, 3 věci ke kontrole".
4. **Urgent:** max 1 urgent e-mail per user per day (later urgent items of the same day merge into the next digest). Not sent during quiet hours.
5. **Quiet hours:** default 20:00–07:30 Europe/Prague and weekends/holidays for e-mail; editable in Nastavení (M11 §5.4). In-app is always silent (no sound/badge animation).
6. **Privacy:** e-mails contain counts, deadlines, amounts estimates and links; never supplier names, document contents or attachments.
7. **Unsubscribe:** every e-mail has one-click `List-Unsubscribe` per category; urgent legal deadlines can be turned off but the toggle warns once.
8. Outbound e-mail transport is Amazon SES in an EU region (ADR-004b, decision D-07), behind M12's `OutboundMailer`.

## 5. Data

### 5.1 Read
See §3. Main queries (all scoped by `org_id`, all on existing indexes): `tax_ledger_entries (org_id, tax_year, tax_effect)`, `documents (org_id, status)`, `documents (org_id, issue_date)`, `vat_ledger_entries (org_id, period_start)`.

### 5.2 Write
`obligations` (generator, user done/undo), `notifications`, `audit_log` (`entity='obligation'`, `action ∈ {done, undo}`).

### 5.3 Schema
Merged into 05 on 2026-10-18; see 05 §8 `obligations` (legal_due_date, is_optional, done_at, done_source, evidence_document_id, generator_version, `unique nulls not distinct`) and `notifications` (dedupe_key, priority, scheduled_for, digest_sent_at), 05 §2 `memberships.prefs` (zod `MembershipPrefs`: `ui.expert_view`, `ui.basis`, `ui.locale`, `ui.dismissed`, `notify.*`). The proposed `taxpayer_profiles.dominant_activity_rate` was dropped: `pausal_rate` carries the declared activity class for paušální daň (04 §1). Obligation kinds: 04 §9.2. `organizations.settings` keys (no DDL): `tourist_fee_municipality`, `dap_via_advisor`, `insurance_reminders`, `insurance_advances`.

**Rule keys:** merged into 06 §2.1 (`calendar.cz_public_holidays`, `vat.registration_turnover_policy`, `pausalni_dan.bands[].ceilings`); `epo.dphdp3_row_sides` became the `side` field of `epo.dphdp3_row_map`; the reserve keys are M06's (`income_tax.rates`, `income_tax.credits`, `insurance.rates`). Product config (not law): `meters.warn_ratio` 0.80, `meters.alert_ratio` 0.95, `meters.pausal_band_warn_czk`, `obligations.horizon_days`, `obligations.lookback_days`, `dashboard.deadlines_window_days`, `notify.review_age_days`, `radar.grace_days`.

## 6. Interfaces

```ts
// packages/domain/src/calendar.ts (pure)
export function isWorkingDay(d: LegalDate, rules: RuleSet): boolean;
export function shiftDate(d: LegalDate, policy: ShiftPolicy, rules: RuleSet): LegalDate;
export function addWorkingDays(d: LegalDate, n: number, rules: RuleSet): LegalDate;

// packages/domain/src/obligations.ts (pure)
export interface ObligationCandidate { kind: ObligationKind; periodStart: LegalDate; periodEnd: LegalDate;
  legalDueDate: LegalDate; dueDate: LegalDate; amountEstimate: Money | null; sourceRule: string; isOptional: boolean; }
export interface ObligationFacts { profiles: TaxpayerProfileSegment[]; settings: OrgSettings;
  vatOutputPeriods: Set<string>; euSupplyPeriods: Set<string>; ioTriggers: IoTrigger[];
  vatThresholdEvents: Array<{ meter: 'calendar_year'|'immediate'; date: LegalDate }>;
  vatEstimates: Map<string, Money>; touristFeeEstimates: Map<string, Money>; priorYearIncome: Money | null; }
export function generateObligationCandidates(facts: ObligationFacts, asOf: LegalDate, rules: RulesResolver): ObligationCandidate[];
export function resolveEvidence(open: ObligationRow[], evidence: EvidenceFacts): Array<{ id: string; doneSource: DoneSource; evidenceDocumentId?: string }>;

// packages/domain/src/dashboard.ts (pure)
export type Basis = 'cash' | 'document';
export function lineCounts(doc: DocumentForTotals): boolean;                 // §4.1
export function computeTotals(input: TotalsInput, basis: Basis, period: DateRange): PeriodTotals;
export function computeMeters(profile: TaxpayerProfileAt, totals: { ytdIncome: Money; turnoverYtd: Money; rolling12?: Money },
                              asOf: LegalDate, rules: RuleSet): LimitMeter[];
export function detectIoTriggers(lines: IoCandidateLine[], segments: TaxpayerProfileSegment[], rules: RulesResolver): IoTrigger[];
// tax reserve: M06 computeTaxReserve (Phase 4); M09 only renders it

export interface LimitMeter { key: 'vat_registration_calendar'|'vat_registration_immediate'|'pausalni_dan_band'
    |'pausalni_dan_eligibility'|'pausalni_vydaje_cap'; current: Money; limit: Money; ratio: number;
  level: 'ok'|'warn'|'alert'|'exceeded'; basis: Basis; ruleKey: string; projectedCrossing: LegalDate | null; }
export interface DashboardData { asOf: LegalDate; basis: Basis; basisReason: 'bank_data'|'no_bank_data'|'user_choice';
  totals: { month: PeriodTotals; ytd: PeriodTotals; pending: { count: number; grossCzk: Money }; months12?: MonthPoint[] };
  meters: LimitMeter[]; ioCard: IoCard | null; review: { count: number; oldestAt: string | null };
  deadlines: ObligationView[]; filingCards: FilingCard[]; packageCard: PackageCard | null;
  missingDocuments: { count: number; totalCzk: Money } | null; payablesAgeing: AgeingBuckets | null;
  taxReserve: TaxReserveEstimate | null; alerts: AlertItem[]; }

// packages/db (I/O)
export async function getDashboard(orgId: string, opts: { asOf?: LegalDate; basis?: Basis | 'auto'; userId: string }): Promise<DashboardData>;
export async function markObligationDone(orgId: string, obligationId: string, userId: string): Promise<void>;
export async function undoObligationDone(orgId: string, obligationId: string, userId: string): Promise<void>; // ≤ 7 days, done_source='user' only
```

**Jobs (pg-boss; payloads zod, ids only):**
```ts
const GenerateObligations = z.object({ orgId: z.string().uuid(), reason: z.enum(['nightly','ledger_rebuilt','profile_changed',
  'document_evidence','filing_changed','transactions_imported']), asOf: z.string().date().optional() });
// 'obligations.generate'           singletonKey = orgId, singletonSeconds = 60, retryLimit 5, backoff
// 'obligations.nightly'            cron '15 2 * * *' tz Europe/Prague → enqueue generate for each org with activity in 400 days
const EvaluateNotifications = z.object({ orgId: z.string().uuid() });   // 'notifications.evaluate' after each generate
const SendDigest = z.object({ userId: z.string().uuid(), orgId: z.string().uuid(), day: z.string().date() });
// 'notifications.digest'           cron '30 7 * * 1-5' tz Europe/Prague → fan-out; skips non-working days
const SendUrgent = z.object({ notificationId: z.string().uuid() });  // 'notifications.urgent'; startAfter = end of quiet hours
```

**API routes** (`/api/v1`, session or PAT; RLS applies): `GET /dashboard?basis=auto|cash|document&asOf=` → `DashboardData`; `GET /obligations?from&to&state` ; `POST /obligations/{id}/done`; `POST /obligations/{id}/undo`; `GET /notifications?unread=1`; `POST /notifications/read {ids}`.

**Caching:** Přehled is a server component; `getDashboard` runs ≤ 8 indexed aggregate queries in one transaction (target p95 < 250 ms for 5 000 documents/org). No materialized snapshot in V3; add one only if p95 > 300 ms in staging.

## 7. UX touchpoints (Czech copy; layout in M11 §5.2)

| i18n key | Czech copy |
|---|---|
| `dashboard.totals.title` | Příjmy a výdaje |
| `dashboard.totals.month` / `.ytd` | Tento měsíc / Od začátku roku |
| `dashboard.totals.basis_document` | Podle dokladů · platby z banky zatím nemáme |
| `dashboard.totals.basis_cash` | Podle plateb |
| `dashboard.totals.pending` | {count, plural, one {# doklad} few {# doklady} other {# dokladů}} za {amount} ještě čeká na kontrolu |
| `dashboard.totals.expenses_note_pausal` | Jen pro přehled — při paušálu se výdaje nedokládají. |
| `dashboard.meter.vat.title` | Limit pro plátce DPH |
| `dashboard.meter.vat.calendar` | {current} z 2 000 000 Kč — nad tímto limitem budete plátcem od 1. 1. příštího roku. |
| `dashboard.meter.vat.immediate` | {current} z 2 536 500 Kč — nad tímto limitem jste plátcem hned od dalšího dne. |
| `dashboard.meter.vat.projection` | Při současném tempu kolem {date}. |
| `dashboard.meter.vat.rolling_info` | Posledních 12 měsíců: {amount}. Jen pro informaci — od roku 2025 se limit počítá za kalendářní rok. |
| `dashboard.meter.pausal_band` | Příjmy letos {current} z {ceiling} Kč pro {band}. pásmo paušální daně |
| `dashboard.meter.pausal_cap` | Nad {limit} Kč příjmů už se vaše paušální výdaje nezvyšují. |
| `dashboard.io.trigger_title` | Pravděpodobně jste se stali identifikovanou osobou k DPH |
| `dashboard.io.trigger_body` | Doklad od {supplier} ({country}) je služba ze zahraničí. Do {due} je potřeba podat přihlášku k registraci. |
| `dashboard.io.status` | {period}: k přiznání {vat} Kč, termín {due} |
| `dashboard.review.title` | {count, plural, one {# věc} few {# věci} other {# věcí}} ke kontrole |
| `deadlines.kind.vat_return` | Přiznání k DPH za {period} |
| `deadlines.kind.tourist_fee_report` | Hlášení poplatku z pobytu ({municipality}) za {period} |
| `deadlines.shift_why` | {legalDate} je {weekdayOrHoliday}, termín se posouvá na {dueDate}. |
| `deadlines.done` / `.undo` | Hotovo / Vrátit |
| `filing.card.ready` | Přiznání DPH za {month} je připraveno |
| `filing.card.needs_accountant` | {month}: tohle raději předejte účetní — {reasons} |
| `filing.card.disclaimer` | Připravili jsme podklady. Za podání odpovídáte vy nebo vaše účetní. |
| `dashboard.reserve.title` | Kolik si odložit |
| `dashboard.reserve.body` | Kdyby rok skončil dnes: zhruba {total} Kč na daň a pojištění. Orientační odhad. |
| `notify.digest.subject` | Shoebox: {deadlines} termíny, {review} ke kontrole |

## 8. Edge cases and failure modes

1. **Profile changes mid-period** (P4 becomes IO on 3 Aug): generator checks overlap per day; meters use the segment valid at `asOf`; IO trigger detection only scans `neplatce` segments.
2. **Late upload after a deadline** (Booking July invoice uploaded in October): obligation created as `overdue` immediately; urgent notification suppressed if the due date is > 30 days in the past (digest only) to avoid alarm; card suggests "Poraďte se s účetní o dodatečném přiznání".
3. **Rule missing for a future year** (`rules.at` has no 2028 data): use the latest known values, mark meters `ruleKey#stale`, notify maintainer; never crash Přehled.
4. **Holiday table missing a year:** weekend-only shift + maintainer alert (§4.7).
5. **FX missing** on a foreign document: M04 cannot compute the amount → document counted as pending; VAT estimate omits it and shows "1 doklad bez kurzu".
6. **Credit notes**: negative amounts via `lineTaxAmountCzk`; meters may decrease; levels can go down silently (no "back to ok" notification).
7. **Duplicate government filings** (same DPHDP3 uploaded twice): M01 dedupes; evidence uses the first by `created_at`.
8. **User marks done, then evidence arrives**: keep `done_source='user'`, attach `evidence_document_id` if null.
9. **Profile no longer applies** (user switches from IO to neplatce retroactively): open obligations → `not_applicable`; done ones kept.
10. **No data at all:** Přehled shows the onboarding checklist (M11 §6), not zeros.
11. **Ledger rebuild in progress** (`build_version` mismatch): read the last complete build; widget subtitle "Přepočítáváme…" when a `ledger.rebuild_document` / `ledger.rebuild_org` job (M04) for the org is active.
12. **Notification e-mail provider down:** digest job retries 3× with backoff; after that the notifications stay in-app; no duplicate e-mail on retry (send is keyed by `digest:{user}:{day}`).
13. **Timezone:** jobs run with `tz: Europe/Prague`; DST transitions do not double-run (pg-boss cron with tz) — tested.

## 9. Acceptance criteria and test plan

**Acceptance criteria**
1. AC-1 Golden P4 (identified person, document basis, asOf 2026-10-18): the 6 decoys, 2 duplicates and the Alza order confirmation (2 105 Kč) contribute **0** to income and expenses; the 2 settlement statements and 2 Praha 3 reports contribute 0 to income (tourist fee 3 500 / 4 150 Kč never appears in Příjmy).
2. AC-2 Golden P4 expenses YTD (document basis) = Σ of the CZK documents 11 600 + 8 150 + 12 960,84 + 9 749,44 + 13 699,77 + 11 549,94 + 26 990 + 1 198 + 117 = **96 014,99 Kč**, plus Cloudflare and Anthropic at their stored `fx_rate`, minus Decathlon if answered "personal"; while Decathlon is `unknown` it is in `pending` (249 Kč), not in expenses. Expected values are asserted from `testdata/golden-v1/labels.json` (the number above is the hand check).
3. AC-3 Property test: for random documents fully paid within a period, `computeTotals(cash) == computeTotals(document)`.
4. AC-4 Golden P4: IO card shows August 2026 output VAT **2 877 Kč** (base 13 700, row 5) and obligation `vat_return` period 2026-08 due **2026-09-25**; after ingesting the filed DPHDP3 decoy the obligation is `done` with `done_source='evidence_document'`.
5. AC-5 Golden P4 with `tourist_fee_municipality='praha3'`: `tourist_fee_report` for August 2026 due **2026-09-15**, for September due **2026-10-15**; each becomes `done` when the matching Praha 3 report is ingested; `amount_estimate` is null when there are no `pt_tourist_fee` lines.
6. AC-6 Deadline table (unit, `calendar.cz_public_holidays` + generators): VAT quarterly Q2 2026 → 2026-07-27, Q3 2026 → 2026-10-26, Q4 2026 → 2027-01-25 (`czech-tax-filings.md §3.1`); monthly Nov 2026 → 2026-12-28; IO Sep 2026 → 2026-10-26; paušál entry for 2026 → 2026-01-12, for 2027 → 2027-01-11; DAP tax year 2025 electronic → 2026-05-04, tax year 2026 electronic → 2027-05-03, advisor → 2027-07-01 (§3.3); paušální daň advance Sep 2026 → 2026-09-21; social Oct 2026 → 2026-10-30 (legal 10-31); health for Oct 2026 → 2026-11-06 (legal 11-08); IO registration trigger 2026-09-03 → 2026-09-18, trigger 2026-10-13 → 2026-10-29 (28 Oct holiday); VAT registration crossing 2026-10-20 → 2026-11-04.
7. AC-7 Each rule in `calendar.cz_public_holidays` and `deadlines.generators` has a test asserting its value on a known date and the previous value the day before any change (06 §2).
8. AC-8 P1 demo (neplatce, Adobe Ireland invoice 2026-09-03): IO trigger card appears; `io_registration` due 2026-09-18; one urgent notification, not repeated on re-runs.
9. AC-9 VAT meter: turnover 1 600 000 → `warn`; 1 900 000 → `alert`; 2 000 001 → calendar `exceeded` + `vat_registration` obligation; 2 536 501 → immediate `exceeded`. A foreign B2B service invoice (partner DE with VAT ID) is excluded; an Airbnb accommodation statement is included.
10. AC-10 Paušální daň band I with `pausal_rate=80` (declared dominant activity): ceiling 2 000 000; with 40: 1 000 000; warn when ≤ 100 000 Kč remain.
11. AC-11 `review.count` equals |open questions| + |needs_review docs without question|; answering the Decathlon question decrements it by 1 and updates totals within one page load.
12. AC-12 Running `obligations.generate` twice yields identical `obligations` rows; user-set `done` survives regeneration.
13. AC-13 Notifications: the same condition produces exactly one row per dedupe key; no e-mail is scheduled between 20:00 and 07:30 or on weekends/holidays by default; at most one urgent e-mail per user per day; a digest with nothing to report is not sent.
14. AC-14 (Phase 4) The tax-reserve tile renders M06's `computeTaxReserve` result unchanged (M06 §9 S2 reserve case), rounded to hundreds with the "odhad" label.
15. AC-15 `getDashboard` p95 < 250 ms on the 5 000-document seeded org (staging).
16. AC-16 Every rendered meter prints current value and threshold as text next to the bar, and `aria-valuetext` equals it; with CSS colours disabled (forced-colors / grayscale snapshot) the level is still identifiable from icon + text.
17. AC-17 A manual entry (`entry_mode='manual'`, `substitute_reason='lost'`, 350 Kč, cash, `exp_car_operating`) counts 350 Kč in expenses on document basis and adds 0 to any VAT estimate.

**Test plan**
- Unit (Vitest): calendar, shift, addWorkingDays, every generator row, meters, IO triggers (tie-breaks), totals.
- Property (fast-check): totals equality (AC-3); obligation generation idempotency; `shiftDate(next)` always lands on a working day ≥ input; `previous` ≤ input.
- Integration (local Supabase): generator upsert + evidence resolution; notification dedupe; RLS (accountant reads obligations, cannot mark done unless `owner|member`).
- Golden (M12 eval harness, Phase 1 gate): AC-1, AC-2, AC-4, AC-5 against `testdata/golden-v1`.
- E2E (Playwright): upload → answer one question → Přehled totals and review count update (02 Phase 1 exit); mark a deadline done and undo.
- Fixtures: `packages/testkit/fixtures/m09/*.ts` personas P1–P4 seeded orgs (Phase 0 seed).

## 10. Maintenance

| Source of change | Where | Monitor | Effort/year |
|---|---|---|---|
| Thresholds, band amounts and ceilings, caps, advances, income-tax rates/credits | rule tables (06 §2) | rule-freshness digest | 0.5 day (part of Annual Update Window) |
| Deadline rules (new filing type, changed day) | `deadlines.generators` | annual review | 0.5 day |
| Public holidays (movable dates) | `calendar.cz_public_holidays` — pre-filled 5 years | `RuleMissingError` alert 12 months ahead | 0.1 day |
| New municipality for tourist fee | `municipal.tourist_fee.<key>` | user request | 0.25 day each |
| Copy (explanations) | i18n catalog | — | 0.25 day |

**Total ≈ 1.5–2 days/year**, mostly inside the Annual Update Window.

## 11. Open questions
Consolidated in `22-open-questions.md`: TA-05 (turnover definition and the 10-working-day clock), TA-12 (paušální daň band limits), TA-15 (deadline shifting for advances), T-02 (output/input row sides), D-07 (outbound e-mail: SES). T-21 (Praha 3 report deadline and weekend shifting). Resolved (22 §F): calendar-year VAT test (04 §7 fixed); `lineTaxAmountCzk` exported by M04.
