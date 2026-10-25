# 0017a: Rules engine: entry envelope and the effective-dated resolver `rules.at(date)`

Status: done
Ticket: P0-DOM-04 | Depends on: none (P0-DOM-01, P0-DOM-03 merged) | Base commit: head of phase/0 | Branch: task/0017a-rules-engine | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `zod` to `@shoebox/domain` and build the pure rules engine: the envelope every law value travels in (`key`, `layer`, inclusive `valid_from`/`valid_to`, `source` URL, `verified_at`, `value`) and `createRuleResolver(entries, schemas)` whose `at(date).get(key)` merges base-year data, mid-year amendments and `rules_overrides` rows for any date. Every tax number the product uses will come through this resolver, so a wrong segment on a boundary day is a wrong tax: the tests pin the day before and the day of every change.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo, do not open any file this brief does not name. Setup: `pnpm install --frozen-lockfile 2>&1 | tail -3`, then `git fetch origin phase/0 && git checkout -b task/0017a-rules-engine origin/phase/0`. Commit after each step as `0017a step k`.

Hard rules that apply (AGENTS.md): 1 (money is never a float; no `parseFloat`/`Number()` in `packages/domain`, Biome plugin `no-number-money` fails the build), 2 (`packages/domain` is pure: no `Date.now()`, no `new Date()`, no I/O imports; dependency-cruiser allows only `decimal.js`, `zod` and the package itself), 7 (no dependency other than the ones this brief names), 8 (never push to `main`). Rates, limits and deadlines live only in `packages/domain/src/rules`; **this brief seeds no law value** (that is P0-DOM-05): every number in the tests below is fake.

Spec lines (pasted; do not open `docs/v3/`):

- 03 ADR-008: "`packages/domain/rules/` contains typed, effective-dated rule sets per jurisdiction … `rules.at(date)` resolves the applicable set. Changes ship as data PRs with tests. A `rules_overrides` DB table allows hotfixes without deploy (admin-only, audited)."
- 06 §2: "Each value has `valid_from` / `valid_to` and a `source` URL (the law or official page) plus a `verified_at` date. Resolution: `rules.at(date)` merges base year data + mid-year amendments + `rules_overrides` from the DB (admin hotfix, audited, requires `reason` and `source`). Every rule has at least one test asserting its value on a known date, and a test asserting the previous value the day before a change."
- 05 `rules_overrides`: `rule_key text not null, valid_from date not null, valid_to date, value jsonb not null, reason text not null, source text not null`. The app maps a row to an entry with `layer: 'override'`; the resolver never reads the DB.
- M12 §4.9 item 5 (admin editor): "`rule_key` (select from `RuleSet` keys) … JSON value validated against the zod schema of that key … preview shows `rules.at(date)` before/after".
- Backlog P0-DOM-04 acceptance: "segment selection on boundaries, amendment beats base, overrides (passed in as data) apply last, a date without data throws `RuleMissingError`, resolver is pure (no I/O imports)"; "every value carries `valid_from`, `valid_to`, `source` URL and `verified_at` (missing source is rejected)".

Design decisions fixed by this brief (the orchestrator reviews them, the executor does not change them):

- Windows are **inclusive** on both ends; `valid_to: null` means open-ended. Layers: `base` < `amendment` < `override`.
- Within one key and one layer, windows **never overlap** (`RuleOverlapError`). Base segments of a key are **contiguous** (`RuleGapError` on a gap); amendments and overrides may leave gaps.
- A date no layer covers throws `RuleMissingError` at `get()`; there is never a default value.
- Validation happens once, at `createRuleResolver(entries, schemas)`; `at(date)` only selects.

The per-key schemas (`RuleSet`, `getRuleKeySchema`, the 75 keys of 06 §2) come in 0017b and 0017c; this brief's tests use two fake keys with inline zod schemas.

Domain helpers this brief imports (already exported from `packages/domain/src/dates/index.ts`): `type LegalDate` (a branded `YYYY-MM-DD` string), `isLegalDate(value: string): value is LegalDate`, `parseLegalDate(value: string): LegalDate` (throws `InvalidLegalDateError`), `addDays(date: LegalDate, days: number): LegalDate`. Branded dates compare correctly with `<`/`>=` as strings.

Excerpt the step-1 edit anchors on (`packages/domain/package.json`, end of file):

```json
  "dependencies": {
    "decimal.js": "10.6.0"
  }
}
```

Excerpt the step-7 edit anchors on (`packages/domain/src/index.ts`, first line; four `export * from` lines follow it, leave them alone):

```ts
export const packageName = '@shoebox/domain' as const;
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/package.json` | edit | add `"zod": "4.6.5"` to `dependencies` |
| `pnpm-lock.yaml` | regenerated | by `pnpm install`; adds `zod@4.6.5` and the domain importer line |
| `packages/domain/src/rules/errors.ts` | new | `RuleError` family |
| `packages/domain/src/rules/segment.ts` | new | `RULE_LAYERS`, `LegalDateSchema`, `RuleEntryMetaSchema`, `ruleEntrySchema`, `RuleEntry`, `RuleEntryInput` |
| `packages/domain/src/rules/resolver.ts` | new | `createRuleResolver`, `RuleResolver`, `RulesAt`, `RuleSchemaMap` |
| `packages/domain/src/rules/index.ts` | new | the rules barrel |
| `packages/domain/test/rules-engine.test.ts` | new | the spec (36 tests); never edited |
| `packages/domain/src/index.ts` | edit | one line: `export * from './rules/index';` |

No other file may change.

## 4. Steps

### Step 1: dependency

Edit `packages/domain/package.json`. Anchor (exact):

```json
  "dependencies": {
    "decimal.js": "10.6.0"
  }
}
```

Replace with:

```json
  "dependencies": {
    "decimal.js": "10.6.0",
    "zod": "4.6.5"
  }
}
```

Command: `pnpm install 2>&1 | tail -8`. Expected: ends with `Done in …s`, no `ERR_`. Then `git status --short | head` shows `M packages/domain/package.json` and `M pnpm-lock.yaml` only. Commit.

### Step 2: `packages/domain/src/rules/errors.ts` (new, full content)

```ts
// Errors of the rules engine (06 §2, ADR-008). Every one extends RuleError so callers can catch the family.
import type { LegalDate } from '../dates/index';

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/** No segment of any layer covers the key on the date (06 §2: a date without data is an error, never a default). */
export class RuleMissingError extends RuleError {
  readonly key: string;
  readonly date: LegalDate;
  constructor(key: string, date: LegalDate) {
    super(`No rule value for "${key}" on ${date}`);
    this.name = 'RuleMissingError';
    this.key = key;
    this.date = date;
  }
}

/** The key is not in the schema map (06 §2.1/§2.2 is the only list of keys). */
export class UnknownRuleKeyError extends RuleError {
  readonly key: string;
  constructor(key: string) {
    super(`Unknown rule key "${key}"`);
    this.name = 'UnknownRuleKeyError';
    this.key = key;
  }
}

/** An entry failed its envelope or per-key zod schema. `issues` are zod issues as `path: message`. */
export class RuleValueError extends RuleError {
  readonly key: string;
  readonly issues: readonly string[];
  constructor(key: string, index: number, issues: readonly string[]) {
    super(`Invalid rule entry #${index} for "${key}": ${issues.join('; ')}`);
    this.name = 'RuleValueError';
    this.key = key;
    this.issues = issues;
  }
}

/** Two segments of the same key and layer cover a common date. */
export class RuleOverlapError extends RuleError {
  readonly key: string;
  constructor(key: string, layer: string, first: string, second: string) {
    super(`Overlapping ${layer} segments for "${key}": [${first}] and [${second}]`);
    this.name = 'RuleOverlapError';
    this.key = key;
  }
}

/** Two consecutive base segments of a key leave days without data between them. */
export class RuleGapError extends RuleError {
  readonly key: string;
  constructor(key: string, lastValidTo: LegalDate, nextValidFrom: LegalDate) {
    super(`Gap in base segments for "${key}": ${lastValidTo} is followed by ${nextValidFrom}`);
    this.name = 'RuleGapError';
    this.key = key;
  }
}
```

Command: `git add -A && git commit -q -m '0017a step 2' && git log --oneline -1 | tail -1`. Expected: one line with `0017a step 2`.

### Step 3: `packages/domain/src/rules/segment.ts` (new, full content)

```ts
// The envelope every rule value travels in (06 §2): a key, a layer, an inclusive validity window,
// the law or official page it came from and the date it was last checked.
import { z } from 'zod';
import { isLegalDate, type LegalDate } from '../dates/index';

/** Precedence, lowest first: base year data < mid-year amendment < `rules_overrides` row (admin hotfix). */
export const RULE_LAYERS = ['base', 'amendment', 'override'] as const;
export type RuleLayer = (typeof RULE_LAYERS)[number];

/** A strict `YYYY-MM-DD` calendar date (ADR-007), typed as `LegalDate` after parsing. */
export const LegalDateSchema = z.string().transform((value, ctx): LegalDate => {
  if (isLegalDate(value)) return value;
  ctx.addIssue({ code: 'custom', message: `Expected a legal date YYYY-MM-DD, got "${value}"` });
  return z.NEVER;
});

const ruleEntryShape = {
  key: z.string().min(1),
  layer: z.enum(RULE_LAYERS),
  /** First day the value applies (inclusive). */
  valid_from: LegalDateSchema,
  /** Last day the value applies (inclusive); `null` = open-ended. */
  valid_to: LegalDateSchema.nullable(),
  /** The law or official page the value was taken from; required (06 §2). */
  source: z.url(),
  /** The day a person last checked the value against `source`. */
  verified_at: LegalDateSchema,
};

function validToAfterValidFrom(entry: {
  valid_from: LegalDate;
  valid_to: LegalDate | null;
}): boolean {
  return entry.valid_to === null || entry.valid_to >= entry.valid_from;
}

const VALID_TO_MESSAGE = 'valid_to is before valid_from';

/** The envelope without the value: what every rule key shares. */
export const RuleEntryMetaSchema = z
  .strictObject(ruleEntryShape)
  .refine(validToAfterValidFrom, { message: VALID_TO_MESSAGE, path: ['valid_to'] });

/** The envelope around one key's value schema. */
export function ruleEntrySchema<V extends z.ZodType>(value: V) {
  return z
    .strictObject({ ...ruleEntryShape, value })
    .refine(validToAfterValidFrom, { message: VALID_TO_MESSAGE, path: ['valid_to'] });
}

/** A validated entry: one value of one key in one layer for one date window. */
export interface RuleEntry<T = unknown> {
  readonly key: string;
  readonly layer: RuleLayer;
  readonly valid_from: LegalDate;
  readonly valid_to: LegalDate | null;
  readonly source: string;
  readonly verified_at: LegalDate;
  readonly value: T;
}

/** What callers pass in: data files and `rules_overrides` rows, before validation. */
export interface RuleEntryInput {
  readonly key: string;
  readonly layer: RuleLayer;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly source: string;
  readonly verified_at: string;
  readonly value: unknown;
}
```

Command: `git add -A && git commit -q -m '0017a step 3' && git log --oneline -1 | tail -1`. Expected: one line with `0017a step 3`.

### Step 4: `packages/domain/src/rules/resolver.ts` (new, full content)

```ts
// The effective-dated resolver `rules.at(date)` (ADR-008, 06 §2). Pure: data in, values out, no I/O.
import type { z } from 'zod';
import { addDays, type LegalDate, parseLegalDate } from '../dates/index';
import {
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  UnknownRuleKeyError,
} from './errors';
import {
  RULE_LAYERS,
  type RuleEntry,
  type RuleEntryInput,
  type RuleLayer,
  ruleEntrySchema,
} from './segment';

/** One zod schema per rule key; the map's keys are the only keys the resolver accepts. */
export type RuleSchemaMap = Readonly<Record<string, z.ZodType>>;
export type RuleKeyOf<S extends RuleSchemaMap> = Extract<keyof S, string>;
export type RuleValueOf<S extends RuleSchemaMap, K extends RuleKeyOf<S>> = z.output<S[K]>;

/** The rules in force on one date. */
export interface RulesAt<S extends RuleSchemaMap> {
  readonly date: LegalDate;
  /** The value of `key` on `date`; throws `RuleMissingError` when no layer covers it. */
  get<K extends RuleKeyOf<S>>(key: K): RuleValueOf<S, K>;
  /** The value with its provenance (layer, window, source, verified_at); throws `RuleMissingError`. */
  resolve<K extends RuleKeyOf<S>>(key: K): RuleEntry<RuleValueOf<S, K>>;
  /** True when some layer covers `key` on `date`. */
  has(key: RuleKeyOf<S>): boolean;
}

export interface RuleResolver<S extends RuleSchemaMap> {
  /** The rules in force on `date`; throws `InvalidLegalDateError` for a malformed date. */
  at(date: LegalDate | string): RulesAt<S>;
  /** Every key of the schema map, sorted. */
  readonly keys: readonly RuleKeyOf<S>[];
  /** All validated entries of `key`, sorted by layer then `valid_from`; `[]` for a key without data. */
  entries(key: RuleKeyOf<S>): readonly RuleEntry[];
}

type Segments = Map<RuleLayer, RuleEntry[]>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

function windowOf(entry: RuleEntry): string {
  return `${entry.valid_from}..${entry.valid_to ?? 'open'}`;
}

function covers(entry: RuleEntry, date: LegalDate): boolean {
  return entry.valid_from <= date && (entry.valid_to === null || date <= entry.valid_to);
}

function validateEntries(
  entries: readonly RuleEntryInput[],
  schemas: RuleSchemaMap,
): Map<string, Segments> {
  const byKey = new Map<string, Segments>();
  entries.forEach((input, index) => {
    const schema = Object.hasOwn(schemas, input.key) ? schemas[input.key] : undefined;
    if (schema === undefined) throw new UnknownRuleKeyError(input.key);
    const parsed = ruleEntrySchema(schema).safeParse(input);
    if (!parsed.success) throw new RuleValueError(input.key, index, formatIssues(parsed.error));
    const entry: RuleEntry = parsed.data;
    let segments = byKey.get(entry.key);
    if (segments === undefined) {
      segments = new Map();
      byKey.set(entry.key, segments);
    }
    const list = segments.get(entry.layer) ?? [];
    list.push(entry);
    segments.set(entry.layer, list);
  });
  return byKey;
}

function checkWindows(key: string, layer: RuleLayer, list: RuleEntry[]): void {
  list.sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0));
  for (let i = 1; i < list.length; i += 1) {
    const previous = list[i - 1];
    const next = list[i];
    if (previous === undefined || next === undefined) continue;
    if (previous.valid_to === null || next.valid_from <= previous.valid_to) {
      throw new RuleOverlapError(key, layer, windowOf(previous), windowOf(next));
    }
    if (layer === 'base' && addDays(previous.valid_to, 1) !== next.valid_from) {
      throw new RuleGapError(key, previous.valid_to, next.valid_from);
    }
  }
}

/**
 * Builds a resolver from entries (base-year data, amendments and `rules_overrides` rows mapped to
 * `layer: 'override'`) and the per-key schemas. Throws at build time on an unknown key, an invalid
 * value, overlapping windows within a layer, or a gap between base segments. Within a date, the
 * override layer beats the amendment layer, which beats the base layer.
 */
export function createRuleResolver<S extends RuleSchemaMap>(
  entries: readonly RuleEntryInput[],
  schemas: S,
): RuleResolver<S> {
  const byKey = validateEntries(entries, schemas);
  for (const [key, segments] of byKey) {
    for (const layer of RULE_LAYERS) {
      const list = segments.get(layer);
      if (list !== undefined) checkWindows(key, layer, list);
    }
  }
  const keys = Object.keys(schemas).sort() as RuleKeyOf<S>[];
  const precedence: readonly RuleLayer[] = ['override', 'amendment', 'base'];

  function find(key: string, date: LegalDate): RuleEntry | undefined {
    const segments = byKey.get(key);
    if (segments === undefined) return undefined;
    for (const layer of precedence) {
      const hit = segments.get(layer)?.find((entry) => covers(entry, date));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  return {
    keys,
    entries(key) {
      const segments = byKey.get(key);
      if (segments === undefined) return [];
      return RULE_LAYERS.flatMap((layer) => segments.get(layer) ?? []);
    },
    at(input) {
      const date = parseLegalDate(input);
      const resolve = <K extends RuleKeyOf<S>>(key: K): RuleEntry<RuleValueOf<S, K>> => {
        if (!Object.hasOwn(schemas, key)) throw new UnknownRuleKeyError(key);
        const hit = find(key, date);
        if (hit === undefined) throw new RuleMissingError(key, date);
        return hit as RuleEntry<RuleValueOf<S, K>>;
      };
      return {
        date,
        resolve,
        get: (key) => resolve(key).value,
        has: (key) => find(key, date) !== undefined,
      };
    },
  };
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`, exit 0. Commit.

### Step 5: `packages/domain/src/rules/index.ts` (new, full content; already in Biome's sort order)

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

Command: `pnpm exec biome check packages/domain/src/rules 2>&1 | tail -5`. Expected: `Checked 4 files … No fixes applied.` (if Biome reports a fixable formatting issue, run the same command with `--write` once and re-check; if it reports an error that `--write` does not fix, STOP, §8). Commit.

### Step 6: `packages/domain/test/rules-engine.test.ts` (new, full content; do not edit it)

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createRuleResolver,
  InvalidLegalDateError,
  RULE_LAYERS,
  type RuleEntryInput,
  RuleEntryMetaSchema,
  RuleError,
  RuleGapError,
  RuleMissingError,
  RuleOverlapError,
  RuleValueError,
  ruleEntrySchema,
  UnknownRuleKeyError,
} from '../src/index';

// Fake keys and fake values only: real law values are seeded by P0-DOM-05.
const schemas = {
  'test.rate': z.number().int().min(0).max(100),
  'test.limit': z.strictObject({ standard: z.number().int(), reduced: z.number().int() }),
} as const;

const SOURCE = 'https://example.invalid/law/test';

// Loosely typed on purpose: the rejection cases pass wrong shapes through.
function entry(overrides: Record<string, unknown> = {}): RuleEntryInput {
  return {
    key: 'test.rate',
    layer: 'base',
    valid_from: '2025-01-01',
    valid_to: '2025-12-31',
    source: SOURCE,
    verified_at: '2025-01-15',
    value: 10,
    ...overrides,
  } as RuleEntryInput;
}

/** The envelope without `value` (what `RuleEntryMetaSchema` validates). */
function meta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { value: _value, ...rest } = entry(overrides);
  return rest;
}

const base2025 = entry();
const base2026 = entry({ valid_from: '2026-01-01', valid_to: null, value: 12 });
const amendmentH2 = entry({
  layer: 'amendment',
  valid_from: '2026-07-01',
  valid_to: '2026-12-31',
  value: 15,
});
const overrideAugust = entry({
  layer: 'override',
  valid_from: '2026-08-01',
  valid_to: '2026-08-31',
  value: 99,
});

describe('rule entry envelope', () => {
  it('accepts a complete entry and types the dates', () => {
    const parsed = RuleEntryMetaSchema.parse(meta());
    expect(parsed.valid_from).toBe('2025-01-01');
    expect(parsed.valid_to).toBe('2025-12-31');
    expect(parsed.verified_at).toBe('2025-01-15');
    expect(parsed.layer).toBe('base');
  });

  it('accepts an open-ended window (valid_to null)', () => {
    expect(RuleEntryMetaSchema.safeParse(meta({ valid_to: null })).success).toBe(true);
  });

  it.each([
    ['missing source', { source: undefined }],
    ['source that is not a URL', { source: 'zákon č. 235/2004 Sb.' }],
    ['missing verified_at', { verified_at: undefined }],
    ['malformed valid_from', { valid_from: '2025-1-1' }],
    ['impossible valid_to', { valid_to: '2025-02-30' }],
    ['valid_to before valid_from', { valid_from: '2025-06-01', valid_to: '2025-05-31' }],
    ['unknown layer', { layer: 'hotfix' }],
    ['empty key', { key: '' }],
    ['extra field', { note: 'x' }],
  ])('rejects %s', (_name, patch) => {
    const result = RuleEntryMetaSchema.safeParse(meta(patch));
    expect(result.success).toBe(false);
  });

  it('ruleEntrySchema validates the value with the per-key schema', () => {
    const schema = ruleEntrySchema(schemas['test.limit']);
    expect(schema.safeParse(entry({ value: { standard: 21, reduced: 12 } })).success).toBe(true);
    const bad = schema.safeParse(entry({ value: { standard: 21 } }));
    expect(bad.success).toBe(false);
    expect(
      schema.safeParse(entry({ value: { standard: 21, reduced: 12, extra: 1 } })).success,
    ).toBe(false);
  });

  it('lists the three layers in precedence order', () => {
    expect(RULE_LAYERS).toEqual(['base', 'amendment', 'override']);
  });
});

describe('createRuleResolver: validation at build time', () => {
  it('rejects an unknown key', () => {
    expect(() => createRuleResolver([entry({ key: 'test.unknown' })], schemas)).toThrow(
      UnknownRuleKeyError,
    );
  });

  it('rejects a value that fails the per-key schema, naming the entry and the path', () => {
    const bad = entry({ key: 'test.limit', value: { standard: 21, reduced: 'twelve' } });
    let caught: unknown;
    try {
      createRuleResolver([base2025, bad], schemas);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleValueError);
    const error = caught as RuleValueError;
    expect(error.key).toBe('test.limit');
    expect(error.message).toContain('#1');
    expect(error.issues.some((issue) => issue.startsWith('value.reduced:'))).toBe(true);
  });

  it('rejects an entry without a source', () => {
    expect(() => createRuleResolver([entry({ source: undefined })], schemas)).toThrow(
      RuleValueError,
    );
  });

  it('rejects overlapping base segments (one shared day)', () => {
    const overlapping = entry({ valid_from: '2025-12-31', valid_to: '2026-12-31', value: 12 });
    expect(() => createRuleResolver([base2025, overlapping], schemas)).toThrow(RuleOverlapError);
  });

  it('rejects a segment after an open-ended one in the same layer', () => {
    const later = entry({ valid_from: '2027-01-01', valid_to: null, value: 13 });
    expect(() => createRuleResolver([base2026, later], schemas)).toThrow(RuleOverlapError);
  });

  it('rejects overlapping overrides', () => {
    const other = entry({
      layer: 'override',
      valid_from: '2026-08-31',
      valid_to: '2026-09-30',
      value: 98,
    });
    expect(() => createRuleResolver([base2026, overrideAugust, other], schemas)).toThrow(
      RuleOverlapError,
    );
  });

  it('rejects a gap between base segments', () => {
    const short2025 = entry({ valid_to: '2025-12-30' });
    expect(() => createRuleResolver([short2025, base2026], schemas)).toThrow(RuleGapError);
  });

  it('allows gaps between amendments and between overrides', () => {
    const laterAmendment = entry({
      layer: 'amendment',
      valid_from: '2027-03-01',
      valid_to: '2027-03-31',
      value: 16,
    });
    const laterOverride = entry({
      layer: 'override',
      valid_from: '2027-06-01',
      valid_to: null,
      value: 97,
    });
    expect(() =>
      createRuleResolver(
        [base2025, base2026, amendmentH2, laterAmendment, overrideAugust, laterOverride],
        schemas,
      ),
    ).not.toThrow();
  });

  it('does not depend on input order', () => {
    const rules = createRuleResolver([overrideAugust, base2026, amendmentH2, base2025], schemas);
    expect(rules.at('2025-06-01').get('test.rate')).toBe(10);
    expect(rules.at('2026-08-15').get('test.rate')).toBe(99);
  });

  it('every error is a RuleError', () => {
    for (const E of [
      RuleMissingError,
      UnknownRuleKeyError,
      RuleValueError,
      RuleOverlapError,
      RuleGapError,
    ]) {
      expect(Object.create(E.prototype)).toBeInstanceOf(RuleError);
    }
  });
});

describe('rules.at(date): segment selection', () => {
  const rules = createRuleResolver([base2025, base2026, amendmentH2, overrideAugust], schemas);

  it('picks the base segment by inclusive boundaries', () => {
    expect(rules.at('2025-01-01').get('test.rate')).toBe(10);
    expect(rules.at('2025-12-31').get('test.rate')).toBe(10);
    expect(rules.at('2026-01-01').get('test.rate')).toBe(12);
    expect(rules.at('2026-06-30').get('test.rate')).toBe(12);
  });

  it('amendment beats base from its first day to its last day', () => {
    expect(rules.at('2026-06-30').get('test.rate')).toBe(12);
    expect(rules.at('2026-07-01').get('test.rate')).toBe(15);
    expect(rules.at('2026-12-31').get('test.rate')).toBe(15);
    expect(rules.at('2027-01-01').get('test.rate')).toBe(12);
  });

  it('override applies last, over the amendment', () => {
    expect(rules.at('2026-07-31').get('test.rate')).toBe(15);
    expect(rules.at('2026-08-01').get('test.rate')).toBe(99);
    expect(rules.at('2026-08-31').get('test.rate')).toBe(99);
    expect(rules.at('2026-09-01').get('test.rate')).toBe(15);
  });

  it('an open-ended override beats an open-ended base', () => {
    const hotfix = entry({
      layer: 'override',
      valid_from: '2026-03-01',
      valid_to: null,
      value: 50,
    });
    const patched = createRuleResolver([base2026, hotfix], schemas);
    expect(patched.at('2026-02-28').get('test.rate')).toBe(12);
    expect(patched.at('2026-03-01').get('test.rate')).toBe(50);
    expect(patched.at('2099-12-31').get('test.rate')).toBe(50);
  });

  it('throws RuleMissingError for a date before the first segment', () => {
    expect(() => rules.at('2024-12-31').get('test.rate')).toThrow(RuleMissingError);
    expect(rules.at('2024-12-31').has('test.rate')).toBe(false);
  });

  it('throws RuleMissingError for a key with no data', () => {
    let caught: unknown;
    try {
      rules.at('2026-01-01').get('test.limit');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleMissingError);
    expect((caught as RuleMissingError).key).toBe('test.limit');
    expect((caught as RuleMissingError).date).toBe('2026-01-01');
    expect(rules.at('2026-01-01').has('test.limit')).toBe(false);
  });

  it('throws RuleMissingError after a closed last segment', () => {
    const closed = createRuleResolver([base2025], schemas);
    expect(() => closed.at('2026-01-01').get('test.rate')).toThrow(RuleMissingError);
  });

  it('an override alone does not cover dates outside its window', () => {
    const only = createRuleResolver([overrideAugust], schemas);
    expect(only.at('2026-08-15').get('test.rate')).toBe(99);
    expect(() => only.at('2026-09-01').get('test.rate')).toThrow(RuleMissingError);
  });

  it('rejects a malformed date', () => {
    expect(() => rules.at('2026-13-01')).toThrow(InvalidLegalDateError);
  });

  it('resolve() returns the provenance of the winning segment', () => {
    const hit = rules.at('2026-08-15').resolve('test.rate');
    expect(hit).toEqual({
      key: 'test.rate',
      layer: 'override',
      valid_from: '2026-08-01',
      valid_to: '2026-08-31',
      source: SOURCE,
      verified_at: '2025-01-15',
      value: 99,
    });
    expect(rules.at('2026-07-15').resolve('test.rate').layer).toBe('amendment');
    expect(rules.at('2026-01-15').resolve('test.rate').layer).toBe('base');
  });

  it('exposes sorted keys and the entries of a key by layer then date', () => {
    expect(rules.keys).toEqual(['test.limit', 'test.rate']);
    expect(rules.entries('test.rate').map((e) => `${e.layer}:${e.valid_from}`)).toEqual([
      'base:2025-01-01',
      'base:2026-01-01',
      'amendment:2026-07-01',
      'override:2026-08-01',
    ]);
    expect(rules.entries('test.limit')).toEqual([]);
  });

  it('get() is typed by the per-key schema', () => {
    const at = rules.at('2026-01-01');
    expectTypeOf(at.get('test.rate')).toEqualTypeOf<number>();
    expectTypeOf(at.get<'test.limit'>).returns.toEqualTypeOf<{
      standard: number;
      reduced: number;
    }>();
    // @ts-expect-error unknown keys do not compile
    expect(() => at.get('test.unknown')).toThrow(UnknownRuleKeyError);
  });
});

describe('purity (M12 §4.1: packages/domain has no I/O)', () => {
  it('src/rules imports only zod and the domain package itself', () => {
    const dir = fileURLToPath(new URL('../src/rules/', import.meta.url));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(
          specifier === 'zod' || specifier.startsWith('./') || specifier.startsWith('../'),
        ).toBe(true);
      }
      expect(text).not.toMatch(/Date\.now\(\)|new Date\(/);
    }
  });
});
```

Command: `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30`. Expected: `Test Files  1 passed (1)`, `Tests  36 passed (36)`. The sources in steps 2–5 pass these tests as given; if one fails, STOP (§8). Commit.

### Step 7: export from the package root

Edit `packages/domain/src/index.ts`. Anchor (exact, one line):

```ts
export const packageName = '@shoebox/domain' as const;
```

Insert directly after that line:

```ts
export * from './rules/index';
```

Then run `pnpm exec biome check --write packages/domain/src/index.ts 2>&1 | tail -3` so Biome puts the export lines in its sort order (expected: `Checked 1 file …` with `Fixed 1 file` or `No fixes applied`; either is fine).

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5` (no `error TS`). Commit.

### Step 8: full checks and the report

Run the §6 commands, then §9.

## 5. Do not touch

- Anything outside §3. In particular not `packages/domain/src/money/**` (brief 0016 changes it in parallel), `packages/domain/src/dates/**`, `packages/domain/src/enums/**`, `tools/biome-plugins/`, `biome.json`, `.dependency-cruiser.cjs`, `pnpm-workspace.yaml`, the root `package.json`, other packages, `docs/v3/`.
- Do not edit `test/rules-engine.test.ts` or a given source file to make something pass: if a given file fails, the brief is wrong, stop (§8).
- Do not add any rule key, law value or data file under `src/rules/`: keys come in 0017b/c, values in P0-DOM-05.
- Hard rules 1, 2, 7 (no dependency other than `zod@4.6.5`), 8.

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/domain test rules 2>&1 | tail -30` → `Tests  36 passed (36)`.
2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0.
3. `pnpm lint 2>&1 | tail -30` → `Checked … files`, `Found 0 errors` (a pre-existing `info` line is fine).
4. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found`.
5. `pnpm test:unit 2>&1 | tail -30` → all test files pass; coverage `Lines` for `packages/domain/src/**` ≥ 90 % (the brief writer measured every engine line covered).

## 7. Acceptance

- [ ] Every entry carries `valid_from`, `valid_to`, `source` URL and `verified_at`; a missing or non-URL `source`, a malformed date, `valid_to` before `valid_from` and an unknown field are rejected (`RuleEntryMetaSchema` tests).
- [ ] `packages/domain/test/rules-engine.test.ts` (36 tests) green: segment selection on inclusive boundaries (the day before and the day of each change), amendment beats base, overrides passed in as data apply last, overlaps rejected in every layer, a gap between base segments rejected, a date without data throws `RuleMissingError`, `resolve()` returns the provenance, `get()` is typed per key, and `src/rules/*.ts` import only `zod` and relative paths (purity).
- [ ] `zod@4.6.5` is the only new dependency; `pnpm depcruise` passes (domain imports only `decimal.js`, `zod`, itself).
- [ ] `createRuleResolver`, the `RuleError` family and the envelope schemas are exported from `@shoebox/domain`.
- Deferred to 0017b/0017c (same ticket): the zod `RuleSet` with one schema per 06 §2 key, `getRuleKeySchema(key)`, `RuleSetSchema`, `createRules`. Deferred to P0-DOM-05: the real 2025–2026 values under `src/rules/cz/`.
- Deviation from the ticket's file list: the ticket names `packages/domain/rules/schema.ts` and `rules/index.ts`; the code lives under `packages/domain/src/rules/` (the package's `src` layout, same as `money/`, `dates/`). The orchestrator notes this in the backlog at review.

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

Write `docs/tasks/0017a-report.md` (600 tokens at most), set `Status: review` in this brief, commit as `0017a report`, then `git push -u origin task/0017a-rules-engine 2>&1 | tail -3`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0...HEAD`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

HIGH (tax rules). Read in full: `packages/domain/src/rules/resolver.ts` (precedence `override > amendment > base`, inclusive `covers()`, overlap and gap checks, `RuleMissingError` with no default) and `packages/domain/src/rules/segment.ts` (strict envelope, `z.url()` for `source`, inclusive window refine). Confirm `test/rules-engine.test.ts` is byte-identical to this brief. Check `pnpm-lock.yaml` adds only `zod@4.6.5`.

## Owner steps

None. The orchestrator merges the PR into `phase/0`; the owner reads this diff on the Phase 0 gate list (HIGH).
