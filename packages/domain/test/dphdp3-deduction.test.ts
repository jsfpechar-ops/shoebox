import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3, dphdp3Row } from '../src/vat/dphdp3';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: d('2026-09-01'),
  periodEnd: d('2026-09-30'),
  vatPointDate: d('2026-09-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_domestic_vat',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: czk(base),
  vatCzk: czk(vat),
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: rows,
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: null,
  evidenceNumber: documentId,
  ...o,
});
const v = (c: ReturnType<typeof computeDphdp3>, row: string) => [
  dphdp3Row(c, row).base.toFixed2(),
  dphdp3Row(c, row).tax.toFixed2(),
];

// Accountant review 2026-10-26 V1–V3 (ZDPH § 72 odst. 6, § 75; XSD dan_zocelk, odp_sum_nar).
const ENTRIES: VatLedgerEntryDraft[] = [
  // MacBook, 80 % business: row 40 carries the deductible 80 % (17 844,63 / 3 747,37).
  e('mac', ['40'], '22305.79', '4684.21', { deductionPct: '80' }),
  // EU ads, 50 % business: row 5 full (output), row 43 half.
  e('ads', ['5', '43'], '10000.00', '2100.00', {
    vatTreatment: 'rcv_eu_service_reverse_charge',
    deductionPct: '50',
  }),
  // § 92a construction work, 100 %: row 10 counts in ř. 62 and in ř. 43.
  e('rc', ['10', '43'], '50000.00', '10500.00', {
    vatTreatment: 'rcv_domestic_reverse_charge',
  }),
  // Import VAT assessed by customs: row 42 counts in ř. 46.
  e('cust', ['42'], '1000.00', '210.00', { vatTreatment: 'rcv_import_customs' }),
];

describe('computeDphdp3 with a proportional deduction (§ 75)', () => {
  const c = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  it('row 40 = round2(amount × 80 %) summed, then whole Kč: 17 845 / 3 747; raw keeps haléře', () => {
    expect(v(c, '40')).toEqual(['17845.00', '3747.00']);
    expect(c.raw['40']?.base.toFixed2()).toBe('17844.63');
    expect(c.raw['40']?.tax.toFixed2()).toBe('3747.37');
  });
  it('output rows stay full: row 5 = 10 000 / 2 100, row 10 = 50 000 / 10 500, row 42 = 1 000 / 210', () => {
    expect(v(c, '5')).toEqual(['10000.00', '2100.00']);
    expect(v(c, '10')).toEqual(['50000.00', '10500.00']);
    expect(v(c, '42')).toEqual(['1000.00', '210.00']);
  });
  it('ř. 43 = half of row 5 + all of row 10 = 55 000 / 11 550; no ř. 44', () => {
    expect(v(c, '43')).toEqual(['55000.00', '11550.00']);
    expect(c.rows['44']).toBeUndefined();
  });
  it('ř. 62 = tax of rows 5 + 10 = 12 600; ř. 46 = 40 + 42 + 43 = 15 507; ř. 65 = 2 907', () => {
    expect(c.row62.toFixed2()).toBe('12600.00');
    expect(v(c, '46')).toEqual(['0.00', '15507.00']);
    expect(c.row63.toFixed2()).toBe('15507.00');
    expect(c.row64.toFixed2()).toBe('0.00');
    expect(c.row65.toFixed2()).toBe('2907.00');
    expect(c.trans).toBe('A');
  });
  it('round_base_then_multiply: row 40 tax = round0(17 845 × 21 %) = 3 747; ř. 43 unchanged', () => {
    const m = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'), 'round_base_then_multiply');
    expect(v(m, '40')).toEqual(['17845.00', '3747.00']);
    expect(v(m, '43')).toEqual(['55000.00', '11550.00']);
  });
  it('IO: ř. 62 counts rows 5/6/12/13 only, never a deduction', () => {
    const io = computeDphdp3(
      [e('ads', ['5'], '10000.00', '2100.00', { vatTreatment: 'rcv_eu_service_reverse_charge' })],
      'identifikovana_osoba',
      rules,
      d('2026-09-01'),
    );
    expect(io.row62.toFixed2()).toBe('2100.00');
    expect(io.row63.toFixed2()).toBe('0.00');
    expect(io.rows['43']).toBeUndefined();
  });
  it('100 % everywhere: identical to the old derivation (ř. 43 = ř. 3 + 5 + 12 rounded per row)', () => {
    const full = computeDphdp3(
      [
        e('a', ['3', '43'], '1000.49', '210.10', { vatTreatment: 'rcv_eu_goods_acquisition' }),
        e('b', ['5', '43'], '2000.49', '420.10', { vatTreatment: 'rcv_eu_service_reverse_charge' }),
        e('c', ['12', '43'], '3000.49', '630.10', {
          vatTreatment: 'rcv_non_eu_service_reverse_charge',
        }),
      ],
      'platce',
      rules,
      d('2026-09-01'),
    );
    expect(v(full, '43')).toEqual(['6000.00', '1260.00']);
    expect(full.row62.toFixed2()).toBe('1260.00');
    expect(full.row63.toFixed2()).toBe('1260.00');
  });
});
