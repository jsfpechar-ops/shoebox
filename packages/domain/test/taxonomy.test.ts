import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { TAX_EFFECT_VALUES } from '../src/enums/index';
import {
  CATEGORIES,
  CATEGORY_CODES,
  categoryAllowsDirection,
  deriveDeductibility,
  findCategory,
  getCategory,
  isCategoryCode,
  isCategoryValidOn,
  UnknownCategoryError,
} from '../src/taxonomy/categories';

// 04 §3.1, pasted into brief 0301 §2. The order is the spec's order; `sort` follows it.
const SPEC: Record<string, string[]> = {
  taxable_income: [
    'income_services', 'income_goods', 'income_accommodation', 'income_platform_payout',
    'income_other_taxable',
  ],
  non_taxable_income: [
    'income_interest', 'income_subsidy', 'income_loan_received', 'income_owner_deposit',
    'income_vat_refund',
  ],
  deductible_expense: [
    'exp_material', 'exp_goods_for_resale', 'exp_small_assets', 'exp_services_general',
    'exp_software_saas', 'exp_hosting_domains', 'exp_telecom', 'exp_rent', 'exp_energy',
    'exp_cleaning', 'exp_property_management', 'exp_platform_commission', 'exp_payment_fees',
    'exp_bank_fees', 'exp_advertising', 'exp_accounting_legal', 'exp_postage_shipping',
    'exp_travel_transport', 'exp_fuel', 'exp_car_operating', 'exp_car_lease', 'exp_repairs',
    'exp_insurance_business', 'exp_training_education', 'exp_office_supplies', 'exp_salaries',
    'exp_other_deductible',
  ],
  non_deductible_expense: ['exp_representation', 'exp_fines_penalties', 'exp_other_non_deductible'],
  asset: ['asset_long_term'],
  pass_through: ['pt_tourist_fee', 'pt_deposit', 'pt_customs_vat'],
  tax_or_insurance_payment: [
    'tax_vat_payment', 'tax_income_payment', 'tax_pausal_advance', 'ins_social_own',
    'ins_health_own', 'tax_other_fees',
  ],
  transfer: [
    'transfer_own_accounts', 'transfer_cash_deposit', 'transfer_cash_withdrawal',
    'loan_repayment_principal',
  ],
  private: ['private_expense', 'private_withdrawal'],
};

describe('CATEGORIES (04 §3.1)', () => {
  it('has the 56 codes of the spec, each exactly once, in spec order', () => {
    const expected = Object.values(SPEC).flat();
    expect(expected).toHaveLength(56);
    expect([...CATEGORY_CODES]).toEqual(expected);
    expect(CATEGORIES.map((c) => c.code)).toEqual(expected);
    expect(new Set(CATEGORY_CODES).size).toBe(56);
  });

  it('maps every code to the tax effect of its spec group', () => {
    for (const [taxEffect, codes] of Object.entries(SPEC)) {
      for (const code of codes) {
        expect(getCategory(code).taxEffect, code).toBe(taxEffect);
      }
    }
    expect(Object.keys(SPEC).sort()).toEqual([...TAX_EFFECT_VALUES].sort());
  });

  it('sort is strictly increasing, labels and icons are non-empty, codes are snake_case', () => {
    let last = -1;
    for (const c of CATEGORIES) {
      expect(c.sort).toBeGreaterThan(last);
      last = c.sort;
      expect(c.labelEn.length).toBeGreaterThan(0);
      expect(c.explanationEn.length).toBeGreaterThan(0);
      expect(c.icon).toMatch(/^[a-z0-9-]+$/);
      expect(c.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c.validFrom).toBe('2000-01-01');
      expect(c.validTo).toBeNull();
      expect(c.replacedBy).toBeNull();
    }
  });

  it('directions: income out, expenses/assets/taxes in, pass-through and transfers both', () => {
    for (const code of [...SPEC.taxable_income, ...SPEC.non_taxable_income]) {
      expect(getCategory(code).direction, code).toBe('out');
    }
    for (const code of [
      ...SPEC.deductible_expense, ...SPEC.non_deductible_expense, ...SPEC.asset,
      ...SPEC.tax_or_insurance_payment, 'private_expense',
    ]) {
      expect(getCategory(code).direction, code).toBe('in');
    }
    for (const code of [...SPEC.pass_through, ...SPEC.transfer, 'private_withdrawal']) {
      expect(getCategory(code).direction, code).toBe('both');
    }
    expect(categoryAllowsDirection(getCategory('pt_tourist_fee'), 'in')).toBe(true);
    expect(categoryAllowsDirection(getCategory('pt_tourist_fee'), 'out')).toBe(true);
    expect(categoryAllowsDirection(getCategory('exp_cleaning'), 'out')).toBe(false);
    expect(categoryAllowsDirection(getCategory('income_services'), 'in')).toBe(false);
  });

  it('lookups', () => {
    expect(isCategoryCode('exp_cleaning')).toBe(true);
    expect(isCategoryCode('exp_nope')).toBe(false);
    expect(findCategory('exp_nope')).toBeUndefined();
    expect(() => getCategory('exp_nope')).toThrow(UnknownCategoryError);
    expect(isCategoryValidOn(getCategory('exp_cleaning'), '2026-10-26')).toBe(true);
    expect(isCategoryValidOn(getCategory('exp_cleaning'), '1999-12-31')).toBe(false);
    expect(
      isCategoryValidOn(
        { ...getCategory('exp_cleaning'), validTo: '2026-06-30' as never },
        '2026-07-01',
      ),
    ).toBe(false);
  });
});

describe('deriveDeductibility (M04 §4.1)', () => {
  const cases: Array<[string, string, string]> = [
    ['exp_cleaning', '100', 'deductible'],
    ['exp_cleaning', '80', 'partially_deductible'],
    ['exp_cleaning', '0.01', 'partially_deductible'],
    ['exp_cleaning', '0', 'non_deductible'],
    ['exp_representation', '100', 'non_deductible'],
    ['exp_representation', '0', 'non_deductible'],
    ['asset_long_term', '100', 'not_applicable'],
    ['private_expense', '0', 'non_deductible'],
    ['private_expense', '100', 'non_deductible'],
    ['income_services', '100', 'not_applicable'],
    ['income_interest', '100', 'not_applicable'],
    ['pt_tourist_fee', '100', 'not_applicable'],
    ['transfer_own_accounts', '100', 'not_applicable'],
    ['tax_vat_payment', '100', 'not_applicable'],
  ];
  it.each(cases)('%s at %s %% → %s', (code, share, expected) => {
    expect(deriveDeductibility(getCategory(code), share)).toBe(expected);
    expect(deriveDeductibility(getCategory(code), new Decimal(share))).toBe(expected);
  });

  it('rejects a share outside 0..100', () => {
    expect(() => deriveDeductibility(getCategory('exp_cleaning'), '101')).toThrow(RangeError);
    expect(() => deriveDeductibility(getCategory('exp_cleaning'), '-1')).toThrow(RangeError);
  });
});
