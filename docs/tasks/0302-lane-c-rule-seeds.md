# 0302: Rule seeds for sorting and money (`classification.*`, `fx.max_lookback_days`, three `vat.*` lists)

Status: todo
Ticket: P1-CAT-01 (acceptance "classification.* seeded exactly as listed in 06 §2.2"), P1-CAT-02 (`vat.eu_member_states`, `vat.out_of_scope_categories`, `vat.reduced_rate_categories`, `fx.max_lookback_days`) | Depends on: 0301 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Seed the product keys the category cascade reads (`classification.*`, `fx.max_lookback_days`) and the three VAT lists the VAT-treatment function reads, so no threshold, keyword list or country list lives in logic code. Every value is pasted below from 06 §2 and M04 §4.1; the executor copies, never invents.

## 2. Context

Hard rule 1: rates, limits and lists live only in `packages/domain/src/rules`. The resolver (`packages/domain/src/rules/resolver.ts`) needs every entry to carry `source` (a URL), `verified_at`, `valid_from`, `valid_to`, `layer`. Product keys are product decisions, not law (06 §2.2): their `source` is the spec file in the repository, `https://github.com/jsfpechar-ops/shoebox/blob/main/docs/v3/06-maintenance-playbook.md`. The schemas already exist in `packages/domain/src/rules/product.ts` (loose `ModuleOwnedRecord` arrays for the seed-data keys) and `law.ts`; this brief tightens nothing there. The typed shape of the seed data and the zod schema that the cascade (brief 0303) uses to parse `rules.at(date).get('classification.hard_rules')` etc. live in the new file.

Values (06 §2.2, M04 §4.1):

```
fx.max_lookback_days                            7
classification.vendor_memory_min_confirmations  2
classification.auto_accept_confidence           0.80
classification.low_value_skip_czk               100
classification.max_questions_per_document       2
classification.max_service_period_days_for_end  62
classification.recurring_categories             [exp_cleaning, exp_property_management, …]   (see note 1)
classification.hard_rules / soft_rules / keyword_rules / platforms / nace_category_map   seed data below
classification.global_prior_* / natural_person_legal_forms   NOT seeded (Later, 06 §2.2)
```

Law lists (06 §2.1):

```
vat.eu_member_states        EU-27 incl. CZ (consumers exclude CZ); 'XI' only for goods   (see note 2)
vat.out_of_scope_categories [pt_tourist_fee, pt_deposit, pt_customs_vat]                  [verify bank fees]
vat.reduced_rate_categories []
```

M04 §4.1 rules, as data:

- H1 `line_type ∈ {rounding, shipping}` → category of the document's dominant item line (largest |gross|, tie → lowest position); `discount` → category of the nearest preceding item line, else dominant.
- H2 `line_type='advance_deduction'` → same category as dominant.
- H3 tourist fee: description matches `poplatek z pobytu | místní poplatek z pobytu | city tax | tourist tax | taxe de séjour | Kurtaxe`, or statement column `tourist_fee` → `pt_tourist_fee`; `kauce | security deposit | damage deposit` → `pt_deposit`.
- H4 supplier is a tax authority / insurer → `tax_*`/`ins_*` per entry (the account list itself is M07's `bank.authority_accounts`; here only the kind → category map).
- H5 `received_credit_note` with `corrects` link → category per line of the original (description similarity ≥ 0.8, else dominant of the original).
- S1 Platform: supplier in `classification.platforms` (Booking.com B.V., Airbnb Ireland UC) and description matches `commission|provize|Kommission` → `exp_platform_commission` (0.92); `payment(s)? (service|charge|fee)|platební služb` → `exp_payment_fees` (0.92); `platform_statement` reservation/payout gross lines → `income_accommodation` if `settings.activity_keywords` includes accommodation, else `income_platform_payout` (0.90).
- S2 Keyword table (cs/en/de, normalized, whole-word): `úklid|cleaning` → `exp_cleaning`, `správa (nemovitosti|apartmánu)|property management|správce` → `exp_property_management`, `doména|domain|DNS|hosting` → `exp_hosting_domains`, `předplatné|subscription|SaaS|API usage|credits` → `exp_software_saas`, `nafta|benzín|natural 95|diesel` → `exp_fuel`, `poštovné|doprava|shipping` → `exp_postage_shipping` (0.80 each; 0.88 if two keywords agree).
- S3 Supplier NACE via `classification.nace_category_map` (`81.21`→`exp_cleaning`, `68.32`→`exp_property_management`, `69.20`→`exp_accounting_legal`, `61.*`→`exp_telecom`, `35.*`→`exp_energy`): 0.75 alone; 0.90 if S2 agrees; only if the document has ≤ 2 item lines.
- S4 `issued_invoice` → `income_services` (0.70) unless lines look like goods (S2 goods keywords) → `income_goods`.
- Asset check durable goods: "LLM `asset_candidate=true` or S2 durable keywords" → a `durable` keyword row.

Notes for the executor: these Czech and German words are matching data for document text, not UI copy (hard rule 6 is about copy). Keywords are matched after normalization (lower-case, diacritics stripped) in brief 0303; store them as written.

Existing code to follow: `packages/domain/src/rules/cz/deadlines.ts` (shared constants imported by both year files) and the `base(key, source, value)` helper in `2025.ts` / `2026.ts`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/classification.ts` | create | typed seed data, zod schemas, `RULES_CZ_PRODUCT` |
| `packages/domain/src/rules/cz/2025.ts` | edit | three `vat.*` list keys |
| `packages/domain/src/rules/cz/2026.ts` | edit | same |
| `packages/domain/src/rules/cz/index.ts` | edit | include product entries, export |
| `packages/domain/src/rules/index.ts` | edit | re-export `RULES_CZ_PRODUCT` |
| `packages/domain/test/rules-values.test.ts` | edit | counts, keys, hosts, dates, new assertions |
| `packages/domain/test/rules-classification.test.ts` | create | the test file below, verbatim |

No other file may change.

## 4. Steps

1. Create `packages/domain/src/rules/cz/classification.ts` with exactly:

```ts
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
export const NaceCategoryMapSchema = z.record(z.string().regex(/^\d{2}(\.\d{2}|\.\*)$/), Identifier);
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
```

Command: `pnpm exec biome check --write packages/domain/src/rules/cz/classification.ts 2>&1 | tail -5` (formatting only; if biome reports a lint error, STOP and report it).

2. Edit `packages/domain/src/rules/cz/2025.ts` and `packages/domain/src/rules/cz/2026.ts` (same change in both).

   In both files, find the anchor line

   ```ts
     base('vat.deadline_day', `${ZDPH}#p101`, 25),
   ```

   and insert after it:

   ```ts
     // Treaty on European Union, Art. 52: the 27 member states (CZ included; VAT consumers that need
     // "other member states" exclude CZ themselves). 'XI' (Northern Ireland, goods only) is not listed:
     // TODO(verify): add 'XI' once the goods-only rule has a place in the schema.
     {
       ...base('vat.eu_member_states', 'https://eur-lex.europa.eu/eli/treaty/teu_2016/oj', [
         'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
         'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
       ]),
       verified_at: '2026-10-26',
     },
     // ZDPH § 2: pass-through amounts (tourist fee, deposits, customs VAT) are not a supply of the
     // taxpayer. TODO(verify): bank fees (06 §2.1 "[verify bank fees]").
     {
       ...base('vat.out_of_scope_categories', `${ZDPH}#p2`, [
         'pt_tourist_fee', 'pt_deposit', 'pt_customs_vat',
       ]),
       verified_at: '2026-10-26',
     },
     // ZDPH § 47 and příloha č. 2: none of the seeded categories is a reduced-rate service by default
     // (06 §2.1: `[]`, "[verify per service]" in M04 §4.2).
     { ...base('vat.reduced_rate_categories', `${ZDPH}#p47`, []), verified_at: '2026-10-26' },
   ```

   Command: `pnpm exec biome check --write packages/domain/src/rules/cz/2025.ts packages/domain/src/rules/cz/2026.ts 2>&1 | tail -5`.

3. Edit `packages/domain/src/rules/cz/index.ts` and `packages/domain/src/rules/index.ts`.

   In `cz/index.ts`, replace

   ```ts
   import { RULES_CZ_2025 } from './2025';
   import { RULES_CZ_2026 } from './2026';

   /** All seeded Czech entries, oldest year first. */
   export const CZ_RULE_ENTRIES: readonly RuleEntryInput[] = [...RULES_CZ_2025, ...RULES_CZ_2026];
   ```

   with

   ```ts
   import { RULES_CZ_2025 } from './2025';
   import { RULES_CZ_2026 } from './2026';
   import { RULES_CZ_PRODUCT } from './classification';

   /** All seeded Czech entries: law by year (oldest first), then the open-ended product keys. */
   export const CZ_RULE_ENTRIES: readonly RuleEntryInput[] = [
     ...RULES_CZ_2025,
     ...RULES_CZ_2026,
     ...RULES_CZ_PRODUCT,
   ];
   ```

   and replace the last line `export { RULES_CZ_2025, RULES_CZ_2026 };` with `export { RULES_CZ_2025, RULES_CZ_2026, RULES_CZ_PRODUCT };`.

   In `rules/index.ts`, replace

   ```ts
   export { CZ_RULE_ENTRIES, createCzRules, RULES_CZ_2025, RULES_CZ_2026 } from './cz/index';
   ```

   with

   ```ts
   export {
     CZ_RULE_ENTRIES,
     createCzRules,
     RULES_CZ_2025,
     RULES_CZ_2026,
     RULES_CZ_PRODUCT,
   } from './cz/index';
   ```

   Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`. Expected: no error lines.

4. Edit `packages/domain/test/rules-values.test.ts` (five anchors, all must be found):

   a. Replace `  RULES_CZ_2026,\n  type RuleKey,` (the import list) with `  RULES_CZ_2026,\n  RULES_CZ_PRODUCT,\n  type RuleKey,`.

   b. Replace the whole `SEEDED_KEYS` array with:

   ```ts
   const SEEDED_KEYS: readonly RuleKey[] = [
     'asset.capitalization_threshold',
     'calendar.cz_public_holidays',
     'cash.payment_limit',
     'deadlines.generators',
     'insurance.min_advances',
     'pausalni_dan.bands',
     'pausalni_dan.deadlines',
     'pausalni_dan.eligibility',
     'pausalni_vydaje.rates_caps',
     'vat.cnb_rate_rule',
     'vat.deadline_day',
     'vat.deduction_deferral_years',
     'vat.eu_member_states',
     'vat.io_eu_goods_threshold',
     'vat.kh_document_limit',
     'vat.out_of_scope_categories',
     'vat.rates',
     'vat.reduced_rate_categories',
     'vat.registration_thresholds',
     'vat.ruceni_cash_threshold',
     'vat.simplified_document_limit',
   ];
   ```

   c. Replace

   ```ts
   const PRIMARY_HOSTS = [
     'www.zakonyprolidi.cz',
     'financnisprava.gov.cz',
     'www.cssz.gov.cz',
     'www.vzp.cz',
     'eur-lex.europa.eu',
   ];
   ```

   with

   ```ts
   const PRIMARY_HOSTS = [
     'www.zakonyprolidi.cz',
     'financnisprava.gov.cz',
     'www.cssz.gov.cz',
     'www.vzp.cz',
     'eur-lex.europa.eu',
     // product keys (06 §2.2) are product decisions: their source is the spec in this repository
     'github.com',
   ];
   ```

   d. Replace `expect(CZ_RULE_ENTRIES).toHaveLength(RULES_CZ_2025.length + RULES_CZ_2026.length);` with `expect(CZ_RULE_ENTRIES).toHaveLength(\n      RULES_CZ_2025.length + RULES_CZ_2026.length + RULES_CZ_PRODUCT.length,\n    );`; replace `expect(['2026-10-18', '2026-10-25']).toContain(entry.verified_at);` with `expect(['2026-10-18', '2026-10-25', '2026-10-26']).toContain(entry.verified_at);`; replace `expect(RULES_CZ_2025).toHaveLength(18);\n    expect(RULES_CZ_2026).toHaveLength(19);` with `expect(RULES_CZ_2025).toHaveLength(21);\n    expect(RULES_CZ_2026).toHaveLength(22);`; replace `expect(RULES_CZ_2026.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(18);` with `expect(RULES_CZ_2026.filter((entry) => entry.valid_from === '2026-01-01')).toHaveLength(21);`.

   e. Append at the end of the file:

   ```ts
   describe('VAT lists (brief 0302)', () => {
     it('vat.eu_member_states: EU-27 incl. CZ, no XI, in both years', () => {
       for (const date of ['2025-12-31', '2026-01-01']) {
         const states = rules.at(date).get('vat.eu_member_states');
         expect(states).toHaveLength(27);
         expect(states).toContain('CZ');
         expect(states).toContain('IE');
         expect(states).not.toContain('XI');
         expect(states).not.toContain('GB');
         expect(states).not.toContain('US');
       }
     });

     it('vat.out_of_scope_categories and vat.reduced_rate_categories', () => {
       for (const date of ['2025-12-31', '2026-01-01']) {
         expect(rules.at(date).get('vat.out_of_scope_categories')).toEqual([
           'pt_tourist_fee',
           'pt_deposit',
           'pt_customs_vat',
         ]);
         expect(rules.at(date).get('vat.reduced_rate_categories')).toEqual([]);
       }
     });
   });

   describe('product keys of lane C (06 §2.2, brief 0302)', () => {
     it('one open-ended base segment per key from 2025-01-01', () => {
       expect(RULES_CZ_PRODUCT).toHaveLength(12);
       for (const entry of RULES_CZ_PRODUCT) {
         expect(entry.layer).toBe('base');
         expect(entry.valid_from).toBe('2025-01-01');
         expect(entry.valid_to).toBeNull();
         expect(new URL(entry.source).hostname).toBe('github.com');
       }
       expect(new Set(RULES_CZ_PRODUCT.map((e) => e.key)).size).toBe(12);
     });

     it('the numeric thresholds', () => {
       const at = rules.at('2026-10-26');
       expect(at.get('fx.max_lookback_days')).toBe(7);
       expect(at.get('classification.vendor_memory_min_confirmations')).toBe(2);
       expect(at.get('classification.auto_accept_confidence')).toBe(0.8);
       expect(at.get('classification.low_value_skip_czk')).toBe(100);
       expect(at.get('classification.max_questions_per_document')).toBe(2);
       expect(at.get('classification.max_service_period_days_for_end')).toBe(62);
       expect(rules.at('2024-12-31').has('fx.max_lookback_days')).toBe(false);
     });
   });
   ```

   Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`. Expected: all rules test files green.

5. Create `packages/domain/test/rules-classification.test.ts` with exactly:

```ts
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
    const byCategory = Object.fromEntries(
      CZ_KEYWORD_RULES.map((r) => [r.category, r.keywords]),
    );
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
```

Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`. Expected: green incl. `rules-classification.test.ts`. If a test fails because of a value you typed, fix the seed (not the test); if the test itself seems wrong, STOP.

6. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` and `pnpm exec biome check packages/domain 2>&1 | tail -10`. Expected: clean.

## 5. Do not touch

`packages/domain/src/rules/product.ts`, `law.ts`, `keys.ts` (no new key, no schema change), `packages/domain/src/index.ts`, every other package. Hard rules 1, 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] `rules-values.test.ts` and `rules-classification.test.ts` green; `rules-keys.test.ts` still reports 75 keys (no new key).
- [ ] `rules.at('2026-10-26').get('classification.auto_accept_confidence')` is `0.8`; `fx.max_lookback_days` is `7`.
- [ ] Commits `0302 step 1` … `0302 step 6`; no push.

## 8. Stop and ask

As TEMPLATE §8 (anchor missing, a test fails twice, 25 tool calls / 50k tokens, a dependency, a file outside §3).

## 9. Report

`docs/tasks/0302-report.md`, `Status: review`, commit `0302 report`. Note any `[verify]` left in the seed comments (XI, bank fees, reduced-rate categories).

## Spec notes for the reviewer

1. `classification.recurring_categories` is listed in 06 §2.2 as `[exp_cleaning, exp_property_management, …]`; the "…" was filled with the personas' recurring monthly costs. Not read by any wave-1 function; safe to change.
2. `vat.eu_member_states` schema is a plain country list; the 06 remark "'XI' only for goods" cannot be expressed, so XI is left out (safer: a GB/XI supplier is treated as non-EU for services, which is right; for goods from Northern Ireland the acquisition would be routed as import → accountant, which is the conservative path). TODO(verify) in the seed.
3. `vat.out_of_scope_categories` carries 06's three codes; bank fees stay deductible expenses with VAT treatment derived from the document (06 "[verify bank fees]").
4. Product entries use a GitHub URL as `source` (the resolver requires a URL and the values test requires an allow-listed host); `github.com` was added to that allow-list for product keys only.

## Risk list (for the reviewer)

`packages/domain/src/rules/cz/classification.ts` (every number against 06 §2.2 / M04 §4.1), the `vat.*` hunks in `2025.ts` / `2026.ts`.

## Owner steps

None.
