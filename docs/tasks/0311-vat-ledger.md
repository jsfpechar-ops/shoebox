# 0311: `buildVatLedgerEntries` (pure, golden-tested)

Status: done
Ticket: P1-LEDG-02 (b) | Depends on: 0301, 0305, 0306, 0310 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 70k tokens

## 1. Objective

One pure function turns a ready document (lines, recap, partner) plus the profile, ČNB rates and rules into VAT-ledger entry drafts: one entry per `(vat_treatment, vat_rate_type)` group, with the VAT point date and period, CZK base and tax (ČNB conversion for foreign currency, self-assessed VAT computed), the DPHDP3 rows, the KH section, the SH code and the counterparty identifiers. It also returns the simple-check issues that stop an entry (`S_DATE_MISSING`, `S_FX_MISSING`, `S_SELF_ASSESSED_RATE_UNKNOWN`, `S_MIXED_TREATMENT_SAME_RATE`). The worker job (lane A, later) persists the drafts into `vat_ledger_entries` (05 §7, brief 0313).

## 2. Context

Hard rule 1 (Money, rates from rules), hard rule 2 (only `ready`/`finalized` documents reach the ledger). M05 §4.2 (pasted, numbered as in the spec):

1. Skip if `business_flag = 'personal'`. Skip lines with `line_type = 'text'` or `business_share_pct = 0`.
2. `status = profile.at(vat_point_date).vat_status`. `neplatce` → no entries.
3. Group lines by `(vat_treatment, vat_rate_type)`; one entry per group, `line_id = null`.
4. Credit notes are stored negative; no sign flip here.
5. `vat_rate_pct = rules.at(vat_point_date).vat.rates[vat_rate_type]` (`zero`/`none` → 0). Self-assessed treatments with `none`/`zero` → `S_SELF_ASSESSED_RATE_UNKNOWN`.
6. CZK document, domestic treatments (`iss_domestic_vat`, `rcv_domestic_vat`): if every line of that rate bucket has the same treatment take `base`/`vat` from the recap (`document_vat_summary`), otherwise `S_MIXED_TREATMENT_SAME_RATE`. Foreign currency (any treatment): `fx` by `vat.cnb_rate_rule` at `vat_point_date`, `base_czk = round2(Σ net_foreign × rate / amount)`, no rate within `fx.max_lookback_days` → `S_FX_MISSING`; the printed rate is never used. Self-assessed: `vat_czk = round2(base_czk × pct / 100)`. `iss_eu_service`, `iss_eu_goods`, `iss_non_eu_service`: `vat_czk = 0`.
7. `dphdp3_rows` from `epo.dphdp3_row_map` by `(treatment, rate_type, status)`; payers' self-assessed entries also carry the deduction row.
8. KH section (payers only) from `epo.kh_routing` on `|total_gross in CZK|`, strict `> vat.kh_document_limit`.
9. SH code: `iss_eu_goods` → 0; `iss_eu_service` → 3; IO only: `iss_no_vat` with partner country ∈ `vat.eu_member_states`, VAT ID present and valid, category `income_services` → 3.
10. `counterparty_vat_id`: CZ partners → `dic`, foreign → `vat_id`. `evidence_number = trim(document_number)` (max 60).
11. `period_start/end` from §4.1 at the entry's `vat_point_date`.

M05 §6: `buildVatLedgerEntries(input): { entries, issues }`. M04 §9.1 AC-9c..f, AC-11 give the golden numbers below.

Readings this brief fixes (spec gaps): a group whose rows are empty and whose SH code is null produces **no entry** (nothing to report: `rcv_domestic_no_vat`, `rcv_out_of_scope`, IO domestic purchases, a payer's non-deductible purchase). A CZK self-assessed group (Booking) takes `base = Σ net` of its lines. When the recap has no row for the rate, `Σ` of the lines is used. `deduction_pct` = the smallest `business_share_pct` in the group (ZDPH § 75 partial deduction; `base_czk`/`vat_czk` stay whole). `kh_document_total_czk` is set only when a KH section was resolved. `vat_point_date` per group via `deriveVatPointDate(doc, [treatment], …)` (0305).

Existing API: `deriveVatPointDate`, `periodFor`, `ProfileAt`, `VatPointDocument`, `PaymentEvidenceDate` (`src/vat/point-date.ts`, 0305); `resolveFxRate`, `convertToCzk`, `FxRateRow` (`src/fx.ts`, 0306); `resolveDphdp3Rows`, `resolveKhSection`, `parseDphdp3RowMap`, `parseKhRouting`, `KhSection` (`src/rules/cz/epo.ts`, 0309/0310); `CategoryCode` (0301); `Money`, `round2`, `vatForRate(base, pct)`, `CZK` (`src/money`).

Hand-checked arithmetic (21 %):

- Booking July (CZK): 12 345,67 + 1 354,10 = 13 699,77; × 0,21 = 2 876,9517 → **2 876,95**. Period IO `issue_date` → 2026-08-03 → 2026-08; `service_period_end` → 2026-07-31 → 2026-07. Payer monthly (policy `service_period_end`) → 2026-07, rows `['5','43']`, KH `A2`; quarterly → 2026-07-01..2026-09-30.
- Booking August: 11 549,94 × 0,21 = 2 425,4874 → **2 425,49**.
- Cloudflare $10.46, issued Sat 2026-10-03, USD rate Fri 2026-10-02 = 23,456 → 245,34976 → **245,35**; × 0,21 = 51,5235 → **51,52**; rows `['12']`.
- Anthropic €90, issued 2026-10-15, EUR 24,58 → **2 212,20**; × 0,21 = 464,562 → **464,56**; rows `['5']`.
- Manager invoice (CZ, 21 %): net 10 711,44, VAT 2 249,40 (10 711,44 × 0,21 = 2 249,4024), gross 12 960,84 > 10 000 → payer `B2`, rows `['40']`; IO → nothing.
- Credit note −1 000,00 self-assessed → base −1 000,00, VAT −210,00; KH test on 1 000,00.
- Issued CZ invoice net 10 000,00 + 2 100,00 = 12 100,00 > 10 000 → `A4` with a CZ DIČ, else `A5`; rows `['1']`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/vat-ledger.test.ts` | create | verbatim below |
| `packages/domain/src/vat/ledger.ts` | create | types and `buildVatLedgerEntries` |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/vat-ledger.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { FxRateRow } from '../src/fx';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import {
  buildVatLedgerEntries,
  type VatLedgerDocument,
  type VatLedgerEntryDraft,
  type VatLedgerInput,
  type VatLedgerLine,
  type VatLedgerPartner,
} from '../src/vat/ledger';
import type { VatProfileSlice } from '../src/vat/point-date';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');

const IO: VatProfileSlice = { vatStatus: 'identifikovana_osoba', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date' };
const IO_SPE: VatProfileSlice = { ...IO, foreignServiceDppdPolicy: 'service_period_end' };
const PAYER_M: VatProfileSlice = { vatStatus: 'platce', vatPeriod: 'monthly', foreignServiceDppdPolicy: 'service_period_end' };
const PAYER_Q: VatProfileSlice = { ...PAYER_M, vatPeriod: 'quarterly' };
const NONPAYER: VatProfileSlice = { vatStatus: 'neplatce', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date' };
const at = (profile: VatProfileSlice) => () => profile;

// Synthetic ČNB fixture (not real values). 2026-10-03/04 is a weekend.
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-01'), currency: 'USD', amount: 1, rate: '23.400000' },
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'USD', amount: 1, rate: '23.500000' },
  { rateDate: d('2026-10-15'), currency: 'EUR', amount: 1, rate: '24.580000' },
];

const BOOKING: VatLedgerPartner = { country: 'NL', dic: null, vatId: 'NL805734958B01', vatIdValid: true };
const CLOUDFLARE: VatLedgerPartner = { country: 'US', dic: null, vatId: null, vatIdValid: null };
const ANTHROPIC: VatLedgerPartner = { country: 'IE', dic: null, vatId: 'IE3797893MH', vatIdValid: true };
const MANAGER: VatLedgerPartner = { country: 'CZ', dic: 'CZ12345678', vatId: null, vatIdValid: null };
const CZ_NO_DIC: VatLedgerPartner = { country: 'CZ', dic: null, vatId: null, vatIdValid: null };

let seq = 0;
function line(over: Partial<VatLedgerLine>): VatLedgerLine {
  seq += 1;
  return {
    lineId: `line-${seq}`, position: seq, lineType: 'item',
    net: czk('0'), vat: czk('0'), gross: czk('0'),
    vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard',
    categoryCode: 'exp_platform_commission', businessSharePct: '100',
    ...over,
  };
}

/** Booking July invoice (AC-9c): issued 3 Aug 2026 for 1–31 July, 13 699,77 CZK, no VAT printed. */
function booking(over: Partial<VatLedgerDocument> = {}): VatLedgerDocument {
  return {
    documentId: 'doc-booking-jul', class: 'received_invoice', direction: 'in', status: 'ready', deleted: false,
    businessFlag: 'business', taxDocStatus: 'full_tax_document', currency: 'CZK', documentNumber: ' 1234567890 ',
    issueDate: d('2026-08-03'), duzp: null, receivedDate: null,
    servicePeriodFrom: d('2026-07-01'), servicePeriodTo: d('2026-07-31'), paidAt: null, userVatPointDate: null,
    totalGross: czk('13699.77'),
    lines: [
      line({ net: czk('12345.67'), gross: czk('12345.67'), categoryCode: 'exp_platform_commission' }),
      line({ net: czk('1354.10'), gross: czk('1354.10'), categoryCode: 'exp_payment_fees' }),
    ],
    recap: [],
    ...over,
  };
}

/** Property-manager invoice (AC-9b): CZ payer, 21 % printed, 12 960,84 incl. VAT. */
function manager(over: Partial<VatLedgerDocument> = {}): VatLedgerDocument {
  return {
    ...booking({ documentId: 'doc-manager', documentNumber: '2026090001', issueDate: d('2026-09-02'), duzp: d('2026-09-02'), receivedDate: d('2026-09-02'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: czk('12960.84') }),
    lines: [line({ net: czk('10711.44'), vat: czk('2249.40'), gross: czk('12960.84'), vatTreatment: 'rcv_domestic_vat', categoryCode: 'exp_property_management' })],
    recap: [{ vatRateType: 'standard', vatRatePct: 21, base: czk('10711.44'), vat: czk('2249.40') }],
    ...over,
  };
}

function build(doc: VatLedgerDocument, partner: VatLedgerPartner, profile: VatProfileSlice, over: Partial<VatLedgerInput> = {}) {
  return buildVatLedgerEntries({ doc, partner, profileAt: at(profile), payments: [], fxRates: RATES, deductionAllowed: true, rules, ...over });
}

const view = (e: VatLedgerEntryDraft) => ({
  ...e,
  baseCzk: e.baseCzk.toFixed2(),
  vatCzk: e.vatCzk.toFixed2(),
  baseForeign: e.baseForeign?.toFixed2() ?? null,
  khDocumentTotalCzk: e.khDocumentTotalCzk?.toFixed2() ?? null,
});

describe('buildVatLedgerEntries: Booking (AC-9c, AC-9d, AC-11)', () => {
  it('IO, policy issue_date: one grouped entry in 2026-08, row 5, no KH', () => {
    const { entries, issues } = build(booking(), BOOKING, IO);
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(view(entries[0] as VatLedgerEntryDraft)).toEqual({
      periodStart: '2026-08-01', periodEnd: '2026-08-31', vatPointDate: '2026-08-03', vatPointRule: 'issue_date',
      documentId: 'doc-booking-jul', lineId: null,
      vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21,
      baseCzk: '13699.77', vatCzk: '2876.95', deductionPct: '100',
      currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null,
      dphdp3Rows: ['5'], khSection: null, khDocumentTotalCzk: null, shvCode: null,
      counterpartyVatId: 'NL805734958B01', evidenceNumber: '1234567890',
    });
  });

  it('IO, policy service_period_end: 2026-07', () => {
    const { entries } = build(booking(), BOOKING, IO_SPE);
    expect(entries.map((e) => [e.periodStart, e.periodEnd, e.vatPointDate, e.vatPointRule])).toEqual([['2026-07-01', '2026-07-31', '2026-07-31', 'service_period_end']]);
  });

  it('payer monthly: rows 5+43, KH A2 on the document total; quarterly: Q3 period', () => {
    const m = build(booking(), BOOKING, PAYER_M).entries;
    expect(m).toHaveLength(1);
    expect(view(m[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-07-01', periodEnd: '2026-07-31', dphdp3Rows: ['5', '43'], khSection: 'A2', khDocumentTotalCzk: '13699.77', baseCzk: '13699.77', vatCzk: '2876.95',
    });
    const q = build(booking(), BOOKING, PAYER_Q).entries;
    expect(q.map((e) => [e.periodStart, e.periodEnd])).toEqual([['2026-07-01', '2026-09-30']]);
  });

  it('Booking August: 11 549,94 → 2 425,49; period 2026-09 (issue_date) or 2026-08 (service_period_end)', () => {
    const aug = booking({
      documentId: 'doc-booking-aug', issueDate: d('2026-09-03'), servicePeriodFrom: d('2026-08-01'), servicePeriodTo: d('2026-08-31'), totalGross: czk('11549.94'),
      lines: [line({ net: czk('11549.94'), gross: czk('11549.94') })],
    });
    const io = build(aug, BOOKING, IO).entries;
    expect(io.map((e) => [e.periodStart, e.baseCzk.toFixed2(), e.vatCzk.toFixed2()])).toEqual([['2026-09-01', '11549.94', '2425.49']]);
    expect(build(aug, BOOKING, IO_SPE).entries.map((e) => e.periodStart)).toEqual(['2026-08-01']);
  });

  it('text lines and share-0 lines are skipped; the group total is unchanged', () => {
    const doc = booking();
    const noisy = booking({
      lines: [
        ...doc.lines,
        line({ lineType: 'text', net: null, vat: null, gross: null }),
        line({ net: czk('500.00'), gross: czk('500.00'), businessSharePct: '0' }),
      ],
    });
    const { entries } = build(noisy, BOOKING, IO);
    expect(entries.map((e) => e.baseCzk.toFixed2())).toEqual(['13699.77']);
  });

  it('credit note: negative entry, KH tested on the absolute value', () => {
    const cn = booking({
      documentId: 'doc-cn', class: 'received_credit_note', totalGross: czk('-1000.00'),
      lines: [line({ net: czk('-1000.00'), gross: czk('-1000.00') })],
    });
    expect(view(build(cn, BOOKING, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ baseCzk: '-1000.00', vatCzk: '-210.00', khSection: 'A2', khDocumentTotalCzk: '1000.00', dphdp3Rows: ['5', '43'] });
    expect(view(build(cn, BOOKING, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({ baseCzk: '-1000.00', vatCzk: '-210.00', khSection: null, khDocumentTotalCzk: null });
  });
});

describe('foreign currency (AC-9e, AC-9f)', () => {
  const cloudflare = booking({
    documentId: 'doc-cloudflare', currency: 'USD', documentNumber: 'CF-1', issueDate: d('2026-10-03'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: Money.parse('10.46', 'USD'),
    lines: [line({ net: Money.parse('10.46', 'USD'), gross: Money.parse('10.46', 'USD'), vatTreatment: 'rcv_non_eu_service_reverse_charge', categoryCode: 'exp_hosting_domains' })],
  });
  const anthropic = booking({
    documentId: 'doc-anthropic', currency: 'EUR', documentNumber: 'INV-90', issueDate: d('2026-10-15'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: Money.parse('90.00', 'EUR'),
    lines: [line({ net: Money.parse('90.00', 'EUR'), gross: Money.parse('90.00', 'EUR'), categoryCode: 'exp_software_saas' })],
  });

  it('Cloudflare $10.46 on a Saturday uses Friday’s rate: 245,35 / 51,52, row 12', () => {
    const { entries, issues } = build(cloudflare, CLOUDFLARE, IO);
    expect(issues).toEqual([]);
    expect(view(entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-10-01', periodEnd: '2026-10-31', vatPointDate: '2026-10-03', vatPointRule: 'issue_date',
      vatTreatment: 'rcv_non_eu_service_reverse_charge', baseCzk: '245.35', vatCzk: '51.52',
      currency: 'USD', baseForeign: '10.46', fxRate: '23.456000', fxAmount: 1, fxRateDate: '2026-10-02',
      dphdp3Rows: ['12'], khSection: null, shvCode: null, counterpartyVatId: null, evidenceNumber: 'CF-1',
    });
  });

  it('Anthropic €90: 2 212,20 / 464,56, row 5, period 2026-10; payer adds row 43 and A2', () => {
    expect(view(build(anthropic, ANTHROPIC, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-10-01', baseCzk: '2212.20', vatCzk: '464.56', baseForeign: '90.00', fxRate: '24.580000', fxRateDate: '2026-10-15', dphdp3Rows: ['5'], counterpartyVatId: 'IE3797893MH',
    });
    expect(view(build(anthropic, ANTHROPIC, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ dphdp3Rows: ['5', '43'], khSection: 'A2', khDocumentTotalCzk: '2212.20' });
  });

  it('no ČNB rate within the look-back → S_FX_MISSING and no entry', () => {
    const { entries, issues } = build(anthropic, ANTHROPIC, IO, { fxRates: RATES.filter((r) => r.currency !== 'EUR') });
    expect(entries).toEqual([]);
    expect(issues).toEqual([{ code: 'S_FX_MISSING', vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard' }]);
  });
});

describe('domestic purchases (AC-9b, AC-11)', () => {
  it('IO: a CZ invoice with VAT produces nothing', () => {
    expect(build(manager(), MANAGER, IO)).toEqual({ entries: [], issues: [] });
  });

  it('payer with deduction: row 40, B2 (12 960,84 > 10 000), base/VAT from the recap', () => {
    const { entries, issues } = build(manager(), MANAGER, PAYER_M);
    expect(issues).toEqual([]);
    expect(view(entries[0] as VatLedgerEntryDraft)).toMatchObject({
      periodStart: '2026-09-01', periodEnd: '2026-09-30', vatPointDate: '2026-09-02', vatPointRule: 'max_duzp_received',
      vatTreatment: 'rcv_domestic_vat', vatRatePct: 21, baseCzk: '10711.44', vatCzk: '2249.40',
      dphdp3Rows: ['40'], khSection: 'B2', khDocumentTotalCzk: '12960.84', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026090001',
    });
  });

  it('payer without deduction: nothing; ≤ 10 000 → B3; simplified document → B3; share 50 → deduction_pct 50', () => {
    expect(build(manager(), MANAGER, PAYER_M, { deductionAllowed: false }).entries).toEqual([]);
    const small = manager({
      totalGross: czk('9680.00'),
      lines: [line({ net: czk('8000.00'), vat: czk('1680.00'), gross: czk('9680.00'), vatTreatment: 'rcv_domestic_vat', categoryCode: 'exp_property_management' })],
      recap: [{ vatRateType: 'standard', vatRatePct: 21, base: czk('8000.00'), vat: czk('1680.00') }],
    });
    expect(view(build(small, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ baseCzk: '8000.00', vatCzk: '1680.00', khSection: 'B3', khDocumentTotalCzk: '9680.00' });
    expect(build(manager({ taxDocStatus: 'simplified_tax_document' }), MANAGER, PAYER_M).entries[0]?.khSection).toBe('B3');
    const m = manager();
    const half = manager({ lines: [{ ...(m.lines[0] as VatLedgerLine), businessSharePct: '50' }] });
    expect(view(build(half, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ deductionPct: '50', baseCzk: '10711.44', vatCzk: '2249.40' });
  });

  it('recap row missing → Σ lines; mixed treatments at one rate → S_MIXED_TREATMENT_SAME_RATE', () => {
    expect(build(manager({ recap: [] }), MANAGER, PAYER_M).entries[0]?.baseCzk.toFixed2()).toBe('10711.44');
    const m = manager();
    const mixed = manager({
      lines: [m.lines[0] as VatLedgerLine, line({ net: czk('100.00'), vat: czk('21.00'), gross: czk('121.00'), vatTreatment: 'rcv_foreign_vat_charged', categoryCode: 'exp_other_deductible' })],
    });
    const { entries, issues } = build(mixed, MANAGER, PAYER_M);
    expect(entries).toEqual([]);
    expect(issues).toEqual([{ code: 'S_MIXED_TREATMENT_SAME_RATE', vatTreatment: 'rcv_domestic_vat', vatRateType: 'standard' }]);
  });
});

describe('issued documents', () => {
  const issued = booking({
    documentId: 'doc-issued', class: 'issued_invoice', direction: 'out', documentNumber: '2026-0042', issueDate: d('2026-09-10'), duzp: d('2026-09-10'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: czk('12100.00'),
    lines: [line({ net: czk('10000.00'), vat: czk('2100.00'), gross: czk('12100.00'), vatTreatment: 'iss_domestic_vat', categoryCode: 'income_services' })],
    recap: [{ vatRateType: 'standard', vatRatePct: 21, base: czk('10000.00'), vat: czk('2100.00') }],
  });

  it('payer, CZ customer with DIČ: row 1, A4; without DIČ: A5; IO: nothing', () => {
    expect(view(build(issued, MANAGER, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ vatPointDate: '2026-09-10', vatPointRule: 'duzp', dphdp3Rows: ['1'], khSection: 'A4', khDocumentTotalCzk: '12100.00', baseCzk: '10000.00', vatCzk: '2100.00', counterpartyVatId: 'CZ12345678', evidenceNumber: '2026-0042' });
    expect(build(issued, CZ_NO_DIC, PAYER_M).entries[0]?.khSection).toBe('A5');
    expect(build(issued, MANAGER, IO).entries).toEqual([]);
  });

  it('payer EU B2B service: row 21, VAT 0, SH code 3, no KH', () => {
    const eu = booking({
      documentId: 'doc-eu', class: 'issued_invoice', direction: 'out', documentNumber: 'EU-1', issueDate: d('2026-09-10'), duzp: d('2026-09-10'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: czk('5000.00'),
      lines: [line({ net: czk('5000.00'), gross: czk('5000.00'), vatTreatment: 'iss_eu_service', vatRateType: 'zero', categoryCode: 'income_services' })],
    });
    expect(view(build(eu, ANTHROPIC, PAYER_M).entries[0] as VatLedgerEntryDraft)).toMatchObject({ dphdp3Rows: ['21'], vatRateType: 'zero', vatRatePct: 0, baseCzk: '5000.00', vatCzk: '0.00', shvCode: 3, khSection: null, counterpartyVatId: 'IE3797893MH' });
  });

  it('IO service to an EU VAT payer (iss_no_vat, income_services): SH code 3, no DPHDP3 row; otherwise nothing', () => {
    const io = booking({
      documentId: 'doc-io-eu', class: 'issued_invoice', direction: 'out', documentNumber: 'IO-1', issueDate: d('2026-09-10'), servicePeriodFrom: null, servicePeriodTo: null, totalGross: czk('5000.00'),
      lines: [line({ net: czk('5000.00'), gross: czk('5000.00'), vatTreatment: 'iss_no_vat', vatRateType: 'none', categoryCode: 'income_services' })],
    });
    expect(view(build(io, ANTHROPIC, IO).entries[0] as VatLedgerEntryDraft)).toMatchObject({ dphdp3Rows: [], shvCode: 3, vatRatePct: 0, baseCzk: '5000.00', vatCzk: '0.00', khSection: null });
    expect(build(io, { ...ANTHROPIC, vatIdValid: false }, IO).entries).toEqual([]);
    expect(build(io, CLOUDFLARE, IO).entries).toEqual([]);
    const accommodation = { ...io, lines: [{ ...(io.lines[0] as VatLedgerLine), categoryCode: 'income_accommodation' as const }] };
    expect(build(accommodation, ANTHROPIC, IO).entries).toEqual([]);
  });
});

describe('gates and issues', () => {
  it('neplatce, personal, not ready, deleted, non-bookable class → nothing', () => {
    expect(build(booking(), BOOKING, NONPAYER)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ businessFlag: 'personal' }), BOOKING, IO)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ status: 'needs_review' }), BOOKING, IO)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ deleted: true }), BOOKING, IO)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ class: 'other_supporting' }), BOOKING, IO)).toEqual({ entries: [], issues: [] });
    expect(build(booking({ status: 'finalized' }), BOOKING, IO).entries).toHaveLength(1);
  });

  it('no usable date → S_DATE_MISSING; self-assessed with rate none → S_SELF_ASSESSED_RATE_UNKNOWN', () => {
    const undated = booking({ issueDate: null, servicePeriodFrom: null, servicePeriodTo: null });
    expect(build(undated, BOOKING, IO)).toEqual({ entries: [], issues: [{ code: 'S_DATE_MISSING', vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard' }] });
    const b = booking();
    const none = booking({ lines: b.lines.map((l) => ({ ...l, vatRateType: 'none' as const })) });
    expect(build(none, BOOKING, IO)).toEqual({ entries: [], issues: [{ code: 'S_SELF_ASSESSED_RATE_UNKNOWN', vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'none' }] });
  });

  it('evidence number is trimmed and cut to 60 characters; empty → null', () => {
    expect(build(booking({ documentNumber: `  ${'9'.repeat(70)}  ` }), BOOKING, IO).entries[0]?.evidenceNumber).toBe('9'.repeat(60));
    expect(build(booking({ documentNumber: '   ' }), BOOKING, IO).entries[0]?.evidenceNumber).toBeNull();
    expect(build(booking({ documentNumber: null }), BOOKING, IO).entries[0]?.evidenceNumber).toBeNull();
  });

  it('no DPHDP3 row number is written in the builder (M05 §4.2 step 8)', () => {
    const src = readFileSync(new URL('../src/vat/ledger.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'(?:[1-9]|[1-9]\d)'/);
    expect(src).not.toMatch(/10[_ ]?000/);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- vat-ledger 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/vat/ledger.ts`. Exported names and signatures exactly:

```ts
import type { LegalDate } from '../dates/index';
import type { Currency } from '../money/index';
import type { CategoryCode } from '../taxonomy/categories';
import type { KhSection } from '../rules/cz/epo';
import type { FxRateRow } from '../fx';
import type { PaymentEvidenceDate, ProfileAt, VatPointDocument, VatPointRule } from './point-date';
import type { DocumentStatus, LineType, VatRateType, VatTreatment } from '../enums/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
// value imports: Money, round2, vatForRate, CZK; resolveFxRate, convertToCzk; resolveDphdp3Rows, resolveKhSection, parseDphdp3RowMap, parseKhRouting; deriveVatPointDate, periodFor; BOOKABLE_CLASSES (from '../ledgers/tax', 0308)

export type BusinessFlag = 'business' | 'personal' | 'mixed' | 'unknown';
export interface VatLedgerLine { readonly lineId: string; readonly position: number; readonly lineType: LineType; readonly net: Money | null; readonly vat: Money | null; readonly gross: Money | null; readonly vatTreatment: VatTreatment | null; readonly vatRateType: VatRateType; readonly categoryCode: CategoryCode | null; readonly businessSharePct: string; }
export interface VatLedgerRecapRow { readonly vatRateType: VatRateType; readonly vatRatePct: number; readonly base: Money; readonly vat: Money; }
export interface VatLedgerDocument extends VatPointDocument { readonly documentId: string; readonly status: DocumentStatus; readonly deleted: boolean; readonly businessFlag: BusinessFlag; readonly currency: Currency; readonly documentNumber: string | null; readonly totalGross: Money | null; readonly lines: readonly VatLedgerLine[]; readonly recap: readonly VatLedgerRecapRow[]; }
export interface VatLedgerPartner { readonly country: string | null; readonly dic: string | null; readonly vatId: string | null; readonly vatIdValid: boolean | null; }
export interface VatLedgerInput { readonly doc: VatLedgerDocument; readonly partner: VatLedgerPartner; readonly profileAt: ProfileAt; readonly payments: readonly PaymentEvidenceDate[]; readonly fxRates: readonly FxRateRow[]; readonly deductionAllowed: boolean; readonly rules: RuleResolver<typeof RULE_SCHEMAS>; }
/** One row of `vat_ledger_entries` (05 §7) before `org_id`/`build_version`. */
export interface VatLedgerEntryDraft {
  readonly periodStart: LegalDate; readonly periodEnd: LegalDate; readonly vatPointDate: LegalDate; readonly vatPointRule: VatPointRule;
  readonly documentId: string; readonly lineId: null;
  readonly vatTreatment: VatTreatment; readonly vatRateType: VatRateType; readonly vatRatePct: number;
  readonly baseCzk: Money; readonly vatCzk: Money; readonly deductionPct: string;
  readonly currency: Currency; readonly baseForeign: Money | null; readonly fxRate: string | null; readonly fxAmount: number | null; readonly fxRateDate: LegalDate | null;
  readonly dphdp3Rows: readonly string[]; readonly khSection: KhSection | null; readonly khDocumentTotalCzk: Money | null; readonly shvCode: 0 | 1 | 2 | 3 | null;
  readonly counterpartyVatId: string | null; readonly evidenceNumber: string | null;
}
export type VatLedgerIssueCode = 'S_DATE_MISSING' | 'S_FX_MISSING' | 'S_SELF_ASSESSED_RATE_UNKNOWN' | 'S_MIXED_TREATMENT_SAME_RATE';
export interface VatLedgerIssue { readonly code: VatLedgerIssueCode; readonly vatTreatment: VatTreatment; readonly vatRateType: VatRateType; }
export interface VatLedgerResult { readonly entries: VatLedgerEntryDraft[]; readonly issues: VatLedgerIssue[]; }

export const SELF_ASSESSED_TREATMENTS: readonly VatTreatment[] = ['rcv_eu_service_reverse_charge', 'rcv_non_eu_service_reverse_charge', 'rcv_eu_goods_acquisition', 'rcv_domestic_reverse_charge'];
export const DOMESTIC_RECAP_TREATMENTS: readonly VatTreatment[] = ['iss_domestic_vat', 'rcv_domestic_vat'];
export const ZERO_VAT_ISSUED_TREATMENTS: readonly VatTreatment[] = ['iss_eu_service', 'iss_eu_goods', 'iss_non_eu_service', 'iss_export_goods', 'iss_exempt', 'iss_no_vat', 'iss_domestic_reverse_charge'];
export const EVIDENCE_NUMBER_MAX = 60;
export function buildVatLedgerEntries(input: VatLedgerInput): VatLedgerResult;
```

Algorithm (in this order):

1. Gates: `doc.deleted`, `doc.status ∉ {'ready','finalized'}`, `doc.class ∉ BOOKABLE_CLASSES`, `doc.businessFlag === 'personal'` → `{ entries: [], issues: [] }`.
2. Usable lines: `lineType !== 'text'`, `vatTreatment !== null`, `new Decimal(businessSharePct)` not zero (use `Money.parse(businessSharePct, CZK).isZero()` to avoid `Number()`).
3. Groups: `Map<string, VatLedgerLine[]>` keyed `${treatment}|${rateType}`, in first-seen order.
4. Per group (`treatment`, `rateType`, `lines`):
   a. If `(doc.duzp ?? doc.issueDate) === null` → issue `S_DATE_MISSING`, continue (do not call the wrapper without a profile date). Else `vp = deriveVatPointDate(doc, [treatment], profileAt, payments, rules)`; null → issue `S_DATE_MISSING`, continue.
   b. `profile = profileAt(vp.date)`; `profile.vatStatus === 'neplatce'` → continue (no issue). `period = periodFor(vp.date, profile)`; null → continue.
   c. `at = rules.at(vp.date)`; `rates = at.get('vat.rates')`; `pct = rateType === 'standard' ? rates.standard : rateType === 'reduced' ? rates.reduced : 0`. Self-assessed and `pct === 0` → issue `S_SELF_ASSESSED_RATE_UNKNOWN`, continue.
   d. Amounts. `netSum = Money.sum(lines.map(l => l.net ?? Money.zero(doc.currency)), doc.currency)`, `vatSum` likewise from `vat`.
      - `doc.currency === 'CZK'`: if `DOMESTIC_RECAP_TREATMENTS` includes the treatment: the rate bucket = all usable lines with this `rateType`; if any has a different treatment → issue `S_MIXED_TREATMENT_SAME_RATE`, continue; `recapRow = doc.recap.find(r => r.vatRateType === rateType)`; `base = recapRow?.base ?? netSum`, `vat = recapRow?.vat ?? vatSum`. Else `base = netSum`; self-assessed → `vat = vatForRate(base, String(pct))`; `ZERO_VAT_ISSUED_TREATMENTS` → `vat = Money.zero(CZK)`; otherwise `vat = vatSum`. No fx fields.
      - Foreign: `fx = resolveFxRate(doc.currency, vp.date, fxRates, at.get('vat.cnb_rate_rule'), at.get('fx.max_lookback_days'))`; null → issue `S_FX_MISSING`, continue. `base = round2(convertToCzk(netSum, fx))`; self-assessed → `vat = vatForRate(base, String(pct))`; zero-VAT issued → zero; otherwise `vat = round2(convertToCzk(vatSum, fx))`. `baseForeign = netSum`, `fxRate = fx.rate`, `fxAmount = fx.amount`, `fxRateDate = fx.rateDate`.
   e. `rows = resolveDphdp3Rows(treatment, rateType, profile.vatStatus, deductionAllowed, parseDphdp3RowMap(at.get('epo.dphdp3_row_map')))`.
   f. KH: `profile.vatStatus === 'platce'` and `doc.totalGross !== null` → `docTotal` = `totalGross` if CZK else `round2(convertToCzk(totalGross, fx))`; `kh = resolveKhSection({ vatStatus, treatment, docTotalCzk: docTotal, counterpartyCzDic: partner.dic?.startsWith('CZ') === true, taxDocStatus: doc.taxDocStatus, limitCzk: at.get('vat.kh_document_limit') }, parseKhRouting(at.get('epo.kh_routing')))`; `khDocumentTotalCzk = kh === null ? null : docTotal.abs()`. Otherwise both null.
   g. SH code: `treatment === 'iss_eu_goods'` → 0; `'iss_eu_service'` → 3; `profile.vatStatus === 'identifikovana_osoba' && treatment === 'iss_no_vat' && partner.country ∈ at.get('vat.eu_member_states') && partner.vatId && partner.vatIdValid === true && lines.every(l => l.categoryCode === 'income_services')` → 3; else null. Put the two constants in a `const SHV_CODES = { iss_eu_goods: 0, iss_eu_service: 3, io_eu_service: 3 } as const` with `// TODO(rules): move to an epo.shv_codes key in Phase 3`.
   h. `rows.length === 0 && shv === null` → continue (nothing to report).
   i. `deductionPct` = the lexicographically smallest share by `Money.parse(share, CZK).compare` (keep the original string). `counterpartyVatId = partner.country === 'CZ' ? partner.dic : partner.vatId` (null when absent). `evidenceNumber = doc.documentNumber?.trim().slice(0, EVIDENCE_NUMBER_MAX) || null`.
   j. Push the entry with `vatRatePct: pct`, `lineId: null`, `currency: doc.currency`, `period.start/end`.
5. Return `{ entries, issues }`.

Hints: `at.get('vat.rates')` is `{ standard: number; reduced: number }`; `at.get('vat.eu_member_states')` is `string[]`; `at.get('vat.kh_document_limit')` is a number. `resolveFxRate` takes `rule` typed `'rate_valid_on_date_else_last_published'` (the resolver returns that literal). Row numbers and the 10 000 limit must not appear as literals (the last test reads the file). Lint: no `Number()`; `String(pct)` is fine.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/vat/ledger.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- vat-ledger 2>&1 | tail -30`. Expected: green.

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './vat/point-date';`. Append after it: `export * from './vat/ledger';`. Typecheck and biome (§6).

## 5. Do not touch

`point-date.ts`, `fx.ts`, `epo.ts`, rules, test files, other packages. Hard rules 1, 2.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- vat-ledger 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Test file green, unchanged (incl. the source-literal test).
- [ ] Commits `0311 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8. Stop if `deriveVatPointDate` for the manager invoice returns a rule other than `max_duzp_received` (then 0305 differs from this brief; do not patch either).

## 9. Report

`docs/tasks/0311-report.md`, `Status: review`, commit `0311 report`. Record the `[verify]` of M05 §4.2 step 9 (IO § 9(1) supplies get no DPHDP3 row) as "assumed, not checked".

## Spec notes for the reviewer

- M04 §6.1 declares `buildVatLedgerEntries(...): VatLedgerEntryDraft[]`; M05 §6 declares `{ entries, issues }`. The brief follows M05 (the issues are needed by the simple-period classifier).
- `deduction_pct` is not defined by M05 §4.2; 05 §7 has the column with default 100. The brief fills it with the smallest business share of the group and leaves `base_czk`/`vat_czk` whole, so the DPHDP3 builder (Phase 3) decides how § 75 applies. `TODO(decision)` in code.
- `kh_document_total_czk` of a foreign-currency document uses the same ČNB rate as the entry (M05 says "converted to CZK" without naming the date).
- Step 9 (SH code for IO `iss_no_vat`) requires every line of the group to be `income_services`; M05 says "category `income_services`" per document.
- Groups with no row and no SH code are dropped rather than written with `dphdp3_rows = '{}'` (05 §7 has `not null`, not `check (cardinality > 0)`; the simpler ledger wins).

## Risk list (for the reviewer)

`packages/domain/src/vat/ledger.ts` (every VAT return number flows through it).

## Owner steps

None.
