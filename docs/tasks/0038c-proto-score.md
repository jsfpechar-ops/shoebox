# 0038c: `pnpm proto:score`: golden-v1 through extraction + checks, per-field accuracy, cached answers

Status: review
Ticket: PROTO-01 (part c of a/b/c/d) | Depends on: 0038b (same branch) | Base commit: head of task/proto-scanner after 0038b | Branch: task/proto-scanner | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`@shoebox/testkit` gets the pure scorer (`compareProtoDocument`, `protoAccuracy`, `renderProtoAccuracy`, `renderProtoMismatches`) and `scripts/proto/` gets the shared pipeline (`.env.local`, cached model answers under `.cache/proto-cassettes`, one document through 0038a + 0038b, approximate cost as `Money`) plus the CLI behind `pnpm proto:score [--fresh]`, which prints a per-field accuracy table, per-document mismatches (field values only), check counts and token cost; without a key it exits 2 with a Czech/English message.

## 2. Context

Rules (AGENTS.md, rules.md), pasted:

- Hard rule 4: no document content in output. The CLI prints file names, field values, check messages and token counts only. Cassettes hold only the response and the request hash (`@shoebox/testkit` `CassetteFile`), under `.cache/` which this brief adds to `.gitignore`.
- Hard rule 1: the cost estimate is `Money` arithmetic (`price × tokens / 1 000 000`), never a float. Prices are the Gemini Flash list prices as of 2026-10-18 (`0.30` / `2.50` USD per 1M tokens, marked `TODO(verify)` for `gemini-3.8-flash`); the free tier costs 0, the number is an indication.
- Hard rule 7: no new dependency, no new workspace. `scripts/proto/*.ts` run through Vite's SSR loader exactly like `scripts/eval.mjs` (Vite is a root devDependency) with `@shoebox/*` aliased to the package sources, because `scripts/` has no `node_modules`. `scripts/proto/tsconfig.json` typechecks them with `paths`.
- M12 §4.10: `labels.json` is loaded with `loadGoldenLabels()` (zod-validated, money as `Money`); documents with `duplicate_of` set are identical bytes and are skipped; `taxpayer.today` (2026-10-18) is the clock for the date checks. golden-v1 is anonymized (its README), the only set that may be sent to the free-tier model (decisions 2026-10-18 [proto]).
- Rate limits: the free tier is small, so the CLI runs documents one after another; `createGeminiClient` (0038a) retries 429/5xx with 15 s × attempt, 4 attempts. The brief writer's real run (18 documents, 2026-10-18) needed no retry and cost ≈ 0.045 USD at list price.
- `@shoebox/testkit` already depends on `@shoebox/extraction` and `@shoebox/domain`; the scorer imports nothing else, so `packages/testkit/package.json` and the lockfile are untouched. Testkit must not import `@shoebox/validation` (no dependency, and the layering): the checks are run in `scripts/proto/pipeline.ts`.
- Biome: `noConsole` is off under `scripts/**`; the CLI still writes through `process.stdout.write`.

Anchors (`task/proto-scanner` after 0038b):

`packages/testkit/src/index.ts` (step 1), the 9-line file ends with:

```ts
export * from './llm/index';
export * from './registries/index';
```

`package.json` (root) line 21 (step 5):

```json
    "eval": "node scripts/eval.mjs",
```

`.gitignore` (step 5), the last line:

```
supabase/.temp/
```

All code below was run by the brief writer on `origin/phase/0` plus 0038a+b: `tsc` clean for testkit and for `scripts/proto`, `biome ci` clean, `pnpm --filter @shoebox/testkit test` 91 passed (8 files; `proto-score.test.ts` 6), `pnpm depcruise` clean, `pii_guard` OK, `pnpm proto:score` without a key → the Czech/English message and exit 2, and with the owner's key → 18 documents, overall 93 % (174/187 fields), second run `18 odpovědí z cache`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/src/proto/score.ts` | create | scorer |
| `packages/testkit/src/index.ts` | edit | one export line |
| `packages/testkit/test/proto-score.test.ts` | create | 6 tests |
| `scripts/proto/pipeline.ts` | create | env, cache, one document, cost |
| `scripts/proto/tsconfig.json` | create | typecheck for scripts/proto |
| `scripts/proto/score.ts` | create | the CLI |
| `scripts/proto-score.mjs` | create | Vite runner |
| `package.json` | edit | two scripts |
| `.gitignore` | edit | `.cache/` |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 80–302
- Step 2 code: lines 308–520
- Step 3 code: lines 528–686
- Step 4 code: lines 694–872
- Step 5 code: lines 880–889
- Step 6: commands only

Setup: you are on `task/proto-scanner` after 0038b (`git log --oneline -1` shows `0038b step 4` or `0038b step 5`; if not, STOP). `pnpm install` is done.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0038c step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/testkit/src/proto/score.ts`, edit `packages/testkit/src/index.ts`

`packages/testkit/src/proto/score.ts`:

```ts
/**
 * Prototype scoring (decisions 2026-10-18 [proto]): compares a `ProtoExtraction` with one
 * golden-v1 label and aggregates per-field accuracy. Pure; the CLI in scripts/proto prints it.
 * Only field values appear in the output, never document text (hard rule 4).
 */
import { CZK, Money } from '@shoebox/domain';
import type { ProtoExtraction } from '@shoebox/extraction';
import type { GoldenDoc } from '../golden/schema';

export const PROTO_SCORED_FIELDS = [
  'class',
  'supplier_name',
  'supplier_ico',
  'supplier_dic',
  'document_number',
  'variable_symbol',
  'issue_date',
  'duzp',
  'due_date',
  'currency',
  'total_gross',
  'vat_lines',
  'not_tax_document',
] as const;
export type ProtoScoredField = (typeof PROTO_SCORED_FIELDS)[number];

export interface ProtoFieldResult {
  readonly field: ProtoScoredField;
  /** '' = the label says "not printed". */
  readonly expected: string;
  readonly actual: string;
  readonly match: boolean;
}

export interface ProtoDocumentScore {
  readonly file: string;
  readonly fields: readonly ProtoFieldResult[];
}

export interface ProtoAccuracyRow {
  readonly field: ProtoScoredField;
  readonly correct: number;
  readonly scored: number;
  /** Whole percent, or null when nothing was scored. */
  readonly percent: number | null;
}

/** Lowercase, no diacritics, no punctuation, single spaces: "Alza.cz a.s." → "alza cz a s". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(expected: string, actual: string): boolean {
  const a = normalizeName(expected);
  const b = normalizeName(actual);
  if (a === '' || b === '') return a === b;
  return a === b || a.includes(b) || b.includes(a);
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

function moneyText(value: string | null, currency: string): string | null {
  if (value === null) return null;
  try {
    return Money.parse(value, currency).toFixed2();
  } catch {
    return null;
  }
}

function rateText(value: string): string {
  return moneyText(value, CZK) ?? value;
}

function exact(field: ProtoScoredField, expected: string, actual: string): ProtoFieldResult {
  return { field, expected, actual, match: expected === actual };
}

/** Field results for the fields the label carries; a label without `partner` scores no supplier field. */
export function compareProtoDocument(label: GoldenDoc, got: ProtoExtraction): ProtoFieldResult[] {
  const results: ProtoFieldResult[] = [];
  results.push(exact('class', label.class, got.document_class));
  if (label.partner !== undefined) {
    const name = text(got.supplier.name);
    results.push({
      field: 'supplier_name',
      expected: label.partner.name,
      actual: name,
      match: namesMatch(label.partner.name, name),
    });
    results.push(exact('supplier_ico', text(label.partner.ico), text(got.supplier.ico)));
    results.push(
      exact(
        'supplier_dic',
        text(label.partner.dic ?? label.partner.vat_id),
        text(got.supplier.dic ?? got.supplier.vat_id),
      ),
    );
  }
  if (label.document_number !== undefined) {
    results.push(exact('document_number', text(label.document_number), text(got.document.number)));
  }
  if (label.variable_symbol !== undefined) {
    results.push(
      exact('variable_symbol', text(label.variable_symbol), text(got.document.variable_symbol)),
    );
  }
  if (label.issue_date !== undefined) {
    results.push(exact('issue_date', text(label.issue_date), text(got.dates.issue_date)));
  }
  if (label.duzp !== undefined) results.push(exact('duzp', text(label.duzp), text(got.dates.duzp)));
  if (label.due_date !== undefined) {
    results.push(exact('due_date', text(label.due_date), text(got.dates.due_date)));
  }
  if (label.currency !== undefined) {
    results.push(exact('currency', label.currency, text(got.currency)));
  }
  const currency = label.currency ?? CZK;
  if (label.totals !== undefined) {
    const actual = moneyText(got.totals.gross, currency) ?? text(got.totals.gross);
    results.push(exact('total_gross', label.totals.gross.toFixed2(), actual));
  }
  if (label.vat_summary !== undefined) {
    const expected = label.vat_summary
      .map(
        (row) => `${rateText(String(row.rate_pct))}:${row.base.toFixed2()}:${row.vat.toFixed2()}`,
      )
      .sort()
      .join(' ');
    const actual = got.vat_recap
      .map(
        (row) =>
          `${rateText(row.rate_pct)}:${moneyText(row.base, currency) ?? row.base}:${moneyText(row.vat, currency) ?? row.vat}`,
      )
      .sort()
      .join(' ');
    results.push(exact('vat_lines', expected, actual));
  }
  if (label.tax_doc_status !== undefined) {
    results.push(
      exact(
        'not_tax_document',
        String(label.tax_doc_status === 'not_tax_document'),
        String(got.not_tax_document),
      ),
    );
  }
  return results;
}

export function protoAccuracy(docs: readonly ProtoDocumentScore[]): ProtoAccuracyRow[] {
  return PROTO_SCORED_FIELDS.map((field) => {
    let correct = 0;
    let scored = 0;
    for (const doc of docs) {
      for (const result of doc.fields) {
        if (result.field !== field) continue;
        scored += 1;
        if (result.match) correct += 1;
      }
    }
    return {
      field,
      correct,
      scored,
      percent: scored === 0 ? null : Math.round((correct * 100) / scored),
    };
  });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** A fixed-width table; `header` is the translated "field | correct | scored | accuracy" line. */
export function renderProtoAccuracy(rows: readonly ProtoAccuracyRow[], header: string): string {
  const width = Math.max(...PROTO_SCORED_FIELDS.map((field) => field.length), 5);
  const lines = [header, '-'.repeat(width + 24)];
  for (const row of rows) {
    const percent = row.percent === null ? '  n/a' : `${String(row.percent).padStart(3)} %`;
    lines.push(
      `${pad(row.field, width)} ${String(row.correct).padStart(7)} ${String(row.scored).padStart(7)} ${percent}`,
    );
  }
  const total = rows.reduce((sum, row) => sum + row.correct, 0);
  const scored = rows.reduce((sum, row) => sum + row.scored, 0);
  const overall =
    scored === 0 ? '  n/a' : `${String(Math.round((total * 100) / scored)).padStart(3)} %`;
  lines.push('-'.repeat(width + 24));
  lines.push(
    `${pad('total', width)} ${String(total).padStart(7)} ${String(scored).padStart(7)} ${overall}`,
  );
  return `${lines.join('\n')}\n`;
}

/** One line per mismatched field: `file: field expected=… actual=…`. Empty string when all match. */
export function renderProtoMismatches(docs: readonly ProtoDocumentScore[]): string {
  const lines: string[] = [];
  for (const doc of docs) {
    for (const result of doc.fields) {
      if (result.match) continue;
      lines.push(
        `${doc.file}: ${result.field} expected=${result.expected} actual=${result.actual}`,
      );
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
```

`packages/testkit/src/index.ts`: find the anchor with `grep -nF "export * from './llm/index';" packages/testkit/src/index.ts` (one hit). Insert this line right after it:

```ts
export * from './proto/score';
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: create `packages/testkit/test/proto-score.test.ts`

```ts
import { parseProtoExtraction } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import {
  compareProtoDocument,
  type GoldenDoc,
  loadGoldenLabels,
  normalizeName,
  protoAccuracy,
  renderProtoAccuracy,
  renderProtoMismatches,
} from '../src/index';

// golden-v1 is anonymized (testdata/golden-v1/README.md); the values below are its synthetic labels.
const labels = loadGoldenLabels();

function doc(file: string): GoldenDoc {
  const found = labels.documents.find((candidate) => candidate.file === file);
  if (found === undefined) throw new Error(`no label for ${file}`);
  return found;
}

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Soukup Radek',
      ico: '20861176',
      dic: doc('Faktura_260807.pdf').partner?.dic ?? '',
      vat_id: '',
      country: 'CZ',
    },
    document: { number: '260807', variable_symbol: '260807' },
    dates: { issue_date: '2026-09-12', duzp: '2026-08-31', due_date: '2026-09-26' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21.0', base: '10711.44', vat: '2249.4' }],
    totals: { net: '10711.44', vat: '2249.40', gross: '12960.84' },
    payment: { account_number: '', bank_code: '', iban: '' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false },
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('drops diacritics, case and punctuation', () => {
    expect(normalizeName('Čistý Dům servis s.r.o.')).toBe('cisty dum servis s r o');
    expect(normalizeName('  Alza.cz a.s. ')).toBe('alza cz a s');
  });
});

describe('compareProtoDocument', () => {
  it('scores every labeled field of a domestic invoice, tolerant on name order and number format', () => {
    const results = compareProtoDocument(doc('Faktura_260807.pdf'), parseProtoExtraction(wire()));
    expect(results.map((result) => result.field)).toEqual([
      'class',
      'supplier_name',
      'supplier_ico',
      'supplier_dic',
      'document_number',
      'variable_symbol',
      'issue_date',
      'duzp',
      'due_date',
      'currency',
      'total_gross',
      'vat_lines',
      'not_tax_document',
    ]);
    const mismatches = results.filter((result) => !result.match);
    expect(mismatches.map((result) => result.field)).toEqual(['supplier_name']);
    expect(results.find((result) => result.field === 'vat_lines')).toEqual({
      field: 'vat_lines',
      expected: '21.00:10711.44:2249.40',
      actual: '21.00:10711.44:2249.40',
      match: true,
    });
  });

  it('matches a name that contains the label (or the reverse) and a null duzp to ""', () => {
    const got = parseProtoExtraction(
      wire({
        supplier: { name: 'Radek Soukup, DiS.', ico: '', dic: '', vat_id: '', country: '' },
        dates: { issue_date: '2026-09-12', duzp: '', due_date: '' },
      }),
    );
    const results = compareProtoDocument(doc('Faktura_260807.pdf'), got);
    const byField = new Map(results.map((result) => [result.field, result]));
    expect(byField.get('supplier_name')?.match).toBe(true);
    expect(byField.get('supplier_ico')).toMatchObject({
      expected: '20861176',
      actual: '',
      match: false,
    });
    expect(byField.get('duzp')).toMatchObject({ expected: '2026-08-31', actual: '', match: false });
    expect(byField.get('due_date')).toMatchObject({
      expected: '2026-09-26',
      actual: '',
      match: false,
    });
  });

  it('uses vat_id when the label has no DIČ and the flag for not_tax_document', () => {
    const anthropic = doc('Invoice-4D2A91C7-3518204.pdf');
    const got = parseProtoExtraction(
      wire({
        supplier: {
          name: 'Anthropic Ireland',
          ico: '',
          dic: '',
          vat_id: 'IE4276970QH',
          country: 'IE',
        },
        currency: 'EUR',
        vat_recap: [{ rate_pct: '0', base: '90.00', vat: '0.00' }],
        totals: { net: '90.00', vat: '0.00', gross: '90.00' },
      }),
    );
    const results = compareProtoDocument(anthropic, got);
    const byField = new Map(results.map((result) => [result.field, result]));
    expect(byField.get('supplier_dic')).toMatchObject({ expected: 'IE4276970QH', match: true });
    expect(byField.get('total_gross')).toMatchObject({
      expected: '90.00',
      actual: '90.00',
      match: true,
    });
    expect(byField.get('vat_lines')).toMatchObject({ expected: '0.00:90.00:0.00', match: true });
    expect(byField.get('not_tax_document')).toMatchObject({ expected: 'false', actual: 'false' });
    const alza = compareProtoDocument(
      doc('4021738955.pdf'),
      parseProtoExtraction(
        wire({
          flags: {
            not_tax_document_text: true,
            non_vat_payer_text: false,
            reverse_charge_text: false,
          },
        }),
      ),
    );
    expect(alza.find((result) => result.field === 'not_tax_document')).toMatchObject({
      expected: 'true',
      actual: 'true',
      match: true,
    });
  });

  it('scores only the labeled fields of a filing (class and issue date, no partner or totals)', () => {
    const results = compareProtoDocument(
      doc('DPHDP3-7801011229-20260920-141836.pdf'),
      parseProtoExtraction(wire({ kind_hint: 'government_filing' })),
    );
    expect(results.map((result) => result.field)).toEqual(['class', 'issue_date']);
    expect(results[0]).toEqual({
      field: 'class',
      expected: 'government_filing',
      actual: 'government_filing',
      match: true,
    });
  });
});

describe('protoAccuracy and rendering', () => {
  it('aggregates per field and renders a table and the mismatch lines', () => {
    const docs = [
      {
        file: 'a.pdf',
        fields: [
          {
            field: 'class' as const,
            expected: 'received_invoice',
            actual: 'received_invoice',
            match: true,
          },
          { field: 'duzp' as const, expected: '2026-08-31', actual: '', match: false },
        ],
      },
      {
        file: 'b.pdf',
        fields: [
          {
            field: 'class' as const,
            expected: 'received_receipt',
            actual: 'unknown',
            match: false,
          },
        ],
      },
    ];
    const rows = protoAccuracy(docs);
    expect(rows.find((row) => row.field === 'class')).toEqual({
      field: 'class',
      correct: 1,
      scored: 2,
      percent: 50,
    });
    expect(rows.find((row) => row.field === 'currency')).toEqual({
      field: 'currency',
      correct: 0,
      scored: 0,
      percent: null,
    });
    const table = renderProtoAccuracy(rows, 'Field | correct | scored | accuracy');
    expect(table.split('\n')[0]).toBe('Field | correct | scored | accuracy');
    expect(table).toContain('class                  1       2  50 %');
    expect(table).toContain('currency               0       0   n/a');
    expect(table.trimEnd().split('\n').at(-1)).toBe('total                  1       3  33 %');
    expect(renderProtoMismatches(docs)).toBe(
      'a.pdf: duzp expected=2026-08-31 actual=\nb.pdf: class expected=received_receipt actual=unknown\n',
    );
    expect(renderProtoMismatches([])).toBe('');
  });
});
```

Command: `pnpm exec biome ci packages/testkit 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/testkit test 2>&1 | tail -6` → `Test Files  8 passed (8)` and `Tests  91 passed (91)`. Commit.

### Step 3: create `scripts/proto/pipeline.ts` and `scripts/proto/tsconfig.json`

`scripts/proto/pipeline.ts`:

```ts
// Shared by `pnpm proto:score` and `pnpm proto:serve` (decisions 2026-10-18 [proto]): env and key,
// the disk cache of model answers (testkit cassettes under .cache/, gitignored), one document
// through extraction + checks, and the approximate cost. No document content is ever printed.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LegalDate, Money } from '@shoebox/domain';
import {
  buildProtoRequest,
  createLlmClientFromEnv,
  type LlmClient,
  type LlmEnvConfig,
  type LlmResponse,
  type LlmUsage,
  loadDotEnvFile,
  type ProtoExtraction,
  type ProtoMediaType,
  parseProtoExtraction,
} from '@shoebox/extraction';
import type { Locale } from '@shoebox/i18n';
import { createCassetteClient, fsCassetteStore, MissingCassetteError } from '@shoebox/testkit';
import { type RenderedProtoCheck, renderProtoChecks, runProtoChecks } from '@shoebox/validation';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROTO_CACHE_DIR = join(REPO_ROOT, '.cache', 'proto-cassettes');
export const PROTO_MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Gemini Flash list prices in USD per 1M tokens (paid tier; the free tier costs 0). Approximate:
 * TODO(verify) the gemini-3.8-flash price on ai.google.dev/pricing before quoting it to anyone.
 */
export const PRICE_USD_PER_MTOK_IN = '0.30';
export const PRICE_USD_PER_MTOK_OUT = '2.50';
const USD = 'USD';
const MTOK = '1000000';

/** Reads `.env.local` at the repo root (shell wins), then builds the configured client. */
export function loadProtoEnv(): { client: LlmClient; config: LlmEnvConfig } {
  loadDotEnvFile(join(REPO_ROOT, '.env.local'), process.env);
  return createLlmClientFromEnv(process.env);
}

export interface CachingClient extends LlmClient {
  /** Answers served from the cache (identical request hash). */
  readonly hits: () => number;
}

/** Replays a cached answer when one exists, else calls `live` and records it. `fresh` always calls live. */
export function createCachingClient(
  live: LlmClient,
  fresh: boolean,
  root = PROTO_CACHE_DIR,
): CachingClient {
  const store = fsCassetteStore(root);
  const replay = createCassetteClient({ mode: 'replay', store });
  const record = createCassetteClient({ mode: 'record', store, live });
  let hits = 0;
  return {
    hits: () => hits,
    async complete(request) {
      if (!fresh) {
        try {
          const response = await replay.complete(request);
          hits += 1;
          return response;
        } catch (error) {
          if (!(error instanceof MissingCassetteError)) throw error;
        }
      }
      return record.complete(request);
    },
  };
}

export interface ProtoRunInput {
  readonly model: string;
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
  readonly today: LegalDate;
  readonly locale?: Locale;
}

export interface ProtoRunResult {
  readonly extraction: ProtoExtraction;
  readonly checks: RenderedProtoCheck[];
  readonly response: LlmResponse;
}

export class ProtoRunError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ProtoRunError';
  }
}

/** One document: model call, normalization, deterministic checks with Czech (or `locale`) messages. */
export async function runProtoDocument(
  client: LlmClient,
  input: ProtoRunInput,
): Promise<ProtoRunResult> {
  const request = buildProtoRequest({
    model: input.model,
    file: { bytes: input.bytes, mediaType: input.mediaType },
  });
  const response = await client.complete(request);
  if (response.stopReason === 'refusal') throw new ProtoRunError('model refused the document');
  if (response.json === null) {
    throw new ProtoRunError(`no JSON in the answer (stop reason ${response.stopReason})`);
  }
  const extraction = parseProtoExtraction(response.json);
  const checks = renderProtoChecks(
    runProtoChecks(extraction, { today: input.today }),
    input.locale ?? 'cs',
  );
  return { extraction, checks, response };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

export const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** `tokens × price / 1M` as Money (never a float), four decimals of a dollar. */
export function estimateCostUsd(usage: LlmUsage): string {
  const input = Money.parse(PRICE_USD_PER_MTOK_IN, USD)
    .multiply(String(usage.inputTokens))
    .divide(MTOK);
  const output = Money.parse(PRICE_USD_PER_MTOK_OUT, USD)
    .multiply(String(usage.outputTokens))
    .divide(MTOK);
  return input.add(output).toDecimal().toFixed(4);
}
```

`scripts/proto/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "../..",
    "paths": {
      "@shoebox/*": ["../../packages/*/src/index.ts"]
    }
  },
  "include": ["*.ts"]
}
```

Command: `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3` → no errors. Commit.

### Step 4: create `scripts/proto/score.ts` and `scripts/proto-score.mjs`

`scripts/proto/score.ts`:

```ts
// `pnpm proto:score [--fresh] [--set-dir <dir>]`: every golden-v1 document through the prototype
// extraction and checks, compared with labels.json. Sequential (free-tier rate limits), answers
// cached under .cache/proto-cassettes so a rerun is free; `--fresh` calls the model again.
// Output: per-field accuracy, per-document mismatches (field values only), check counts, cost.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLegalDate } from '@shoebox/domain';
import { LlmKeyMissingError, protoMediaTypeOf } from '@shoebox/extraction';
import { t } from '@shoebox/i18n';
import {
  compareProtoDocument,
  goldenSetDir,
  loadGoldenLabels,
  type ProtoDocumentScore,
  protoAccuracy,
  renderProtoAccuracy,
  renderProtoMismatches,
} from '@shoebox/testkit';
import {
  addUsage,
  createCachingClient,
  estimateCostUsd,
  loadProtoEnv,
  runProtoDocument,
  ZERO_USAGE,
} from './pipeline';

export const USAGE = `Usage: pnpm proto:score [--fresh] [--set-dir <dir>]

  --fresh          ignore cached answers and call the model again
  --set-dir <dir>  golden set directory (default: testdata/golden-v1)
`;

export interface ScoreOptions {
  readonly fresh: boolean;
  readonly setDir: string;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): ScoreOptions {
  let fresh = false;
  let setDir = goldenSetDir();
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fresh') fresh = true;
    else if (arg === '--set-dir') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--set-dir needs a value');
      setDir = next;
      i += 1;
    } else if (arg === '--help' || arg === '-h') help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return { fresh, setDir, help };
}

const out = (text: string): void => {
  process.stdout.write(text);
};

export async function main(argv: readonly string[]): Promise<number> {
  let options: ScoreOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }
  let env: ReturnType<typeof loadProtoEnv>;
  try {
    env = loadProtoEnv();
  } catch (error) {
    if (error instanceof LlmKeyMissingError) {
      out(`${t('proto.cli.no_key', { keyEnv: error.keyEnv })}\n`);
      return 2;
    }
    throw error;
  }
  const client = createCachingClient(env.client, options.fresh);
  const labels = loadGoldenLabels({ dir: options.setDir });
  const today = parseLegalDate(labels.taxpayer.today);
  const docs: ProtoDocumentScore[] = [];
  const checkLines: string[] = [];
  const failures: string[] = [];
  let usage = ZERO_USAGE;
  let calls = 0;
  out(
    `${env.config.provider} ${env.config.model}, ${labels.documents.length} labels, today ${today}\n`,
  );
  for (const label of labels.documents) {
    if (label.duplicate_of !== null) continue;
    const mediaType = protoMediaTypeOf(label.file);
    if (mediaType === null) {
      failures.push(
        t('proto.cli.document_failed', { file: label.file, detail: 'unsupported type' }),
      );
      continue;
    }
    const bytes = readFileSync(join(options.setDir, 'docs', label.file));
    try {
      const result = await runProtoDocument(client, {
        model: env.config.model,
        bytes,
        mediaType,
        today,
      });
      calls += 1;
      usage = addUsage(usage, result.response.usage);
      docs.push({ file: label.file, fields: compareProtoDocument(label, result.extraction) });
      const counts = { pass: 0, warn: 0, fail: 0 };
      for (const check of result.checks) counts[check.severity] += 1;
      const failing = result.checks
        .filter((check) => check.severity !== 'pass')
        .map((check) => `  ${check.severity} ${check.id}: ${check.message}`);
      checkLines.push(`${label.file}: ${counts.pass}/${counts.warn}/${counts.fail}`, ...failing);
      out('.');
    } catch (error) {
      failures.push(
        t('proto.cli.document_failed', { file: label.file, detail: (error as Error).message }),
      );
      out('x');
    }
  }
  out('\n\n');
  out(renderProtoAccuracy(protoAccuracy(docs), t('proto.cli.table_header')));
  out(`\n${t('proto.cli.mismatches')}\n${renderProtoMismatches(docs) || '-\n'}`);
  out(`\n${t('proto.cli.checks')}\n${checkLines.join('\n')}\n`);
  if (failures.length > 0) out(`\n${failures.join('\n')}\n`);
  out(
    `\n${t('proto.cli.cost', {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cost: estimateCostUsd(usage),
      cached: client.hits(),
    })}\n`,
  );
  return failures.length === 0 && calls > 0 ? 0 : 1;
}
```

`scripts/proto-score.mjs`:

```js
// `pnpm proto:score`: runs scripts/proto/score.ts through Vite's SSR module loader (like eval.mjs),
// so no extra TS runner is needed. `@shoebox/*` is aliased to the package sources because scripts/
// is not a workspace package.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: [
      {
        find: /^@shoebox\/(domain|extraction|i18n|testkit|validation)$/,
        replacement: `${root}packages/$1/src/index.ts`,
      },
    ],
  },
  ssr: { noExternal: [/^@shoebox\//] },
});
try {
  const cli = await server.ssrLoadModule('/scripts/proto/score.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} finally {
  await server.close();
}
```

Command: `pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -3` → no errors; `pnpm exec biome ci scripts 2>&1 | tail -3` → no errors. Commit.

### Step 5: edit `package.json` and `.gitignore`, run the CLI

`package.json`: find the anchor with `grep -nF '"eval": "node scripts/eval.mjs",' package.json` (one hit, line 21). Insert these two lines right after it (same 4-space indent):

```json
    "proto:score": "node scripts/proto-score.mjs",
    "proto:serve": "node scripts/proto-serve.mjs",
```

`.gitignore`: append one line at the end of the file:

```
.cache/
```

Command: `pnpm proto:score 2>&1 | tail -4`. Expected, in this order of likelihood:

- no `.env.local` with a key on this machine (normal for the executor): the line `Chybí GEMINI_API_KEY. Vložte klíč do souboru .env.local … / GEMINI_API_KEY is not set. …` and `ELIFECYCLE  Command failed with exit code 2`;
- the owner already put `GEMINI_API_KEY` into `.env.local`: dots for 18 documents, then a table starting `Pole | správně | hodnoceno | přesnost`, a `Neshody` block, a `Kontroly (pass/warn/fail)` block and a `Tokeny: … vstup, … výstup; cena přibližně … USD (0 odpovědí z cache).` line, exit 0. Then `pnpm proto:score 2>&1 | tail -1` again → the same line ending `(18 odpovědí z cache).` and `ls .cache/proto-cassettes/gemini-3.8-flash/m02-proto-v1 | wc -l` → `18`. Never paste the table's file names or values into chat beyond the report; never print `.env.local`.

Also `git status --short | grep -c cache` → `0` (the cache is ignored). Commit.

### Step 6: repo guards, push

Command: `pnpm depcruise 2>&1 | tail -2` → `no dependency violations found`; `pnpm lint 2>&1 | tail -3` → ends with `check:tenant-sql: … no Drizzle call on a tenant table outside withTenant()` (biome ci and the i18n test passed before it); `python3 scripts/pii_guard.py --all packages/testkit/src/proto/score.ts packages/testkit/test/proto-score.test.ts scripts/proto/pipeline.ts scripts/proto/score.ts scripts/proto-score.mjs 2>&1 | tail -1` → `pii_guard: OK`; `git diff --stat origin/phase/0 -- pnpm-lock.yaml | tail -1` → `1 file changed, 7 insertions(+)` (only 0038b's lines). Nothing to commit. Write the report (§9) and push: `git push origin task/proto-scanner 2>&1 | tail -3`. No PR yet (0038d opens it).

## 5. Do not touch

`packages/testkit/package.json`, `packages/testkit/src/eval/**`, `packages/testkit/src/golden/**`, `packages/testkit/src/llm/**`, `packages/extraction/**`, `packages/validation/**`, `scripts/eval.mjs`, `vitest.config.ts`, `vitest.workspace.ts`, `testdata/**` (never add a cassette or a document there), `.env*`, `docs/v3/**`, `.github/**`. Hard rules 1, 4, 7, 8. The key stays in the owner's `.env.local` or shell; never in a file you write, never in the report.

## 6. Commands

```
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                       # 91 passed (8 files)
pnpm --filter @shoebox/testkit exec vitest run test/proto-score.test.ts 2>&1 | tail -6    # 6 passed
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                  # exit 0
pnpm exec tsc -p scripts/proto/tsconfig.json 2>&1 | tail -30                              # exit 0
pnpm exec biome ci packages/testkit scripts 2>&1 | tail -30                               # No fixes applied, no errors
pnpm proto:score 2>&1 | tail -30                                                          # key message + exit 2, or the table
pnpm depcruise 2>&1 | tail -3                                                             # no dependency violations found
pnpm lint 2>&1 | tail -30                                                                 # biome, i18n, tenant-sql all OK
python3 scripts/pii_guard.py --all packages/testkit/src/proto/score.ts packages/testkit/test/proto-score.test.ts scripts/proto/*.ts scripts/proto-score.mjs 2>&1 | tail -3   # pii_guard: OK
```

## 7. Acceptance

- [ ] `packages/testkit/test/proto-score.test.ts`: 6 passed; it pins the 13 scored fields in order, the name match `Soukup Radek` ↔ `Radek Soukup` (normalized, contains), `vat_lines` rendered as `21.00:10711.44:2249.40`, `vat_id` used when the label has no DIČ, the table row `class                  1       2  50 %` and the `total` row.
- [ ] `pnpm proto:score` without a key prints the `proto.cli.no_key` message (Czech then English) and exits 2; with a key it prints the table, mismatches, checks and the cost line, and a second run reports `18 odpovědí z cache`.
- [ ] `grep -c "proto:" package.json` → `2`; `grep -c "^.cache/$" .gitignore` → `1`; `git status --short` shows no `.cache` entry after a run.
- [ ] `pnpm exec tsc -p scripts/proto/tsconfig.json` exit 0; `pnpm depcruise` clean; `packages/testkit/package.json` unchanged (`git diff --stat origin/phase/0 -- packages/testkit/package.json` → empty).
- [ ] No file in `scripts/proto` or `packages/testkit` contains a real key (`grep -rn "AQ\.\|AIza" scripts packages/testkit` → no output).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- `pnpm proto:score` with a key fails on more than one document (`x` marks) twice in a row: report the error line (status only), do not retry a third time (rate limits);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0038c-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output (for `proto:score` with a key: the accuracy table and the cost line, nothing else).
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`score.ts` (testkit): which fields are scored (only those the label carries; duplicates skipped by the CLI), `supplier_dic` = label `dic ?? vat_id` against model `dic ?? vat_id`, name match by normalized containment (a looser rule than production will use), `vat_lines` as a sorted `rate:base:vat` string, `not_tax_document` against `tax_doc_status === 'not_tax_document'`. `pipeline.ts`: replay-then-record cache keyed by the testkit `cassettePath` (model, prompt version, request hash: the file bytes are part of the hash, so an identical duplicate hits the cache), `--fresh` records without reading, cost as `Money` with `TODO(verify)` prices, `ProtoRunError` on refusal or missing JSON. `proto-score.mjs`: the alias regex covers the five packages the scripts import; adding a sixth package needs the regex extended. Vite prints a WebSocket warning only if another Vite instance runs; `ws: false` avoids it. The free-tier run is sequential; a 429 storm shows as `x` marks with `gemini: HTTP 429` in the failure lines.

## Owner steps

Optional now, required for 0038d: `GEMINI_API_KEY=…` in `.env.local` at the repo root (0038d has the click-by-click list). With it, `pnpm proto:score` runs the 18 documents once (about ten minutes on the free tier) and every later run is free.
