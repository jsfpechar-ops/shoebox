import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { TaxEffect } from '../src/enums/index';
import { type AnnualTotalsEntry, computeAnnualTotals } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';

const d = parseLegalDate;
let seq = 0;
const nextSeq = (): number => {
  seq += 1;
  return seq;
};
const e = (
  categoryCode: string,
  taxEffect: TaxEffect,
  amountCzk: string,
  o: Partial<AnnualTotalsEntry> = {},
): AnnualTotalsEntry => ({
  entryDate: d('2026-06-15'),
  taxYear: 2026,
  basis: 'payment',
  documentId: `doc-${nextSeq()}`,
  lineId: `line-${seq}`,
  categoryCode,
  taxEffect,
  amountCzk,
  businessSharePct: '100',
  businessAmountCzk: amountCzk,
  ...o,
});
const f2 = (m: Money) => m.toFixed2();
const byCode = (list: ReadonlyArray<{ categoryCode: string; amount: Money }>) =>
  Object.fromEntries(list.map((c) => [c.categoryCode, f2(c.amount)]));

// M06 §9 S4: P4 Josef 2026 (fixture CZK amounts; the MacBook is booked at 100 % in this scenario).
const s4: AnnualTotalsEntry[] = [
  e('income_accommodation', 'taxable_income', '180000.00'),
  e('income_services', 'taxable_income', '60000.00'),
  e('exp_cleaning', 'deductible_expense', '11600.00'),
  e('exp_cleaning', 'deductible_expense', '8150.00'),
  e('exp_property_management', 'deductible_expense', '12960.84'),
  e('exp_property_management', 'deductible_expense', '9749.44'),
  e('exp_platform_commission', 'deductible_expense', '13699.77'),
  e('exp_platform_commission', 'deductible_expense', '11549.94'),
  e('exp_small_assets', 'deductible_expense', '26990.00', { documentId: 'macbook' }),
  e('exp_material', 'deductible_expense', '1198.00', { documentId: 'ikea' }),
  e('exp_material', 'deductible_expense', '117.00', { documentId: 'alza' }),
  e('exp_hosting_domains', 'deductible_expense', '226.50'),
  e('exp_software_saas', 'deductible_expense', '2218.32'),
  e('pt_tourist_fee', 'pass_through', '3500.00'),
  e('pt_tourist_fee', 'pass_through', '4150.00'),
  e('exp_other_deductible', 'private', '249.00', {
    documentId: 'decathlon',
    businessSharePct: '0',
    businessAmountCzk: '0.00',
  }),
  e('tax_vat_payment', 'tax_or_insurance_payment', '2877.00'),
  e('tax_vat_payment', 'tax_or_insurance_payment', '2471.00'),
  e('transfer_own', 'transfer', '10000.00'),
  e('income_services', 'taxable_income', '85000.00', { entryDate: d('2027-01-04'), taxYear: 2027 }),
  e('income_services', 'taxable_income', '5000.00', {
    basis: 'provisional',
    entryDate: d('2026-12-20'),
  }),
];

describe('computeAnnualTotals S4 (M06 §9)', () => {
  const t = computeAnnualTotals(s4, 2026);
  it('income 240 000,00 by category; the 2027 entry and the provisional one are not in it', () => {
    expect(f2(t.incomeTotal)).toBe('240000.00');
    expect(byCode(t.income)).toEqual({
      income_accommodation: '180000.00',
      income_services: '60000.00',
    });
    expect(t.income.map((c) => c.categoryCode)).toEqual([
      'income_accommodation',
      'income_services',
    ]);
  });
  it('deductible 98 459,81; tourist fee 7 650 only in pass-through; Decathlon 249 private; VAT payments listed', () => {
    expect(f2(t.deductibleTotal)).toBe('98459.81');
    expect(byCode(t.passThrough)).toEqual({ pt_tourist_fee: '7650.00' });
    expect(f2(t.privatePart)).toBe('249.00');
    expect(t.privateItems[0]?.entries[0]?.documentId).toBe('decathlon');
    expect(byCode(t.taxAndInsurancePayments)).toEqual({ tax_vat_payment: '5348.00' });
    expect(t.transfersCount).toBe(1);
    expect(t.assets).toEqual([]);
  });
  it('provisional listed, not counted; entryCount excludes it and the other year', () => {
    expect(t.provisionalCount).toBe(1);
    expect(byCode(t.provisional)).toEqual({ income_services: '5000.00' });
    expect(t.entryCount).toBe(19);
    expect(t.year).toBe(2026);
  });
  it('drill-down keeps document ids and entry order', () => {
    const mat = t.deductible.find((c) => c.categoryCode === 'exp_material');
    expect(mat?.entries.map((x) => x.documentId)).toEqual(['ikea', 'alza']);
    expect(mat?.entryCount).toBe(2);
  });
});

describe('computeAnnualTotals S2 shapes and edge cases', () => {
  it('S2: phone at 50 % → 12 000 deductible + 12 000 private; representation listed; van as asset; insurance in payments', () => {
    const t = computeAnnualTotals(
      [
        e('income_services', 'taxable_income', '1400000.00'),
        e('exp_material', 'deductible_expense', '400000.00'),
        e('exp_fuel', 'deductible_expense', '60000.00'),
        e('exp_telecom', 'deductible_expense', '24000.00', {
          businessSharePct: '50',
          businessAmountCzk: '12000.00',
        }),
        e('exp_small_assets', 'deductible_expense', '48000.00'),
        e('exp_representation', 'non_deductible_expense', '4000.00'),
        e('asset_long_term', 'asset', '650000.00', { entryDate: d('2026-05-12') }),
        e('ins_social_own', 'tax_or_insurance_payment', '60060.00'),
        e('ins_health_own', 'tax_or_insurance_payment', '39672.00'),
      ],
      2026,
    );
    expect(f2(t.incomeTotal)).toBe('1400000.00');
    expect(f2(t.deductibleTotal)).toBe('520000.00');
    expect(f2(t.privatePart)).toBe('12000.00');
    expect(byCode(t.nonDeductible)).toEqual({ exp_representation: '4000.00' });
    expect(f2(t.nonDeductibleTotal)).toBe('4000.00');
    expect(byCode(t.assets)).toEqual({ asset_long_term: '650000.00' });
    expect(byCode(t.taxAndInsurancePayments)).toEqual({
      ins_health_own: '39672.00',
      ins_social_own: '60060.00',
    });
    const phone = t.deductible.find((c) => c.categoryCode === 'exp_telecom');
    expect([
      f2(phone?.businessAmount ?? Money.zero(CZK)),
      f2(phone?.privateAmount ?? Money.zero(CZK)),
    ]).toEqual(['12000.00', '12000.00']);
  });
  it('a refund larger than the purchase gives a negative category total', () => {
    const t = computeAnnualTotals(
      [
        e('exp_material', 'deductible_expense', '1198.00'),
        e('exp_material', 'deductible_expense', '-1500.00'),
      ],
      2026,
    );
    expect(byCode(t.deductible)).toEqual({ exp_material: '-302.00' });
    expect(f2(t.deductibleTotal)).toBe('-302.00');
  });
  it('non-taxable income is listed and not in incomeTotal; empty input → zeros', () => {
    const t = computeAnnualTotals([e('income_subsidy', 'non_taxable_income', '50000.00')], 2026);
    expect(f2(t.incomeTotal)).toBe('0.00');
    expect(byCode(t.nonTaxableIncome)).toEqual({ income_subsidy: '50000.00' });
    const z = computeAnnualTotals([], 2026);
    expect([f2(z.incomeTotal), f2(z.deductibleTotal), f2(z.privatePart), z.entryCount]).toEqual([
      '0.00',
      '0.00',
      '0.00',
      0,
    ]);
  });
});

describe('properties (M06 §9 general 4)', () => {
  const effects: TaxEffect[] = [
    'taxable_income',
    'non_taxable_income',
    'deductible_expense',
    'non_deductible_expense',
    'asset',
    'pass_through',
    'transfer',
    'tax_or_insurance_payment',
    'private',
  ];
  const arbEntry = fc
    .record({
      categoryCode: fc.constantFrom('a', 'b', 'c'),
      taxEffect: fc.constantFrom(...effects),
      cents: fc.integer({ min: -5_000_000, max: 5_000_000 }),
      share: fc.constantFrom(0, 25, 50, 80, 100),
      provisional: fc.boolean(),
    })
    .map(({ categoryCode, taxEffect, cents, share, provisional }) => {
      const amount = Money.fromDecimal(Money.parse(String(cents), CZK).toDecimal().div(100), CZK);
      const business = Money.fromDecimal(
        amount.toDecimal().times(share).div(100).toDecimalPlaces(2),
        CZK,
      );
      return e(categoryCode, taxEffect, amount.toFixed2(), {
        businessSharePct: String(share),
        businessAmountCzk: business.toFixed2(),
        basis: provisional ? 'provisional' : 'payment',
      });
    });
  it('Σ categories = bucket totals and amount = business + private for every category', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 40 }), (entries) => {
        const t = computeAnnualTotals(entries, 2026);
        const sum = (
          list: readonly { amount: Money }[],
          pick: (c: { amount: Money; businessAmount: Money }) => Money = (c) => c.amount,
        ) =>
          Money.sum(
            list.map((c) => pick(c as { amount: Money; businessAmount: Money })),
            CZK,
          );
        expect(f2(sum(t.income))).toBe(f2(t.incomeTotal));
        expect(f2(sum(t.deductible, (c) => c.businessAmount))).toBe(f2(t.deductibleTotal));
        expect(f2(sum(t.nonDeductible))).toBe(f2(t.nonDeductibleTotal));
        for (const list of [
          t.income,
          t.deductible,
          t.nonDeductible,
          t.passThrough,
          t.assets,
          t.privateItems,
          t.provisional,
        ]) {
          for (const c of list)
            expect(f2(c.businessAmount.add(c.privateAmount))).toBe(f2(c.amount));
        }
        expect(t.entryCount + t.provisionalCount).toBe(entries.length);
      }),
      { numRuns: 200 },
    );
  });
});
