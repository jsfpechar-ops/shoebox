# 0017b: Rule schemas: shared atoms and one zod schema per law key (06 §2.1)

Status: done
Ticket: P0-DOM-04 | Depends on: 0017a (merged into phase/0 first) | Base commit: head of phase/0 | Branch: task/0017b-rules-law | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Give every law key of 06 §2.1 (36 keys: VAT rates and thresholds, flat-rate caps, paušální daň bands, income-tax rates and credits, insurance, holidays, EPO forms, …) its own zod schema, built from shared atoms that keep amounts out of floats. The admin override editor and the P0-DOM-05 data files validate against these shapes, so a mistyped law value is rejected before it can reach a filing.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo, do not open any file this brief does not name. Setup: `pnpm install --frozen-lockfile 2>&1 | tail -3`, then `git fetch origin phase/0 && git checkout -b task/0017b-rules-law origin/phase/0`. Commit after each step as `0017b step k`.

Hard rules that apply (AGENTS.md): 1 (money is never a float; no `parseFloat`/`Number()` in `packages/domain`, Biome plugin `no-number-money` fails the build), 2 (`packages/domain` is pure: no `Date.now()`, no `new Date()`, no I/O imports; dependency-cruiser allows only `decimal.js`, `zod` and the package itself), 7 (no dependency other than the ones this brief names), 8 (never push to `main`). Rates, limits and deadlines live only in `packages/domain/src/rules`; **this brief seeds no law value** (that is P0-DOM-05): every number in the tests below is fake.

Spec lines (pasted; do not open `docs/v3/`):

- 06 §2: "Location: `packages/domain/rules/cz/<year>.ts`, typed with a zod schema `RuleSet`." "This is the **only** list of rule keys … A module that needs a new key adds it here in the same PR."
- 06 §2.1 is the law-key table; its 36 keys, with the 2026 value shapes that fix the schemas below: `vat.rates {standard: 21, reduced: 12}`, `vat.registration_thresholds {calendar_year, immediate}`, `vat.registration_turnover_policy {exclude_treatments: [...], always_include_categories: [...]}`, `vat.kh_document_limit 10_000`, `vat.simplified_document_limit`, `vat.io_eu_goods_threshold`, `vat.deduction_deferral_years 2`, `vat.ruceni_cash_threshold`, `vat.cnb_rate_rule 'rate_valid_on_date_else_last_published'`, `vat.deadline_day 25`, `vat.simple_period_policy {version, allowed_treatments, …} (M05 §4.3)`, `vat.return_rounding 'sum_entries_then_round' | 'round_base_then_multiply'`, `vat.shv_rounding 'ceil'`, `vat.amendment_windows {dp3_dodatecne_due: 'end_of_month_after_discovery', kh_nasledne_working_days: 5}`, `vat.eu_member_states` (EU-27 codes, `'XI'` for goods), `vat.out_of_scope_categories [pt_…]`, `vat.reduced_rate_categories []`, `pausalni_vydaje.rates_caps {80: …, 60: …, 40: …, 30: …}`, `pausalni_dan.bands [{band, monthly, ceilings:[{max_income, requires_dominant_rate_in?}]}]`, `pausalni_dan.eligibility {max_income, max_other_income}`, `pausalni_dan.deadlines {entry: '01-10', exit: '01-10', advance_day: 20}`, `income_tax.rates {r1, r2, threshold_annual}`, `income_tax.credits {taxpayer}`, `insurance.min_advances {social, health}`, `insurance.rates {social_pct: 29.2, social_base_pct, health_pct: 13.5, health_base_pct}`, `asset.capitalization_threshold`, `cash.payment_limit [{valid_to:'2027-07-09', czk:270_000}, {valid_from:'2027-07-10', eur:10_000}]`, `calendar.cz_public_holidays {fixed:[…], movable:{2026:[…]}}`, `deadlines.generators [{kind, …}]` (fields in M05 §4.12, M06 §4.12, M09 §4.7), `municipal.tourist_fee {praha3: {report_deadline_days_after_month, rate_per_bed_night, account}}`, `bank.authority_accounts {fu_vat: {prefix, vs}, …}`, `epo.forms {DPHDP3:{version, verze_pis, xsd, …}, DPFDP7:{tax_years, …}}`, `epo.dphdp3_row_map [{row, attrs, treatment, rate, side, kind}]`, `epo.kh_routing` (data version of a research table), `epo.fu_payment_accounts {c_ufo: {prefix, number, bank_code}}`, `privacy.retention_years_after_year 10`.
- 03 ADR-007: money is never a float. Hence the atoms: whole-CZK law amounts are integers (`CzkWhole`), fractional amounts are decimal strings (`MoneyString`, `DecimalString`) parsed by consumers with `Money`/`decimal.js`; percentages and ratios are plain numbers (factors, not money), percentages limited to two decimals.

Design decisions fixed by this brief:

- `cash.payment_limit` keeps its two regimes as two **entries** (the envelope's `valid_from`/`valid_to` carry the dates); the value is `{ amount, currency: 'CZK' | 'EUR' }`.
- `pausalni_vydaje.rates_caps` is keyed by the percentage as text (`'80'`), a partial record.
- Keys whose shape is defined by a module spec not implemented yet (`vat.simple_period_policy`, `deadlines.generators`, `bank.authority_accounts`, `epo.forms`, `epo.kh_routing`, `epo.dphdp3_row_map` extra fields, `municipal.tourist_fee` extra fields) are **loose objects with the required fields only**, marked `module-owned`; the module ticket that reads the key tightens the schema in the same PR.

Excerpt the step-3 edit replaces (`packages/domain/src/rules/index.ts`, the whole file as 0017a left it):

```ts
export {
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
export type { RuleKeyOf, RuleResolver, RuleSchemaMap, RulesAt, RuleValueOf } from './resolver';
export { createRuleResolver } from './resolver';
export type { RuleEntry, RuleEntryInput, RuleLayer } from './segment';
export { LegalDateSchema, RULE_LAYERS, RuleEntryMetaSchema, ruleEntrySchema } from './segment';
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/atoms.ts` | new | `CzkWhole`, `MoneyString`, `DecimalString`, `Pct`, `Ratio`, `NonNegInt`, `PositiveInt`, `DayOfMonth`, `MonthDay`, `YearKey`, `CountryCode`, `Identifier`, `Digits`, `ModuleOwnedRecord` |
| `packages/domain/src/rules/law.ts` | new | `LAW_RULE_SCHEMAS`, `LAW_RULE_KEYS`, `LawRuleKey` |
| `packages/domain/src/rules/index.ts` | replace | adds the `atoms` and `law` export blocks |
| `packages/domain/test/rules-law.test.ts` | new | the spec (39 tests); never edited |

No other file may change.

## 4. Steps

### Step 1: `packages/domain/src/rules/atoms.ts` (new, full content)

```ts
// Building blocks shared by the per-key rule schemas (06 §2). Amounts are never floats (ADR-007):
// whole CZK thresholds are integers, fractional amounts are decimal strings parsed with Money by
// the consumer. Percentages and ratios are plain numbers; they are factors, not money.
import { z } from 'zod';

/** A whole amount in CZK from the law (thresholds, caps, monthly amounts), never negative. */
export const CzkWhole = z.number().int().min(0);

/** A non-negative amount with exactly two decimals, as text (`'0.02'`); consumers parse it with `Money`. */
export const MoneyString = z.string().regex(/^\d+\.\d{2}$/, 'Expected an amount like 12.50');

/** A non-negative decimal as text with 1–6 decimals (`'0.005'`); consumers parse it with `decimal.js`. */
export const DecimalString = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Expected a decimal like 0.005');

/** A percentage 0–100 with at most two decimals (`21`, `29.2`). A factor, not money. */
export const Pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, 'At most two decimals');

/** A ratio 0–1 (confidence thresholds, relative tolerances). */
export const Ratio = z.number().min(0).max(1);

export const NonNegInt = z.number().int().min(0);
export const PositiveInt = z.number().int().min(1);

/** A day of a month, 1–31. */
export const DayOfMonth = z.number().int().min(1).max(31);

/** A month and day without a year, `MM-DD`. */
export const MonthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected MM-DD');

/** A four-digit year as an object key (`'2026'`). */
export const YearKey = z.string().regex(/^\d{4}$/, 'Expected YYYY');

/** An ISO 3166-1 alpha-2 code (`'CZ'`), plus `'XI'` for Northern Ireland goods. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'Expected a two-letter country code');

/** A snake_case identifier such as a category, treatment or form id (`income_accommodation`). */
export const Identifier = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a snake_case identifier');

/** Digits only (bank account prefixes and numbers). */
export const Digits = z.string().regex(/^\d+$/, 'Expected digits');

/** A shape owned by a module spec that is not implemented yet: keys are strings, values are checked there. */
export const ModuleOwnedRecord = z.record(z.string(), z.unknown());
```

Command: `git add -A && git commit -q -m '0017b step 1' && git log --oneline -1 | tail -1`. Expected: one line with `0017b step 1`.

### Step 2: `packages/domain/src/rules/law.ts` (new, full content)

```ts
// One zod schema per law key (06 §2.1). This file holds shapes only; the values (the numbers in
// the law) are seeded by P0-DOM-05 under `packages/domain/src/rules/cz/`. A key whose shape is
// defined by a module spec that is not implemented yet is marked "module-owned" and kept loose;
// the module's ticket tightens it in the same PR that reads it.
import { z } from 'zod';
import {
  CountryCode,
  CzkWhole,
  DayOfMonth,
  Digits,
  Identifier,
  ModuleOwnedRecord,
  MonthDay,
  NonNegInt,
  Pct,
  PositiveInt,
  YearKey,
} from './atoms';

const PausalniDanCeiling = z.strictObject({
  max_income: CzkWhole,
  requires_dominant_rate_in: z.array(Pct).min(1).optional(),
});

const PausalniDanBand = z.strictObject({
  band: z.number().int().min(1).max(3),
  monthly: CzkWhole,
  ceilings: z.array(PausalniDanCeiling).min(1),
});

/** `cash.payment_limit`: one segment per currency regime (CZK until 2027-07-09, EUR after); the window is the envelope's. */
const CashPaymentLimit = z.strictObject({
  amount: z.number().int().min(0),
  currency: z.enum(['CZK', 'EUR']),
});

const Dphdp3Row = z.looseObject({
  row: z.string().min(1),
  attrs: z.array(z.string().min(1)).min(1),
  treatment: Identifier,
  side: z.enum(['input', 'output']),
});

const FuPaymentAccount = z.strictObject({
  prefix: Digits,
  number: Digits,
  bank_code: z.string().regex(/^\d{4}$/),
});

export const LAW_RULE_SCHEMAS = {
  'vat.rates': z.strictObject({ standard: Pct, reduced: Pct }),
  'vat.registration_thresholds': z.strictObject({ calendar_year: CzkWhole, immediate: CzkWhole }),
  'vat.registration_turnover_policy': z.strictObject({
    exclude_treatments: z.array(Identifier),
    always_include_categories: z.array(Identifier),
  }),
  'vat.kh_document_limit': CzkWhole,
  'vat.simplified_document_limit': CzkWhole,
  'vat.io_eu_goods_threshold': CzkWhole,
  'vat.deduction_deferral_years': NonNegInt,
  'vat.ruceni_cash_threshold': CzkWhole,
  'vat.cnb_rate_rule': z.enum(['rate_valid_on_date_else_last_published']),
  'vat.deadline_day': DayOfMonth,
  // module-owned: M05 §4.3 defines the policy fields; `version` is the only required one.
  'vat.simple_period_policy': z.looseObject({ version: z.string().min(1) }),
  'vat.return_rounding': z.enum(['sum_entries_then_round', 'round_base_then_multiply']),
  'vat.shv_rounding': z.enum(['ceil', 'round', 'floor']),
  'vat.amendment_windows': z.strictObject({
    dp3_dodatecne_due: z.enum(['end_of_month_after_discovery']),
    kh_nasledne_working_days: PositiveInt,
  }),
  'vat.eu_member_states': z.array(CountryCode).min(1),
  'vat.out_of_scope_categories': z.array(Identifier),
  'vat.reduced_rate_categories': z.array(Identifier),
  // keyed by the flat-rate percentage as text ('80', '60', '40', '30'), value = the cap in CZK.
  'pausalni_vydaje.rates_caps': z.partialRecord(z.enum(['80', '60', '40', '30']), CzkWhole),
  'pausalni_dan.bands': z.array(PausalniDanBand).min(1),
  'pausalni_dan.eligibility': z.strictObject({ max_income: CzkWhole, max_other_income: CzkWhole }),
  'pausalni_dan.deadlines': z.strictObject({
    entry: MonthDay,
    exit: MonthDay,
    advance_day: DayOfMonth,
  }),
  'income_tax.rates': z.strictObject({ r1: Pct, r2: Pct, threshold_annual: CzkWhole }),
  'income_tax.credits': z.strictObject({ taxpayer: CzkWhole }),
  'insurance.min_advances': z.strictObject({ social: CzkWhole, health: CzkWhole }),
  'insurance.rates': z.strictObject({
    social_pct: Pct,
    social_base_pct: Pct,
    health_pct: Pct,
    health_base_pct: Pct,
  }),
  'asset.capitalization_threshold': CzkWhole,
  'cash.payment_limit': CashPaymentLimit,
  'calendar.cz_public_holidays': z.strictObject({
    fixed: z.array(MonthDay).min(1),
    movable: z.record(YearKey, z.array(MonthDay)),
  }),
  // module-owned: M05 §4.12, M06 §4.12, M09 §4.7 define the generator fields; `kind` is required.
  'deadlines.generators': z.array(z.looseObject({ kind: Identifier })),
  'municipal.tourist_fee': z.record(
    Identifier,
    z.looseObject({ report_deadline_days_after_month: PositiveInt, rate_per_bed_night: CzkWhole }),
  ),
  // module-owned: M07 (authority account patterns per payee).
  'bank.authority_accounts': z.record(Identifier, ModuleOwnedRecord),
  // module-owned: M05/M06 (EPO form versions, XSD URLs, tax years), keyed by form id.
  'epo.forms': z.record(z.string().regex(/^[A-Z0-9]+$/), ModuleOwnedRecord),
  'epo.dphdp3_row_map': z.array(Dphdp3Row),
  // module-owned: M05 §4.2 step 8 (KH routing table).
  'epo.kh_routing': ModuleOwnedRecord,
  'epo.fu_payment_accounts': z.record(Identifier, FuPaymentAccount),
  'privacy.retention_years_after_year': PositiveInt,
} as const;

export type LawRuleKey = keyof typeof LAW_RULE_SCHEMAS;
export const LAW_RULE_KEYS = Object.keys(LAW_RULE_SCHEMAS) as readonly LawRuleKey[];
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`, exit 0. Commit.

### Step 3: `packages/domain/src/rules/index.ts` (replace the whole file with this content; already in Biome's sort order)

First `grep -nF "from './law'" packages/domain/src/rules/index.ts | head -3` must print nothing (otherwise STOP, §8). Then write the file:

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

Command: `pnpm exec biome check packages/domain/src/rules 2>&1 | tail -5`. Expected: `Checked 6 files … No fixes applied.` (a fixable formatting issue: run once with `--write` and re-check; an error `--write` does not fix: STOP, §8). Commit.

### Step 4: `packages/domain/test/rules-law.test.ts` (new, full content; do not edit it)

```ts
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
```

Command: `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30`. Expected: `Test Files  2 passed (2)`, `Tests  75 passed (75)` (36 engine + 39 law). Commit.

### Step 5: full checks and the report

Run the §6 commands, then §9.

## 5. Do not touch

- Anything outside §3. In particular not `errors.ts`, `segment.ts`, `resolver.ts`, `test/rules-engine.test.ts` (0017a), `packages/domain/src/index.ts` (the barrel re-exports `./rules/index` already), `packages/domain/src/money/**`, `package.json`, `pnpm-lock.yaml`, `docs/v3/`.
- Do not edit `test/rules-law.test.ts` or a given source file to make something pass (§8).
- Do not add a product key (0017c), a data file, or any real law value (P0-DOM-05).
- Hard rules 1, 2, 7 (no new dependency), 8.

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30` → `Tests  75 passed (75)`.
2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0.
3. `pnpm lint 2>&1 | tail -30` → `Found 0 errors` (a pre-existing `info` line is fine).
4. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found`.
5. `pnpm test:unit 2>&1 | tail -30` → all test files pass; coverage `Lines` for `packages/domain/src/**` ≥ 90 %.

## 7. Acceptance

- [ ] `LAW_RULE_SCHEMAS` has exactly the 36 keys of 06 §2.1 (the test compares the key list with its sample table and asserts the count).
- [ ] Every law key accepts one fake valid value and rejects one invalid value (`it.each` over `LAW_RULE_KEYS`); strict objects reject unknown fields; percentages allow at most two decimals.
- [ ] No float carries an amount: whole CZK are `z.number().int()`, fractional amounts are decimal strings (atoms).
- [ ] `pnpm --filter @shoebox/domain test rules` green (75), typecheck, lint, depcruise green.
- Deferred to 0017c: product keys (06 §2.2), the merged `RuleSet`, `getRuleKeySchema`, `RuleEntrySchema`/`RuleSetSchema`, `createRules`.

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

Write `docs/tasks/0017b-report.md` (600 tokens at most), set `Status: review` in this brief, commit as `0017b report`, then `git push -u origin task/0017b-rules-law 2>&1 | tail -3`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0...HEAD`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

HIGH (tax rules). Read `packages/domain/src/rules/law.ts` key by key against 06 §2.1 (36 keys, names verbatim, shapes match the 2026 value column) and `atoms.ts` (no float amount). Confirm `test/rules-law.test.ts` is byte-identical to this brief and contains no real law value.

## Owner steps

None. Loose `module-owned` schemas are tightened by the module tickets (M05/M06/M07/M09) that read those keys; the orchestrator adds a line to `docs/context/known-issues.md` at review.
