# 0017c: Rule schemas: product keys, the one key list, `RuleSet`, `getRuleKeySchema` and `createRules`

Status: done
Ticket: P0-DOM-04 | Depends on: 0017b (merged into phase/0 first) | Base commit: head of phase/0 | Branch: task/0017c-rules-keys | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the 39 product keys of 06 §2.2 (validation tolerances, registry timings, classification thresholds, feature flags) and merge both tables into the one canonical key list: `RULE_SCHEMAS`, the typed `RuleSet`, `getRuleKeySchema(key)` for the admin override editor, `RuleEntrySchema`/`RuleSetSchema` for data files and `rules_overrides` rows, and `createRules(entries)` whose `at(date).get('vat.rates')` is typed. This closes P0-DOM-04: P0-DOM-05 then only adds data.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo, do not open any file this brief does not name. Setup: `pnpm install --frozen-lockfile 2>&1 | tail -3`, then `git fetch origin phase/0 && git checkout -b task/0017c-rules-keys origin/phase/0`. Commit after each step as `0017c step k`.

Hard rules that apply (AGENTS.md): 1 (money is never a float; no `parseFloat`/`Number()` in `packages/domain`, Biome plugin `no-number-money` fails the build), 2 (`packages/domain` is pure: no `Date.now()`, no `new Date()`, no I/O imports; dependency-cruiser allows only `decimal.js`, `zod` and the package itself), 7 (no dependency other than the ones this brief names), 8 (never push to `main`). Rates, limits and deadlines live only in `packages/domain/src/rules`; **this brief seeds no law value** (that is P0-DOM-05): every number in the tests below is fake.

Spec lines (pasted; do not open `docs/v3/`):

- 06 §2.2 product keys (hotfixable through `rules_overrides`, not law), with their shapes: `validation.tol.line_qty_price {abs: 0.02, rel: 0.0005}`, `validation.tol.line_vat {abs: 0.02}`, `validation.tol.vat_row_per_line 0.005 (cap 1.00)`, `validation.tol.sum {abs: 0.01}`, `validation.rounding.max_czk 1.00`, `validation.rounding.max_foreign 0.05`, `validation.discount_patterns [...]`, `validation.confidence_review_threshold 0.80`, `validation.name_match_min 0.85`, `validation.future_date_grace_days 1`, `validation.max_document_age_years 11`, `validation.duzp_issue_gap_days 15`, `validation.dup_fuzzy_days 3`, `validation.dup_fuzzy_amount_tol 0.00`, `validation.personal_purchase {threshold, max_amount_czk, merchants, keywords_ref}`, `validation.vat_id_patterns {AT:'^U\\d{8}$', …}`, `registry.timeout_ms 3000`, `registry.cache_ttl_hours {ares, crpdph, vies}`, `registry.stale_ok_hours 72`, `registry.retry_schedule_minutes [15, 60, 360, 1440]`, `fx.max_lookback_days 7`, `classification.vendor_memory_min_confirmations 2`, `classification.auto_accept_confidence 0.80`, `classification.low_value_skip_czk 100`, `classification.max_questions_per_document 2`, `classification.max_service_period_days_for_end 62`, `classification.recurring_categories [exp_…]`, `classification.hard_rules / soft_rules / keyword_rules / platforms / nace_category_map` (seed data, versioned), `classification.global_prior_min_support 5 / global_prior_min_agreement 0.8 / natural_person_legal_forms […]` (Later), feature flags `feature.dpfdp7_partial`, `feature.bank_fio_api`, `feature.vat_filings`, `feature.bank` ("stored as product keys in `packages/domain/rules`, no flag service").
- 06 §2: "This is the **only** list of rule keys." Keys 06 lists as merged or removed (`validation.dup_phash_max_distance`, `validation.expected_invoice_days`, `validation.vat_threshold_warn_pcts`, `io_triggers.registration_days`, `classification.authority_registry`, `classification.llm`, `eu_member_states`, `epo.dphdp3_row_sides`, `income_tax.dap_deadlines`) are **not** keys.
- M12 §4.9 item 5: the editor selects `rule_key` from `RuleSet` keys and validates the JSON value "against the zod schema of that key" → `getRuleKeySchema(key)`; the preview calls `rules.at(date)`.
- Backlog P0-DOM-04: "Zod `RuleSet` with one schema per rule key"; "`getRuleKeySchema(key)` exported for the admin editor".

Design decisions fixed by this brief: `validation.tol.vat_row_per_line` is `{ per_line: '0.005', cap: '1.00' }`; CZK tolerances are `MoneyString` (two decimals) or `DecimalString`; `RuleSet` is the **type** `{ [key]: value type }` and `RuleSetSchema` the zod schema of a data file (an array of entries). Total keys: 36 law + 39 product = 75.

Excerpt the step-3 edit replaces (`packages/domain/src/rules/index.ts`, the whole file as 0017b left it):

```ts
export {
  CountryCode,
  CzkWhole,
  DayOfMonth,
  DecimalString,
  Digits,
  Identifier,
  ModuleOwnedRecord,
  MoneyString,
  MonthDay,
  NonNegInt,
  Pct,
  PositiveInt,
  Ratio,
  YearKey,
} from './atoms';
export {
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
export type { LawRuleKey } from './law';
export { LAW_RULE_KEYS, LAW_RULE_SCHEMAS } from './law';
export type { RuleKeyOf, RuleResolver, RuleSchemaMap, RulesAt, RuleValueOf } from './resolver';
export { createRuleResolver } from './resolver';
export type { RuleEntry, RuleEntryInput, RuleLayer } from './segment';
export { LegalDateSchema, RULE_LAYERS, RuleEntryMetaSchema, ruleEntrySchema } from './segment';
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/product.ts` | new | `PRODUCT_RULE_SCHEMAS`, `PRODUCT_RULE_KEYS`, `ProductRuleKey` |
| `packages/domain/src/rules/keys.ts` | new | `RULE_SCHEMAS`, `RULE_KEYS`, `RuleKey`, `RuleSet`, `isRuleKey`, `getRuleKeySchema`, `RuleEntrySchema`, `RuleSetSchema`, `createRules` |
| `packages/domain/src/rules/index.ts` | replace | adds the `keys` and `product` export blocks |
| `packages/domain/test/rules-keys.test.ts` | new | the spec (52 tests); never edited |

No other file may change.

## 4. Steps

### Step 1: `packages/domain/src/rules/product.ts` (new, full content)

```ts
// One zod schema per product key (06 §2.2): hotfixable through `rules_overrides`, not law.
// Shapes only; values are seeded by P0-DOM-05. Keys whose shape is seed data owned by a module
// (M03/M04 rule tables) stay loose until that module's ticket tightens them.
import { z } from 'zod';
import {
  CountryCode,
  CzkWhole,
  DecimalString,
  Identifier,
  ModuleOwnedRecord,
  MoneyString,
  NonNegInt,
  PositiveInt,
  Ratio,
} from './atoms';

export const PRODUCT_RULE_SCHEMAS = {
  'validation.tol.line_qty_price': z.strictObject({ abs: MoneyString, rel: Ratio }),
  'validation.tol.line_vat': z.strictObject({ abs: MoneyString }),
  'validation.tol.vat_row_per_line': z.strictObject({ per_line: DecimalString, cap: MoneyString }),
  'validation.tol.sum': z.strictObject({ abs: MoneyString }),
  'validation.rounding.max_czk': MoneyString,
  'validation.rounding.max_foreign': MoneyString,
  'validation.discount_patterns': z.array(z.string().min(1)).min(1),
  'validation.confidence_review_threshold': Ratio,
  'validation.name_match_min': Ratio,
  'validation.future_date_grace_days': NonNegInt,
  'validation.max_document_age_years': PositiveInt,
  'validation.duzp_issue_gap_days': NonNegInt,
  'validation.dup_fuzzy_days': NonNegInt,
  'validation.dup_fuzzy_amount_tol': MoneyString,
  'validation.personal_purchase': z.looseObject({
    threshold: Ratio,
    max_amount_czk: CzkWhole,
    merchants: z.array(z.string().min(1)),
  }),
  'validation.vat_id_patterns': z.record(CountryCode, z.string().min(1)),
  'registry.timeout_ms': PositiveInt,
  'registry.cache_ttl_hours': z.strictObject({
    ares: PositiveInt,
    crpdph: PositiveInt,
    vies: PositiveInt,
  }),
  'registry.stale_ok_hours': PositiveInt,
  'registry.retry_schedule_minutes': z.array(PositiveInt).min(1),
  'fx.max_lookback_days': PositiveInt,
  'classification.vendor_memory_min_confirmations': PositiveInt,
  'classification.auto_accept_confidence': Ratio,
  'classification.low_value_skip_czk': CzkWhole,
  'classification.max_questions_per_document': NonNegInt,
  'classification.max_service_period_days_for_end': PositiveInt,
  'classification.recurring_categories': z.array(Identifier),
  // module-owned seed data (M04): one record per rule or platform.
  'classification.hard_rules': z.array(ModuleOwnedRecord),
  'classification.soft_rules': z.array(ModuleOwnedRecord),
  'classification.keyword_rules': z.array(ModuleOwnedRecord),
  'classification.platforms': z.array(ModuleOwnedRecord),
  'classification.nace_category_map': z.record(z.string().min(1), Identifier),
  'classification.global_prior_min_support': PositiveInt,
  'classification.global_prior_min_agreement': Ratio,
  'classification.natural_person_legal_forms': z.array(z.string().min(1)),
  'feature.dpfdp7_partial': z.boolean(),
  'feature.bank_fio_api': z.boolean(),
  'feature.vat_filings': z.boolean(),
  'feature.bank': z.boolean(),
} as const;

export type ProductRuleKey = keyof typeof PRODUCT_RULE_SCHEMAS;
export const PRODUCT_RULE_KEYS = Object.keys(PRODUCT_RULE_SCHEMAS) as readonly ProductRuleKey[];
```

Command: `git add -A && git commit -q -m '0017c step 1' && git log --oneline -1 | tail -1`. Expected: one line with `0017c step 1`.

### Step 2: `packages/domain/src/rules/keys.ts` (new, full content)

```ts
// The one list of rule keys (06 §2: "this is the only list of rule keys") with its per-key zod
// schemas, the typed `RuleSet`, the entry/data-file schemas and the typed resolver factory.
import { z } from 'zod';
import { UnknownRuleKeyError } from './errors';
import { LAW_RULE_SCHEMAS } from './law';
import { PRODUCT_RULE_SCHEMAS } from './product';
import { createRuleResolver, type RuleResolver } from './resolver';
import { type RuleEntryInput, ruleEntrySchema } from './segment';

export const RULE_SCHEMAS = { ...LAW_RULE_SCHEMAS, ...PRODUCT_RULE_SCHEMAS } as const;

export type RuleKey = keyof typeof RULE_SCHEMAS;
export const RULE_KEYS = Object.keys(RULE_SCHEMAS).sort() as readonly RuleKey[];

/** The resolved value type of every key: `RuleSet['vat.rates']` is `{ standard: number; reduced: number }`. */
export type RuleSet = { readonly [K in RuleKey]: z.output<(typeof RULE_SCHEMAS)[K]> };

export function isRuleKey(key: string): key is RuleKey {
  return Object.hasOwn(RULE_SCHEMAS, key);
}

/** The zod schema of one key (M12 §4.9 admin editor); throws `UnknownRuleKeyError`. */
export function getRuleKeySchema(key: string): z.ZodType {
  if (!isRuleKey(key)) throw new UnknownRuleKeyError(key);
  return RULE_SCHEMAS[key];
}

/** One entry with its value checked against the schema of its key (one `rules_overrides` row, one data-file item). */
export const RuleEntrySchema = ruleEntrySchema(z.unknown()).superRefine((entry, ctx) => {
  if (!isRuleKey(entry.key)) {
    ctx.addIssue({ code: 'custom', path: ['key'], message: `Unknown rule key "${entry.key}"` });
    return;
  }
  const result = RULE_SCHEMAS[entry.key].safeParse(entry.value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['value', ...issue.path], message: issue.message });
    }
  }
});

/** A data file or a list of override rows: every item is a valid `RuleEntrySchema`. */
export const RuleSetSchema = z.array(RuleEntrySchema);

/** The typed resolver over the canonical keys: `createRules(entries).at(date).get('vat.rates')`. */
export function createRules(entries: readonly RuleEntryInput[]): RuleResolver<typeof RULE_SCHEMAS> {
  return createRuleResolver(entries, RULE_SCHEMAS);
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`, exit 0. Commit.

### Step 3: `packages/domain/src/rules/index.ts` (replace the whole file with this content; already in Biome's sort order)

First `grep -nF "from './keys'" packages/domain/src/rules/index.ts | head -3` must print nothing (otherwise STOP, §8). Then write the file:

```ts
export {
  CountryCode,
  CzkWhole,
  DayOfMonth,
  DecimalString,
  Digits,
  Identifier,
  ModuleOwnedRecord,
  MoneyString,
  MonthDay,
  NonNegInt,
  Pct,
  PositiveInt,
  Ratio,
  YearKey,
} from './atoms';
export {
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
export type { RuleKey, RuleSet } from './keys';
export {
  createRules,
  getRuleKeySchema,
  isRuleKey,
  RULE_KEYS,
  RULE_SCHEMAS,
  RuleEntrySchema,
  RuleSetSchema,
} from './keys';
export type { LawRuleKey } from './law';
export { LAW_RULE_KEYS, LAW_RULE_SCHEMAS } from './law';
export type { ProductRuleKey } from './product';
export { PRODUCT_RULE_KEYS, PRODUCT_RULE_SCHEMAS } from './product';
export type { RuleKeyOf, RuleResolver, RuleSchemaMap, RulesAt, RuleValueOf } from './resolver';
export { createRuleResolver } from './resolver';
export type { RuleEntry, RuleEntryInput, RuleLayer } from './segment';
export { LegalDateSchema, RULE_LAYERS, RuleEntryMetaSchema, ruleEntrySchema } from './segment';
```

Command: `pnpm exec biome check packages/domain/src/rules 2>&1 | tail -5`. Expected: `Checked 8 files … No fixes applied.` (a fixable formatting issue: run once with `--write` and re-check; an error `--write` does not fix: STOP, §8). Commit.

### Step 4: `packages/domain/test/rules-keys.test.ts` (new, full content; do not edit it)

```ts
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
```

Command: `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30`. Expected: `Test Files  3 passed (3)`, `Tests  127 passed (127)` (36 engine + 39 law + 52 keys). Commit.

### Step 5: full checks and the report

Run the §6 commands, then §9.

## 5. Do not touch

- Anything outside §3. In particular not `atoms.ts`, `law.ts`, `errors.ts`, `segment.ts`, `resolver.ts`, the two existing `test/rules-*.test.ts` files, `packages/domain/src/index.ts`, `packages/domain/src/money/**`, `package.json`, `pnpm-lock.yaml`, `docs/v3/`.
- Do not edit `test/rules-keys.test.ts` or a given source file to make something pass (§8).
- Do not add a data file or any real value (P0-DOM-05), and no key beyond the 75 listed.
- Hard rules 1, 2, 7 (no new dependency), 8.

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30` → `Tests  127 passed (127)`.
2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0.
3. `pnpm lint 2>&1 | tail -30` → `Found 0 errors` (a pre-existing `info` line is fine).
4. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found`.
5. `pnpm test:unit 2>&1 | tail -30` → all test files pass; coverage `Lines` for `packages/domain/src/**` ≥ 90 %.

## 7. Acceptance (mirrors the ticket)

- [ ] Zod schema per rule key: `RULE_SCHEMAS` has exactly 75 keys (36 law + 39 product, sorted, no duplicates), the typed `RuleSet` maps each key to its value type, and every product key accepts one fake valid value and rejects one invalid value.
- [ ] Every value carries `valid_from`, `valid_to`, `source` URL and `verified_at`; `RuleEntrySchema` rejects a missing source, a bad window, an unknown key (path `['key']`) and a value failing its key's schema (path `['value', …]`); `RuleSetSchema` validates a whole data file.
- [ ] `packages/domain/test/rules-engine.test.ts` (0017a) still green: boundaries, amendment beats base, overrides apply last, `RuleMissingError`, purity.
- [ ] `getRuleKeySchema(key)` exported from `@shoebox/domain`, returns the key's schema, throws `UnknownRuleKeyError` (also for `'toString'`).
- [ ] `createRules(entries).at(date).get('vat.rates')` is typed as `RuleSet['vat.rates']`.
- Not in this ticket: real values (P0-DOM-05), the DB loader of `rules_overrides` rows (apps, later), the admin editor UI (M12).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (the source files are given in full; if a given file fails its own tests, the brief is wrong: do not patch either side, report it);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, `Done: steps 1 to k. Left: steps k+1 to n.`);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0017c-report.md` (600 tokens at most), set `Status: review` in this brief, commit as `0017c report`, then `git push -u origin task/0017c-rules-keys 2>&1 | tail -3`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0...HEAD`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

HIGH (tax rules). Read `packages/domain/src/rules/keys.ts` (`RuleEntrySchema` refine paths, `getRuleKeySchema` uses `Object.hasOwn`, `createRules` passes the full map) and `product.ts` key by key against 06 §2.2 (39 keys, names verbatim). Confirm `test/rules-keys.test.ts` is byte-identical to this brief and holds no real value. After merge the orchestrator ticks P0-DOM-04 in the backlog and notes the `src/rules/` path deviation.

## Owner steps

None.
