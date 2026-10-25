# 0040c: results event model and analysis report (`pnpm proto:report`)

Status: todo
Ticket: PROTO-03 | Depends on: 0040b | Base commit: cba65e2 (rebase on phase/0 after 0040b merges) | Branch: task/0040c-proto-results | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The owner wants to measure, on ~100 real documents and then on every later prompt or model change, how often the model gets the class (invoice / receipt / spam) and each field right, and *why* it goes wrong, with data that grows into a warehouse later. This brief defines `proto-results-v2`: an append-only JSON Lines file of two kinds of event, **runs** (one model reading of one document) and **labels** (one revision of the owner's correction), plus a pure report over it: class confusion matrix, per-field accuracy split into correct / format / wrong / missing / hallucinated, errors, worst documents, what the checks caught, accuracy by input mode, and a comparison of two run selections (prompt v1 vs v2, Haiku vs Sonnet). 0040d makes the page write these events.

## 2. Context

- Grain = production grain (05 data model, design reviewed 2026-10-18): a `run` line ↔ one `extraction_runs` row plus its `document_fields` (nested `fields[]`) plus `source_files` facts (denormalized); a `label` line ↔ `document_fields` with `source='user'`. Nested arrays load as they are into BigQuery (newline-delimited JSON, repeated records) or Postgres (`jsonb`). Nothing is overwritten: a re-read is a new run, a correction is a new label revision. Verdicts are never stored; the report computes them and prints `PROTO_VERDICT_RULES_VERSION`.
- Hard rule 4: real documents and their values never enter git, logs or Sentry. Results files live on the owner's machine or in the private project folder, never in the repo or a GitHub issue. Tests use invented values only.
- Like `renderProtoMismatches`, the report is developer output: field ids and values, English headings, no i18n.
- Money through `Money` (ADR-007), never `parseFloat`.

Existing code in `packages/testkit/src/proto/score.ts`:
- `PROTO_SCORED_FIELDS` (13 ids, first is `'class'`), `type ProtoScoredField`, `normalizeName(name)`.
- Private helpers to export (step 2): `function namesMatch(expected: string, actual: string): boolean {`, `function moneyText(value: string | null, currency: string): string | null {`, `function rateText(value: string): string {`.
- `compareProtoDocument` builds `vat_lines` as rows `${rateText(rate_pct)}:${money(base)}:${money(vat)}`, sorted, joined by one space; `supplier_dic` is `dic ?? vat_id`; `not_tax_document` is `'true'`/`'false'`.

`packages/testkit/src/index.ts` line 8: `export * from './proto/score';`
`scripts/proto-score.mjs` (29 lines) loads `/scripts/proto/score.ts` through Vite SSR; `package.json` line 22: `    "proto:score": "node scripts/proto-score.mjs",`

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/test/proto-results.test.ts` | create | the spec below |
| `packages/testkit/src/proto/score.ts` | edit | export 3 helpers |
| `packages/testkit/src/proto/results.ts` | create | events, verdicts, report |
| `packages/testkit/src/index.ts` | edit | export results |
| `scripts/proto/report.ts` | create | CLI |
| `scripts/proto-report.mjs` | create | Vite loader |
| `package.json` | edit | `proto:report` script |

No other file may change.

## 4. Steps

1. **Write the test file** `packages/testkit/test/proto-results.test.ts` exactly as below. Commit `0040c step 1`.

```ts
import { parseProtoExtraction } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import {
  buildProtoReport,
  classGroupOf,
  fieldVerdict,
  flattenProtoExtraction,
  PROTO_VERDICT_RULES_VERSION,
  type ProtoFieldKey,
  type ProtoLabelRecord,
  type ProtoResultRecord,
  type ProtoRunRecord,
  parseProtoResults,
  renderProtoReport,
} from '../src/index';

// Invented values only (hard rule 4).
const KEYS: ProtoFieldKey[] = [
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
];
const SHA = (n: number): string => n.toString(16).padStart(64, '0');
const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function values(cls: string, over: Partial<Record<ProtoFieldKey, string | null>> = {}) {
  return KEYS.map((key) => ({
    key,
    value: key === 'class' ? cls : key in over ? (over[key] ?? null) : '',
  }));
}

function run(n: number, doc: number, over: Partial<ProtoRunRecord> = {}): ProtoRunRecord {
  return {
    schema: 'proto-results-v2',
    kind: 'run',
    run_id: UUID(n),
    doc_id: SHA(doc),
    batch_id: UUID(900),
    file_name: `doc${doc}.pdf`,
    media_type: 'application/pdf',
    size_bytes: 1000,
    channel: 'upload',
    page_count: null,
    has_text_layer: null,
    provider: 'anthropic',
    model_requested: 'claude-haiku-5-5',
    model: 'claude-haiku-5-5',
    prompt_version: 'm02-proto-v2',
    schema_version: 'm02-proto-v2',
    effort: null,
    input_mode: 'pdf',
    attempt: 1,
    ok: true,
    error: null,
    stop_reason: 'end_turn',
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: '0.0030',
    latency_ms: 1000,
    extracted_at: `2026-10-19T10:00:0${n % 10}.000Z`,
    parse_issues: [],
    checks: [],
    fields: values('received_invoice'),
    raw_response: null,
    ...over,
  };
}

function label(
  n: number,
  doc: number,
  cls: string,
  over: Partial<Record<ProtoFieldKey, string>> = {},
  extra: Partial<ProtoLabelRecord> = {},
): ProtoLabelRecord {
  return {
    schema: 'proto-results-v2',
    kind: 'label',
    label_id: UUID(100 + n),
    doc_id: SHA(doc),
    rev: 1,
    supersedes: null,
    basis_run_id: null,
    labeled_by: 'owner',
    labeled_at: '2026-10-19T11:00:00.000Z',
    fields: values(cls, over).map((field) => ({ key: field.key, value: field.value ?? '' })),
    note: '',
    ...extra,
  };
}

describe('fieldVerdict', () => {
  it('tells correct, missing and hallucinated apart; null counts as empty', () => {
    expect(fieldVerdict('supplier_ico', '', '')).toBe('correct');
    expect(fieldVerdict('supplier_ico', '', null)).toBe('correct');
    expect(fieldVerdict('supplier_ico', '', '12345678')).toBe('hallucinated');
    expect(fieldVerdict('supplier_ico', '12345678', null)).toBe('missing');
    expect(fieldVerdict('supplier_ico', '12345678', '12345678')).toBe('correct');
    expect(fieldVerdict('supplier_ico', '12345678', '12345679')).toBe('wrong');
    expect(fieldVerdict('issue_date', '2026-09-01', '2026-09-02')).toBe('wrong');
  });

  it('calls a same-value, different-spelling answer format', () => {
    expect(fieldVerdict('supplier_ico', '123 456 78', '12345678')).toBe('format');
    expect(fieldVerdict('supplier_name', 'Alza.cz a.s.', 'ALZA.CZ')).toBe('format');
    expect(fieldVerdict('total_gross', '1 210,00', '1210.00')).toBe('format');
    expect(fieldVerdict('total_gross', '1210.00', '1210.50')).toBe('wrong');
    expect(
      fieldVerdict(
        'vat_lines',
        '21:1000:210 12.00:100.00:12.00',
        '12.00:100.00:12.00 21.00:1000.00:210.00',
      ),
    ).toBe('format');
    expect(fieldVerdict('not_tax_document', 'ano', 'true')).toBe('format');
    expect(fieldVerdict('not_tax_document', 'false', 'true')).toBe('wrong');
  });
});

describe('classGroupOf', () => {
  it('folds 04 classes into invoice / receipt / spam / other', () => {
    expect(classGroupOf('received_invoice')).toBe('invoice');
    expect(classGroupOf('received_credit_note')).toBe('invoice');
    expect(classGroupOf('received_proforma')).toBe('invoice');
    expect(classGroupOf('received_receipt')).toBe('receipt');
    expect(classGroupOf('non_document')).toBe('spam');
    expect(classGroupOf('unknown')).toBe('other');
    expect(classGroupOf('order_confirmation')).toBe('other');
  });
});

describe('flattenProtoExtraction', () => {
  it('returns one observation per key in scorer formats, keeping null for "not printed"', () => {
    const extraction = parseProtoExtraction({
      kind_hint: 'tax_invoice',
      supplier: { name: 'Firma s.r.o.', ico: '12345678', dic: '', vat_id: 'DE123', country: 'DE' },
      document: { number: 'F1', variable_symbol: '' },
      dates: { issue_date: '2026-09-12', duzp: '', due_date: '2026-09-26' },
      currency: 'CZK',
      vat_recap: [{ rate_pct: '21.0', base: '100', vat: '21' }],
      totals: { net: '100', vat: '21', gross: '121' },
      payment: { account_number: '', bank_code: '', iban: '' },
      flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false },
    });
    expect(flattenProtoExtraction(extraction)).toEqual([
      { key: 'class', value: 'received_invoice' },
      { key: 'supplier_name', value: 'Firma s.r.o.' },
      { key: 'supplier_ico', value: '12345678' },
      { key: 'supplier_dic', value: 'DE123' },
      { key: 'document_number', value: 'F1' },
      { key: 'variable_symbol', value: null },
      { key: 'issue_date', value: '2026-09-12' },
      { key: 'duzp', value: null },
      { key: 'due_date', value: '2026-09-26' },
      { key: 'currency', value: 'CZK' },
      { key: 'total_gross', value: '121.00' },
      { key: 'vat_lines', value: '21.00:100.00:21.00' },
      { key: 'not_tax_document', value: 'false' },
    ]);
  });
});

describe('parseProtoResults', () => {
  it('reads both kinds, skips blank lines, dedupes by run_id and label_id', () => {
    const lines = [run(1, 1), label(1, 1, 'received_invoice'), run(1, 1), run(2, 2)]
      .map((record) => JSON.stringify(record))
      .join('\n\n');
    const records = parseProtoResults(lines);
    expect(records.map((record) => record.kind)).toEqual(['run', 'label', 'run']);
  });

  it('names the bad line', () => {
    expect(() =>
      parseProtoResults(`${JSON.stringify(run(1, 1))}\n{"schema":"proto-results-v2","kind":"run"}`),
    ).toThrow(/line 2/);
  });
});

describe('buildProtoReport', () => {
  const records: ProtoResultRecord[] = [
    // doc1: an older v1 run (class unknown), then the v2 run: VS missing, DUZP hallucinated, date check fired
    run(5, 1, { prompt_version: 'm02-proto-v1', fields: values('unknown'), extracted_at: '2026-10-18T09:00:00.000Z' }),
    run(1, 1, {
      fields: values('received_invoice', { supplier_ico: '12345678', duzp: '2026-09-01', variable_symbol: null }),
      checks: [{ id: 'date', severity: 'fail' }],
    }),
    label(1, 1, 'received_invoice', { supplier_ico: '12345678', variable_symbol: '77' }, { basis_run_id: UUID(1) }),
    // doc2: receipt read as an invoice, total right in another spelling; label revised once
    run(2, 2, {
      fields: values('received_invoice', { total_gross: '121.00' }),
      cost_usd: '0.0010',
      latency_ms: 2000,
      parse_issues: ['total_vat'],
    }),
    label(2, 2, 'received_invoice', { total_gross: '121' }),
    label(3, 2, 'received_receipt', { total_gross: '121' }, { rev: 2, supersedes: UUID(102) }),
    // doc3: spam caught from a photo; only the class is scored
    run(3, 3, {
      input_mode: 'image',
      media_type: 'image/png',
      stop_reason: 'max_tokens',
      fields: values('non_document', { supplier_ico: '99999999' }),
      checks: [{ id: 'ico_checksum', severity: 'fail' }],
    }),
    label(4, 3, 'non_document'),
    // doc4: one failed attempt, then a good run; not labeled yet
    run(6, 4, { ok: false, attempt: 2, error: 'anthropic: HTTP 529', fields: [], cost_usd: '0.0000', extracted_at: '2026-10-19T09:59:00.000Z' }),
    run(4, 4),
  ];
  const report = buildProtoReport(records);

  it('summarizes runs, labels, spend and failures', () => {
    expect(report.verdictRules).toBe(PROTO_VERDICT_RULES_VERSION);
    expect(report.runs).toBe(6);
    expect(report.failedRuns).toBe(1);
    expect(report.retries).toBe(1);
    expect(report.documents).toBe(4);
    expect(report.labeled).toBe(3);
    expect(report.labelRevisions).toBe(4);
    expect(report.models).toEqual(['claude-haiku-5-5']);
    expect(report.promptVersions).toEqual(['m02-proto-v2']);
    expect(report.costUsd).toBe('0.0130');
    expect(report.meanLatencyMs).toBe(1250);
    expect(report.parseIssueRatePct).toBe(25);
    expect(report.notEndTurn).toBe(1);
  });

  it('builds the class confusion matrix from the latest run and the latest label revision', () => {
    expect(report.confusion.invoice.invoice).toBe(1);
    expect(report.confusion.receipt.invoice).toBe(1);
    expect(report.confusion.spam.spam).toBe(1);
    expect(report.confusion.receipt.receipt).toBe(0);
    expect(report.classAccuracyPct).toBe(67);
  });

  it('scores fields of non-spam labeled documents only', () => {
    const field = (key: string) => report.fields.find((row) => row.field === key);
    expect(field('supplier_ico')).toMatchObject({ scored: 2, correct: 2, hallucinated: 0, accuracyPct: 100 });
    expect(field('variable_symbol')).toMatchObject({ scored: 2, correct: 1, missing: 1, accuracyPct: 50 });
    expect(field('duzp')).toMatchObject({ hallucinated: 1 });
    expect(field('total_gross')).toMatchObject({ format: 1, accuracyPct: 100 });
  });

  it('lists errors, worst documents, what the checks caught and accuracy by input mode', () => {
    expect(report.errors).toEqual([
      { file_name: 'doc1.pdf', field: 'variable_symbol', verdict: 'missing', labeled: '77', predicted: '' },
      { file_name: 'doc1.pdf', field: 'duzp', verdict: 'hallucinated', labeled: '', predicted: '2026-09-01' },
      { file_name: 'doc2.pdf', field: 'class', verdict: 'wrong', labeled: 'received_receipt', predicted: 'received_invoice' },
    ]);
    expect(report.worst).toEqual([
      { file_name: 'doc1.pdf', errors: 2 },
      { file_name: 'doc2.pdf', errors: 1 },
    ]);
    expect(report.checks).toEqual([
      { id: 'date', fired: 1, withError: 1 },
      { id: 'ico_checksum', fired: 1, withError: 0 },
    ]);
    expect(report.byInputMode).toEqual([
      { mode: 'image', labeled: 1, classAccuracyPct: 100, fieldAccuracyPct: null },
      { mode: 'pdf', labeled: 2, classAccuracyPct: 50, fieldAccuracyPct: 92 },
    ]);
  });

  it('compares two run selections on the same labeled documents', () => {
    const compared = buildProtoReport(records, {
      run: { promptVersion: 'm02-proto-v2' },
      compareRun: { promptVersion: 'm02-proto-v1' },
    });
    expect(compared.compare).toMatchObject({
      matched: 1,
      classAccuracyBeforePct: 0,
      classAccuracyAfterPct: 100,
    });
    expect(buildProtoReport(records).compare).toBeNull();
  });

  it('renders a Markdown report', () => {
    const text = renderProtoReport(report);
    expect(text).toContain('# Prototype results');
    expect(text).toContain(`Verdict rules: ${PROTO_VERDICT_RULES_VERSION}`);
    expect(text).toContain('| receipt | 1 | 0 | 0 | 0 |');
    expect(text).toContain('Class accuracy: 67 %');
    expect(text).toContain('| variable_symbol | 2 | 1 | 0 | 0 | 1 | 0 | 50 % |');
    expect(text).toContain('| doc1.pdf | duzp | hallucinated |  | 2026-09-01 |');
    expect(text).toContain('| pdf | 2 | 50 % | 92 % |');
    expect(text).toContain('| image | 1 | 100 % | n/a |');
    expect(text).not.toContain('Compared with');
  });
});
```

Run `pnpm --filter @shoebox/testkit test -- proto-results 2>&1 | tail -30`. Expected: fails (exports missing).

2. **Edit `score.ts`:** add `export ` in front of the three helper lines quoted in §2. Nothing else. Commit `0040c step 2`.

3. **Create `packages/testkit/src/proto/results.ts`** and implement until the tests pass. Do not edit the test file. Exports:

```ts
export const PROTO_RESULTS_SCHEMA = 'proto-results-v2';
export const PROTO_VERDICT_RULES_VERSION = 'verdicts-v1';
export type ProtoResultField = Exclude<ProtoScoredField, 'class'>;
export const PROTO_RESULT_FIELDS: readonly ProtoResultField[]; // PROTO_SCORED_FIELDS without 'class', same order
export type ProtoFieldKey = ProtoScoredField;                   // 'class' + the 12 fields
/** Reserved for later prompts: confidence 0..1, page (1-based), quote (≤ 120 chars). */
export interface ProtoFieldObservation { readonly key: ProtoFieldKey; readonly value: string | null; readonly confidence?: number | null; readonly page?: number | null; readonly quote?: string | null; }
export interface ProtoRunRecord {
  readonly schema: typeof PROTO_RESULTS_SCHEMA; readonly kind: 'run';
  readonly run_id: string; readonly doc_id: string; readonly batch_id: string;     // uuid, sha256 hex (64), uuid
  readonly file_name: string; readonly media_type: string; readonly size_bytes: number;
  readonly channel: 'upload' | 'email'; readonly page_count: number | null; readonly has_text_layer: boolean | null;
  readonly provider: string; readonly model_requested: string; readonly model: string;
  readonly prompt_version: string; readonly schema_version: string; readonly effort: string | null;
  readonly input_mode: 'pdf' | 'image';
  readonly attempt: number; readonly ok: boolean; readonly error: string | null; readonly stop_reason: string | null;
  readonly input_tokens: number; readonly output_tokens: number; readonly cache_read_tokens: number; readonly cache_write_tokens: number;
  readonly cost_usd: string;                                                   // decimal string or 'n/a'
  readonly latency_ms: number; readonly extracted_at: string;                  // ISO UTC
  readonly parse_issues: readonly string[];
  readonly checks: readonly { readonly id: string; readonly severity: 'pass' | 'warn' | 'fail' }[];
  readonly fields: readonly ProtoFieldObservation[];                           // [] when ok is false
  readonly raw_response: string | null;                                       // the model's JSON text
}
export interface ProtoLabelRecord {
  readonly schema: typeof PROTO_RESULTS_SCHEMA; readonly kind: 'label';
  readonly label_id: string; readonly doc_id: string; readonly rev: number; readonly supersedes: string | null;
  readonly basis_run_id: string | null; readonly labeled_by: string; readonly labeled_at: string;
  readonly fields: readonly { readonly key: ProtoFieldKey; readonly value: string }[];  // '' = not on the document
  readonly note: string;
}
export type ProtoResultRecord = ProtoRunRecord | ProtoLabelRecord;
export type ProtoVerdict = 'correct' | 'format' | 'wrong' | 'missing' | 'hallucinated';
export type ProtoClassGroup = 'invoice' | 'receipt' | 'spam' | 'other';
export const PROTO_CLASS_GROUPS: readonly ProtoClassGroup[]; // ['invoice','receipt','spam','other']
export interface ProtoRunSelector { readonly promptVersion: string; readonly model?: string; }
export function classGroupOf(documentClass: string): ProtoClassGroup;
export function fieldVerdict(field: ProtoResultField, labeled: string, predicted: string | null): ProtoVerdict;
export function flattenProtoExtraction(extraction: ProtoExtraction): ProtoFieldObservation[];
export function parseProtoResults(text: string): ProtoResultRecord[];
export interface ProtoFieldStats { field: ProtoResultField; scored: number; correct: number; format: number; wrong: number; missing: number; hallucinated: number; accuracyPct: number | null; }
export interface ProtoErrorRow { file_name: string; field: ProtoFieldKey; verdict: ProtoVerdict; labeled: string; predicted: string; }
export interface ProtoReport {
  verdictRules: string; runs: number; failedRuns: number; retries: number;
  documents: number; labeled: number; labelRevisions: number;
  models: string[]; promptVersions: string[]; costUsd: string; meanLatencyMs: number | null;
  parseIssueRatePct: number | null; notEndTurn: number; classAccuracyPct: number | null;
  confusion: Record<ProtoClassGroup, Record<ProtoClassGroup, number>>;
  fields: ProtoFieldStats[]; errors: ProtoErrorRow[];
  worst: { file_name: string; errors: number }[];
  checks: { id: string; fired: number; withError: number }[];
  byInputMode: { mode: string; labeled: number; classAccuracyPct: number | null; fieldAccuracyPct: number | null }[];
  compare: null | { matched: number; classAccuracyBeforePct: number | null; classAccuracyAfterPct: number | null; fields: { field: ProtoResultField; beforePct: number | null; afterPct: number | null }[] };
}
export function buildProtoReport(records: readonly ProtoResultRecord[], options?: { run?: ProtoRunSelector; compareRun?: ProtoRunSelector }): ProtoReport;
export function renderProtoReport(report: ProtoReport): string;
```

Rules (the tests are the spec; these explain them):
- `fieldVerdict`: `null` → `''`; trim both. Both empty → `correct`; labeled empty → `hallucinated`; predicted empty → `missing`; equal → `correct`; equal after `normalize(field, …)` → `format`; else `wrong`. Normalize: `supplier_name` uses `namesMatch`; `total_gross` removes spaces, `,`→`.`, then `moneyText(v, 'CZK')` (unparseable stays as is); `vat_lines` splits on whitespace into rows, each row on `:` and each part through the money rule, rows sorted and joined by a space; `not_tax_document` maps `ano|yes|true` → `true`, `ne|no|false` → `false` (case-insensitive); every other field: strip diacritics, uppercase, remove whitespace.
- `classGroupOf`: `invoice` = `received_invoice`, `received_credit_note`, `received_proforma`, `received_advance_tax_doc`, `issued_invoice`, `issued_credit_note`; `receipt` = `received_receipt`; `spam` = `non_document`; everything else `other`.
- `flattenProtoExtraction`: 13 observations in `PROTO_SCORED_FIELDS` order; `null` stays `null`; money via `moneyText` with the extraction's currency or `CZK`; `supplier_dic` = `dic ?? vat_id`; `vat_lines` = `null` when the recap is empty; `not_tax_document` always `'true'`/`'false'`.
- `parseProtoResults`: zod discriminated union on `kind` (`schema` literal; `doc_id` `/^[0-9a-f]{64}$/`; `run_id`, `label_id`, `batch_id` `z.uuid()`; optional `confidence`, `page`, `quote` on observations). Blank lines skipped. Bad line → `Error(\`proto results line ${n}: ${zodMessage}\`)`. Duplicate `run_id` or `label_id`: keep the first, drop the repeat (files from several sessions may be concatenated).
- Selection: per `doc_id`, the **selected run** is the latest `extracted_at` among runs with `ok: true` matching `options.run` (any run when absent); the **label** is the highest `rev`. `documents` = docs with a selected run; `labeled` = of those, docs with a label. `runs`, `failedRuns` (`ok: false`), `retries` (Σ `attempt − 1`), `labelRevisions`, `costUsd` (Σ through `Money` in `USD`, skipping `'n/a'`, `toFixed(4)`) count **all** records. `models`, `promptVersions`, `meanLatencyMs` (rounded), `parseIssueRatePct` (selected runs with ≥ 1 issue), `notEndTurn` (selected runs whose `stop_reason` is not `end_turn`) use selected runs.
- Class: every labeled doc (an error row with field `class` when groups differ, after that doc's field rows). Fields: labeled docs whose label group is not `spam`. `accuracyPct` = round(100 × (correct + format) / scored), `null` when 0. Errors: `wrong`, `missing`, `hallucinated`, docs in order of their selected run's first appearance, fields in `PROTO_RESULT_FIELDS` order, `predicted` printed as `''` for `null`. `worst`: docs with ≥ 1 error, most first, ties by `file_name`, at most 10. `checks`: per id with a `warn` or `fail` in a selected run, sorted by id; `withError` = those docs with ≥ 1 error row. `byInputMode`: per `input_mode` of the selected run, sorted by mode, over labeled docs: class accuracy and pooled field accuracy (`null` when no field scored).
- `compare` (only with `compareRun`): docs labeled and with a selected run under both selectors; class and per-field accuracy before (`compareRun`) and after (`run`).
- `renderProtoReport`: Markdown, in this order: `# Prototype results`; a summary block (runs, failed runs, retries, documents, labeled, label revisions, models, prompts, `Cost: X USD`, `Mean latency: N ms`, parse issue rate, not end_turn, `Verdict rules: verdicts-v1`); `## Class (rows: labeled, columns: model)` table `| | invoice | receipt | spam | other |` with one row per group, then `Class accuracy: 67 %`; `## Fields` table `| field | scored | correct | format | wrong | missing | hallucinated | accuracy |` (accuracy `50 %` or `n/a`); `## Errors` table `| file | field | verdict | labeled | model |` (empty cells stay empty: `|  |`); `## Worst documents`; `## Checks` table `| check | fired | with an error |`; `## By input mode` table `| mode | labeled | class accuracy | field accuracy |`; and only when `compare` is set, `## Compared with the other run selection`.

Run the step 1 command: all pass. Commit `0040c step 3`.

4. **Edit `packages/testkit/src/index.ts`:** after line 8 add `export * from './proto/results';`. Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`: clean. Commit `0040c step 4`.

5. **Create `scripts/proto/report.ts`** (~60 lines, same style as `score.ts`): `export const USAGE = 'Usage: pnpm proto:report <results.jsonl>... [--run <prompt>[@model]] [--compare-run <prompt>[@model]] [--out <report.md>]\n'`; `export function parseArgs(argv)` (one or more positional paths, concatenated; `--run`, `--compare-run` split on `@`; `--out`; `--anonymized` throws `--anonymized is not built yet`; `--help`; unknown flag → throw); `export async function main(argv): Promise<number>` reads the files with `readFileSync(path, 'utf8')`, joins them with `\n`, `parseProtoResults`, `buildProtoReport`, `renderProtoReport`, writes to `--out` when given (and prints `report written to <path>`), else to stdout. Bad args → usage, exit 2; parse error → its message, exit 1. Commit `0040c step 5`.

6. **Create `scripts/proto-report.mjs`:** copy `scripts/proto-score.mjs`, change only the comment's first line to `// \`pnpm proto:report\`: runs scripts/proto/report.ts through Vite's SSR module loader (like eval.mjs),` and the loaded module to `'/scripts/proto/report.ts'`. Commit `0040c step 6`.

7. **Edit `package.json`:** after the `proto:score` line add `    "proto:report": "node scripts/proto-report.mjs",`. Check: write three of the step 1 test's records to `/tmp/r.jsonl` (outside the repo), run `pnpm proto:report /tmp/r.jsonl 2>&1 | head -50`: prints the report. Commit `0040c step 7`.

## 5. Do not touch

Everything outside §3, in particular `compareProtoDocument` and the existing exports of `score.ts`. Never put a results file under the repo (hard rule 4).

## 6. Commands

```
pnpm --filter @shoebox/testkit test -- proto-results proto-score 2>&1 | tail -30
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30
pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30
pnpm exec biome check packages/testkit scripts/proto scripts/proto-report.mjs 2>&1 | tail -30
```

## 7. Acceptance

- [ ] `proto-results.test.ts` passes unchanged; `proto-score.test.ts` still passes.
- [ ] `pnpm proto:report /tmp/r.jsonl` prints a report with every section.
- [ ] `git status --short` shows no `.jsonl` file.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

`docs/tasks/0040c-report.md`, as in the template §9. Set `Status: review`, open one PR to `phase/0`.

## Risk list (for the reviewer)

`packages/testkit/src/proto/results.ts` (the selection and verdict rules decide every number the owner will act on).

## Owner steps

None.
