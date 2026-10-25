# M05: Simple VAT (IO DPHDP3, simple-payer DPHDP3 + DPHKH1 + DPHSHV)

> Phase 3. Depends on M01–M04 (documents, lines, `vat_treatment`, finalization), M07 (payments, for VAT-payment status only), the rules engine (06 §2) and `fx_rates`.
> **Anchor:** the *simple period* definition (02 Phase 3, 04 §8) is **§4.3 (simple-period classifier)** of this file.
> Legal facts cite `research/czech-tax-filings.md` (abbreviated **CTF**). Anything marked **[verify]** must be checked against the vendored XSD or an advisor before release and is listed in §11.

---

## 1. Purpose and scope

M05 defines how finalized documents become **VAT ledger** entries (`vat_ledger_entries`) and, **only when a period is simple**, turns them into EPO XML filings the user uploads themselves. Otherwise it produces a **VAT workbook (XLSX) for the accountant** and says why in plain Czech.

**Ownership split (00-README module map):** M04 owns the ledger *jobs and table writes*; M05 owns the *VAT rules* they apply: the pure functions in `packages/domain/src/vat/` (§4.1–4.2) and the rule data (`epo.dphdp3_row_map`, `epo.kh_routing`). M09 owns the obligations generator; M05 supplies the VAT generator definitions (§4.12). Everything from §4.3 on is M05's.

**In scope**
1. VAT ledger routing (`vat_point_date`, period, CZK base/tax, DPHDP3 rows, KH section, SH code) as pure functions called by M04's ledger builder.
2. Simple-period classifier (rule key `vat.simple_period_policy`, 04 §8).
3. **IO DPHDP3** (`typ_platce="I"`): monthly, only months with a liability, rows 5, 6, 12, 13 (output only), no deduction, no KH (CTF §3.2). ČNB FX.
4. **Simple-payer DPHDP3** (`typ_platce="P"`): rows 1, 2, 3–6, 12, 13, 20, 21, 26, 40, 41, 43, 44, computed 46, 62–65.
5. **DPHKH1** sections A2, A4, A5, B2, B3 (+ Věta C). **DPHSHV** codes `k_pln_eu` 0 and 3 (payers; and IOs supplying §9(1) services to EU businesses).
6. Whole-CZK rounding, XSD validation (vendored XSD + `xmllint`), human preview with drill-down, preview PDF.
7. Filing lifecycle (`filings`: draft → generated → downloaded → marked_filed, `superseded`), amendments (řádné/opravné/dodatečné; KH řádné/následné; SH následné) with a diff against the filed snapshot.
8. Obligations (deadlines) for VAT returns, KH, SH, VAT payment, amendments.
9. Submission guide (download + step-by-step on MOJE daně or datová schránka). **No automatic submission** (02 guardrails).

**Out of scope (→ VAT workbook for the accountant):** domestic reverse charge (§92a, rows 10/11/25, KH A1/B1), imports (rows 7/8/42), exports (22), new means of transport (9, 23), OSS/distance sales (24), triangular trade (30/31), bad-debt and §42a/§74a corrections (14, 33, 34, 48), pro-rata coefficient (50–53), §78 adjustments (60), refunds §84 (61), §75 partial private-use deduction, advance tax documents (ZDD), deduction deferral, `kod_zo` (period switch), KH response to a tax-office request (`vyzva_odp`, `c_jed_vyzvy`), dodatečné-opravné (`E`) forms, VAT groups. IO detection/registration alert itself is Phase 1 (dashboard/M04); M05 starts once the profile says `identifikovana_osoba`.

## 2. User stories

- **P4 (IO):** "On 3 Sept a Booking invoice arrives. In the Přehled I see *'Přiznání k DPH za září: 2 425 Kč, do 26. 10.'*; I open the preview, see row 5 with the Booking invoice and row 12 with Cloudflare converted at the ČNB rate, download the XML and follow 6 steps on MOJE daně."
- **P4:** "My August numbers match the return I already filed (I uploaded its PDF), so the app marks August as filed, not as a new task."
- **P1 (IO, paušální daň):** "I bought Figma (US) and Canva (AU) this month; the app files rows 12 for me. In months without foreign invoices I see *'V říjnu nic nepodáváte'*."
- **P3 (payer, quarterly):** "My Q3 is simple: domestic sales, EU SaaS, two invoices over 10 000 Kč. I get DPHDP3 + KH + SH in one ZIP and an XLSX for my accountant. If the quarter contains a §92a invoice, I get only the workbook and the sentence why."
- **P3:** "A supplier credit note for June arrived in August. The app tells me this needs my accountant (credit note for a prior period)."
- **Any:** "After I filed, I corrected a document. The app shows the difference (+1 200 Kč base on row 40), explains *opravné* vs *dodatečné* and prepares the right one."
- **Accountant:** "I open the client's period, see why it was not simple, download the workbook with every ledger entry, FX rate and KH routing, and drill to source PDFs."

## 3. Inputs / outputs

**Inputs**
- `documents` (status `finalized`, bookable classes per 04 §2.1), `document_lines` (`vat_treatment`, `vat_rate_type`, `vat_rate_pct`, `net`, `vat`, `business_share_pct`, `line_type`, `rc_commodity_code`), `document_vat_summary`, `partners` (`dic`, `vat_id`, `country`, `is_vat_payer`), `document_links` (`corrects`, `reported_in`), `validation_results` (open blocking).
- `taxpayer_profiles` (effective-dated: `vat_status`, `vat_period`, `foreign_service_dppd_policy`, `dic`, `fu_code`, `ufo_code`, `main_activity_nace`, `legal_name`, `address`).
- `fx_rates` (ČNB fixing; `rate`, `amount`).
- Rules: `vat.rates`, `vat.kh_document_limit`, `vat.cnb_rate_rule`, `vat.deadline_day`, `vat.simple_period_policy`, `epo.forms`, `epo.dphdp3_row_map`, `epo.kh_routing`, `deadlines.generators` + proposed keys in §5.3.
- `transactions` with `category_code = 'tax_vat_payment'` (VAT payment status only).

**Outputs**
- `vat_ledger_entries` (rebuilt, never hand-edited).
- `filings` rows of type `DPHDP3`, `DPHKH1`, `DPHSHV`, `VAT_WORKBOOK`; `filing_documents`; files under `org/{org_id}/filings/{filing_id}/` (`.xml`, preview `.pdf`, `.xlsx`).
- `obligations` (kinds below), `notifications`, `audit_log` entries.

## 4. Detailed behavior and algorithms

All computation is pure TypeScript in `packages/domain/src/vat/` (no I/O). Money uses the `Money` type (`decimal.js`, `ROUND_HALF_UP` = half away from zero, ADR-007). Functions: `round2(x)`, `round0(x)` (half-up to whole CZK), `ceil0(x)` (sign-preserving: `sign(x) × ceil(|x|)`).

### 4.1 VAT period and `vat_point_date`

`resolveVatPeriod(profile, date)`: IO → calendar month. `platce` → month or quarter from `profile.at(date).vat_period`. KH (FO) follows the return period (CTF §1.3). **SH is always monthly** (monthly is always permitted; quarterly SH for services-only is optional, CTF §3.1) **[verify]**.

`computeVatPointDate(doc, line, profile)` (04 §3.3), evaluated per line treatment:

| Treatment | `vat_point_date` |
|---|---|
| `iss_*` | `doc.duzp` |
| `rcv_domestic_vat` (payer) | `max(doc.duzp, doc.received_date)`. No deferral in V3. |
| `rcv_eu_service_reverse_charge`, `rcv_non_eu_service_reverse_charge` | policy `service_period_end` → `doc.service_period_to` if not null else `doc.issue_date`; policy `issue_date` → `doc.issue_date` |
| `rcv_eu_goods_acquisition` | `min(doc.issue_date, 15th of month after doc.duzp)` |
| others | null (no entry) |

Missing required date → check `S_DATE_MISSING` (not_ready). The resolved date is written to `documents.vat_point_date` (if a document mixes treatments with different dates, the earliest is written there; the ledger keeps per-entry dates).

### 4.2 VAT ledger builder (`buildVatLedgerEntries`)

Pure function. M04's job `ledger.rebuild_document` (03 §3.1) calls it for one document at a time and deletes/re-inserts that document's entries with a new `build_version`. Inputs: the document (status `ready` or `finalized`, `deleted_at is null`, class bookable; filings additionally require every document of the period to be `finalized`, check `S_PENDING_DOCUMENTS`), its lines, VAT recap, partner, profile at each `vat_point_date`, rules.

1. Skip if `documents.business_flag = 'personal'`. Skip lines with `line_type = 'text'` or `business_share_pct = 0`.
2. Determine `status = profile.at(vat_point_date).vat_status`. If `neplatce` → no entries (the IO alert is Phase 1's job).
3. **Group** lines by `(vat_treatment, vat_rate_type)`. One entry per group (`line_id = null`). Rationale: KH rows and FX conversion are per document × rate; per-line conversion drifts.
4. **Sign:** credit notes are stored with negative amounts (04 §3, normalized by M02), so their entries are negative without any flip here. A positive amount on a credit note is a bug (M03 math rules catch it), not something to repair silently.
5. **Rate:** `vat_rate_pct = rules.at(vat_point_date).vat.rates[vat_rate_type]`. For self-assessed treatments `vat_rate_type` must be `standard` or `reduced`; `none`/`zero` → check `S_SELF_ASSESSED_RATE_UNKNOWN`.
6. **Base and tax in CZK**
   - CZK document, domestic treatments (`iss_domestic_vat`, `rcv_domestic_vat`): if every line of that rate bucket has the same treatment, take `base`/`vat` from `document_vat_summary` (supplier recap is authoritative, ADR-007); otherwise check `S_MIXED_TREATMENT_SAME_RATE`.
   - Foreign currency (any treatment): `fx = fxRateFor(currency, vat_point_date)` per `vat.cnb_rate_rule` = the ČNB rate with `rate_date = vat_point_date`, else the latest `rate_date < vat_point_date` (never later). `base_czk = round2(Σ net_foreign × fx.rate / fx.amount)`. If no rate exists within `fx.max_lookback_days` (7) before → check `S_FX_MISSING`. **The supplier's printed rate is never used for self-assessment.**
   - Self-assessed treatments: `vat_czk = round2(base_czk × vat_rate_pct / 100)`.
   - Issued EU/non-EU treatments (`iss_eu_service`, `iss_eu_goods`, `iss_non_eu_service`): `vat_czk = 0`.
7. **Rows:** `dphdp3_rows` from `epo.dphdp3_row_map` (§4.6) by `(treatment, rate_type, status)`. For `platce`, self-assessed entries also carry the deduction row (`'5'` → `{'5','43'}`). For IO no deduction row.
8. **KH section** (payers only; IO → null), from `epo.kh_routing` (CTF §1.3.1):
   ```
   docTotal = |documents.total_gross converted to CZK|   // whole document incl. VAT, all lines
   iss_domestic_vat:  partner.dic startsWith 'CZ' && docTotal > kh_document_limit ? 'A4' : 'A5'
   self-assessed (rcv_eu_service_*, rcv_non_eu_service_*, rcv_eu_goods_acquisition): 'A2'
   rcv_domestic_vat:  partner.dic startsWith 'CZ' && docTotal > kh_document_limit
                        && tax_doc_status = 'full_tax_document' ? 'B2' : 'B3'
   iss_eu_*, iss_non_eu_service: null
   ```
   Boundary: `> 10 000.00` (strict). Credit notes are tested on the absolute value (CTF §1.3.1).
9. **SH code** (`vat_ledger_entries.shv_code`, 05 §7): `iss_eu_goods` → 0; `iss_eu_service` → 3; IO only: `iss_no_vat` where partner country ∈ `vat.eu_member_states`, partner `vat_id` present and VIES-valid, category `income_services` → 3 (04 §3.2; IO files SH, CTF §3.2). IO §9(1) supplies get **no** DPHDP3 row **[verify]**.
10. `counterparty_vat_id`: payers' CZ partners → `partner.dic`; foreign → `partner.vat_id`. `evidence_number = trim(documents.document_number)` (max 60 chars, exact as printed; KH pairing key, CTF §1.3).
11. `period_start/period_end` from §4.1 using the entry's `vat_point_date`.

Rebuild triggers: document finalized, new revision, deleted/restored, partner DIČ/VAT ID change, profile change (rebuild all entries from `valid_from`), `fx_rates` backfill for a date with an `S_FX_MISSING` document. After rebuild → `vat.period.evaluate` for affected periods, and `vat.amendment.detect` if the period has a non-superseded generated/filed filing.

### 4.3 Simple-period classifier (`classifyPeriod`)

Input: org, filing family (`DPHDP3` for IO; `DPHDP3`+`DPHKH1`+`DPHSHV` for payers), period, ledger entries, all documents whose `coalesce(vat_point_date, duzp, issue_date)` falls in the period, profile history, open validations, rule `vat.simple_period_policy`.

Output (`SimpleCheckResult`, stored verbatim in `filings.simple_check`):
```ts
{ verdict: 'simple' | 'not_ready' | 'needs_accountant' | 'nothing_to_file',
  checks: Array<{ code: SimpleCheckCode; outcome: 'pass' | 'not_ready' | 'needs_accountant';
                  documentIds: string[]; params: Record<string, string | number> }>,
  policyVersion: string, rulesDate: string, evaluatedAt: string }
```
`verdict` = `needs_accountant` if any check is `needs_accountant`; else `not_ready` if any is `not_ready`; else `nothing_to_file` if IO and no entry with `dphdp3_rows ∩ {3..13}` and no SH entry; else `simple`. **`not_ready` is fixable by the user in the app; `needs_accountant` is not.** All checks always run (the user sees every reason at once).

| Code | Condition | Outcome |
|---|---|---|
| `S_PROFILE_UNSUPPORTED` | status not in (`platce`, `identifikovana_osoba`), or `entity_type ≠ 'osvc'` | needs_accountant |
| `S_PROFILE_CHANGED_IN_PERIOD` | `vat_status` or `vat_period` differs between two profile versions overlapping the period | needs_accountant |
| `S_ENTRY_BEFORE_STATUS` | a VAT-relevant document's `vat_point_date` precedes the earliest profile with an IO/payer status | not_ready (fix the profile date) |
| `S_TREATMENT_NOT_ALLOWED` | an entry's treatment not in `allowed_treatments[status]` | needs_accountant |
| `S_RC_COMMODITY` | any line with `rc_commodity_code` not null | needs_accountant |
| `S_FORBIDDEN_CLASS` | document class in `forbid_document_classes` (default `received_advance_tax_doc`) or a line type in `forbid_line_types` (default `advance_deduction`) | needs_accountant |
| `S_EU_GOODS_MULTI_RATE` | an `rcv_eu_goods_acquisition` document has > `max_rates_per_eu_goods_document` rates | needs_accountant |
| `S_PRIOR_PERIOD_CREDIT_NOTE` | a credit note in the period `corrects` a document whose `vat_point_date` is in an earlier period | needs_accountant |
| `S_PARTIAL_SHARE_DEDUCTION` | payer: `rcv_domestic_vat` or self-assessed line with `0 < business_share_pct < 100` (§75 partial deduction) | needs_accountant |
| `S_PLATFORM_INCOME_PAYER` | payer: a `platform_statement` line with `taxable_income` category and no linked `issued_invoice` | needs_accountant |
| `S_IO_OUTPUT_VAT` | IO: any `iss_domestic_vat`/`iss_eu_*`/`iss_non_eu_service` line | needs_accountant |
| `S_MAX_DOCS` | VAT-relevant documents in period > `max_docs` (150) | needs_accountant |
| `S_PENDING_DOCUMENTS` | documents in the period with status not in (`finalized`,`supporting`,`duplicate`) and class bookable | not_ready |
| `S_BLOCKING_VALIDATION` | open `validation_results` with `severity='blocking'` on a document in the period | not_ready |
| `S_BUSINESS_FLAG_UNKNOWN` | VAT-relevant document with `business_flag = 'unknown'` | not_ready |
| `S_FX_MISSING` | §4.2 step 6 | not_ready (auto-resolves when rates arrive) |
| `S_DATE_MISSING`, `S_SELF_ASSESSED_RATE_UNKNOWN`, `S_MIXED_TREATMENT_SAME_RATE` | §4.1, §4.2 | not_ready |
| `S_KH_DIC_MISSING` | payer: A4/B2 candidate whose partner has no CZ DIČ although the document shows one, or `rcv_domestic_vat` with supplier DIČ missing | not_ready |
| `S_KH_EVIDENCE_NUMBER_MISSING` | A2/A4/B2 entry with empty `evidence_number` | not_ready |
| `S_DOMESTIC_NOT_TAX_DOC` | `rcv_domestic_vat` on a document with `tax_doc_status` not in (`full_tax_document`,`simplified_tax_document`) | not_ready |
| `S_SH_VAT_ID_INVALID` | SH entry whose partner `vat_id` is missing or VIES-invalid at the last check | not_ready |

Missing **buyer** DIČ on a foreign invoice (golden: Booking August) is a warning from M03 and does **not** fail any check; the preview shows it as information.

Default policy value (data, `packages/domain/rules/cz/2026.ts`):
```ts
'vat.simple_period_policy': {
  version: '2026.1',
  allowed_treatments: {
    identifikovana_osoba: ['rcv_eu_service_reverse_charge','rcv_non_eu_service_reverse_charge',
      'rcv_domestic_vat','rcv_domestic_no_vat','rcv_foreign_vat_charged','rcv_out_of_scope','iss_no_vat'],
    platce: ['iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service','iss_no_vat',
      'rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
      'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_foreign_vat_charged','rcv_out_of_scope'] },
  forbid_document_classes: ['received_advance_tax_doc'],
  forbid_line_types: ['advance_deduction'],
  max_docs: 150, max_rates_per_eu_goods_document: 1,
  allow_partial_business_share_on_deduction: false, allow_prior_period_credit_notes: false }
```
IO `rcv_eu_goods_acquisition` is deliberately **not** allowed (326 000 Kč threshold tracking → accountant; 04 §3.2 ⚠️). `rcv_domestic_vat` is allowed for IO but produces no row (VAT is a cost).

When the verdict is `not_ready` or `needs_accountant`, the user can always download the **VAT workbook** (§4.10). Filing XML is never generated unless the verdict is `simple` at generation time **and** re-checked at download time (if it changed, the download is refused and the card refreshes).

### 4.4 DPHDP3 computation (`computeDphdp3`)

1. Select entries of the period (all entries with non-empty `dphdp3_rows`).
2. For each **source row** in `epo.dphdp3_row_map` (`kind: 'source'`): `base_raw = Σ base_czk`, `tax_raw = Σ vat_czk` over entries whose `dphdp3_rows` contains the row.
3. **Rounding** (rule `vat.return_rounding`, default `sum_entries_then_round`, decision D-11): `base = round0(base_raw)`, `tax = round0(tax_raw)`. Alternative value `round_base_then_multiply`: `tax = round0(base × pct / 100)` (rate from the row map). The default keeps KH (haléře) and DPHDP3 consistent **[verify with advisor]**.
4. **Derived rows** (`kind: 'derived'`), in map order, using already-rounded row values (payers only unless stated):
   - ř. 43 base = ř.3 + ř.5 + ř.12 base; ř. 43 deduction (full column) = ř.3 + ř.5 + ř.12 tax. ř. 44 likewise from ř. 4, 6, 13. (Full deduction right assumed in a simple period → net zero, CTF §2 notes.)
   - ř. 46 full column = ř.40 + ř.41 + ř.43 + ř.44 deduction. Reduced column (`odp_sum_kr`) is not emitted (no coefficient).
   - ř. 62 = Σ tax of ř. 1, 2, 3, 4, 5, 6, 12, 13 (IO: 3–13 only).
   - ř. 63 = ř. 46 (IO: 0). Formula per CTF §2 ("ř. 63 = ř. 46 + 52 + 53 + 60") with 52/53/60 out of scope **[verify]**.
   - ř. 64 `dano_da` = max(0, ř.62 − ř.63); ř. 65 `dano_no` = max(0, ř.63 − ř.62).
5. Header (§4.7): `trans = 'A'` if ř.62 ≠ 0 or any row 20/21/26 ≠ 0, else `'N'` **[verify semantics]**.
6. Payer with no entries: still a return (payers file every period); all rows 0, `trans='N'`, Veta6 emitted with `dano_da="0"` **[verify nil-return form]**. IO with no entries: `nothing_to_file` (no filing, no obligation).

### 4.5 DPHKH1 and DPHSHV computation

**KH** (`computeKh`, payers only):
- `A2`: one row per (document, rate bucket grouped into attrs 1/2): `k_stat` = 2-letter prefix of `counterparty_vat_id` (Greece `EL`) else `partner.country`; `vatid_dod` = VAT ID without prefix or empty; `c_evid_dd`; `dppd` = entry `vat_point_date`; `zakl_dane1/dan1` (standard), `zakl_dane2/dan2` (reduced), 2 decimals.
- `A4`: per document: `dic_odb` (digits only), `c_evid_dd`, `dppd` = `duzp`, `zakl_dane1..2`, `dan1..2`, `kod_rezim_pl="0"`, `zdph_44="N"`.
- `B2`: per document: `dic_dod`, `c_evid_dd`, `dppd` = `duzp`, `zakl_dane1..2`, `dan1..2`, `pomer="N"`, `zdph_44="N"`.
- `A5`, `B3`: one aggregate row each (Σ of entries), omitted if all zero.
- `c_radku`: 1-based sequence per Věta after sorting by (`dppd`, `c_evid_dd`, `dic`) **[verify format]**.
- **Věta C** = the corresponding **DPHDP3 values** (whole CZK): `obrat23`=ř.1 base, `obrat5`=ř.2 base, `pln23`=ř.40 base, `pln5`=ř.41 base, `celk_zd_a2`=ř.3+4+5+6+12+13 bases; `pln_rez_pren`, `rez_pren23`, `rez_pren5` = 0 (omitted). Whether Věta C should carry KH sums instead is **[verify]** (CTF §1.3 marks the mapping [I]).

**SH** (`computeShv`): group SH entries of the **calendar month** by (`k_stat`, `c_vat`, `k_pln_eu`): `pln_hodnota = ceil0(Σ base_czk)` (rule `vat.shv_rounding`, CTF §1.4 "rounded up"; credit notes negative) **[verify]**, `pln_pocet` = number of distinct documents, `c_rad` 1-based, `por_c_stran = 1` **[verify]**.

### 4.6 Rule `epo.dphdp3_row_map` (table-driven builder)

Zod: `{ row: string; veta: 'Veta1'|'Veta2'|'Veta4'|'Veta6'; kind: 'source'|'derived'; side: 'output'|'input'|'result'; attrs: { base?: string; tax?: string; tax_full?: string; tax_reduced?: string; value?: string }; treatments?: VatTreatment[]; rate?: 'standard'|'reduced'|'any'; statuses: VatStatus[]; deduction_row?: string; formula?: { op: 'sum_base_tax'|'sum_tax'|'copy'|'max0_diff'; from: string[] }; confirmed: boolean }`.

| Row | Věta | Attrs (base / tax) | Treatments | Rate | Statuses | Source |
|---|---|---|---|---|---|---|
| 1 | Veta1 | `obrat23` / `dan23` | `iss_domestic_vat` | standard | P | CTF §2 [O] |
| 2 | Veta1 | `obrat5` / `dan5` | `iss_domestic_vat` | reduced | P | [O] |
| 3 | Veta1 | `p_zb23` / `dan_pzb23` | `rcv_eu_goods_acquisition` | standard | P (→43) | [O] |
| 4 | Veta1 | `p_zb5` / `dan_pzb5` | `rcv_eu_goods_acquisition` | reduced | P (→44) | [O] |
| 5 | Veta1 | `p_sl23_e` / `dan_psl23_e` | `rcv_eu_service_reverse_charge` | standard | P (→43), I | [O] |
| 6 | Veta1 | `p_sl5_e` / `dan_psl5_e` | `rcv_eu_service_reverse_charge` | reduced | P (→44), I | [O] |
| 12 | Veta1 | `p_sl23_z` / `dan_psl23_z` | `rcv_non_eu_service_reverse_charge` | standard | P (→43), I | [O] |
| 13 | Veta1 | `p_sl5_z` / `dan_psl5_z` | `rcv_non_eu_service_reverse_charge` | reduced | P (→44), I | [O] |
| 20 | Veta2 | `dod_zb` | `iss_eu_goods` | any | P | [O] |
| 21 | Veta2 | `pln_sluzby` | `iss_eu_service` | any | P | [O] |
| 26 | Veta2 | `pln_ost` | `iss_non_eu_service` | any | P | [O] |
| 40 | Veta4 | `pln23` / `odp_tuz23_nar` (full); `odp_tuz23` (reduced, unused) | `rcv_domestic_vat` | standard | P | **[verify against XSD]** |
| 41 | Veta4 | `pln5` / `odp_tuz5_nar`; `odp_tuz5` unused | `rcv_domestic_vat` | reduced | P | **[verify against XSD]** |
| 43 | Veta4 | `nar_zdp23` / `od_zdp23`; `odkr_zdp23` unused | derived Σ 3,5,12 | — | P | [O] |
| 44 | Veta4 | `nar_zdp5` / `od_zdp5`; `odkr_zdp5` unused | derived Σ 4,6,13 | — | P | [O]/**[verify]** |
| 46 | Veta4 | `odp_sum_nar`; `odp_sum_kr` unused | derived Σ tax 40,41,43,44 | — | P | **[verify against XSD]** |
| 62 | Veta6 | `dan_zocelk` | derived | — | P, I | **[verify against XSD]** |
| 63 | Veta6 | `odp_zocelk` | derived | — | P | **[verify against XSD]** |
| 64 | Veta6 | `dano_da` | derived | — | P, I | **[verify against XSD]** |
| 65 | Veta6 | `dano_no` | derived | — | P | **[verify against XSD]** |

`side` (rows 1–13, 20–26 `output`; 40–47 `input`; 62–66 `result`) replaces M09's former `epo.dphdp3_row_sides` key; M09's VAT estimate sums by `side` (T-02 confirms the list). A CI test parses the vendored XSD and asserts every attribute in the map exists on the stated Věta; `confirmed:false` rows block release until verified. An XSD bump only edits this data (06 §7 `epo-version-bump.md`).

### 4.7 XML structure and header mapping

Common rules (CTF §1.1): UTF-8 with declaration; dot decimal separator; dates `DD.MM.YYYY`; **DPHDP3 amounts as integers**, **KH amounts with 2 decimals**, **SH `pln_hodnota` integer**; DIČ digits only (`[0-9]{1,10}`, no `CZ`, keep leading zeros); attributes with value 0 or empty are **omitted** (a Věta with no attributes is omitted, except VetaD/VetaP and DPHDP3 Veta6) **[verify omission vs "0"]**; elements in XSD sequence order; attributes in a fixed order (row-map order) so output is byte-deterministic.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Pisemnost nazevSW="Shoebox" verzeSW="{app version}">              <!-- root attrs [verify against XSD] -->
  <DPHDP3 verzePis="{epo.forms.DPHDP3.verze_pis}">                   <!-- verzePis [verify against XSD] -->
    <VetaD .../> <VetaP .../> <Veta1 .../> <Veta2 .../> <Veta4 .../> <Veta6 .../>
  </DPHDP3>
</Pisemnost>
```
DPHKH1 children: `VetaD, VetaP, VetaA2*, VetaA4*, VetaA5?, VetaB2*, VetaB3?, VetaC?` (CTF §1.3). DPHSHV children: `VetaD, VetaP, VetaR*` (CTF §1.4).

**VetaD (DPHDP3)**

| Attr | Source | Status |
|---|---|---|
| `dokument` | `'DP3'` | [O] |
| `k_uladis` | `'DPH'` | [O] |
| `dapdph_forma` | `filings.kind`: `radne`→`B`, `opravne`→`O`, `dodatecne`→`D` | [O] |
| `typ_platce` | `platce`→`P`, `identifikovana_osoba`→`I` | [O] |
| `rok` | period year | [O] |
| `mesic` / `ctvrt` | monthly → `mesic` 1–12; quarterly → `ctvrt` 1–4 (never both) | [O] |
| `trans` | §4.4 step 5 | [O] name, **[verify]** semantics |
| `c_okec` | `profile.main_activity_nace` normalised to 6 digits (right-pad with `0`); if absent, ask once in the generation dialog and save to the profile | [O] name, **[verify]** padding and whether required for IO |
| `d_poddp` | generation date (Europe/Prague) | [O] |
| `d_zjist` | `dodatecne` only: date grounds were found (user input, default today) | [O] |
| `kod_zo`, `zdobd_od/do`, `d_por_dod` | never emitted | [O] |

**VetaD (DPHKH1):** `dokument='KH1'`, `k_uladis='DPH'`, `rok`, `mesic`|`ctvrt`, `khdph_forma` (`radne`→`B`, `opravne`→`O`, `nasledne`→`N`), `d_poddp`, `d_zjist` (N only) — all [O]. `vyzva_odp`, `c_jed_vyzvy`, `zdobd_*` not emitted.
**VetaD (DPHSHV):** `dokument='SHV'`, `k_uladis='DPH'`, `shvies_forma` (`radne`→`R`, `nasledne`→`N`), `rok`, `mesic`, `d_poddp` — [O]. Legacy `pln_poc_celk`, `poc_radku`, `poc_stran`, `suma_pln` not emitted.

**VetaP (all three forms)**

| Attr | Source | Status |
|---|---|---|
| `c_ufo` | `profile.fu_code` (3 digits, finanční úřad) | [O] |
| `c_pracufo` | `profile.ufo_code` (4 digits, územní pracoviště) | [O] |
| `dic` | `profile.dic` without `CZ` | [O] |
| `typ_ds` | `'F'` (natural person) | [O] |
| `jmeno`, `prijmeni`, `titul` | proposed profile columns `first_name`, `last_name`, `title` (§5.2) | **[verify against XSD]** |
| `ulice`, `c_pop`, `c_orient`, `naz_obce`, `psc`, `stat` | `address.street`, `address.house_number`, `address.orientation_number`, `address.city`, `address.zip` (digits), `'ČESKÁ REPUBLIKA'` | **[verify against XSD]** (names from CTF skeleton, [I]) |
| `email`, `c_telef` | proposed `filing_email`, `filing_phone` (default owner's e-mail) | [O] names |
| `zast_*`, `sest_*`, `opr_*`, `dodobchjm` | not emitted (the taxpayer files personally) | [O] names |

Missing VetaP data → generation dialog asks for it once and stores it on the profile (new profile version not required; these are non-tax attributes, updated in place with audit).

### 4.8 XSD validation

- Vendored at `packages/tax-xml/xsd/{FORM}/{version}/` with all included/imported XSDs and `manifest.json` `{ form, version, verze_pis, source_url, sha256, fetched_at, valid_for_periods_from }`. `epo.forms` selects the version by **period start** (not by today).
- `validateXml(xml, form, version)`: write to a temp file, run `xmllint --noout --nonet --schema <main.xsd> <file>` (timeout 10 s), parse stderr lines `file:line: element X: Schemas validity error : …` into `xsd_errors: [{line, element, message}]`.
- Invalid → `filings.state` stays `draft`, `xsd_valid=false`, errors saved, **no XML download for users** (admin only), maintainer alert (Sentry `tax_xml_invalid`), user copy `vat.filing.error.xsd`. Also run on every golden fixture in CI.
- Business validations after XSD (fail = maintainer bug, same handling): §4.11 properties P1–P6.

### 4.9 Human preview and preview PDF

`getPeriodPreview(orgId, type, periodStart)` returns rows with Czech labels (`vat.row.{n}.label`), base, tax, and per row the contributing ledger entries `{documentId, partnerName, documentNumber, vatPointDate, currency, amountForeign, fxRate, fxRateDate, baseCzk, vatCzk}`. KH preview groups by section; SH by country/VAT ID. Each entry links to the document viewer. Rounding is shown explicitly ("13 699,77 Kč → zaokrouhleno 13 700 Kč"). The preview PDF (`pdf_path`, react-pdf) is the same content plus the simple-check summary; it is **not** the official form.

### 4.10 VAT workbook (`VAT_WORKBOOK`)

XLSX (exceljs) generated for any period on demand and automatically when the verdict is `needs_accountant`. Sheets: `Souhrn` (period, profile, verdict, reasons with document links, provisional row totals labelled "Neověřený výpočet"), `Evidence DPH` (one row per ledger entry: document number, partner, DIČ/VAT ID, country, dates issue/DUZP/received/vat_point_date, treatment, rate, currency, foreign amount, ČNB rate + date, base CZK, VAT CZK, DPHDP3 rows, KH section, SH code), `Doklady k řešení` (failed checks), `Kurzy ČNB`. Stored as a `filings` row `type='VAT_WORKBOOK'`, `state='generated'` (no XML, no lifecycle beyond downloaded).

### 4.11 Filing lifecycle

States (`filing_state`): `draft` (computed, simple-check stored, not validated) → `generated` (XML built, XSD-valid, snapshot written) → `downloaded` (first download of XML or ZIP) → `marked_filed` (user confirms "Mám podáno", with `filed_on` date and optional podací číslo) ; `superseded` (see below).

- **Generate** (`vat.filing.generate`): recompute in one DB transaction: classifier → computation → XML → XSD → write files → insert `filing_documents (document_id, document_revision)` and proposed `filing_entries` (entry-level snapshot) → `totals` = `{ rows: {"5": {"base": 13700, "tax": 2877}, …}, kh: {...}, shv: [...] }` → state `generated`. Idempotency key `{org}:{type}:{period_start}:{kind}:{ledger_build_hash}`; same hash → return the existing filing.
- For payers, DPHDP3 + DPHKH1 (+ DPHSHV for each month of the period with SH entries) are generated together as a **bundle** (same `generated_at`); KH and DP3 must both be XSD-valid or neither becomes `generated`. Download offers a ZIP and single files.
- **Regenerate before filing:** any open filing (`draft|generated|downloaded`) for the same `(type, period_start, kind)` → `superseded`; new row created.
- **Mark filed:** allowed from `generated|downloaded`. Sets `marked_filed_at`, `filed_on`, `submission_ref`, obligation → `done`. If the filing is `opravne`, the filing it amends → `superseded`. Finalized documents in the snapshot become retention-locked (10 years, 02 guardrails).
- **Imported filed return:** a `government_filing` document whose extracted fields (M02 `filing` profile, keys of 04 §9.4: `filing.form_code`, `filing.period_start`, `filing.kind`, `filing.filer_dic`, `filing.rows.{row}.base|tax`) identify a DPHDP3 for this org creates a `filings` row with `origin='imported'`, `state='marked_filed'`, `totals` from those fields, link `reported_in` from each ledger document of the period. If our computation equals the imported totals → card "Sedí s vaším podaným přiznáním"; otherwise → amendment flow.

**Amendment detection** (`vat.amendment.detect`, after any ledger rebuild of a period with a `marked_filed` filing): compute the new snapshot and `diffFilings(filed, next)`:
```ts
type FilingDiff = { rows: Array<{row: string; attr: string; filed: number; now: number; delta: number}>;
  documents: { added: string[]; removed: string[]; changed: Array<{documentId: string; fromRevision: number; toRevision: number}> };
  kh: { added: KhRowKey[]; removed: KhRowKey[]; changed: KhRowKey[] }; shv: { changed: ShvKey[] } }
```
Empty diff → nothing. Otherwise notification `vat.amendment_needed` and an obligation (below). The kind is proposed by `chooseAmendmentKind(filed, today, rules)`:

| Filed form | today ≤ original deadline | today > original deadline |
|---|---|---|
| DPHDP3 | `opravne` (`O`): full corrected values, replaces the original | `dodatecne` (`D`): full corrected values + `d_zjist`; ř. 66 (`dano`) = new ř.64 − ř.65 minus last known (ř.64 − ř.65) **[verify attribute and sign]**; due end of the month after `d_zjist` (rule `vat.amendment_windows`) **[verify]** |
| DPHKH1 | `opravne` (`O`), full content | `nasledne` (`N`), full content **[verify full vs delta]**, `d_zjist`; due 5 working days after discovery (CTF §1.3) |
| DPHSHV | `radne` regenerated (replace) **[verify]** | `nasledne` (`N`): per changed group a storno row (`k_storno="A"`, original values) + a new row **[verify]** |

`dodatecne` is only allowed when the classifier verdict for the new state is `simple`; otherwise workbook + "needs accountant". Amending an amendment that is itself `dodatecne` → needs_accountant (form `E` not supported).

### 4.12 Obligations (generator definitions; M09's daily obligations job runs them)

M05 exports `vatObligationsFor(org, profileHistory, ledgerSummary, filings, today, rules): ObligationDraft[]` (pure); M09's `obligations.generate` (nightly fan-out 02:15 Europe/Prague and debounced on events, M09 §4.7) upserts the result; M05 never writes `obligations` itself. The entries in `deadlines.generators` with `kind ∈ {vat_return, kh, sh, vat_payment, vat_amendment, kh_nasledne}` point to it.

Due date rule `25th_after_period`: day `vat.deadline_day` of the month after `period_end`; if Saturday/Sunday/holiday (`calendar.cz_public_holidays`) → next working day (CTF §3.1). Upsert on `(org_id, kind, period_start)`; `source_rule` = generator id.

| Kind | Who | Created when | `amount_estimate` | Done when |
|---|---|---|---|---|
| `vat_return` | payer: every period; IO: periods with ≥ 1 entry on rows 3–13 | period end (payer) / first entry (IO) | ř.64 (− ř.65 as negative) | DPHDP3 `marked_filed` |
| `kh` | payer | period end | — | DPHDP3 bundle KH `marked_filed` |
| `sh` | payer or IO with SH entries in the month | first SH entry | Σ `pln_hodnota` | SH `marked_filed` |
| `vat_payment` | where ř.64 > 0 | DPHDP3 `generated` | ř.64 | Σ matched `tax_vat_payment` transactions booked in `(period_end, due_date + 30 d]` ≥ amount (M07 match; VS = DIČ digits) |
| `vat_amendment` / `kh_nasledne` | §4.11 | diff detected | Δ ř.64 | amendment `marked_filed` |

`state='overdue'` when `due_date < today` and not done (daily). An IO month whose deadline passed without filing still gets a `radne` filing (late) and the warning `vat.late_filing` (penalty info: CTF §1.3 for KH; DPHDP3 late-filing penalty **[verify]**).

### 4.13 Submission (user does it; no automation)

The success screen after "Stáhnout" shows a 6-step guide (`vat.submit.steps.*`), two channels (CTF §1.6):
1. **MOJE daně / EPO:** open `mojedane.gov.cz` → Elektronické formuláře → "Načíst ze souboru" (DPHDP3, then KH, then SH) → "Kontrola" → "Podat" with Identita občana (bank identity, eObčanka) or without signature as EPO allows → save the receipt (podací číslo). UI labels **[verify]**; the guide carries a `verified_at` date and a link to the official help.
2. **Datová schránka:** send the XML files as attachments to the FÚ's data box; no electronic signature needed.
Then: pay the tax (account prefix 705 of the user's FÚ, VS = DIČ digits, CTF §3.1 [I] **[verify]**; a SPAYD QR is shown only when rule `epo.fu_payment_accounts` has the account for `c_ufo`), and tap **"Mám podáno"**. Never: EPO machine submission, `test=1` dry-run (needs a qualified signature), ISDS API.

## 5. Data

### 5.1 Read / written

| Table | R/W | Columns |
|---|---|---|
| `documents` | R, W(`vat_point_date`) | `class`, `status`, `direction`, `tax_doc_status`, `partner_id`, `document_number`, `issue_date`, `duzp`, `received_date`, `service_period_from/to`, `currency`, `total_gross`, `business_flag`, `revision`, `deleted_at` |
| `document_lines`, `document_vat_summary`, `partners`, `document_links`, `validation_results`, `taxpayer_profiles`, `fx_rates`, `transactions` | R | as listed in §3 |
| `vat_ledger_entries` | W (via M04's job, using M05 functions); R | all columns |
| `filings`, `filing_documents` | W | all columns |
| `obligations`, `notifications`, `audit_log` | W | |

### 5.2 Schema
Merged into 05 on 2026-10-18; see 05 §7 `vat_ledger_entries` (shv_code, FX columns, kh_document_total_czk), 05 §8 `filings` (origin, source_document_id, filed_on, submission_ref, discovered_on, bundle_id, `filings_one_open_per_kind`) and `filing_entries`, 05 §2 `taxpayer_profiles` (first_name, last_name, title, filing_email, filing_phone; address with house and orientation numbers). Obligation kinds `vat_payment`, `vat_amendment`, `kh_nasledne`: 04 §9.2.

### 5.3 Rule keys
Merged into 06 §2.1 on 2026-10-18 (`vat.return_rounding`, `vat.shv_rounding`, `vat.eu_member_states`, `vat.amendment_windows`, `calendar.cz_public_holidays`, `epo.fu_payment_accounts`, `epo.forms` with `verze_pis` and `valid_for_periods_from`, `epo.dphdp3_row_map` with `side`, `epo.kh_routing`).

## 6. Interfaces

```ts
// packages/domain/src/vat/index.ts  (pure)
export type IsoDate = string;
export interface VatPeriod { start: IsoDate; end: IsoDate; kind: 'month' | 'quarter'; year: number; month?: number; quarter?: number }
export function resolveVatPeriod(profile: TaxpayerProfile, date: IsoDate): VatPeriod;
export function computeVatPointDate(doc: VatDocument, treatment: VatTreatment, profile: TaxpayerProfile): IsoDate | null;
export function fxRateFor(rates: FxRateLookup, currency: string, date: IsoDate, rules: RuleSet): FxRate | null;
export function buildVatLedgerEntries(input: VatLedgerInput, rules: RuleSet): { entries: VatLedgerEntryDraft[]; issues: SimpleCheck[] };
export function classifyPeriod(input: PeriodClassifierInput, rules: RuleSet): SimpleCheckResult;
export function computeDphdp3(entries: VatLedgerEntry[], status: 'platce' | 'identifikovana_osoba', rules: RuleSet): Dphdp3Computation;
export function computeKh(entries: VatLedgerEntry[], dp3: Dphdp3Computation, rules: RuleSet): KhComputation;
export function computeShv(entries: VatLedgerEntry[], rules: RuleSet): ShvComputation;
export function reconcileKhDp3(dp3: Dphdp3Computation, kh: KhComputation): ReconciliationResult; // §9 P1–P5
export function diffFilings(filed: FilingSnapshot, next: FilingSnapshot): FilingDiff;
export function chooseAmendmentKind(filed: FilingSnapshot, today: IsoDate, rules: RuleSet): { kind: FilingKind; dueDate: IsoDate } | { kind: 'needs_accountant'; reason: string };
export function vatDueDate(periodEnd: IsoDate, rules: RuleSet): IsoDate;

// packages/tax-xml/src/index.ts
export interface EpoHeader { form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; kind: FilingKind; period: VatPeriod; status: VatStatus;
  taxpayer: { fuCode: string; ufoCode: string; dicDigits: string; firstName: string; lastName: string; title?: string;
    street?: string; houseNumber?: string; orientationNumber?: string; city: string; zip: string; email?: string; phone?: string };
  naceCode6?: string; preparedOn: IsoDate; discoveredOn?: IsoDate; appVersion: string }
export function serializeDphdp3(c: Dphdp3Computation, h: EpoHeader, rowMap: RowMap): string;
export function serializeKh(c: KhComputation, h: EpoHeader): string;
export function serializeShv(c: ShvComputation, h: EpoHeader): string;
export function validateXml(xml: string, form: EpoForm, version: string): Promise<{ valid: boolean; errors: XsdError[] }>;

// apps/worker/src/vat/service.ts
export function getPeriodPreview(orgId: string, type: 'DPHDP3' | 'DPHKH1' | 'DPHSHV', periodStart: IsoDate): Promise<PeriodPreview>;
export function generateFilingBundle(orgId: string, req: GenerateFilingRequest, userId: string): Promise<{ bundleId: string; filingIds: string[] }>;
export function generateVatWorkbook(orgId: string, periodStart: IsoDate, userId: string): Promise<string /* filingId */>;
export function markFiled(orgId: string, filingId: string, input: { filedOn: IsoDate; submissionRef?: string }, userId: string): Promise<void>;
```

**Jobs (pg-boss, zod payloads, idempotency key per ADR-003)**
```ts
// owned by M04 (listed for the contract; M05 requires these reasons to exist and to enqueue vat.period.evaluate afterwards)
'ledger.rebuild_document' and 'ledger.rebuild_org' — payloads and reasons as in M04 §6.3 (reasons include 'deleted', 'partner_changed', 'fx_imported', 'profile_changed')
// owned by M05
'vat.period.evaluate':         z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), family: z.enum(['IO','PAYER']) })
'vat.filing.generate':         z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), kind: z.enum(['radne','opravne','dodatecne','nasledne']), amendsFilingId: z.string().uuid().optional(), discoveredOn: z.string().date().optional(), requestedBy: z.string().uuid() })
'vat.workbook.generate':       z.object({ orgId: z.string().uuid(), periodStart: z.string().date(), requestedBy: z.string().uuid().optional() })
'vat.amendment.detect':        z.object({ orgId: z.string().uuid(), periodStart: z.string().date() })
```
(No own cron: obligations run inside M09's daily job via `vatObligationsFor`.)
Failures: retry ×3 with exponential backoff; xmllint/XSD failure is **not** retried (deterministic) → dead-letter + alert.

**API routes** (`/api/v1`, roles: owner/member write; accountant read + workbook + download; viewer read)
- `GET  /vat/periods?year=2026` → list of periods with verdict, totals, obligation status.
- `GET  /vat/periods/{periodStart}/preview?form=DPHDP3|DPHKH1|DPHSHV`
- `POST /vat/periods/{periodStart}/filings` `{kind, discoveredOn?}` → 202 `{bundleId}`
- `POST /vat/periods/{periodStart}/workbook` → 202 `{filingId}`
- `GET  /filings/{id}` · `GET /filings/{id}/download?format=xml|pdf|xlsx|zip` (re-runs classifier; 409 `period_changed` if no longer simple or ledger hash changed)
- `POST /filings/{id}/mark-filed` `{filedOn, submissionRef?}` · `GET /filings/{id}/diff`

**Events / notifications:** M05 emits `filing.state_changed` and `filing.amendment_needed`; M09 turns them into `notifications.kind` (04 §9.3) `filing_ready`, `filing_needs_accountant`, `filing_not_ready`, `amendment_needed`, `filing_matches_filed`; deadline reminders are M09's `deadline_upcoming` / `deadline_today` (no VAT-specific deadline kind). Audit actions: `filing.generated`, `filing.downloaded`, `filing.marked_filed`, `filing.superseded`.

## 7. UX touchpoints

Filings live as cards in **Přehled** (06 §6); preview opens as a full-height sheet, not a new screen. No row numbers on the card; row numbers appear only in the preview (with plain labels). Every filing card, preview and download screen carries the disclaimer `vat.disclaimer` (22 L-02): "Soubor připravujeme z vašich dokladů. Před podáním ho zkontrolujte – podáváte ho vy (nebo vaše účetní)."

| Situation | Card copy (cs, i18n key) |
|---|---|
| simple, IO | `vat.card.ready_io`: "Přiznání k DPH za {month} je připravené. K zaplacení {amount} do {dueDate}." [Zobrazit] [Stáhnout soubor] |
| simple, payer | `vat.card.ready_payer`: "DPH za {period}: přiznání, kontrolní hlášení{shPart} jsou připravené. {payOrRefund}" |
| nothing to file (IO) | `vat.card.nothing_io`: "Za {month} nic nepodáváte – nemáte žádné zahraniční služby." |
| not_ready | `vat.card.not_ready`: "Než přiznání připravíme, zbývá {count, plural, one {# věc} few {# věci} other {# věcí}}." + list of reasons → [Vyřešit] |
| needs_accountant | `vat.card.needs_accountant`: "Za {period} vám přiznání nepřipravíme – je potřeba účetní. Důvod: {reason}." [Stáhnout podklady pro účetní (XLSX)] |
| matches filed | `vat.card.matches_filed`: "Sedí s přiznáním, které jste už podal(a). Označili jsme ho jako podané." |
| amendment | `vat.card.amendment`: "Po podání se změnil {documentLabel}. Rozdíl: {delta} Kč daně. Připravíme {kindLabel} – termín {dueDate}." |

Reason copy examples (`vat.simple.reason.{code}`): `S_RC_COMMODITY` "Doklad {doc} je v režimu přenesení daňové povinnosti v tuzemsku (např. stavební práce)." · `S_PRIOR_PERIOD_CREDIT_NOTE` "Dobropis {doc} opravuje doklad z dřívějšího období." · `S_PARTIAL_SHARE_DEDUCTION` "U dokladu {doc} uplatňujete jen část pro podnikání – odpočet je potřeba krátit." · `S_FX_MISSING` "Čekáme na kurz ČNB ke dni {date}." · `S_KH_DIC_MISSING` "U dokladu {doc} chybí DIČ dodavatele – doplňte ho, jinak doklad nemůže do kontrolního hlášení." · `S_PENDING_DOCUMENTS` "{count} doklady čekají na vaši kontrolu."

Preview row label examples (`vat.row.5.label`): "Služby od plátců z jiných států EU (21 %)"; `vat.row.12.label`: "Služby od firem mimo EU (21 %)"; `vat.row.40.label`: "Nákupy v Česku s DPH – odpočet (21 %)". Drill-down line: "Booking.com B.V. · faktura 1234 · vystavena 3. 9. 2026 · 11 549,94 Kč". FX line: "10,46 USD × kurz ČNB {rate} ({rateDate}) = {czk} Kč".

Mark-filed dialog (`vat.mark_filed.*`): "Kdy jste podali?" [date, default today] · "Podací číslo (nepovinné)". Amendment explainer (`vat.amend.explain.opravne`): "Termín ještě neuplynul – podáte řádné opravné přiznání, které nahradí to původní." / (`.dodatecne`) "Termín už uplynul – podáte dodatečné přiznání. Rozdíl daně doplaťte do {dueDate}."

## 8. Edge cases and failure modes

1. **Booking invoice without buyer DIČ** → included; info line "Na faktuře chybí vaše DIČ – na výpočtu to nic nemění."
2. **Service-period policy change** in the profile → `ledger.rebuild_org` from `valid_from`; filed periods that change → amendment flow (never silent).
3. **FX on a weekend/holiday** → last ČNB rate before; **FX for today before 14:30** → `S_FX_MISSING` until the nightly fetch, then auto-reevaluate.
4. **JPY/HUF** (`fx_rates.amount = 100`) → divide by `amount`.
5. **Credit note same period** → negative entry; KH row on `|total|`; DP3 rows may become negative sums (allowed); a negative ř.62 for IO → needs_accountant **[verify]**.
6. **Two invoices with the same number** from different suppliers → KH rows distinct by DIČ; duplicate number + same supplier is already blocked by `documents_semantic_dedupe`.
7. **Late foreign invoice for a filed IO month** (policy `issue_date` with an old issue date) → amendment (`dodatecne` if after deadline).
8. **Profile becomes payer mid-month** → `S_PROFILE_CHANGED_IN_PERIOD` → workbook.
9. **XSD version not vendored for the period** → generation disabled, card "Formulář pro toto období připravujeme", maintainer alert (drift monitor should have caught it).
10. **Document deleted after filing** → it stays in the snapshot (retention lock); ledger removal → diff → amendment.
11. **User downloads, then edits a document before marking filed** → download endpoint re-checks the ledger hash; the open filing becomes stale (badge "Zastaralé – vytvořte znovu"); mark-filed of a stale filing asks for confirmation and immediately triggers amendment detection.
12. **xmllint missing / crash** → job fails, no partial state, alert; never fall back to "unvalidated".
13. **Rounding to exactly .50** → half away from zero (e.g. 2 425,50 → 2 426).
14. **Accountant role** can download workbook/XML but cannot mark filed.
15. **Very large period** (> `max_docs`) → workbook only (performance and liability).

## 9. Acceptance criteria and test plan

**Golden (P4, `testdata/golden-v1`, profile `identifikovana_osoba`, `foreign_service_dppd_policy = 'issue_date'`)**
1. **August 2026** DPHDP3: verdict `simple`; `typ_platce="I"`, `mesic="8"`, `dapdph_forma="B"`; Veta1 `p_sl23_e="13700"`, `dan_psl23_e="2877"`; Veta6 `dan_zocelk="2877"`, `dano_da="2877"`; no other row attributes; no Veta4; no KH. Entry: Booking July invoice 13 699,77 → `vat_czk` 2 876,95. Equals the imported filed DPHDP3 (decoy) → card `vat.card.matches_filed`, filing `origin='imported'` linked `reported_in`.
2. **September 2026**: row 5 base `11550`, tax `2425` (entry 11 549,94 × 21 % = 2 425,49 → 2 425 under `sum_entries_then_round`; the test also asserts `2426` under `round_base_then_multiply`). Row 12: Cloudflare `base = round0(round2(10.46 × r / amount))`, `tax = round0(round2(base_czk × 0.21))` where `r` = ČNB USD rate for the invoice's `issue_date` (or last before) from the recorded `fx_rates` fixture (illustration only: r = 21.000 → 219,66 → 220; tax 46,13 → 46). ř.62 = row 5 tax + row 12 tax. Property-manager (CZ 21 %) and cleaning invoices produce no rows. Booking missing buyer DIČ does not change the verdict.
3. **October 2026**: row 5 = Anthropic €90: `base = round0(round2(90 × r_EUR))`, `tax = round0(round2(base_czk × 0.21))`, `r_EUR` from the fixture at the invoice `issue_date`.
4. Same data with policy `service_period_end`: July return row 5 = 13 700 / 2 877; August return row 5 = 11 550 / 2 425 (service periods July, August).
5. Decoys (order confirmation, settlement statements, tourist-fee reports, own DPHDP3) create **no** `vat_ledger_entries`; duplicates create none twice.
6. Every generated XML for 1–3 passes the vendored DPHDP3 XSD (`xmllint` exit 0) and byte-matches the golden XML in `testdata/golden-v1/expected/vat/` except `d_poddp`.

**Classifier and routing**
7. Each `S_*` code has a unit test with a minimal failing and passing fixture; verdict precedence `needs_accountant > not_ready > nothing_to_file > simple`.
8. KH boundary: payer, CZ customer with DIČ, gross 10 000,00 → A5; 10 000,01 → A4; supplier gross 10 000,01 without DIČ → `S_KH_DIC_MISSING`; credit note −12 000 → B2 with negative values.
9. IO with `iss_domestic_vat` → `S_IO_OUTPUT_VAT`; IO with EU goods → `S_TREATMENT_NOT_ALLOWED`.
10. FX: rate on Saturday uses Friday's; no rate in the 7-day window → `S_FX_MISSING`.

**Property tests (fast-check, 1 000 runs; generator = random simple payer periods: 0–60 documents of allowed treatments, both rates, CZK/EUR/USD, credit notes in-period, gross around 10 000)**
- **P1** Věta C equals the DP3 values it mirrors (`obrat23`=ř.1 base, …, `celk_zd_a2`=Σ ř.3,4,5,6,12,13 base).
- **P2** `|VetaC.obrat23 − Σ(A4+A5).zakl_dane1| ≤ 0.50`; same for `obrat5` (A4+A5 `zakl_dane2`), `pln23` (B2+B3 `zakl_dane1`), `pln5`.
- **P3** `|celk_zd_a2 − Σ A2 (zakl_dane1+zakl_dane2)| ≤ 0.50 × k`, k = number of non-zero DP3 rows in {3,4,5,6,12,13}.
- **P4** Every entry with `kh_section` appears in exactly one KH row or aggregate; Σ KH bases and taxes (2 dp) = Σ entry `base_czk`, `vat_czk` exactly.
- **P5** ř.43 = ř.3+5+12 (base and tax), ř.44 = ř.4+6+13; ř.64 − ř.65 = ř.62 − ř.63; exactly one of ř.64/ř.65 non-zero (or both zero).
- **P6** IO: no Veta4, no KH, ř.64 = ř.62.
- **P7** Permuting entry order → byte-identical XML. **P8** Splitting a document's lines differently (same per-rate sums) → identical XML.
- **P9** XSD-valid for every generated case.

**Lifecycle**
11. Regenerate before filing supersedes the open filing; unique index holds.
12. Mark filed → obligation `done`; editing an included document → `vat.amendment_needed` with a correct row diff; before deadline proposes `opravne`, after deadline `dodatecne` with `d_zjist`; KH after deadline proposes `nasledne`.
13. Download of a stale filing returns 409 `period_changed`.
14. Obligations: due 25 Oct 2026 is a Sunday → `26.10.2026` (CTF §3.1 quarterly 26. 10. 2026); December 2026 IO return → `25.01.2027`.
15. Workbook for a `needs_accountant` period contains every ledger entry, the reasons and FX rates.

**Test layers:** unit (domain, 100 % branch coverage on routing/rounding), property (above), integration (worker + Postgres + real `xmllint`, golden fixtures, RLS: other org cannot read filings/XML), E2E (Playwright: P4 September — open card → preview drill-down to Cloudflare → download XML → mark filed → edit document → amendment card). Fixtures: `testkit/vat/` factories (`aBookingInvoice()`, `aCloudflareInvoice()`), recorded ČNB rates for Aug–Oct 2026.

## 10. Maintenance

| Source of change | Containment | Monitor | Effort/yr |
|---|---|---|---|
| EPO structures (DPHDP3/DPHKH1/DPHSHV ~1–2 bumps/yr; all re-dated 11. 8. 2026, CTF §1.1) | vendored XSD per period, row map as data, CI attribute-existence test, golden XML | 06 §3 EPO version + XSD hash monitors | 2–3 days |
| Rates, KH limit, deadlines, holidays | rule tables (`vat.*`, `calendar.cz_public_holidays`) | rule freshness digest | 0.5 day |
| KH/SH methodology clarifications (amendment modes, Věta C) | `[verify]` items resolved once, encoded as rule data | — | 0.5 day |
| ViDA / KH reshaping after 2030, EET 2.0 (not VAT forms) | out of V3 | annual review | — |
| Submission guide UI labels on MOJE daně | i18n copy with `verified_at` | yearly manual check in Jan | 0.25 day |
**Total ≈ 3–4 days/year** (within 06 §1's EPO budget). No code change is expected for a rate change.

## 11. Open questions
Consolidated in `22-open-questions.md`: D-11 (row rounding method; default `sum_entries_then_round`, both methods reproduce the filed August 2026 return), D-05 (dating of foreign services), T-02 (XSD attributes, `trans`, nil return, Věta C, `c_ufo`/`c_pracufo`, row sides), TA-08 (IO §9(1) supplies: SH only, monthly SH), TA-10 (KH/SH následné, dodatečné deadline and ř. 66), TA-11 (negative ř. 62 for an IO), T-20 (MOJE daně labels). Resolved (22 §F): cross-module contracts (job names 03 §3.1, `filing.*` keys 04 §9.4, M09 runs `vatObligationsFor`).
