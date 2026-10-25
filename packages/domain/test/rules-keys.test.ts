import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createRules,
  getRuleKeySchema,
  isRuleKey,
  LAW_RULE_KEYS,
  PRODUCT_RULE_KEYS,
  PRODUCT_RULE_SCHEMAS,
  type ProductRuleKey,
  RULE_KEYS,
  RULE_SCHEMAS,
  type RuleEntryInput,
  RuleEntrySchema,
  RuleMissingError,
  type RuleSet,
  RuleSetSchema,
  RuleValueError,
  UnknownRuleKeyError,
} from '../src/index';

// Fake values only; P0-DOM-05 seeds the real ones.
const SAMPLES: Record<ProductRuleKey, { ok: unknown; bad: unknown }> = {
  'validation.tol.line_qty_price': { ok: { abs: '0.02', rel: 0.5 }, bad: { abs: 0.02, rel: 0.5 } },
  'validation.tol.line_vat': { ok: { abs: '0.10' }, bad: { abs: '0.1' } },
  'validation.tol.vat_row_per_line': {
    ok: { per_line: '0.005', cap: '1.00' },
    bad: { per_line: 0.005, cap: '1.00' },
  },
  'validation.tol.sum': { ok: { abs: '0.01' }, bad: { abs: '-0.01' } },
  'validation.rounding.max_czk': { ok: '1.00', bad: 1 },
  'validation.rounding.max_foreign': { ok: '0.05', bad: '0.050' },
  'validation.discount_patterns': { ok: ['test'], bad: [] },
  'validation.confidence_review_threshold': { ok: 0.5, bad: 1.5 },
  'validation.name_match_min': { ok: 1, bad: -0.1 },
  'validation.future_date_grace_days': { ok: 0, bad: 0.5 },
  'validation.max_document_age_years': { ok: 1, bad: 0 },
  'validation.duzp_issue_gap_days': { ok: 3, bad: -3 },
  'validation.dup_fuzzy_days': { ok: 0, bad: '3' },
  'validation.dup_fuzzy_amount_tol': { ok: '0.00', bad: 0 },
  'validation.personal_purchase': {
    ok: { threshold: 0.5, max_amount_czk: 10, merchants: ['x'], keywords_ref: 'k' },
    bad: { threshold: 0.5, max_amount_czk: 10.5, merchants: [] },
  },
  'validation.vat_id_patterns': { ok: { AT: '^U\\d{8}$' }, bad: { at: '^U\\d{8}$' } },
  'registry.timeout_ms': { ok: 1, bad: 0 },
  'registry.cache_ttl_hours': { ok: { ares: 1, crpdph: 1, vies: 1 }, bad: { ares: 1, crpdph: 1 } },
  'registry.stale_ok_hours': { ok: 1, bad: 1.5 },
  'registry.retry_schedule_minutes': { ok: [1, 2], bad: [] },
  'fx.max_lookback_days': { ok: 1, bad: 0 },
  'classification.vendor_memory_min_confirmations': { ok: 1, bad: 0 },
  'classification.auto_accept_confidence': { ok: 0.9, bad: 9 },
  'classification.low_value_skip_czk': { ok: 1, bad: -1 },
  'classification.max_questions_per_document': { ok: 0, bad: -1 },
  'classification.max_service_period_days_for_end': { ok: 1, bad: 0 },
  'classification.recurring_categories': { ok: ['exp_test'], bad: ['Exp-Test'] },
  'classification.hard_rules': { ok: [{ any: 1 }], bad: { any: 1 } },
  'classification.soft_rules': { ok: [], bad: 'x' },
  'classification.keyword_rules': { ok: [{}], bad: [1] },
  'classification.platforms': { ok: [{ name: 'x' }], bad: null },
  'classification.nace_category_map': {
    ok: { '55.10': 'income_test' },
    bad: { '55.10': 'Income' },
  },
  'classification.global_prior_min_support': { ok: 1, bad: 0 },
  'classification.global_prior_min_agreement': { ok: 0.8, bad: 80 },
  'classification.natural_person_legal_forms': { ok: ['101'], bad: [''] },
  'feature.dpfdp7_partial': { ok: true, bad: 'true' },
  'feature.bank_fio_api': { ok: false, bad: 0 },
  'feature.vat_filings': { ok: true, bad: null },
  'feature.bank': { ok: false, bad: undefined },
};

const SOURCE = 'https://example.invalid/law/test';

function entry(overrides: Record<string, unknown> = {}): RuleEntryInput {
  return {
    key: 'vat.rates',
    layer: 'base',
    valid_from: '2025-01-01',
    valid_to: null,
    source: SOURCE,
    verified_at: '2025-01-15',
    value: { standard: 20, reduced: 10 },
    ...overrides,
  } as RuleEntryInput;
}

describe('product rule schemas (06 §2.2)', () => {
  it('has every key of 06 §2.2 and nothing else', () => {
    expect([...PRODUCT_RULE_KEYS].sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(PRODUCT_RULE_KEYS).toHaveLength(39);
  });

  it.each(PRODUCT_RULE_KEYS)('%s accepts its sample and rejects the bad one', (key) => {
    const schema = PRODUCT_RULE_SCHEMAS[key];
    expect(schema.safeParse(SAMPLES[key].ok).success).toBe(true);
    expect(schema.safeParse(SAMPLES[key].bad).success).toBe(false);
  });
});

describe('the one list of rule keys', () => {
  it('is the union of law and product keys, sorted, without duplicates', () => {
    expect(RULE_KEYS).toEqual([...LAW_RULE_KEYS, ...PRODUCT_RULE_KEYS].sort());
    expect(new Set(RULE_KEYS).size).toBe(LAW_RULE_KEYS.length + PRODUCT_RULE_KEYS.length);
    expect(RULE_KEYS).toHaveLength(75);
    expect(Object.keys(RULE_SCHEMAS).sort()).toEqual(RULE_KEYS);
  });

  it('isRuleKey and getRuleKeySchema agree with the list', () => {
    for (const key of RULE_KEYS) {
      expect(isRuleKey(key)).toBe(true);
      expect(getRuleKeySchema(key)).toBe(RULE_SCHEMAS[key]);
    }
    expect(isRuleKey('vat.unknown')).toBe(false);
    expect(() => getRuleKeySchema('vat.unknown')).toThrow(UnknownRuleKeyError);
    expect(() => getRuleKeySchema('toString')).toThrow(UnknownRuleKeyError);
  });

  it('RuleSet maps each key to its value type', () => {
    expectTypeOf<RuleSet['vat.rates']>().toEqualTypeOf<{ standard: number; reduced: number }>();
    expectTypeOf<RuleSet['feature.bank']>().toEqualTypeOf<boolean>();
    expectTypeOf<RuleSet['validation.rounding.max_czk']>().toEqualTypeOf<string>();
  });
});

describe('RuleEntrySchema and RuleSetSchema', () => {
  it('accepts an entry whose value matches the schema of its key', () => {
    expect(RuleEntrySchema.safeParse(entry()).success).toBe(true);
    expect(
      RuleEntrySchema.safeParse(entry({ key: 'feature.bank', layer: 'override', value: true }))
        .success,
    ).toBe(true);
  });

  it('rejects an unknown key, naming the path', () => {
    const result = RuleEntrySchema.safeParse(entry({ key: 'vat.unknown' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['key']);
  });

  it('rejects a value that fails the schema of its key, with the path under value', () => {
    const result = RuleEntrySchema.safeParse(entry({ value: { standard: 20, reduced: 'ten' } }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['value', 'reduced']);
  });

  it('rejects an entry without a source or with a bad window', () => {
    expect(RuleEntrySchema.safeParse(entry({ source: undefined })).success).toBe(false);
    expect(
      RuleEntrySchema.safeParse(entry({ valid_from: '2025-02-01', valid_to: '2025-01-31' }))
        .success,
    ).toBe(false);
  });

  it('RuleSetSchema validates a whole data file', () => {
    const ok = [entry(), entry({ key: 'feature.bank', value: false })];
    expect(RuleSetSchema.safeParse(ok).success).toBe(true);
    expect(
      RuleSetSchema.safeParse([...ok, entry({ key: 'feature.bank', value: 'no' })]).success,
    ).toBe(false);
  });
});

describe('createRules: the typed resolver over the canonical keys', () => {
  const rules = createRules([
    entry({ valid_to: '2025-12-31' }),
    entry({ valid_from: '2026-01-01', value: { standard: 22, reduced: 11 } }),
    entry({
      key: 'feature.bank',
      layer: 'override',
      valid_from: '2026-03-01',
      valid_to: null,
      value: true,
    }),
  ]);

  it('resolves typed values by date', () => {
    expect(rules.at('2025-12-31').get('vat.rates')).toEqual({ standard: 20, reduced: 10 });
    expect(rules.at('2026-01-01').get('vat.rates')).toEqual({ standard: 22, reduced: 11 });
    expect(rules.at('2026-03-01').get('feature.bank')).toBe(true);
    expectTypeOf(rules.at('2026-01-01').get('vat.rates')).toEqualTypeOf<RuleSet['vat.rates']>();
  });

  it('throws RuleMissingError for a key without data on the date', () => {
    expect(() => rules.at('2026-02-28').get('feature.bank')).toThrow(RuleMissingError);
    expect(() => rules.at('2026-01-01').get('income_tax.rates')).toThrow(RuleMissingError);
  });

  it('rejects entries that fail a per-key schema at build time', () => {
    expect(() => createRules([entry({ value: { standard: 20 } })])).toThrow(RuleValueError);
    expect(() => createRules([entry({ key: 'vat.unknown' })])).toThrow(UnknownRuleKeyError);
  });

  it('lists all 75 keys', () => {
    expect(rules.keys).toEqual(RULE_KEYS);
  });
});
