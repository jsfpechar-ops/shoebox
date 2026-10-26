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
  periodStart: d('2026-08-01'),
  periodEnd: d('2026-08-31'),
  vatPointDate: d('2026-08-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge',
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

describe('computeDphdp3 golden (M05 §9 #1–#3)', () => {
  it('August 2026 IO: row 5 = 13 700 / 2 877, ř.62 = ř.64 = 2 877, trans A, no row 43', () => {
    const c = computeDphdp3(
      [e('booking-jul', ['5'], '13699.77', '2876.95')],
      'identifikovana_osoba',
      rules,
      d('2026-08-01'),
    );
    expect(v(c, '5')).toEqual(['13700.00', '2877.00']);
    expect(c.raw['5']?.base.toFixed2()).toBe('13699.77');
    expect([c.row62, c.row63, c.row64, c.row65].map((m) => m.toFixed2())).toEqual([
      '2877.00',
      '0.00',
      '2877.00',
      '0.00',
    ]);
    expect(c.trans).toBe('A');
    expect(Object.keys(c.rows)).toEqual(['5']);
    expect(c).toMatchObject({
      status: 'identifikovana_osoba',
      rounding: 'sum_entries_then_round',
      documentIds: ['booking-jul'],
      entryCount: 1,
    });
  });
  it('September 2026 IO: 11 550 / 2 425; 2 426 under round_base_then_multiply', () => {
    const sep = [e('booking-aug', ['5'], '11549.94', '2425.49', { vatPointDate: d('2026-09-03') })];
    expect(v(computeDphdp3(sep, 'identifikovana_osoba', rules, d('2026-09-01')), '5')).toEqual([
      '11550.00',
      '2425.00',
    ]);
    const alt = computeDphdp3(
      sep,
      'identifikovana_osoba',
      rules,
      d('2026-09-01'),
      'round_base_then_multiply',
    );
    expect(v(alt, '5')).toEqual(['11550.00', '2426.00']);
    expect(alt.rounding).toBe('round_base_then_multiply');
  });
  it('October 2026 IO: row 12 Cloudflare 245 / 52, row 5 Anthropic 2 212 / 465, ř.62 = 517', () => {
    const c = computeDphdp3(
      [
        e('cloudflare', ['12'], '245.35', '51.52', {
          vatTreatment: 'rcv_non_eu_service_reverse_charge',
          currency: 'USD',
        }),
        e('anthropic', ['5'], '2212.20', '464.56', { currency: 'EUR' }),
      ],
      'identifikovana_osoba',
      rules,
      d('2026-10-01'),
    );
    expect(v(c, '12')).toEqual(['245.00', '52.00']);
    expect(v(c, '5')).toEqual(['2212.00', '465.00']);
    expect(c.row62.toFixed2()).toBe('517.00');
    expect(c.row64.toFixed2()).toBe('517.00');
    expect(c.documentIds).toEqual(['anthropic', 'cloudflare']);
  });
});

describe('computeDphdp3 payer', () => {
  const sep = [
    e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat' }),
    e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
    e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
    e('booking-aug', ['5', '43'], '11549.94', '2425.49'),
    e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat' }),
    e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat' }),
    e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat' }),
  ];
  it('synthetic September: rows 1/5/40, derived 43/46, ř.62–65', () => {
    const c = computeDphdp3(sep, 'platce', rules, d('2026-09-01'));
    expect(v(c, '1')).toEqual(['26529.00', '5571.00']);
    expect(v(c, '5')).toEqual(['11550.00', '2425.00']);
    expect(v(c, '40')).toEqual(['1784.00', '375.00']);
    expect(v(c, '43')).toEqual(['11550.00', '2425.00']);
    expect(dphdp3Row(c, '46').tax.toFixed2()).toBe('2800.00');
    expect([c.row62, c.row63, c.row64, c.row65].map((m) => m.toFixed2())).toEqual([
      '7996.00',
      '2800.00',
      '5196.00',
      '0.00',
    ]);
    expect(c.trans).toBe('A');
    expect(
      Object.keys(c.rows).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)),
    ).toEqual(['1', '5', '40', '43', '46']);
  });
  it('P5: 43 = 3+5+12 and 44 = 4+6+13 from rounded rows; 64 − 65 = 62 − 63; one of 64/65 is zero', () => {
    const c = computeDphdp3(
      [
        e('g', ['3', '43'], '1000.50', '210.11', { vatTreatment: 'rcv_eu_goods_acquisition' }),
        e('s', ['5', '43'], '2000.50', '420.11'),
        e('n', ['12', '43'], '3000.50', '630.11', {
          vatTreatment: 'rcv_non_eu_service_reverse_charge',
        }),
        e('r', ['6', '44'], '100.49', '12.06', { vatRateType: 'reduced', vatRatePct: 12 }),
      ],
      'platce',
      rules,
      d('2026-09-01'),
    );
    expect(v(c, '43')).toEqual(['6003.00', '1260.00']); // 1001 + 2001 + 3001; 210 + 420 + 630
    expect(v(c, '44')).toEqual(['100.00', '12.00']);
    expect(c.row64.subtract(c.row65).equals(c.row62.subtract(c.row63))).toBe(true);
    expect(c.row64.isZero() || c.row65.isZero()).toBe(true);
  });
  it('credit only (row 40) → ř.65, trans N; nil return → all zero, trans N', () => {
    const credit = computeDphdp3(
      [e('m', ['40'], '1784.16', '374.68', { vatTreatment: 'rcv_domestic_vat' })],
      'platce',
      rules,
      d('2026-09-01'),
    );
    expect(
      [credit.row62, credit.row63, credit.row64, credit.row65].map((m) => m.toFixed2()),
    ).toEqual(['0.00', '375.00', '0.00', '375.00']);
    expect(credit.trans).toBe('N');
    const nil = computeDphdp3([], 'platce', rules, d('2026-09-01'));
    expect(nil.rows).toEqual({});
    expect(nil.row64.isZero() && nil.trans === 'N' && nil.entryCount === 0).toBe(true);
  });
  it('P6: IO never gets 43/44/46 and ř.64 = ř.62; row 21 alone sets trans A for a payer', () => {
    const io = computeDphdp3(
      [e('s', ['5'], '2000.50', '420.11')],
      'identifikovana_osoba',
      rules,
      d('2026-09-01'),
    );
    expect(Object.keys(io.rows)).toEqual(['5']);
    expect(io.row64.equals(io.row62)).toBe(true);
    const sh = computeDphdp3(
      [e('eu', ['21'], '3000.30', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3 })],
      'platce',
      rules,
      d('2026-09-01'),
    );
    expect(v(sh, '21')).toEqual(['3000.00', '0.00']);
    expect(sh.trans).toBe('A');
    expect(sh.row62.isZero()).toBe(true);
  });
  it('unknown row throws', () => {
    expect(() =>
      computeDphdp3([e('x', ['99'], '1.00', '0.21')], 'platce', rules, d('2026-09-01')),
    ).toThrow(/unknown row/);
  });
});
