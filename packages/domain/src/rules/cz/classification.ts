// Seed data of the product keys M04 reads (06 §2.2, M04 §4.1): the classification thresholds and
// the hard/soft/keyword/platform/NACE rule tables, plus `fx.max_lookback_days`. Product keys are
// not law: their source is the spec file in the repository, and they vary by release, not by year
// (one open-ended base segment). The cascade (taxonomy/cascade.ts) reads them through
// `rules.at(date)` and parses the loose `ModuleOwnedRecord` values with the schemas below.
import { z } from 'zod';
import { Identifier } from '../atoms';
import type { ProductRuleKey } from '../product';
import type { RuleEntryInput } from '../segment';

export const PRODUCT_RULES_SOURCE =
  'https://github.com/jsfpechar-ops/shoebox/blob/main/docs/v3/06-maintenance-playbook.md';
export const PRODUCT_RULES_VALID_FROM = '2025-01-01';
export const PRODUCT_RULES_VERIFIED_AT = '2026-10-26';

// ---------------------------------------------------------------------------------------------
// Schemas (the typed view of the loose `classification.*` records)

const Confidence = z.number().min(0).max(1);

export const HardRuleSchema = z.discriminatedUnion('action', [
  z.strictObject({
    id: z.string().min(1),
    action: z.literal('inherit_dominant'),
    line_types: z.array(z.enum(['rounding', 'shipping', 'advance_deduction'])).min(1),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal('inherit_preceding_item'),
    line_types: z.array(z.enum(['discount'])).min(1),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal('match_description'),
    patterns: z.array(z.string().min(1)).min(1),
    statement_columns: z.array(z.string().min(1)).optional(),
    category: Identifier,
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal('authority'),
    map: z.record(Identifier, Identifier),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal('inherit_original'),
    min_similarity: Confidence,
  }),
]);
export type HardRule = z.output<typeof HardRuleSchema>;

export const SoftRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal('platform'),
    commission_patterns: z.array(z.string().min(1)).min(1),
    commission_category: Identifier,
    payment_fee_patterns: z.array(z.string().min(1)).min(1),
    payment_fee_category: Identifier,
    confidence: Confidence,
    statement_income_confidence: Confidence,
    accommodation_keyword: z.string().min(1),
    accommodation_category: Identifier,
    payout_category: Identifier,
  }),
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal('keywords'),
    confidence: Confidence,
    confidence_two_keywords: Confidence,
  }),
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal('nace'),
    confidence: Confidence,
    confidence_with_keywords: Confidence,
    max_item_lines: z.number().int().min(1),
  }),
  z.strictObject({
    id: z.string().min(1),
    kind: z.literal('issued_default'),
    category: Identifier,
    goods_category: Identifier,
    confidence: Confidence,
  }),
]);
export type SoftRule = z.output<typeof SoftRuleSchema>;

/** `role`: `category` rows feed S2; `goods` rows feed S4; `durable` rows feed the asset check. */
export const KeywordRuleSchema = z.strictObject({
  category: Identifier,
  keywords: z.array(z.string().min(1)).min(1),
  role: z.enum(['category', 'goods', 'durable']),
});
export type KeywordRule = z.output<typeof KeywordRuleSchema>;

export const PlatformSchema = z.strictObject({
  name: z.string().min(1),
  country: z.string().regex(/^[A-Z]{2}$/),
  /** Lower-case fragments; a supplier whose normalized name contains one is this platform. */
  match: z.array(z.string().min(1)).min(1),
});
export type Platform = z.output<typeof PlatformSchema>;

/** A key is an exact NACE code (`81.21`) or a prefix with `.*` (`61.*`). */
export const NaceCategoryMapSchema = z.record(
  z.string().regex(/^\d{2}(\.\d{2}|\.\*)$/),
  Identifier,
);
export type NaceCategoryMap = z.output<typeof NaceCategoryMapSchema>;

export interface ClassificationRules {
  readonly vendorMemoryMinConfirmations: number;
  readonly autoAcceptConfidence: number;
  readonly lowValueSkipCzk: number;
  readonly maxQuestionsPerDocument: number;
  readonly maxServicePeriodDaysForEnd: number;
  readonly recurringCategories: readonly string[];
  readonly hardRules: readonly HardRule[];
  readonly softRules: readonly SoftRule[];
  readonly keywordRules: readonly KeywordRule[];
  readonly platforms: readonly Platform[];
  readonly naceCategoryMap: NaceCategoryMap;
}

/** The typed `classification.*` values of one day; throws a ZodError on malformed seed or override data. */
export function parseClassificationRules(at: {
  get<K extends ProductRuleKey>(key: K): unknown;
}): ClassificationRules {
  return {
    vendorMemoryMinConfirmations: z
      .number()
      .int()
      .parse(at.get('classification.vendor_memory_min_confirmations')),
    autoAcceptConfidence: Confidence.parse(at.get('classification.auto_accept_confidence')),
    lowValueSkipCzk: z.number().int().parse(at.get('classification.low_value_skip_czk')),
    maxQuestionsPerDocument: z
      .number()
      .int()
      .parse(at.get('classification.max_questions_per_document')),
    maxServicePeriodDaysForEnd: z
      .number()
      .int()
      .parse(at.get('classification.max_service_period_days_for_end')),
    recurringCategories: z.array(Identifier).parse(at.get('classification.recurring_categories')),
    hardRules: z.array(HardRuleSchema).parse(at.get('classification.hard_rules')),
    softRules: z.array(SoftRuleSchema).parse(at.get('classification.soft_rules')),
    keywordRules: z.array(KeywordRuleSchema).parse(at.get('classification.keyword_rules')),
    platforms: z.array(PlatformSchema).parse(at.get('classification.platforms')),
    naceCategoryMap: NaceCategoryMapSchema.parse(at.get('classification.nace_category_map')),
  };
}

// ---------------------------------------------------------------------------------------------
// Seed data (M04 §4.1, verified 2026-10-26 against the brief 0302 §2 paste of the spec)

export const CZ_HARD_RULES: readonly HardRule[] = [
  { id: 'H1', action: 'inherit_dominant', line_types: ['rounding', 'shipping'] },
  { id: 'H1_DISCOUNT', action: 'inherit_preceding_item', line_types: ['discount'] },
  { id: 'H2', action: 'inherit_dominant', line_types: ['advance_deduction'] },
  {
    id: 'H3_TOURIST_FEE',
    action: 'match_description',
    patterns: [
      'poplatek z pobytu',
      'místní poplatek z pobytu',
      'city tax',
      'tourist tax',
      'taxe de séjour',
      'kurtaxe',
    ],
    statement_columns: ['tourist_fee'],
    category: 'pt_tourist_fee',
  },
  {
    id: 'H3_DEPOSIT',
    action: 'match_description',
    patterns: ['kauce', 'security deposit', 'damage deposit'],
    category: 'pt_deposit',
  },
  {
    id: 'H4',
    action: 'authority',
    map: {
      fu_vat: 'tax_vat_payment',
      fu_income_tax: 'tax_income_payment',
      fu_pausal: 'tax_pausal_advance',
      cssz: 'ins_social_own',
      health_insurer: 'ins_health_own',
    },
  },
  { id: 'H5', action: 'inherit_original', min_similarity: 0.8 },
];

export const CZ_SOFT_RULES: readonly SoftRule[] = [
  {
    id: 'S1',
    kind: 'platform',
    commission_patterns: ['commission', 'provize', 'kommission'],
    commission_category: 'exp_platform_commission',
    payment_fee_patterns: [
      'payment service*',
      'payments service*',
      'payment charge*',
      'payments charge*',
      'payment fee*',
      'payments fee*',
      'platební služb*',
    ],
    payment_fee_category: 'exp_payment_fees',
    confidence: 0.92,
    statement_income_confidence: 0.9,
    accommodation_keyword: 'accommodation',
    accommodation_category: 'income_accommodation',
    payout_category: 'income_platform_payout',
  },
  { id: 'S2', kind: 'keywords', confidence: 0.8, confidence_two_keywords: 0.88 },
  { id: 'S3', kind: 'nace', confidence: 0.75, confidence_with_keywords: 0.9, max_item_lines: 2 },
  {
    id: 'S4',
    kind: 'issued_default',
    category: 'income_services',
    goods_category: 'income_goods',
    confidence: 0.7,
  },
];

/** A trailing `*` in a keyword matches the rest of the word (`platební služb*` → `platební služby`). */
export const CZ_KEYWORD_RULES: readonly KeywordRule[] = [
  { category: 'exp_cleaning', keywords: ['úklid', 'cleaning', 'reinigung'], role: 'category' },
  {
    category: 'exp_property_management',
    keywords: [
      'správa nemovitosti',
      'správa nemovitostí',
      'správa apartmánu',
      'property management',
      'správce',
      'hausverwaltung',
    ],
    role: 'category',
  },
  {
    category: 'exp_hosting_domains',
    keywords: ['doména', 'domain', 'dns', 'hosting', 'webhosting'],
    role: 'category',
  },
  {
    category: 'exp_software_saas',
    keywords: ['předplatné', 'subscription', 'saas', 'api usage', 'credits'],
    role: 'category',
  },
  { category: 'exp_fuel', keywords: ['nafta', 'benzín', 'natural 95', 'diesel'], role: 'category' },
  {
    category: 'exp_postage_shipping',
    keywords: ['poštovné', 'doprava', 'shipping', 'versand'],
    role: 'category',
  },
  { category: 'income_goods', keywords: ['zboží', 'goods', 'ware'], role: 'goods' },
  {
    category: 'exp_small_assets',
    keywords: [
      'notebook',
      'macbook',
      'laptop',
      'monitor',
      'tiskárna',
      'printer',
      'smartphone',
      'iphone',
      'nábytek',
      'furniture',
      'kamera',
      'camera',
      'vrtačka',
      'drill',
    ],
    role: 'durable',
  },
];

export const CZ_PLATFORMS: readonly Platform[] = [
  { name: 'Booking.com B.V.', country: 'NL', match: ['booking.com', 'booking com'] },
  { name: 'Airbnb Ireland UC', country: 'IE', match: ['airbnb'] },
];

export const CZ_NACE_CATEGORY_MAP: NaceCategoryMap = {
  '81.21': 'exp_cleaning',
  '68.32': 'exp_property_management',
  '69.20': 'exp_accounting_legal',
  '61.*': 'exp_telecom',
  '35.*': 'exp_energy',
};

// 06 §2.2 lists "[exp_cleaning, exp_property_management, …]"; the "…" is read as the recurring
// monthly costs of the personas (brief 0302 spec note 1).
export const CZ_RECURRING_CATEGORIES: readonly string[] = [
  'exp_cleaning',
  'exp_property_management',
  'exp_rent',
  'exp_energy',
  'exp_telecom',
  'exp_software_saas',
  'exp_hosting_domains',
  'exp_platform_commission',
  'exp_accounting_legal',
  'exp_insurance_business',
];

function product(key: ProductRuleKey, value: unknown): RuleEntryInput {
  return {
    key,
    layer: 'base',
    valid_from: PRODUCT_RULES_VALID_FROM,
    valid_to: null,
    source: PRODUCT_RULES_SOURCE,
    verified_at: PRODUCT_RULES_VERIFIED_AT,
    value,
  };
}

/** The product-key entries of lane C (06 §2.2 values), one open-ended segment each. */
export const RULES_CZ_PRODUCT: readonly RuleEntryInput[] = [
  product('fx.max_lookback_days', 7),
  product('classification.vendor_memory_min_confirmations', 2),
  product('classification.auto_accept_confidence', 0.8),
  product('classification.low_value_skip_czk', 100),
  product('classification.max_questions_per_document', 2),
  product('classification.max_service_period_days_for_end', 62),
  product('classification.recurring_categories', CZ_RECURRING_CATEGORIES),
  product('classification.hard_rules', CZ_HARD_RULES),
  product('classification.soft_rules', CZ_SOFT_RULES),
  product('classification.keyword_rules', CZ_KEYWORD_RULES),
  product('classification.platforms', CZ_PLATFORMS),
  product('classification.nace_category_map', CZ_NACE_CATEGORY_MAP),
];
