import { describe, expect, it } from 'vitest';
import {
  CZ_HARD_RULES,
  CZ_KEYWORD_RULES,
  CZ_NACE_CATEGORY_MAP,
  CZ_PLATFORMS,
  CZ_SOFT_RULES,
  parseClassificationRules,
} from '../src/rules/cz/classification';
import { createCzRules } from '../src/rules/index';
import { isCategoryCode } from '../src/taxonomy/categories';

// M04 §4.1 rule tables as data (brief 0302 §2). Every category named by a rule must exist in the
// taxonomy (brief 0301); every confidence is the spec's number.
const rules = createCzRules();
const parsed = parseClassificationRules(rules.at('2026-10-26'));

describe('classification.* seed data parses back to the typed constants', () => {
  it('round-trips through rules.at(date)', () => {
    expect(parsed.hardRules).toEqual(CZ_HARD_RULES);
    expect(parsed.softRules).toEqual(CZ_SOFT_RULES);
    expect(parsed.keywordRules).toEqual(CZ_KEYWORD_RULES);
    expect(parsed.platforms).toEqual(CZ_PLATFORMS);
    expect(parsed.naceCategoryMap).toEqual(CZ_NACE_CATEGORY_MAP);
    expect(parsed.vendorMemoryMinConfirmations).toBe(2);
    expect(parsed.autoAcceptConfidence).toBe(0.8);
    expect(parsed.lowValueSkipCzk).toBe(100);
    expect(parsed.maxServicePeriodDaysForEnd).toBe(62);
    expect(parsed.recurringCategories[0]).toBe('exp_cleaning');
    expect(parsed.recurringCategories[1]).toBe('exp_property_management');
  });

  it('rejects a malformed override', () => {
    const broken = createCzRules([
      {
        key: 'classification.hard_rules',
        layer: 'override',
        valid_from: '2026-01-01',
        valid_to: null,
        source: 'https://github.com/jsfpechar-ops/shoebox',
        verified_at: '2026-01-01',
        value: [{ id: 'X', action: 'teleport' }],
      },
    ]);
    expect(() => parseClassificationRules(broken.at('2026-10-26'))).toThrow();
  });
});

describe('hard rules H1–H5', () => {
  it('ids and actions', () => {
    expect(CZ_HARD_RULES.map((r) => `${r.id}:${r.action}`)).toEqual([
      'H1:inherit_dominant',
      'H1_DISCOUNT:inherit_preceding_item',
      'H2:inherit_dominant',
      'H3_TOURIST_FEE:match_description',
      'H3_DEPOSIT:match_description',
      'H4:authority',
      'H5:inherit_original',
    ]);
  });

  it('H3 patterns and categories', () => {
    const fee = CZ_HARD_RULES[3];
    const deposit = CZ_HARD_RULES[4];
    expect(fee?.action === 'match_description' && fee.category).toBe('pt_tourist_fee');
    expect(fee?.action === 'match_description' && fee.patterns).toEqual([
      'poplatek z pobytu',
      'místní poplatek z pobytu',
      'city tax',
      'tourist tax',
      'taxe de séjour',
      'kurtaxe',
    ]);
    expect(fee?.action === 'match_description' && fee.statement_columns).toEqual(['tourist_fee']);
    expect(deposit?.action === 'match_description' && deposit.category).toBe('pt_deposit');
  });

  it('H4 maps authority kinds to tax/insurance categories; H5 needs 0.8', () => {
    const h4 = CZ_HARD_RULES[5];
    expect(h4?.action === 'authority' && h4.map).toEqual({
      fu_vat: 'tax_vat_payment',
      fu_income_tax: 'tax_income_payment',
      fu_pausal: 'tax_pausal_advance',
      cssz: 'ins_social_own',
      health_insurer: 'ins_health_own',
    });
    const h5 = CZ_HARD_RULES[6];
    expect(h5?.action === 'inherit_original' && h5.min_similarity).toBe(0.8);
  });
});

describe('soft rules S1–S4', () => {
  it('confidences per M04 §4.1', () => {
    const [s1, s2, s3, s4] = CZ_SOFT_RULES;
    expect(s1?.kind === 'platform' && s1.confidence).toBe(0.92);
    expect(s1?.kind === 'platform' && s1.statement_income_confidence).toBe(0.9);
    expect(s2?.kind === 'keywords' && s2.confidence).toBe(0.8);
    expect(s2?.kind === 'keywords' && s2.confidence_two_keywords).toBe(0.88);
    expect(s3?.kind === 'nace' && s3.confidence).toBe(0.75);
    expect(s3?.kind === 'nace' && s3.confidence_with_keywords).toBe(0.9);
    expect(s3?.kind === 'nace' && s3.max_item_lines).toBe(2);
    expect(s4?.kind === 'issued_default' && s4.confidence).toBe(0.7);
    expect(s4?.kind === 'issued_default' && s4.category).toBe('income_services');
  });

  it('keyword rules: the six spec categories plus goods and durable rows', () => {
    const byCategory = Object.fromEntries(CZ_KEYWORD_RULES.map((r) => [r.category, r.keywords]));
    expect(byCategory.exp_cleaning).toEqual(expect.arrayContaining(['úklid', 'cleaning']));
    expect(byCategory.exp_property_management).toEqual(
      expect.arrayContaining(['property management', 'správce']),
    );
    expect(byCategory.exp_hosting_domains).toEqual(
      expect.arrayContaining(['doména', 'domain', 'dns', 'hosting']),
    );
    expect(byCategory.exp_software_saas).toEqual(
      expect.arrayContaining(['předplatné', 'subscription', 'saas', 'api usage', 'credits']),
    );
    expect(byCategory.exp_fuel).toEqual(
      expect.arrayContaining(['nafta', 'benzín', 'natural 95', 'diesel']),
    );
    expect(byCategory.exp_postage_shipping).toEqual(
      expect.arrayContaining(['poštovné', 'doprava', 'shipping']),
    );
    expect(CZ_KEYWORD_RULES.filter((r) => r.role === 'goods').map((r) => r.category)).toEqual([
      'income_goods',
    ]);
    expect(CZ_KEYWORD_RULES.filter((r) => r.role === 'durable').map((r) => r.category)).toEqual([
      'exp_small_assets',
    ]);
  });

  it('NACE map and platforms', () => {
    expect(CZ_NACE_CATEGORY_MAP).toEqual({
      '81.21': 'exp_cleaning',
      '68.32': 'exp_property_management',
      '69.20': 'exp_accounting_legal',
      '61.*': 'exp_telecom',
      '35.*': 'exp_energy',
    });
    expect(CZ_PLATFORMS.map((p) => p.name)).toEqual(['Booking.com B.V.', 'Airbnb Ireland UC']);
  });

  it('every category a rule names exists in the taxonomy', () => {
    const named: string[] = [
      ...Object.values(CZ_NACE_CATEGORY_MAP),
      ...CZ_KEYWORD_RULES.map((r) => r.category),
      ...parsed.recurringCategories,
    ];
    for (const r of CZ_HARD_RULES) {
      if (r.action === 'match_description') named.push(r.category);
      if (r.action === 'authority') named.push(...Object.values(r.map));
    }
    for (const r of CZ_SOFT_RULES) {
      if (r.kind === 'platform') {
        named.push(
          r.commission_category,
          r.payment_fee_category,
          r.accommodation_category,
          r.payout_category,
        );
      }
      if (r.kind === 'issued_default') named.push(r.category, r.goods_category);
    }
    for (const code of named) {
      expect(isCategoryCode(code), code).toBe(true);
    }
  });
});
