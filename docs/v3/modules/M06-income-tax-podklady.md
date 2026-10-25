# M06: Income-tax podklady (annual summary for the accountant / MOJE daně)

> Phase 4. **Not a tax return.** M06 summarises a tax year from data the app already has and lists, in plain Czech, what the user or accountant must still add. Depends on M04 (`tax_ledger_entries`, categories), M07 (payments, advances), M05 (IO VAT paid), M09 (dashboard widget, obligations runner).
> Legal facts cite `research/czech-tax-filings.md` (**CTF**). **[verify]** = check the primary source before release (listed in §11). Low maintenance is a design goal (06 §5): the PDF/XLSX do not depend on any form version.

---

## 1. Purpose and scope

**In scope**
1. Annual **cash-basis totals** from `tax_ledger_entries` by `category_code` and `tax_effect`, with business/private split.
2. **Paušální výdaje:** flat-rate expenses = income × rate, capped (rule `pausalni_vydaje.rates_caps`), and a **flat-rate vs actual** comparison (shown to `danova_evidence` and `pausalni_vydaje` users).
3. **Paušální daň:** band check vs income, **advances paid** (from matched transactions), eligibility warnings, the **10 January** entry/exit/band-change deadline.
4. **Assets > 80 000 Kč** list (rule `asset.capitalization_threshold`); small-asset list for information. No depreciation.
5. **Private-use flags** (personal documents, partial business shares, car-regime answer).
6. **IO/VAT note** (self-assessed VAT paid, VAT status changes in the year, VAT-registration threshold warning).
7. **What is NOT included** + a checklist for MOJE daně / the accountant.
8. Outputs: **PDF summary** (Czech) and **XLSX workbook** for every regime, and an **optional partial DPFDP7 XML** (header + příloha 1 rows that are fully derivable) behind a feature flag, **only for flat-rate users**: `pausalni_vydaje`, and `pausalni_dan` in a year where a return is required (§4.4). Actual-expense users (`danova_evidence`) get PDF/XLSX podklady for the accountant and **no XML** (01 §1; Competitor C's line, lowest maintenance). Rodné číslo is asked at generation and **never stored** (05 §11).
9. A year-round **tax reserve estimate** on the dashboard (rough, labelled, non-binding). This is the **only** implementation; M09 only displays it, from Phase 4 (moved out of Phase 1 in the 2026-10-18 review).
10. Obligation definitions for `dap`, `pausalni_dan_entry`, `pausalni_dan_exit`, `pausalni_dan_advance` (04 §9.2; run and written by M09).

**Out of scope:** a full DPFDP7, ČSSZ and health-insurer přehledy (01 §6, 06 §5.1), credits and deductions computation (§15, §35ba), child benefit, other income (§6, §8, §9, §10), §23 base adjustments (ř. 103/104), depreciation (odpisy), car km allowances, loss carry-forward, final tax computation, `ucetnictvi` organisations (export only), multiple activities with different flat rates (only the main `pausal_rate`; see §11), submission of anything.

## 2. User stories

- **P1 (paušální daň, band I):** "In January I see: income 850 000 Kč fits band I; I paid 109 944 Kč of advances, exactly what was due; a reminder that I can change band or leave the regime by 11 January 2027."
- **P2 (actual expenses):** "In February I download one PDF and one XLSX for my accountant: income 1 400 000, expenses 520 000 by category, a van for 650 000 to depreciate, my 50 % private phone, and the note that the 80 % flat rate would give a base 600 000 Kč lower."
- **P3 (VAT payer, paušální výdaje 60 %):** "The summary shows income without VAT, the 1 200 000 Kč cap reached, and that my real costs would have been much better. I can tick 'generate the partial XML' and finish on MOJE daně."
- **P4 (IO, daňová evidence, rental + software):** "The tourist fee is shown separately and not counted as income or expense; the Decathlon backpack is listed as private; the MacBook is a small asset, not depreciated; Booking/Cloudflare/Anthropic are expenses; the VAT I paid as an IO is listed for my accountant."
- **Any (dashboard):** "All year I see 'Odhad k odložení na daně a pojištění: ≈ 151 600 Kč' with a clear 'odhad' label."
- **Accountant:** "I get totals I can type straight into my software, every figure drills down to documents, and a list of what the client did not tell the app."

## 3. Inputs / outputs

**Inputs:** `tax_ledger_entries` (tax_year), `categories` (`tax_effect`, labels), `documents` + `document_lines` (asset/small-asset details, `business_flag`, `business_share_pct`), `transactions` (categories `tax_pausal_advance`, `tax_income_payment`, `ins_social_own`, `ins_health_own`, `tax_vat_payment`), `taxpayer_profiles` history for the year, `filings` (M05 IO/payer VAT filings, previous podklady), `review_questions` (car regime answers), user answers in the generation wizard (§4.8), rules.

**Rules used:** `pausalni_vydaje.rates_caps`, `pausalni_dan.bands`, `pausalni_dan.eligibility`, `pausalni_dan.deadlines`, `asset.capitalization_threshold`, `vat.registration_thresholds`, `epo.forms.DPFDP7`, `deadlines.generators`, `calendar.cz_public_holidays`, `income_tax.rates`, `income_tax.credits`, `insurance.rates` (all in 06 §2.1).

**Outputs:** `filings` row `type='PODKLADY_DPFO'` (+ optional `DPFDP7_PARTIAL`), files `org/{org_id}/filings/{filing_id}/podklady-{year}.pdf|.xlsx`, `obligations`, `notifications`, the dashboard reserve payload (computed on request, cached).

## 4. Detailed behavior and algorithms

Pure functions in `packages/domain/src/income-tax/` (no I/O). Money via `Money` (`decimal.js`, half away from zero). `round0` = half-up to whole CZK; `floor0`; `round100` = to nearest 100 (display only); `floor100` = down to whole hundreds (DAP base, ADR-007).

### 4.1 Preconditions (`checkPodkladyReadiness`)

Run before every preview/generation; results are shown, generation is still allowed (podklady are informative) except where marked **blocking**.

| Code | Condition | Effect |
|---|---|---|
| `P_YEAR_OPEN` | tax year not ended (today < 1 Jan of year+1) | allowed; output watermarked "Průběžný stav k {date}" |
| `P_REGIME_UNSUPPORTED` | any profile in the year with `tax_regime='ucetnictvi'` or `entity_type≠'osvc'` | **blocking**: "Pro účetnictví podklady nepřipravujeme – předejte export účetní." |
| `P_REGIME_CHANGED` | `tax_regime` differs between profile versions in the year | allowed; summary split per regime segment, warning |
| `P_LEDGER_STALE` | any `tax_ledger_entries.build_version` < current builder version, or documents finalized after the last build | M06 enqueues M04's rebuild and waits (max 60 s), else shows "Přepočítáváme…" |
| `P_PENDING_DOCUMENTS` | bookable documents with `issue_date` or `paid_at` in the year not `finalized` | warning with count + link to Inbox |
| `P_UNPAID_ISSUED` | `issued_invoice` with `issue_date` ≤ year end and no `paid_at` | warning: "Nevíme, zda byly zaplaceny – do příjmů je nepočítáme." (cash basis) |
| `P_UNEXPLAINED_TX` | M07 radar items (unmatched outgoing business transactions) in the year | warning with count and sum: "chybí doklady" |
| `P_BUSINESS_FLAG_UNKNOWN` | documents with `business_flag='unknown'` paid in the year | warning; amounts shown in "Nevyjasněné" |

### 4.2 Annual totals (`computeAnnualTotals`)

Source: `tax_ledger_entries where org_id = $1 and tax_year = $2` (built by M04: cash basis, dated by payment, pro rata across lines, 04 §4–5). For VAT payers M04 records amounts **without** deductible/charged VAT; for non-payers and IOs amounts include VAT (VAT is a cost) — M06 relies on this contract (§11).

For each entry: `share = business_share_pct / 100`; `business = round2(amount_czk × share)`; `private = amount_czk − business`.

| Bucket | Rule | Shown as |
|---|---|---|
| Income | `tax_effect='taxable_income'` Σ `amount_czk` (share ignored) | `Příjmy` by category |
| Non-taxable income | `non_taxable_income` | listed, not in totals |
| Deductible expenses | `deductible_expense` Σ `business` | `Výdaje` by category |
| Private part | Σ `private` of deductible lines + all `tax_effect='private'` | `Soukromé (nezapočteno)` |
| Non-deductible | `non_deductible_expense` Σ `amount_czk` | listed, not deducted |
| Assets | `asset` → §4.5 | asset list |
| Pass-through | `pass_through` by category (e.g. `pt_tourist_fee`) | separate box, not income/expense |
| Taxes & insurance | `tax_or_insurance_payment` by category | §4.6/§4.7 and info table |
| Transfers | `transfer` | ignored (count only) |

Totals per category are 2-decimal sums; the PDF shows `round0`, the XLSX keeps haléře. `income_accommodation` gets the flag "§7 nebo §9 rozhodne účetní" (22 D-06). Category labels come from `categories.label_cs`.

Drill-down: every category total links to its entries `{documentId, partner, documentNumber, paidOn, amountCzk, sharePct}`.

### 4.3 Flat-rate expenses and comparison (`computeFlatRateComparison`)

Applies to `danova_evidence` (comparison only) and `pausalni_vydaje` (the regime's figure). Inputs: `income` (Σ from §4.2), `rate = profile.pausal_rate` (for `danova_evidence`: the user picks 80/60/40/30 in the comparison widget, default from M04's activity hint or 60), `actual` (Σ deductible business).

```
incomeKc   = round0(income)
capKc      = rules.pausalni_vydaje.rates_caps[rate]          // 2026: 80→1 600 000, 60→1 200 000, 40→800 000, 30→600 000
flatRaw    = floor0(incomeKc × rate / 100)                   // never round up an expense [verify rounding]
flat       = min(flatRaw, capKc);  capReached = flatRaw > capKc
baseFlat   = incomeKc − flat
baseActual = incomeKc − round0(actual)
better     = baseFlat < baseActual ? 'flat' : baseFlat > baseActual ? 'actual' : 'equal'
difference = |baseFlat − baseActual|
```
Caveats rendered with the comparison (fixed i18n texts, no computation): actual excludes depreciation of assets (§4.5) and car allowances; own social/health insurance is never an expense; with flat-rate expenses, if §7+§9 flat-rate bases exceed 50 % of the total base, the spouse credit and child benefit are lost (§35ca, CTF §1.5 [I]) **[verify]**; switching method has consequences the accountant must assess. The comparison shows **bases only**, not tax.

### 4.4 Paušální daň check (`checkPausalniDan`)

For years where any profile segment has `tax_regime='pausalni_dan'`.

1. **Band fit.** Rule `pausalni_dan.bands[].ceilings` (06 §2.1; same data and the same pure ceiling function as M09 §4.4.2) gives per band the income ceiling by declared dominant activity class. Class = `profile.pausal_rate` (04 §1: for paušální daň it is the declared class of ≥ 75 % of income); the app takes the user's declaration and says so. `limit(band, class)`: band 1 → 1 000 000 (any) / 1 500 000 (class 60, 80) / 2 000 000 (class 80); band 2 → 1 500 000 / 2 000 000 (60, 80); band 3 → 2 000 000 (CTF §4.2). `fitBand` = smallest band with `income ≤ limit`.
   - `fitBand > profileBand` → warning `pd.band_exceeded`: "Příjmy {income} Kč překročily hranici pásma {band} ({limit} Kč)." Consequences for the year are **[verify]** → "Poraďte se s účetní."
   - `income > pausalni_dan.eligibility.max_income` → warning `pd.regime_limit_exceeded`.
   - `fitBand < profileBand` → info `pd.lower_band_possible` for the next year (deadline below).
2. **Advances.** `expected = Σ_{m=1..12} rules.at(⟨year⟩-⟨m⟩-01).pausalni_dan.bands[band].monthly` over months covered by the paušál profile segment (rules hold the *current* value for the year, so retroactive changes are automatic). `paid = Σ transactions.amount (absolute)` with `category_code='tax_pausal_advance'` and `booked_on` in the year **[verify: a December advance paid in January counts for which year]**. `delta = paid − expected` → "doplatit" (< 0) / "přeplatek" (> 0) / "v pořádku". A per-month table shows paid vs due (due day `pausalni_dan.deadlines.advance_day` = 20, shifted to next working day); per-month differences are informational (2026 had a retroactive band I cut: 9 984 → 9 162, July payment 4 230, CTF §4.2).
3. **Eligibility warnings** (from data and wizard answers, never blocking): any profile segment in the year with `vat_status='platce'` (IO is fine, CTF §3.2/§4.2); answer "other §8/§9/§10 income" > `pausalni_dan.eligibility.max_other_income`; answer "employment beyond DPP/DPČ limits"; answer "insolvency / v.o.s. partner". Each warning: "Podmínky paušálního režimu možná nesplňujete: {reason}. Pak je potřeba podat přiznání – poraďte se s účetní." **[verify wording]**
4. **10 January deadline.** `noticeDue(year+1) = shiftToWorkingDay(⟨year+1⟩-01-10)` from `pausalni_dan.deadlines.entry/exit` (2027 → **11. 1. 2027**, since 10 Jan is a Sunday; 2026 was 12. 1., CTF §3.3). Shown from 1 December to the deadline to: paušál users (stay / change band / leave) and eligible non-payers on another regime (income ≤ 2 000 000, no `platce` segment): "Do {date} můžete oznámit vstup do paušálního režimu." No cost comparison.
5. If all conditions hold, the summary says "Za rok {year} přiznání nepodáváte, pokud podmínky platily celý rok." **[verify]** and still offers the PDF/XLSX.

### 4.5 Assets and small assets

- **Asset list:** lines with `category_code='asset_long_term'` on finalized documents whose `paid_at` or `issue_date` is in the year (union, deduplicated) with `price = line gross` for non-payers/IO and `line net` for payers where VAT was deducted (`rcv_domestic_vat` with a KH section) — the "vstupní cena" decision itself is the accountant's. Columns: date, supplier, description, document number, price, paid amount in year, business share, car flag (`exp_car_*`/`exp_fuel` co-occurrence or a car-regime answer).
- Consistency check: any single line with `category_code ≠ 'asset_long_term'` and `price > asset.capitalization_threshold` → warning `asset.maybe_misclassified`; any `asset_long_term` line ≤ threshold → warning (04 §3.1 rule).
- **Small assets** (`exp_small_assets`) listed for information (they are already in expenses).
- Note: "Odpisy spočítá účetní. V přehledu nejsou." No depreciation numbers anywhere.

### 4.6 Private use and car

List: documents with `business_flag='personal'` paid in the year (count, sum), lines with `0 < business_share_pct < 100` (description, total, business part), `review_questions` of kind `car_regime` with the answer (actual costs vs flat km rate, business share) or "nezodpovězeno". No computation beyond §4.2.

### 4.7 IO/VAT note

- VAT status segments in the year (e.g. "identifikovaná osoba od 3. 8. 2026").
- IO: Σ `tax_vat_payment` transactions in the year, and the M05 filings of the year (period, ř. 64, state). Text: "DPH, kterou jako identifikovaná osoba odvádíte z nákupů ze zahraničí, si nemůžete odečíst; pro daň z příjmů je obvykle výdajem – potvrdí účetní." **[verify]** Not added to totals.
- Payer: "Příjmy a výdaje jsou bez DPH." + Σ `tax_vat_payment` paid (info).
- Non-payer/IO: if Σ income (domestic, cash) of the calendar year > `vat.registration_thresholds.calendar_year` → warning "Obrat překročil hranici pro registraci k DPH" (the dashboard alert owns the action).

### 4.8 Generation wizard (questions; answers stored without RČ)

Max 6 questions, each skippable, defaults "nevím": (1) other income §6/§8/§9/§10? (yes/no + approx. amount for paušální daň only); (2) employment beyond DPP/DPČ limits? (paušální daň only); (3) insolvency/v.o.s./k.s. partner? (paušální daň only); (4) flat rate for the comparison (DE users); (5) activity class for paušální daň if `pausal_rate` is null; (6) "include the partial XML" (only if the flag is on and the regime qualifies, §4.10). Stored in `filings.inputs` (05 §8).

### 4.9 Outputs

**PDF summary** (react-pdf, A4, Czech, ≤ 4 pages, no jargon, `round0` amounts): (1) header: name, IČO, year, regime, generated date, watermark if year open; (2) "Hlavní čísla": income, expenses (or flat-rate), difference ("základ před úpravami"), advances paid; (3) categories table; (4) comparison (§4.3) or paušální daň box (§4.4); (5) assets, private use, pass-through, IO/VAT note; (6) warnings from §4.1; (7) **"Co v podkladech není"** checklist (below); (8) footer disclaimer `podklady.disclaimer`: "Toto není daňové přiznání. Jsou to podklady z dokladů v aplikaci. Přiznání podáváte vy nebo vaše účetní."

**XLSX workbook** (exceljs): `Souhrn`, `Příjmy` (entry level), `Výdaje` (entry level with share, business part, private part), `Kategorie` (pivot by `category_code` × `tax_effect`), `Majetek`, `Drobný majetek`, `Soukromé`, `Platby daní a pojistného` (transactions by category and month), `Paušální daň` (if applicable), `Chybí` (warnings with links), `Kontrolní seznam`. Amounts in haléře, CZK number format, frozen header rows, document links (app URLs; accountant role required).

**Checklist "Co doplnit na MOJE daně / s účetní"** (`podklady.checklist.*`, fixed items, regime-filtered):
1. Slevy na dani (e.g. sleva na poplatníka) and daňové zvýhodnění na děti.
2. Nezdanitelné části základu (dary, úroky z hypotéky, penzijní a životní pojištění…).
3. Jiné příjmy: zaměstnání (§6), kapitálové (§8), nájem (§9), ostatní (§10), zahraniční příjmy.
4. Odpisy majetku ze seznamu "Majetek" (DE only).
5. Auto: paušál na dopravu / skutečné náklady, krácení soukromého použití (DE only).
6. Úpravy základu (ř. 103/104), ztráta z minulých let.
7. Zaplacené zálohy na daň (ř. 85) a paušální daň (ř. 86) — we list amounts found in transactions; the user confirms.
8. Přehledy pro ČSSZ a zdravotní pojišťovnu (not prepared by the app).
9. Příjmy z ubytování: §7 nebo §9 (P4-type users).
10. Doklady, které v aplikaci chybí (count from §4.1).

### 4.10 Optional partial DPFDP7 XML (`DPFDP7_PARTIAL`)

Feature flag `feature.dpfdp7_partial` (global kill switch + per-org opt-in, default **off**). Hidden automatically when `epo.forms.DPFDP7` has no vendored XSD whose `tax_years` include the year (drift monitor alerts the maintainer, 06 §3). Offered **only to flat-rate users**: `pausalni_vydaje`, and `pausalni_dan` only in a year where §4.4 step 3 found that a return is required (ř. 102 then uses the flat rate of the declared activity class, `pausal_rate`). **Never** for `danova_evidence` (their ř. 102 depends on depreciation and the accountant's adjustments; they get PDF/XLSX podklady) or `ucetnictvi`. The route returns 404 for non-qualifying regimes.

**Content (only fully derivable values; all names [verify against XSD], 22 T-03):**

| Element / attr | Value | Regime |
|---|---|---|
| `Pisemnost@nazevSW`, `@verzeSW` | app name/version | all [verify] |
| `DPFDP7@verzePis` | from `epo.forms.DPFDP7.verze_pis` | [verify] |
| `VetaD@dokument`, `@k_uladis` | `DP7` / `DPF` (CTF §1.5 marks [I]) | [verify] |
| `VetaD@rok` | tax year | [verify] |
| `VetaD@dap_typ` | `B` (řádné only) | [verify] |
| `VetaD@pln_moc`, `@audit` | `N`, `N` | [verify] |
| `VetaD@c_ufo_cil`, `@c_pracufo` | `profile.fu_code`, `profile.ufo_code` | [verify] |
| `VetaP@rod_c` | rodné číslo from the request (digits, no slash) | [verify] |
| `VetaP@jmeno`, `@prijmeni`, `@titul`, address attrs, `@email`, `@c_telef` | profile (`taxpayer_profiles.first_name/last_name/title/filing_email/filing_phone`, 05 §2) | [verify] |
| `VetaT@c_nace` | `profile.main_activity_nace` | [verify] |
| `VetaT@kc_prij7` (ř. 101) | `round0(income)` | PV, PD (return year) |
| `VetaT@kc_vyd7` (ř. 102) | `flat` from §4.3 | PV, PD (return year) |
| `VetaT@pr_sazba`, `@vyd7proc` | `pausal_rate`, flag "flat rate used" | PV, PD (return year) |

Not emitted: VetaO/VetaS (ř. 37 onward — EPO computes or the user fills) **[verify that EPO accepts VetaT without VetaO; CTF §1.5 notes kc_zd7 ⇒ VetaT, not the reverse; T-03]**, ř. 103–113, `pr_prij7`/`pr_vyd7`/`celk_pr_*` (if the XSD requires them when `vyd7proc` is set, emit `pr_prij7 = kc_prij7`, `pr_vyd7 = kc_vyd7` only after verifying; otherwise the feature is disabled for PV), activity dates `d_zahcin` etc. Competitor C offers its XML only on the flat-rate line and its actual-expense export breaks on the flat-rate field (internal research (not published)); we follow the same line and emit no XML for actual-expense users. A CI test asserts every emitted attribute exists in the vendored XSD.

**Rodné číslo handling (never stored):**
- Generation is a **synchronous** Route Handler (`POST /api/v1/podklady/{year}/dpfdp7-partial`), **not** a pg-boss job (job payloads are persisted in Postgres).
- Body `{ rodneCislo, inputsVersion }`; validate format `^\d{6}/?\d{3,4}$`; for 10 digits check `n mod 11 = 0` (or remainder 10 with last digit 0) → mismatch is a warning, not a block.
- Build XML in memory → `validateXml` (M05 `packages/tax-xml`, `xmllint --nonet`) → stream as `attachment; filename="DPFDP7-{year}-castecne.xml"`; response header `Cache-Control: no-store`.
- Never written to storage, DB, logs, Sentry, analytics or job tables. Request-body logging disabled for the route; Sentry `beforeSend` and the logger redact keys `rodneCislo`, `rod_c` and any 9–10-digit token matching the pattern; the field is `autocomplete="off"`, not kept in client state after the response.
- The `filings` row (`type='DPFDP7_PARTIAL'`, `state='downloaded'`) stores only `totals` (`kc_prij7`, `kc_vyd7`, rate), `form_version`, `xsd_valid`; `xml_path = null`. Each new download asks for the RČ again.
- XSD-invalid → 422 with a generic message; errors go to Sentry **with the XML redacted** (rod_c removed before serialisation for the error report).

### 4.11 Tax reserve estimate (dashboard, `computeTaxReserve`)

Simple, YTD, explicitly an estimate. Shown in Přehled as one number + "Jak počítáme?" popover. Recomputed on ledger rebuild (debounced) and nightly; cached per org.

```
asOf = today (Europe/Prague); months = month(asOf)              // elapsed months incl. current
income  = Σ taxable_income YTD (tax_ledger_entries, entry_date ≤ asOf)
expense = pausalni_vydaje ? min(floor0(income × rate/100), cap[rate]) : Σ deductible business YTD
profit  = max(0, income − expense)
base    = floor100(profit)
taxRaw  = base ≤ T × months/12 ? base × r1 : (T × months/12) × r1 + (base − T × months/12) × r2
tax     = max(0, taxRaw − credit × months/12)                    // r1, r2, T, credit: rule keys income_tax.rates, income_tax.credits (06 §2.1)
social  = round0(profit × sBase/100 × sRate/100);  health = round0(profit × hBase/100 × hRate/100)
paidS, paidH, paidT = Σ YTD transactions ins_social_own, ins_health_own, tax_income_payment
reserve = max(0, tax − paidT) + max(0, social − paidS) + max(0, health − paidH)
display = round100(reserve)
```
- `pausalni_dan`: no reserve; the widget shows "Zálohy paušální daně: zaplaceno {paid} z {dueYtd}" (§4.4 step 2, YTD).
- `ucetnictvi`: widget hidden. VAT is not included (M05 obligations show VAT due).
- Label `reserve.label`: "Odhad k odložení na daň a pojištění" + badge "odhad"; popover `reserve.how`: "Počítáme jen z dokladů a plateb v aplikaci od 1. 1. Nezahrnujeme slevy kromě slevy na poplatníka, odpočty, odpisy ani jiné příjmy. Skutečná daň bude jiná." Never shown as a payable obligation; never used in filings.

### 4.12 Obligations (definitions; M09's daily job runs `incomeTaxObligationsFor`)

| Kind | Who | `due_date` | `source_rule` |
|---|---|---|---|
| `dap` | `danova_evidence`, `pausalni_vydaje`; `pausalni_dan` only with a §4.4 warning | electronic deadline `⟨year+1⟩-05-01` shifted (2027 → 3. 5. 2027, CTF §3.3); note with the paper (1. 4.) and advisor (1. 7.) dates; `has_accountant` → note "s poradcem do 1. 7." | `deadlines.generators/dap` (the paper and advisor dates are notes on that entry) |
| `pausalni_dan_entry` / `pausalni_dan_exit` (optional) | eligible non-payers on another regime / paušál users | §4.4 step 4 (11. 1. 2027) | `pausalni_dan.deadlines` (M09 generator) |
| `pausalni_dan_advance` | `pausalni_dan` months | 20th of each month, shifted | `pausalni_dan.deadlines.advance_day` |

`pausalni_dan_advance` is `done` when a `tax_pausal_advance` transaction ≥ the month's amount is booked between the 1st of the month and the due date + 10 days (M07 matching; else `overdue`). `amount_estimate` = the band's monthly amount.

### 4.13 Filing lifecycle (podklady)

`PODKLADY_DPFO`: `period_start = ⟨year⟩-01-01`, `period_end = ⟨year⟩-12-31`, `kind='radne'`. States: `generated` (PDF + XLSX written, `totals` snapshot, `filing_documents` snapshot of every document contributing an entry) → `downloaded` → `marked_filed` (user: "Předáno účetní / podáno") → `superseded` (regenerated). After `marked_filed`, a change in the year's ledger shows "Podklady se od předání změnily: {diff of totals}" with a regenerate button (no legal amendment logic — the accountant decides).

## 5. Data

### 5.1 Read / written

| Table | R/W | Columns |
|---|---|---|
| `tax_ledger_entries` | R | all |
| `categories` | R | `code`, `tax_effect`, `label_cs`, `direction` |
| `documents`, `document_lines` | R | `class`, `status`, `business_flag`, `issue_date`, `paid_at`, `document_number`, `partner_id`, lines: `category_code`, `net`, `gross`, `business_share_pct`, `vat_treatment` |
| `transactions` | R | `category_code`, `amount`, `booked_on`, `match_state` |
| `taxpayer_profiles`, `review_questions`, `filings` (M05 types) | R | |
| `filings`, `filing_documents`, `obligations`, `notifications`, `audit_log` | W | |

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §8 `filings.inputs` with the `filings_inputs_no_rc` check, 05 §2 `taxpayer_profiles.pausal_rate` (also the paušální daň activity class, 04 §1) and the VetaP columns. Obligation kinds: 04 §9.2 (`pausalni_dan_entry` / `pausalni_dan_exit` replace the proposed `pausalni_dan_notice`).

### 5.3 Rule keys
Merged into 06 §2.1 on 2026-10-18: `pausalni_dan.bands` (with `ceilings`, shared with M09), `income_tax.rates`, `income_tax.credits`, `insurance.rates`, `epo.forms.DPFDP7` (`tax_years`, `verze_pis`). `income_tax.dap_deadlines` was folded into `deadlines.generators` (`dap`). `feature.dpfdp7_partial` is a feature flag (config, not law).

## 6. Interfaces

```ts
// packages/domain/src/income-tax/index.ts (pure)
export interface AnnualTotals { year: number; regimeSegments: RegimeSegment[];
  income: CategoryTotal[]; incomeTotal: Money; nonTaxableIncome: CategoryTotal[];
  deductible: CategoryTotal[]; deductibleTotal: Money; privatePart: Money; nonDeductible: CategoryTotal[];
  passThrough: CategoryTotal[]; taxAndInsurancePayments: CategoryTotal[]; transfersCount: number }
export interface CategoryTotal { categoryCode: string; taxEffect: TaxEffect; amount: Money; entryCount: number }
export function computeAnnualTotals(entries: TaxLedgerEntry[], categories: Category[]): AnnualTotals;
export function checkPodkladyReadiness(input: ReadinessInput): ReadinessCheck[];
export function computeFlatRateComparison(income: Money, actual: Money, rate: 80 | 60 | 40 | 30, rules: RuleSet): FlatRateComparison;
export function checkPausalniDan(input: { year: number; income: Money; band: 1 | 2 | 3; activityClass: 80 | 60 | 40 | 30;
  months: number[]; advances: { bookedOn: IsoDate; amount: Money }[]; profileSegments: ProfileSegment[];
  answers: PodkladyAnswers }, rules: RuleSet): PausalniDanCheck;
export function listAssets(lines: AssetLineInput[], vatStatusAt: (d: IsoDate) => VatStatus, rules: RuleSet): { assets: AssetRow[]; smallAssets: AssetRow[]; warnings: AssetWarning[] };
export function computeTaxReserve(input: ReserveInput, rules: RuleSet, asOf: IsoDate): TaxReserveEstimate | { kind: 'pausalni_dan'; paid: Money; dueYtd: Money } | null;
export function incomeTaxObligationsFor(org: OrgContext, profiles: ProfileSegment[], tx: AdvanceTx[], today: IsoDate, rules: RuleSet): ObligationDraft[];
export function buildPodkladySummary(input: PodkladyInput, rules: RuleSet): PodkladySummary;   // everything the PDF/XLSX render

// packages/tax-xml
export function serializeDpfdp7Partial(s: PodkladySummary, h: DpfHeader, rodneCislo: string, rules: RuleSet): string; // pure, no logging
export function validateRodneCislo(input: string): { normalized: string; checksumOk: boolean } | { error: 'format' };

// apps/worker / apps/web services
export function generatePodklady(orgId: string, year: number, answers: PodkladyAnswers, userId: string): Promise<{ filingId: string }>;
export function streamPartialDpfdp7(orgId: string, year: number, rodneCislo: string, userId: string): Promise<ReadableStream>;
```

**Jobs (pg-boss, zod)**
```ts
'podklady.generate':        z.object({ orgId: z.string().uuid(), year: z.number().int().min(2024), answersVersion: z.number().int(), requestedBy: z.string().uuid() })
                            // idempotency {org}:podklady:{year}:{ledgerBuildHash}:{answersVersion}
'podklady.reserve.refresh': z.object({ orgId: z.string().uuid(), reason: z.enum(['ledger_rebuilt','nightly','profile_changed']) })
                            // debounce 60 s per org; nightly 02:30 Europe/Prague fan-out
```
The partial XML is deliberately **not** a job (§4.10).

**API routes** (`/api/v1`; owner/member generate; accountant read/download; viewer read)
- `GET /podklady/{year}/preview` → `PodkladySummary` + readiness checks (live, not stored)
- `POST /podklady/{year}` `{answers}` → 202 `{filingId}` · `GET /filings/{id}/download?format=pdf|xlsx`
- `POST /podklady/{year}/dpfdp7-partial` `{rodneCislo}` → 200 XML stream | 404 feature off | 422 invalid (owner only)
- `GET /dashboard/tax-reserve` → cached estimate
- `POST /filings/{id}/mark-filed` (shared with M05)

**Notifications** (`notifications.kind`, 04 §9.3; delivered by M09): `podklady_ready` (in February for closed years: "Podklady k dani za {year} jsou připravené"), `podklady_changed`. The 10 January notice deadline and missing paušál advances are M09's `deadline_upcoming` / `deadline_overdue` on the `pausalni_dan_*` obligations.

## 7. UX touchpoints

- **Přehled card** (Jan–Jun for the previous year; on demand any time): "Podklady k dani z příjmů za 2026" → [Zobrazit] [Stáhnout PDF] [Stáhnout XLSX]. Readiness warnings appear as a short list above the buttons ("3 doklady čekají na kontrolu", "2 platby bez dokladu").
- **Preview sheet:** five blocks, top to bottom: Hlavní čísla · Kategorie · Srovnání paušálu (or Paušální daň) · Majetek a soukromé · Co v podkladech není. Every number is tappable → entries.
- **Comparison copy** (`podklady.flat.result`): "S paušálem {rate} % by byl základ daně o {difference} Kč {lower|higher} než se skutečnými výdaji." Cap: "Paušál je omezen na {cap} Kč – limit jste dosáhli."
- **Paušální daň copy:** `pd.band_ok` "Příjmy {income} Kč se vejdou do {band}. pásma (limit {limit} Kč)." `pd.advances_ok` "Zálohy: zaplaceno {paid} Kč, mělo být {expected} Kč. V pořádku." `pd.advances_missing` "Chybí doplatit {delta} Kč." `pd.notice` "Do {date} můžete změnit pásmo nebo z režimu vystoupit."
- **Partial XML dialog** (flag on): "Chcete i soubor pro MOJE daně? Vyplníme jen hlavičku a příjmy{pvPart}. Zbytek doplníte na MOJE daně." Field "Rodné číslo (neukládáme ho)". Then steps: MOJE daně → Elektronické formuláře → Načíst ze souboru → doplnit → Kontrola → Podat **[verify UI labels]**.
- **Dashboard reserve tile:** "≈ 151 600 Kč · odhad" + "Jak počítáme?" link. No red colours, no "dlužíte".

## 8. Edge cases and failure modes

1. **Invoice issued in December, paid in January** → next year's income (cash basis); shown in "Nezaplacené k 31. 12." in the XLSX.
2. **Refund or credit note paid back** → negative entries reduce the category; a negative category total is shown as such.
3. **Mid-year regime/VAT status change** → per-segment totals; flat-rate comparison over the full year with a warning.
4. **Duplicates** (golden IKEA NFC/NFD, Decathlon ×2) → counted once (they never reach the ledger as separate documents).
5. **Decoys** (order confirmation, settlement statements, municipal reports, own DPHDP3) → never in totals.
6. **Card payment in foreign currency** → `amount_czk` = bank-charged CZK (M04/M07); if only the document exists, M04's FX choice applies; M06 shows the source.
7. **Advances paid from a private account** → not found → `deadline_overdue` on the month's `pausalni_dan_advance` obligation; user can mark the transaction or add a manual one (M07).
8. **Year with no data** → the card is not shown; the preview says "Za {year} nemáme žádné doklady."
9. **Feature flag on but XSD for the year missing** → XML button hidden with "Soubor pro {year} zatím nepřipravujeme"; PDF/XLSX unaffected.
10. **RČ in logs by mistake** → CI test greps captured logs/Sentry fake for the test RČ (fails build).
11. **Accountant regenerates** → allowed (read + export role includes podklady); `generated_by` records it.
12. **PDF render failure** → retry ×3, then the XLSX is still delivered with a notice.

## 9. Acceptance criteria and test plan

All scenarios are fixtures in `testkit/podklady/` with documents, payments (`tax_ledger_entries` built by M04's real builder) and rules for 2026. Expected values are exact.

**S1 – P1 Petra, `pausalni_dan` band 1, activity class 60, IO, 2026**
- Income: 9 invoices issued and paid in 2026 (9 × 85 000 = 765 000) + 1 issued 15. 12. 2025 paid 5. 1. 2026 (85 000) + 1 issued 10. 12. 2026 paid 4. 1. 2027 (excluded). → `incomeTotal = 850 000,00`.
- Advances (`tax_pausal_advance`): Jan–Jun 6 × 9 984 = 59 904; Jul 4 230; Aug–Dec 5 × 9 162 = 45 810 → `paid = 109 944`; `expected = 12 × 9 162 = 109 944`; `delta = 0` → `pd.advances_ok`.
- Band: fit band 1 (limit 1 500 000 for class 60); no band warnings; `pd.lower_band_possible` absent.
- Notice deadline for 2027: **11. 1. 2027**; optional obligation `pausalni_dan_exit` (period 2027) created by M09's generator; no `dap` obligation; reserve widget shows advances, not a reserve.
- Partial XML not offered.

**S2 – P2 Tomáš, `danova_evidence`, non-payer, 2026**
- Income 1 400 000,00. Deductible business: material 400 000 + fuel 60 000 + phone 24 000 at 50 % (→ 12 000) + tools `exp_small_assets` 48 000 = **520 000,00**; private part **12 000,00**; `exp_representation` 4 000 listed non-deductible; van `asset_long_term` 650 000 (paid 12. 5. 2026) in the asset list, not in expenses; `ins_social_own` 12 × 5 005 = 60 060 and `ins_health_own` 12 × 3 306 = 39 672 listed in payments, not deducted.
- Comparison at 80 %: flat 1 120 000 (no cap), `baseFlat = 280 000`, `baseActual = 880 000`, `better='flat'`, `difference = 600 000`.
- **S2b** income 2 300 000 at 80 % → `flatRaw 1 840 000`, `flat = 1 600 000`, `capReached = true`; VAT-threshold warning present.
- Partial XML: **not offered** (`danova_evidence`); the dialog is absent and `POST /podklady/2026/dpfdp7-partial` returns 404. PDF and XLSX only.
- **Reserve** as of 30. 9. 2026 (YTD income 1 050 000, expenses 390 000, social paid 9 × 5 005 = 45 045, health paid 9 × 3 306 = 29 754, tax paid 0): profit 660 000; tax = 99 000 − 30 840 × 9/12 (23 130) = 75 870; social = 660 000 × 0,55 × 0,292 = 105 996; health = 660 000 × 0,50 × 0,135 = 44 550; reserve = 75 870 + 60 951 + 14 796 = **151 617** → display **≈ 151 600 Kč**.

**S3 – P3 Lucie, `platce` quarterly, `pausalni_vydaje` 60 %, 2026**
- Income (net of VAT) 3 500 000; actual deductible (net) 2 900 000. Flat: `flatRaw 2 100 000`, `flat = 1 200 000`, `capReached`; `baseFlat = 2 300 000`, `baseActual = 600 000`, `better='actual'`, `difference = 1 700 000`.
- Partial XML: `kc_prij7="3500000"`, `kc_vyd7="1200000"`, `pr_sazba="60"` (+ `vyd7proc`), XSD-valid; the stored `filings` row has `xml_path = null` and `totals` only.
- IO/VAT note says "bez DPH".

**S4 – P4 Josef, IO, `danova_evidence`, golden-v1 documents + synthetic income, 2026**
- Fixture income: `income_accommodation` 180 000 + `income_services` 60 000 = **240 000,00**; tourist fee `pt_tourist_fee` 3 500 + 4 150 = **7 650** in pass-through only.
- Deductible (all paid in 2026): cleaning 11 600 + 8 150; property manager 12 960,84 + 9 749,44; Booking 13 699,77 + 11 549,94; MacBook 26 990 (`exp_small_assets`, March); IKEA 1 198 (counted once); Alza 117 ("není daňový doklad" still counts); Cloudflare card charge 226,50; Anthropic card charge 2 218,32 (fixture CZK amounts) → **98 459,81**.
- Private: Decathlon 249 (counted once). Excluded: Alza order confirmation 2 105, settlement statements, municipal reports, filed DPHDP3.
- Asset list empty (MacBook < 80 000 → small assets). `income_accommodation` flagged §7/§9.
- IO note: `tax_vat_payment` 2 877 + 2 471 = 5 348 listed, not deducted; IO since the profile date.
- Comparison at 60 %: flat 144 000, `baseFlat 96 000`, `baseActual 141 540,19` (PDF 141 540), `better='flat'`, `difference 45 540,19`.

**General criteria**
1. Totals equal the fixture to the haléř in XLSX and to the koruna (half-up) in the PDF.
2. Every PDF contains the disclaimer and the regime-filtered checklist; text extraction test finds each checklist key.
3. No document with a non-bookable class contributes to any total (property over random fixtures).
4. Property: Σ categories = bucket totals; `business + private = amount_czk` per entry; flat ≤ cap and ≤ income × rate.
5. RČ: after the S3 partial-XML run, the RČ test value `7801011229` does not appear in the DB dump, storage bucket, pg-boss tables, captured logs or the Sentry test transport; the `filings_inputs_no_rc` constraint rejects an insert containing `rodneCislo`.
6. Feature flag off → route returns 404 and the UI hides the option.
7. Rules: changing `pausalni_vydaje.rates_caps` via `rules_overrides` changes S2b without a deploy.
8. Obligations: `dap` for 2026 due **3. 5. 2027**; `pausalni_dan_advance` for October 2026 due 20. 10. 2026 (Tue).

**Test layers:** unit (domain functions, 100 % branch coverage on §4.3/§4.4/§4.11), property (fast-check on totals and caps), integration (M04 builder → M06 → PDF/XLSX, RLS on filings), E2E (Playwright: P2 opens podklady → downloads PDF and XLSX → numbers match; P3 generates partial XML with RČ).

## 10. Maintenance

| Source of change | Containment | Effort/yr |
|---|---|---|
| Flat-rate %/caps, paušální daň amounts/limits, asset threshold, credits/rates for the reserve | rule data PR in the Annual Update Window (06 §4); mid-year hotfix via `rules_overrides` (e.g. the 2026 band I cut) | 0.5 day |
| DPFDP7 structure for a new tax year (optional feature) | vendor XSD, re-check the ≤ 12 attributes, golden XML; if late or changed heavily → keep the flag off for that year (no user impact on PDF/XLSX) | 0.5–1 day |
| Checklist and copy (e.g. 2027 credits returning, CTF §4.5/§6) | i18n text update | 0.25 day |
| Category taxonomy changes | owned by M04; M06 groups by `tax_effect`, so new categories need no change | 0 |
**Total ≈ 1–2 days/year**, within 06 §1. Monitors: 06 §3 EPO version/XSD hash (DPFDP7), rule freshness digest. Nothing in M06 blocks a release if the DPFDP7 XSD changes: the flag hides the XML.

## 11. Open questions
Consolidated in `22-open-questions.md`: TA-12 (paušální daň band and regime limits, December advance), TA-13 (rounding of flat-rate expenses and ř. 101/102), T-03 (DPFDP7 attributes), TA-06 (IO VAT as an expense), TA-14 (§35ca text), T-18 (2026 tax threshold), D-06 (§7 vs §9). Resolved (22 §F): the ledger contract with M04 (05 §7); one flat rate per profile, no secondary-rate column; partial XML only for flat-rate users.
