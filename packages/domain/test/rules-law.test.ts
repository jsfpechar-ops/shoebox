import { describe, expect, it } from 'vitest';
import { LAW_RULE_KEYS, LAW_RULE_SCHEMAS, type LawRuleKey } from '../src/rules/law';

// Fake values only (no number here is a law value; P0-DOM-05 seeds the real ones). Every key has
// one accepted and one rejected sample; the exhaustiveness test fails when a key is added without.
const SAMPLES: Record<LawRuleKey, { ok: unknown; bad: unknown }> = {
  'vat.rates': { ok: { standard: 20, reduced: 10 }, bad: { standard: 20 } },
  'vat.registration_thresholds': {
    ok: { calendar_year: 1_000, immediate: 2_000 },
    bad: { calendar_year: 1_000.5, immediate: 2_000 },
  },
  'vat.registration_turnover_policy': {
    ok: { exclude_treatments: ['iss_test'], always_include_categories: [] },
    bad: { exclude_treatments: ['Not-Snake'], always_include_categories: [] },
  },
  'vat.kh_document_limit': { ok: 1_000, bad: -1 },
  'vat.simplified_document_limit': { ok: 1_000, bad: '1000' },
  'vat.io_eu_goods_threshold': { ok: 5, bad: 5.5 },
  'vat.deduction_deferral_years': { ok: 0, bad: -1 },
  'vat.ruceni_cash_threshold': { ok: 7, bad: null },
  'vat.cnb_rate_rule': { ok: 'rate_valid_on_date_else_last_published', bad: 'latest' },
  'vat.deadline_day': { ok: 31, bad: 32 },
  'vat.simple_period_policy': { ok: { version: 'test-1', max_docs: 3 }, bad: { max_docs: 3 } },
  'vat.return_rounding': { ok: 'round_base_then_multiply', bad: 'none' },
  'vat.shv_rounding': { ok: 'floor', bad: 'truncate' },
  'vat.amendment_windows': {
    ok: { dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 1 },
    bad: { dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 0 },
  },
  'vat.eu_member_states': { ok: ['CZ', 'XI'], bad: ['cz'] },
  'vat.out_of_scope_categories': { ok: ['pt_test'], bad: 'pt_test' },
  'vat.reduced_rate_categories': { ok: [], bad: [1] },
  'pausalni_vydaje.rates_caps': { ok: { '80': 100, '60': 50 }, bad: { '70': 100 } },
  'pausalni_dan.bands': {
    ok: [
      {
        band: 1,
        monthly: 100,
        ceilings: [{ max_income: 10 }, { max_income: 20, requires_dominant_rate_in: [80] }],
      },
    ],
    bad: [{ band: 4, monthly: 100, ceilings: [{ max_income: 10 }] }],
  },
  'pausalni_dan.eligibility': {
    ok: { max_income: 10, max_other_income: 1 },
    bad: { max_income: 10 },
  },
  'pausalni_dan.deadlines': {
    ok: { entry: '01-10', exit: '12-31', advance_day: 20 },
    bad: { entry: '13-10', exit: '12-31', advance_day: 20 },
  },
  'income_tax.rates': {
    ok: { r1: 10, r2: 20, threshold_annual: 5 },
    bad: { r1: 10, r2: 120, threshold_annual: 5 },
  },
  'income_tax.credits': { ok: { taxpayer: 1 }, bad: { taxpayer: '1' } },
  'insurance.min_advances': {
    ok: { social: 1, health: 2 },
    bad: { social: 1, health: 2, other: 3 },
  },
  'insurance.rates': {
    ok: { social_pct: 1.5, social_base_pct: 50, health_pct: 2.25, health_base_pct: 50 },
    bad: { social_pct: 1.555, social_base_pct: 50, health_pct: 2, health_base_pct: 50 },
  },
  'asset.capitalization_threshold': { ok: 9, bad: 9.9 },
  'cash.payment_limit': {
    ok: { amount: 100, currency: 'EUR' },
    bad: { amount: 100, currency: 'USD' },
  },
  'calendar.cz_public_holidays': {
    ok: { fixed: ['01-01'], movable: { '2030': ['04-19'] } },
    bad: { fixed: ['01-01'], movable: { '30': ['04-19'] } },
  },
  'deadlines.generators': { ok: [{ kind: 'test_kind', extra: true }], bad: [{ due: 'x' }] },
  'municipal.tourist_fee': {
    ok: { test_town: { report_deadline_days_after_month: 1, rate_per_bed_night: 1, account: 'x' } },
    bad: { test_town: { report_deadline_days_after_month: 0, rate_per_bed_night: 1 } },
  },
  'bank.authority_accounts': { ok: { fu_test: { prefix: '1' } }, bad: { 'Fu-Test': {} } },
  'epo.forms': { ok: { TESTF1: { version: '00.00.01' } }, bad: { testf1: {} } },
  'epo.dphdp3_row_map': {
    ok: [{ row: '1', attrs: ['a_test'], treatment: 'test_treatment', side: 'output', rate: 'x' }],
    bad: [{ row: '1', attrs: [], treatment: 'test_treatment', side: 'output' }],
  },
  'epo.kh_routing': { ok: { any: 'shape' }, bad: ['list'] },
  'epo.fu_payment_accounts': {
    ok: { c_test: { prefix: '1', number: '2', bank_code: '0000' } },
    bad: { c_test: { prefix: '1', number: '2', bank_code: '000' } },
  },
  'privacy.retention_years_after_year': { ok: 1, bad: 0 },
};

describe('law rule schemas (06 §2.1)', () => {
  it('has every key of 06 §2.1 and nothing else', () => {
    expect([...LAW_RULE_KEYS].sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(LAW_RULE_KEYS).toHaveLength(36);
  });

  it.each(LAW_RULE_KEYS)('%s accepts its sample and rejects the bad one', (key) => {
    const schema = LAW_RULE_SCHEMAS[key];
    const sample = SAMPLES[key];
    expect(schema.safeParse(sample.ok).success).toBe(true);
    expect(schema.safeParse(sample.bad).success).toBe(false);
  });

  it('strict objects reject unknown fields', () => {
    expect(
      LAW_RULE_SCHEMAS['vat.rates'].safeParse({ standard: 1, reduced: 1, super: 1 }).success,
    ).toBe(false);
  });

  it('percentages allow at most two decimals', () => {
    expect(LAW_RULE_SCHEMAS['vat.rates'].safeParse({ standard: 21.5, reduced: 0 }).success).toBe(
      true,
    );
    expect(LAW_RULE_SCHEMAS['vat.rates'].safeParse({ standard: 21.555, reduced: 0 }).success).toBe(
      false,
    );
  });
});
