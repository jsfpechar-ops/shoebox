import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { computeTaxReserve, type ReserveInput } from '../src/income-tax/reserve';
import type { AnnualTotalsEntry } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
let n = 0;
const nextId = (): number => {
  n += 1;
  return n;
};
const e = (
  taxEffect: AnnualTotalsEntry['taxEffect'],
  amount: string,
  entryDate = '2026-03-01',
  basis: AnnualTotalsEntry['basis'] = 'payment',
): AnnualTotalsEntry => ({
  entryDate: d(entryDate),
  taxYear: Number.parseInt(entryDate.slice(0, 4), 10),
  basis,
  documentId: `doc-${nextId()}`,
  lineId: null,
  categoryCode: 'x',
  taxEffect,
  amountCzk: amount,
  businessSharePct: '100',
  businessAmountCzk: amount,
});
const pay = (categoryCode: string, amount: string, bookedOn: string) => ({
  categoryCode,
  bookedOn: d(bookedOn),
  amount: czk(amount),
});
const months = (cat: string, amount: string, upTo: number) =>
  Array.from({ length: upTo }, (_, i) =>
    pay(cat, amount, `2026-${String(i + 1).padStart(2, '0')}-10`),
  );
const s2 = (o: Partial<ReserveInput> = {}): ReserveInput => ({
  year: 2026,
  regime: 'danova_evidence',
  pausalRate: null,
  pausalDanBand: null,
  entries: [
    e('taxable_income', '1050000.00'),
    e('deductible_expense', '390000.00'),
    e('taxable_income', '200000.00', '2026-11-15'),
    e('taxable_income', '99999.00', '2026-05-05', 'provisional'),
  ],
  payments: [...months('ins_social_own', '5005.00', 9), ...months('ins_health_own', '3306.00', 9)],
  ...o,
});

describe('computeTaxReserve S2 (M06 §9, as of 30. 9. 2026)', () => {
  const r = computeTaxReserve(s2(), rules, d('2026-09-30'));
  it('profit 660 000 → tax 75 870, social 105 996, health 44 550; reserve 151 617 → ≈ 151 600', () => {
    expect(r?.kind).toBe('estimate');
    if (r?.kind !== 'estimate') return;
    expect([r.months, f(r.income), f(r.expense), f(r.profit), f(r.base)]).toEqual([
      9,
      '1050000.00',
      '390000.00',
      '660000.00',
      '660000.00',
    ]);
    expect([f(r.tax), f(r.social), f(r.health)]).toEqual(['75870.00', '105996.00', '44550.00']);
    expect([f(r.paidTax), f(r.paidSocial), f(r.paidHealth)]).toEqual([
      '0.00',
      '45045.00',
      '29754.00',
    ]);
    expect([f(r.reserve), f(r.display)]).toEqual(['151617.00', '151600.00']);
  });
  it('a payment of tax above the estimate never makes the reserve negative; later entries are ignored', () => {
    const r2 = computeTaxReserve(
      s2({
        payments: [
          pay('tax_income_payment', '500000.00', '2026-02-01'),
          pay('ins_social_own', '1.00', '2026-10-01'),
        ],
      }),
      rules,
      d('2026-09-30'),
    );
    if (r2?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r2.paidTax), f(r2.paidSocial), f(r2.reserve)]).toEqual([
      '500000.00',
      '0.00',
      '150546.00',
    ]); // 0 + 105 996 + 44 550
  });
});

describe('computeTaxReserve: threshold, floor100, flat-rate regime, paušální daň, účetnictví', () => {
  it('profit 2 000 000 on 31. 12.: 15 % to 1 762 812 then 23 %; credit 30 840 → tax 288 135', () => {
    const r = computeTaxReserve(
      s2({
        entries: [e('taxable_income', '2600000.00'), e('deductible_expense', '600000.00')],
        payments: [],
      }),
      rules,
      d('2026-12-31'),
    );
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([r.months, f(r.tax), f(r.social), f(r.health), f(r.reserve), f(r.display)]).toEqual([
      12,
      '288135.00',
      '321200.00',
      '135000.00',
      '744335.00',
      '744300.00',
    ]);
  });
  it('base is floored to hundreds: profit 123 456 → base 123 400; a loss → zero everywhere', () => {
    const r = computeTaxReserve(
      s2({ entries: [e('taxable_income', '123456.00')], payments: [] }),
      rules,
      d('2026-12-31'),
    );
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r.profit), f(r.base)]).toEqual(['123456.00', '123400.00']);
    const loss = computeTaxReserve(
      s2({
        entries: [e('taxable_income', '10.00'), e('deductible_expense', '50.00')],
        payments: [],
      }),
      rules,
      d('2026-12-31'),
    );
    if (loss?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(loss.profit), f(loss.tax), f(loss.social), f(loss.reserve)]).toEqual([
      '0.00',
      '0.00',
      '0.00',
      '0.00',
    ]);
  });
  it('pausalni_vydaje 60 %: expense = floor(1 050 000 × 0,6) = 630 000, capped at 1 200 000', () => {
    const r = computeTaxReserve(
      s2({ regime: 'pausalni_vydaje', pausalRate: 60, payments: [] }),
      rules,
      d('2026-09-30'),
    );
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r.expense), f(r.profit), f(r.tax), f(r.social), f(r.health), f(r.display)]).toEqual([
      '630000.00',
      '420000.00',
      '39870.00',
      '67452.00',
      '28350.00',
      '135700.00',
    ]);
    const capped = computeTaxReserve(
      s2({
        regime: 'pausalni_vydaje',
        pausalRate: 60,
        entries: [e('taxable_income', '3000000.00')],
        payments: [],
      }),
      rules,
      d('2026-09-30'),
    );
    if (capped?.kind !== 'estimate') throw new Error('estimate expected');
    expect(f(capped.expense)).toBe('1200000.00');
  });
  it('pausalni_dan: paid vs due YTD (9 × 9 162 = 82 458); ucetnictvi → null', () => {
    const r = computeTaxReserve(
      s2({
        regime: 'pausalni_dan',
        pausalDanBand: 1,
        payments: months('tax_pausal_advance', '9162.00', 8),
      }),
      rules,
      d('2026-09-30'),
    );
    expect(r).toEqual({
      kind: 'pausalni_dan',
      asOf: '2026-09-30',
      paid: czk('73296.00'),
      dueYtd: czk('82458.00'),
    });
    expect(computeTaxReserve(s2({ regime: 'ucetnictvi' }), rules, d('2026-09-30'))).toBeNull();
  });
});
