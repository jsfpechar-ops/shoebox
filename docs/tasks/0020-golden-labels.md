# 0020: Golden labels schema and loader

Status: review
Ticket: P0-EVAL-01 | Depends on: none (P0-REPO-01, P0-TEST-01, P0-DOM-03 merged) | Base commit: head of phase/0 | Branch: task/0020-golden-labels | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the M12 zod schema for `testdata/golden-v1/labels.json` and a loader in `@shoebox/testkit` that applies adapters, merges `expected/*.json` and validates, turning every labeled amount into `Money`. The eval runner (P0-EVAL-02) then works on checked, typed labels, and a malformed label fails loudly instead of quietly skewing a metric.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read files you just wrote, do not explore the repo. Every code block in §4 was compiled, linted and run against the committed golden set by the brief writer (14 tests pass).

**Spec, M12 §4.10 Evaluation harness (pasted):**

> **Golden-set loader.** `testdata/golden-v1/labels.json` is the contract; its zod schema lives in `packages/testkit/src/eval/labels.ts`. If the delivered file differs, write an adapter in `labels-adapters/v1.ts`, never relax the metric code.
>
> `const Money = z.string().regex(/^-?\d+\.\d{2}$/);  // dot decimal in labels` · `ExpectedDoc` = file, sha256 (64), bookable, class (DocumentClass), duplicate_of (nullable), tax_doc_status?, partner? {name, ico|null, dic|null, vat_id|null, country (2)}, document_number?, variable_symbol?, issue_date?/duzp?/due_date?/service_period_from?/service_period_to? (ISO date, nullable), currency? (3), totals? {net|null, vat|null, gross}, vat_summary? [{rate_pct: number, base, vat}], lines? [{description, gross, line_type}], category_code?, vat_treatment?, business_flag? (business|personal|mixed|unknown), expected_validations [{rule_id, severity}] default [], expected_questions string[] default [], notes?.
> `GoldenLabels = { version: 'golden-v1', taxpayer: TaxpayerProfileFixture, documents: ExpectedDoc[] (length 20), periods: [{ period: /^\d{4}-\d{2}$/, dphdp3: record<string, {base: int, tax: int}> }] default [] }`.
>
> Expected per-module files under `testdata/golden-v1/expected/*.json` are merged into the labels by the loader. golden-v1 has 20 documents: 12 bookable, 6 decoys, 2 duplicates.

**Decisions made in this brief (orchestrator):**

- Location is `packages/testkit/src/golden/` (not `src/eval/` as the ticket says) so parallel briefs 0018 (`src/registries/**`) and 0019 (`src/llm/**`) never touch the same folder. P0-EVAL-02 builds `src/eval/` on top of it.
- Enums come from `@shoebox/domain` (`DOCUMENT_CLASS_VALUES`, `TAX_DOC_STATUS_VALUES`, `LINE_TYPE_VALUES`, `VAT_TREATMENT_VALUES`, `SEVERITY_VALUES`, `VAT_STATUS_VALUES`, `TAX_REGIME_VALUES`). Amounts are validated as the M12 string, then converted with `Money.parse(text, doc.currency)` (hard rule 1: never a JS number). A document with amounts and no `currency` fails.
- `TaxpayerProfileFixture` is not defined in M12; it is written from the committed `taxpayer` object (name, legal_form, ico, dic, vat_status, accounting_regime, address, foreign_service_dppd_policy, tourist_fee_municipality?, today).
- `periods[].dphdp3` base/tax stay `z.number().int()` exactly as M12 says (whole CZK on the filed return, not a money amount we compute).
- Extension keys in `labels.json` (`links`, `statement`, `filing`, `embedded_isdoc`, `buyer_dic`, `card_last4`, `reference_amounts`, `changed_values`, `expected_totals`, …; listed in `testdata/golden-v1/README.md`) are stripped by the schema. The ticket that needs one adds it to the schema.
- `expected/` does not exist yet. Its file format is fixed here: `{ "documents": { "<file>": { ...fields } } }`, shallow-merged into the document with that `file`, files in alphabetical order; an unknown `file` is an error.
- The ticket's stub fixture (`packages/testkit/fixtures/golden-stub/`) is replaced by the real committed golden set (P0-EVAL-03 is done): tests copy it in memory or into an OS temp dir and break it there.
- `zod` is approved (decisions.md, P0-OWN-01). Version `4.6.5` (published 2026-09-13, more than 14 days old), exact pin.
- Privacy (hard rule 4): the labels are synthetic but look like personal data. Error messages carry the path and rule only, never a value; tests never print labels (no `console.log`, no `toEqual` on whole documents).

Excerpt the step-1 edit anchors on (`packages/testkit/package.json`, the `dependencies` block):

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*"
  },
```

Brief 0019 adds `"@shoebox/extraction": "workspace:*"` to the same block. If that line is already there, keep it and add `zod` as the last entry, keeping the keys in alphabetical order. Merge order with 0019 (shared files `packages/testkit/package.json`, `packages/testkit/src/index.ts`, `pnpm-lock.yaml`): 0019 first; if 0020 is merged first, 0019 rebases instead. The second one keeps both lines and reruns `pnpm install`.

Excerpt the step-6 edit anchors on (`packages/testkit/src/index.ts`, last line; parallel briefs may have added `export * from` lines after it):

```ts
export * from './ids';
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/package.json` | edit | add `"zod": "4.6.5"` to `dependencies` |
| `pnpm-lock.yaml` | regenerated | by `pnpm install`; only the testkit importer and the zod package entry change |
| `packages/testkit/src/golden/schema.ts` | new | M12 zod schema with domain enums, amounts to `Money` |
| `packages/testkit/src/golden/labels-adapters/v1.ts` | new | `LabelsAdapter` type, identity `v1Adapter` |
| `packages/testkit/src/golden/load.ts` | new | `loadGoldenLabels`, `parseGoldenLabels`, `goldenSetDir`, `GoldenLabelsError` |
| `packages/testkit/src/golden/index.ts` | new | re-exports |
| `packages/testkit/src/index.ts` | edit | add exactly one line `export * from './golden/index';` |
| `packages/testkit/test/golden-labels.test.ts` | new | the spec (14 tests) |

No other file may change.

## 4. Steps

0. Setup: `git fetch origin phase/0 && git checkout -b task/0020-golden-labels origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -5`. Expected: `Done in …`.

1. **Edit `packages/testkit/package.json`.** Replace the anchor (§2) so the block reads:

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "zod": "4.6.5"
  },
```

   (keep any line another brief added, see §2). Run `pnpm install 2>&1 | tail -5 && git diff --stat 2>&1 | tail -5`.
   Expected: `Done in …`; diff stat shows `packages/testkit/package.json` and `pnpm-lock.yaml` only. Commit `0020 step 1`.

2. **New `packages/testkit/src/golden/schema.ts`** (exact content):

```ts
import {
  DOCUMENT_CLASS_VALUES,
  LINE_TYPE_VALUES,
  type LineType,
  Money,
  SEVERITY_VALUES,
  TAX_DOC_STATUS_VALUES,
  TAX_REGIME_VALUES,
  VAT_STATUS_VALUES,
  VAT_TREATMENT_VALUES,
} from '@shoebox/domain';
import { z } from 'zod';

/** M12 §4.10: money in labels is a dot-decimal string with exactly two places. */
export const LabelMoney = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, 'money must be a dot-decimal string with two places');

const IsoDate = z.iso.date();

export const TaxpayerProfileFixture = z.object({
  name: z.string(),
  legal_form: z.string(),
  ico: z.string(),
  dic: z.string(),
  vat_status: z.enum(VAT_STATUS_VALUES),
  accounting_regime: z.enum(TAX_REGIME_VALUES),
  address: z.object({
    street: z.string(),
    city: z.string(),
    zip: z.string(),
    country: z.string().length(2),
  }),
  foreign_service_dppd_policy: z.string(),
  tourist_fee_municipality: z.string().optional(),
  today: IsoDate,
});

/** The M12 `ExpectedDoc` with domain enums; amounts are still strings here. */
export const ExpectedDocRaw = z.object({
  file: z.string(),
  sha256: z.string().length(64),
  bookable: z.boolean(),
  class: z.enum(DOCUMENT_CLASS_VALUES),
  duplicate_of: z.string().nullable(),
  tax_doc_status: z.enum(TAX_DOC_STATUS_VALUES).optional(),
  partner: z
    .object({
      name: z.string(),
      ico: z.string().nullable(),
      dic: z.string().nullable(),
      vat_id: z.string().nullable(),
      country: z.string().length(2),
    })
    .optional(),
  document_number: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
  issue_date: IsoDate.nullable().optional(),
  duzp: IsoDate.nullable().optional(),
  due_date: IsoDate.nullable().optional(),
  service_period_from: IsoDate.nullable().optional(),
  service_period_to: IsoDate.nullable().optional(),
  currency: z.string().length(3).optional(),
  totals: z
    .object({ net: LabelMoney.nullable(), vat: LabelMoney.nullable(), gross: LabelMoney })
    .optional(),
  vat_summary: z
    .array(z.object({ rate_pct: z.number(), base: LabelMoney, vat: LabelMoney }))
    .optional(),
  lines: z
    .array(
      z.object({ description: z.string(), gross: LabelMoney, line_type: z.enum(LINE_TYPE_VALUES) }),
    )
    .optional(),
  category_code: z.string().optional(),
  vat_treatment: z.enum(VAT_TREATMENT_VALUES).optional(),
  business_flag: z.enum(['business', 'personal', 'mixed', 'unknown']).optional(),
  expected_validations: z
    .array(z.object({ rule_id: z.string(), severity: z.enum(SEVERITY_VALUES) }))
    .default([]),
  expected_questions: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type ExpectedDocRaw = z.output<typeof ExpectedDocRaw>;

export interface GoldenTotals {
  readonly net: Money | null;
  readonly vat: Money | null;
  readonly gross: Money;
}
export interface GoldenVatSummaryRow {
  readonly rate_pct: number;
  readonly base: Money;
  readonly vat: Money;
}
export interface GoldenLine {
  readonly description: string;
  readonly gross: Money;
  readonly line_type: LineType;
}
/** One labeled document with every amount as `Money` in the document currency. */
export type GoldenDoc = Omit<ExpectedDocRaw, 'totals' | 'vat_summary' | 'lines'> & {
  totals?: GoldenTotals;
  vat_summary?: GoldenVatSummaryRow[];
  lines?: GoldenLine[];
};

export const ExpectedDoc = ExpectedDocRaw.transform((doc, ctx): GoldenDoc => {
  const { totals, vat_summary, lines, ...rest } = doc;
  if (totals === undefined && vat_summary === undefined && lines === undefined) {
    return rest;
  }
  const currency = doc.currency;
  if (currency === undefined) {
    ctx.issues.push({
      code: 'custom',
      message: 'currency is required when amounts are labeled',
      input: doc,
      path: ['currency'],
    });
    return z.NEVER;
  }
  const money = (text: string): Money => Money.parse(text, currency);
  const out: GoldenDoc = { ...rest };
  if (totals !== undefined) {
    out.totals = {
      net: totals.net === null ? null : money(totals.net),
      vat: totals.vat === null ? null : money(totals.vat),
      gross: money(totals.gross),
    };
  }
  if (vat_summary !== undefined) {
    out.vat_summary = vat_summary.map((row) => ({
      rate_pct: row.rate_pct,
      base: money(row.base),
      vat: money(row.vat),
    }));
  }
  if (lines !== undefined) {
    out.lines = lines.map((line) => ({
      description: line.description,
      gross: money(line.gross),
      line_type: line.line_type,
    }));
  }
  return out;
});

export const GoldenLabels = z.object({
  version: z.literal('golden-v1'),
  taxpayer: TaxpayerProfileFixture,
  documents: z.array(ExpectedDoc).length(20),
  periods: z
    .array(
      z.object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        dphdp3: z.record(z.string(), z.object({ base: z.number().int(), tax: z.number().int() })),
      }),
    )
    .default([]),
});
export type GoldenLabels = z.output<typeof GoldenLabels>;
```

   No command yet (the files import each other; step 5 typechecks all four).

3. **New `packages/testkit/src/golden/labels-adapters/v1.ts`** (exact content):

```ts
/**
 * M12 §4.10: when the delivered `labels.json` differs from the schema, fix it here, never by
 * relaxing the schema or the metric code. An adapter takes the parsed JSON and returns JSON.
 */
export type LabelsAdapter = (raw: unknown) => unknown;

/** golden-v1 as committed matches the M12 schema, so v1 changes nothing. */
export const v1Adapter: LabelsAdapter = (raw) => raw;
```

   No command yet (the files import each other; step 5 typechecks all four).

4. **New `packages/testkit/src/golden/load.ts`** (exact content):

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { type LabelsAdapter, v1Adapter } from './labels-adapters/v1';
import { GoldenLabels } from './schema';

export type GoldenSetName = 'golden-v1';

/** Thrown when labels do not match the schema. Messages carry paths only, never label values. */
export class GoldenLabelsError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`golden labels invalid:\n${issues.join('\n')}`);
    this.name = 'GoldenLabelsError';
    this.issues = issues;
  }
}

export interface LoadGoldenOptions {
  /** Directory holding `labels.json` (and optionally `expected/`). Default: the committed set. */
  readonly dir?: string;
  /** Applied in order before validation. Default: `[v1Adapter]`. */
  readonly adapters?: readonly LabelsAdapter[];
}

/** Absolute path of `testdata/<set>/` in this repository. */
export function goldenSetDir(set: GoldenSetName = 'golden-v1'): string {
  return fileURLToPath(new URL(`../../../../testdata/${set}/`, import.meta.url));
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

/** Validates already-read labels JSON: adapters first, then the M12 schema. */
export function parseGoldenLabels(
  raw: unknown,
  adapters: readonly LabelsAdapter[] = [v1Adapter],
): GoldenLabels {
  const adapted = adapters.reduce<unknown>((value, adapter) => adapter(value), raw);
  const result = GoldenLabels.safeParse(adapted);
  if (!result.success) {
    throw new GoldenLabelsError(formatIssues(result.error));
  }
  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges `expected/*.json` (alphabetical) into the documents: each file is
 * `{ "documents": { "<file>": { ...fields } } }`, shallow-merged into the document with that `file`.
 */
function mergeExpected(raw: unknown, dir: string): unknown {
  const expectedDir = join(dir, 'expected');
  if (!existsSync(expectedDir) || !isRecord(raw) || !Array.isArray(raw.documents)) {
    return raw;
  }
  const documents: unknown[] = raw.documents.map((doc) => (isRecord(doc) ? { ...doc } : doc));
  const names = readdirSync(expectedDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const name of names) {
    const content: unknown = JSON.parse(readFileSync(join(expectedDir, name), 'utf8'));
    if (!isRecord(content) || !isRecord(content.documents)) {
      throw new GoldenLabelsError([
        `expected/${name}: must be { "documents": { "<file>": {...} } }`,
      ]);
    }
    let position = 0;
    for (const [file, fields] of Object.entries(content.documents)) {
      position += 1;
      const target = documents.find((doc) => isRecord(doc) && doc.file === file);
      if (!isRecord(target) || !isRecord(fields)) {
        throw new GoldenLabelsError([
          `expected/${name}: entry #${position} matches no labeled document or is not an object`,
        ]);
      }
      Object.assign(target, fields);
    }
  }
  return { ...raw, documents };
}

/** Reads `labels.json`, applies adapters, merges `expected/*.json` and validates (M12 §4.10). */
export function loadGoldenLabels(options: LoadGoldenOptions = {}): GoldenLabels {
  const dir = options.dir ?? goldenSetDir();
  const raw: unknown = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const adapters = options.adapters ?? [v1Adapter];
  const adapted = adapters.reduce<unknown>((value, adapter) => adapter(value), raw);
  return parseGoldenLabels(mergeExpected(adapted, dir), []);
}
```

   No command yet (the files import each other; step 5 typechecks all four).

5. **New `packages/testkit/src/golden/index.ts`** (exact content):

```ts
export { type LabelsAdapter, v1Adapter } from './labels-adapters/v1';
export {
  GoldenLabelsError,
  type GoldenSetName,
  goldenSetDir,
  type LoadGoldenOptions,
  loadGoldenLabels,
  parseGoldenLabels,
} from './load';
export {
  ExpectedDoc,
  ExpectedDocRaw,
  type GoldenDoc,
  GoldenLabels,
  type GoldenLine,
  type GoldenTotals,
  type GoldenVatSummaryRow,
  LabelMoney,
  TaxpayerProfileFixture,
} from './schema';
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`. Expected: no output after the `tsc` line (exit 0). Commit `0020 steps 2-5`.

6. **Edit `packages/testkit/src/index.ts`.** After the anchor line `export * from './ids';` (or after the **last** `export * from` line if a parallel brief added one) add exactly one line:

```ts
export * from './golden/index';
```

   Run `pnpm exec biome check --write packages/testkit/src/index.ts 2>&1 | tail -5`. Expected: `Checked 1 file … ` with no errors. Commit `0020 step 6`.

7. **New `packages/testkit/test/golden-labels.test.ts`** (exact content; implement until these tests pass, do not edit the test file):

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Money } from '@shoebox/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GoldenLabelsError,
  goldenSetDir,
  type LabelsAdapter,
  loadGoldenLabels,
  parseGoldenLabels,
  v1Adapter,
} from '../src/index';

type RawDoc = Record<string, unknown> & { totals?: Record<string, unknown>; file: string };
type RawLabels = Record<string, unknown> & { documents: RawDoc[] };

/** A fresh mutable copy of the committed labels. Tests never print label values. */
function rawLabels(): RawLabels {
  return JSON.parse(readFileSync(join(goldenSetDir(), 'labels.json'), 'utf8')) as RawLabels;
}

function firstWithTotals(raw: RawLabels): { doc: RawDoc; index: number } {
  const index = raw.documents.findIndex((doc) => doc.totals !== undefined);
  const doc = raw.documents[index];
  if (doc === undefined) throw new Error('golden set has no document with totals');
  return { doc, index };
}

function issuesOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof GoldenLabelsError) return error.issues;
    throw error;
  }
  throw new Error('expected GoldenLabelsError');
}

const tempDirs: string[] = [];
function tempSet(raw: RawLabels): string {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'labels.json'), JSON.stringify(raw));
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('committed golden-v1', () => {
  it('loads and validates against the M12 schema', () => {
    const labels = loadGoldenLabels();
    expect(labels.version).toBe('golden-v1');
    expect(labels.documents).toHaveLength(20);
    expect(labels.documents.filter((doc) => doc.bookable)).toHaveLength(12);
    expect(labels.documents.filter((doc) => doc.duplicate_of !== null)).toHaveLength(2);
  });

  it('turns every labeled amount into Money in the document currency', () => {
    const labels = loadGoldenLabels();
    let amounts = 0;
    for (const doc of labels.documents) {
      const all: (Money | null)[] = [
        ...(doc.totals ? [doc.totals.net, doc.totals.vat, doc.totals.gross] : []),
        ...(doc.vat_summary ?? []).flatMap((row) => [row.base, row.vat]),
        ...(doc.lines ?? []).map((line) => line.gross),
      ];
      for (const amount of all) {
        if (amount === null) continue;
        expect(Money.isMoney(amount)).toBe(true);
        expect(amount.currency).toBe(doc.currency);
        amounts += 1;
      }
    }
    expect(amounts).toBeGreaterThan(0);
  });

  it('defaults expected_validations and expected_questions to arrays', () => {
    for (const doc of loadGoldenLabels().documents) {
      expect(Array.isArray(doc.expected_validations)).toBe(true);
      expect(Array.isArray(doc.expected_questions)).toBe(true);
    }
  });
});

describe('schema failures', () => {
  it('rejects 19 documents', () => {
    const raw = rawLabels();
    raw.documents.pop();
    expect(issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('documents'))).toBe(
      true,
    );
  });

  it('rejects a comma-decimal money string without echoing the value', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: '1234,50' };
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.totals.gross`))).toBe(true);
    expect(issues.join('\n')).not.toContain('1234,50');
  });

  it('rejects money as a JS number', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: 1234.5 };
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.totals.gross`))).toBe(true);
  });

  it('rejects a class that is not a domain DocumentClass', () => {
    const raw = rawLabels();
    const first = raw.documents[0] as RawDoc;
    first.class = 'invoice';
    expect(
      issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('documents.0.class')),
    ).toBe(true);
  });

  it('rejects amounts without a currency', () => {
    const raw = rawLabels();
    const { doc, index } = firstWithTotals(raw);
    delete doc.currency;
    const issues = issuesOf(() => parseGoldenLabels(raw));
    expect(issues.some((i) => i.startsWith(`documents.${index}.currency`))).toBe(true);
  });

  it('rejects a wrong version', () => {
    const raw = rawLabels();
    raw.version = 'golden-v2';
    expect(issuesOf(() => parseGoldenLabels(raw)).some((i) => i.startsWith('version'))).toBe(true);
  });
});

describe('adapters', () => {
  it('v1Adapter is the identity', () => {
    const raw = rawLabels();
    expect(v1Adapter(raw)).toBe(raw);
  });

  it('applies adapters in order before validation instead of relaxing the schema', () => {
    const raw = rawLabels();
    const { doc } = firstWithTotals(raw);
    doc.totals = { ...doc.totals, gross: '1234,50' };
    const calls: string[] = [];
    const fixComma: LabelsAdapter = (value) => {
      calls.push('fixComma');
      const labels = value as RawLabels;
      for (const d of labels.documents) {
        if (typeof d.totals?.gross === 'string') d.totals.gross = d.totals.gross.replace(',', '.');
      }
      return labels;
    };
    const labels = loadGoldenLabels({ dir: tempSet(raw), adapters: [v1Adapter, fixComma] });
    expect(calls).toEqual(['fixComma']);
    const fixed = labels.documents.find((d) => d.file === doc.file);
    expect(fixed?.totals?.gross.toFixed2()).toBe('1234.50');
  });
});

describe('expected/*.json merge', () => {
  it('merges expected fields into the document with the same file', () => {
    const raw = rawLabels();
    const target = raw.documents[0] as RawDoc;
    const dir = tempSet(raw);
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({
        documents: {
          [target.file]: { expected_validations: [{ rule_id: 'X-TEST', severity: 'warning' }] },
        },
      }),
    );
    const merged = loadGoldenLabels({ dir }).documents[0];
    expect(merged?.expected_validations).toEqual([{ rule_id: 'X-TEST', severity: 'warning' }]);
  });

  it('fails when an expected entry matches no labeled document', () => {
    const dir = tempSet(rawLabels());
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({ documents: { 'no-such-file.pdf': { notes: 'x' } } }),
    );
    expect(issuesOf(() => loadGoldenLabels({ dir }))[0]).toContain('expected/validation.json');
  });

  it('fails when a merged expected field breaks the schema', () => {
    const raw = rawLabels();
    const target = raw.documents[0] as RawDoc;
    const dir = tempSet(raw);
    mkdirSync(join(dir, 'expected'));
    writeFileSync(
      join(dir, 'expected', 'validation.json'),
      JSON.stringify({
        documents: {
          [target.file]: { expected_validations: [{ rule_id: 'X', severity: 'fatal' }] },
        },
      }),
    );
    expect(
      issuesOf(() => loadGoldenLabels({ dir })).some((i) =>
        i.startsWith('documents.0.expected_validations.0.severity'),
      ),
    ).toBe(true);
  });
});
```

   Run `pnpm --filter @shoebox/testkit test golden 2>&1 | tail -30`. Expected: `Test Files  1 passed (1)`, `Tests  14 passed (14)`. If a test fails, fix `src/golden/*` (never the test, never `testdata/`); a failure on the committed set itself means stop (§8). Commit `0020 step 7`.

8. Run §6 in full, then §9.

## 5. Do not touch

- `testdata/**` (the golden set is the contract; a mismatch is fixed in an adapter, never in the data), `packages/domain/**`, `packages/testkit/src/registries/**` and `packages/testkit/src/llm/**` (briefs 0018/0019), any other package, root config, `docs/v3/**`.
- Hard rules: 1 (amounts as `Money`, never a JS number), 4 (never print or log label values, not even in a report or a failing-test paste: quote paths and messages only), 7 (no dependency other than `zod@4.6.5`), 8 (never push to `main`).

## 6. Commands

```
pnpm --filter @shoebox/testkit test golden 2>&1 | tail -30      # Tests 14 passed (14)
pnpm --filter @shoebox/testkit test 2>&1 | tail -30             # all testkit files pass
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30        # exit 0
pnpm lint 2>&1 | tail -30                                       # no errors
python3 scripts/context_lint.py 2>&1 | tail -8                  # after writing the report
```

## 7. Acceptance

Ticket P0-EVAL-01 acceptance, mapped:

- [ ] `packages/testkit/test/golden-labels.test.ts` (ticket name `labels.test.ts`, renamed to match `test golden`): valid set loads — on the **real committed** `testdata/golden-v1` (20 documents, 12 bookable, 2 duplicates) instead of the stub; the ticket's `fixtures/golden-stub/` is not created (P0-EVAL-03 is done, so the stub is redundant).
- [ ] 19 documents fail (`rejects 19 documents`).
- [ ] Wrong money format fails, and the value is not echoed (`rejects a comma-decimal money string …`, `rejects money as a JS number`).
- [ ] An adapter in `labels-adapters/v1.ts` is applied (`src/golden/labels-adapters/v1.ts`; `applies adapters in order before validation …`).
- [ ] `expected/*.json` merge works and an unknown document fails (3 tests).
- [ ] Every labeled amount is a `Money` in the document currency; class, line type, severity and VAT treatment use the domain enums.
- [ ] Files per §3 only; the ticket's paths `src/eval/labels.ts` / `src/eval/load.ts` become `src/golden/schema.ts` / `src/golden/load.ts` (orchestrator decision, §2).
- [ ] §6 commands pass.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test this brief wrote seems wrong;
- the committed `labels.json` itself fails the schema (report the issue paths only, never values);
- `pnpm install` wants to change anything besides the testkit importer and zod;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0020-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -15`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Commit `0020 report`, then `git push -u origin task/0020-golden-labels 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `packages/testkit/src/golden/schema.ts`: money regex, `Money.parse` with the document currency, the currency-required check, enums from `@shoebox/domain`.
- `packages/testkit/src/golden/load.ts`: error messages carry paths only (privacy), `expected/` merge order and unknown-file error.
- `pnpm-lock.yaml` and `packages/testkit/package.json`: only `zod@4.6.5` added; overlaps with brief 0019 in the same `dependencies` block (rebase: keep both lines, rerun `pnpm install`).

## Owner steps

None. The orchestrator opens and merges the PR into `phase/0`.
