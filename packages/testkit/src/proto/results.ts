/**
 * Prototype results (`proto-results-v2`, decision 2026-10-18 [proto]): an append-only JSON Lines
 * log of model readings (`run`) and owner corrections (`label`), and a pure report over it.
 * Nothing is overwritten; verdicts are computed here, never stored. Developer output: field ids
 * and values, English headings. Real documents never enter this file's tests or the repo (hard rule 4).
 */
import { CZK, Money } from '@shoebox/domain';
import type { ProtoExtraction } from '@shoebox/extraction';
import { z } from 'zod';
import {
  moneyText,
  namesMatch,
  PROTO_SCORED_FIELDS,
  type ProtoScoredField,
  rateText,
} from './score';

export const PROTO_RESULTS_SCHEMA = 'proto-results-v2';
export const PROTO_VERDICT_RULES_VERSION = 'verdicts-v1';
export type ProtoResultField = Exclude<ProtoScoredField, 'class'>;
export const PROTO_RESULT_FIELDS: readonly ProtoResultField[] = PROTO_SCORED_FIELDS.filter(
  (field): field is ProtoResultField => field !== 'class',
);
export type ProtoFieldKey = ProtoScoredField;

/** Reserved for later prompts: confidence 0..1, page (1-based), quote (≤ 120 chars). */
export interface ProtoFieldObservation {
  readonly key: ProtoFieldKey;
  readonly value: string | null;
  readonly confidence?: number | null;
  readonly page?: number | null;
  readonly quote?: string | null;
}

export interface ProtoRunRecord {
  readonly schema: typeof PROTO_RESULTS_SCHEMA;
  readonly kind: 'run';
  readonly run_id: string;
  readonly doc_id: string;
  readonly batch_id: string;
  readonly file_name: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly channel: 'upload' | 'email';
  readonly page_count: number | null;
  readonly has_text_layer: boolean | null;
  readonly provider: string;
  readonly model_requested: string;
  readonly model: string;
  readonly prompt_version: string;
  readonly schema_version: string;
  readonly effort: string | null;
  readonly input_mode: 'pdf' | 'image';
  readonly attempt: number;
  readonly ok: boolean;
  readonly error: string | null;
  readonly stop_reason: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_tokens: number;
  readonly cache_write_tokens: number;
  readonly cost_usd: string;
  readonly latency_ms: number;
  readonly extracted_at: string;
  readonly parse_issues: readonly string[];
  readonly checks: readonly { readonly id: string; readonly severity: 'pass' | 'warn' | 'fail' }[];
  readonly fields: readonly ProtoFieldObservation[];
  readonly raw_response: string | null;
}

export interface ProtoLabelRecord {
  readonly schema: typeof PROTO_RESULTS_SCHEMA;
  readonly kind: 'label';
  readonly label_id: string;
  readonly doc_id: string;
  readonly rev: number;
  readonly supersedes: string | null;
  readonly basis_run_id: string | null;
  readonly labeled_by: string;
  readonly labeled_at: string;
  readonly fields: readonly { readonly key: ProtoFieldKey; readonly value: string }[];
  readonly note: string;
}

export type ProtoResultRecord = ProtoRunRecord | ProtoLabelRecord;
export type ProtoVerdict = 'correct' | 'format' | 'wrong' | 'missing' | 'hallucinated';
export type ProtoClassGroup = 'invoice' | 'receipt' | 'spam' | 'other';
export const PROTO_CLASS_GROUPS: readonly ProtoClassGroup[] = [
  'invoice',
  'receipt',
  'spam',
  'other',
];
export interface ProtoRunSelector {
  readonly promptVersion: string;
  readonly model?: string;
}

const INVOICE_CLASSES = new Set([
  'received_invoice',
  'received_credit_note',
  'received_proforma',
  'received_advance_tax_doc',
  'issued_invoice',
  'issued_credit_note',
]);

export function classGroupOf(documentClass: string): ProtoClassGroup {
  if (INVOICE_CLASSES.has(documentClass)) return 'invoice';
  if (documentClass === 'received_receipt') return 'receipt';
  if (documentClass === 'non_document') return 'spam';
  return 'other';
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The money rule for vat_lines parts and total_gross: CZK money text, unparseable kept as is. */
function moneyOrRaw(value: string): string {
  return moneyText(value, CZK) ?? value;
}

function normalizeVatLines(value: string): string {
  return value
    .split(/\s+/)
    .filter((row) => row !== '')
    .map((row) => row.split(':').map(moneyOrRaw).join(':'))
    .sort()
    .join(' ');
}

function normalizeField(field: ProtoResultField, value: string): string {
  switch (field) {
    case 'total_gross':
      return moneyOrRaw(value.replace(/\s/g, '').replace(/,/g, '.'));
    case 'vat_lines':
      return normalizeVatLines(value);
    case 'not_tax_document': {
      const lower = value.toLowerCase();
      if (['ano', 'yes', 'true'].includes(lower)) return 'true';
      if (['ne', 'no', 'false'].includes(lower)) return 'false';
      return value;
    }
    default:
      return stripDiacritics(value).toUpperCase().replace(/\s+/g, '');
  }
}

export function fieldVerdict(
  field: ProtoResultField,
  labeled: string,
  predicted: string | null,
): ProtoVerdict {
  const expected = labeled.trim();
  const actual = (predicted ?? '').trim();
  if (expected === '' && actual === '') return 'correct';
  if (expected === '') return 'hallucinated';
  if (actual === '') return 'missing';
  if (expected === actual) return 'correct';
  if (field === 'supplier_name') return namesMatch(expected, actual) ? 'format' : 'wrong';
  return normalizeField(field, expected) === normalizeField(field, actual) ? 'format' : 'wrong';
}

export function flattenProtoExtraction(extraction: ProtoExtraction): ProtoFieldObservation[] {
  const currency = extraction.currency ?? CZK;
  const vatLines =
    extraction.vat_recap.length === 0
      ? null
      : extraction.vat_recap
          .map(
            (row) =>
              `${rateText(row.rate_pct)}:${moneyText(row.base, currency) ?? row.base}:${moneyText(row.vat, currency) ?? row.vat}`,
          )
          .sort()
          .join(' ');
  const observations: Record<ProtoFieldKey, string | null> = {
    class: extraction.document_class,
    supplier_name: extraction.supplier.name,
    supplier_ico: extraction.supplier.ico,
    supplier_dic: extraction.supplier.dic ?? extraction.supplier.vat_id,
    document_number: extraction.document.number,
    variable_symbol: extraction.document.variable_symbol,
    issue_date: extraction.dates.issue_date,
    duzp: extraction.dates.duzp,
    due_date: extraction.dates.due_date,
    currency: extraction.currency,
    total_gross: moneyText(extraction.totals.gross, currency),
    vat_lines: vatLines,
    not_tax_document: extraction.flags.not_tax_document_text ? 'true' : 'false',
  };
  return PROTO_SCORED_FIELDS.map((key) => ({ key, value: observations[key] }));
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const observationSchema = z.object({
  key: z.enum(PROTO_SCORED_FIELDS),
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  quote: z.string().max(120).nullable().optional(),
});
const runSchema = z.object({
  schema: z.literal(PROTO_RESULTS_SCHEMA),
  kind: z.literal('run'),
  run_id: z.uuid(),
  doc_id: sha256Hex,
  batch_id: z.uuid(),
  file_name: z.string(),
  media_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  channel: z.enum(['upload', 'email']),
  page_count: z.number().int().nonnegative().nullable(),
  has_text_layer: z.boolean().nullable(),
  provider: z.string(),
  model_requested: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  schema_version: z.string(),
  effort: z.string().nullable(),
  input_mode: z.enum(['pdf', 'image']),
  attempt: z.number().int().positive(),
  ok: z.boolean(),
  error: z.string().nullable(),
  stop_reason: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  cost_usd: z.string(),
  latency_ms: z.number().nonnegative(),
  extracted_at: z.iso.datetime(),
  parse_issues: z.array(z.string()),
  checks: z.array(z.object({ id: z.string(), severity: z.enum(['pass', 'warn', 'fail']) })),
  fields: z.array(observationSchema),
  raw_response: z.string().nullable(),
});
const labelSchema = z.object({
  schema: z.literal(PROTO_RESULTS_SCHEMA),
  kind: z.literal('label'),
  label_id: z.uuid(),
  doc_id: sha256Hex,
  rev: z.number().int().positive(),
  supersedes: z.uuid().nullable(),
  basis_run_id: z.uuid().nullable(),
  labeled_by: z.string(),
  labeled_at: z.iso.datetime(),
  fields: z.array(z.object({ key: z.enum(PROTO_SCORED_FIELDS), value: z.string() })),
  note: z.string(),
});
const recordSchema = z.discriminatedUnion('kind', [runSchema, labelSchema]);

/** Reads JSON Lines; blank lines are skipped, a repeated run_id or label_id keeps its first copy. */
export function parseProtoResults(text: string): ProtoResultRecord[] {
  const seen = new Set<string>();
  const records: ProtoResultRecord[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNo = index + 1;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`proto results line ${lineNo}: not JSON`);
    }
    const parsed = recordSchema.safeParse(json);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(record)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`proto results line ${lineNo}: ${message}`);
    }
    const record = parsed.data as ProtoResultRecord;
    const id = record.kind === 'run' ? record.run_id : record.label_id;
    if (seen.has(id)) return;
    seen.add(id);
    records.push(record);
  });
  return records;
}

export interface ProtoFieldStats {
  field: ProtoResultField;
  scored: number;
  correct: number;
  format: number;
  wrong: number;
  missing: number;
  hallucinated: number;
  accuracyPct: number | null;
}

export interface ProtoErrorRow {
  file_name: string;
  field: ProtoFieldKey;
  verdict: ProtoVerdict;
  labeled: string;
  predicted: string;
}

export interface ProtoReport {
  verdictRules: string;
  runs: number;
  failedRuns: number;
  retries: number;
  documents: number;
  labeled: number;
  labelRevisions: number;
  models: string[];
  promptVersions: string[];
  costUsd: string;
  meanLatencyMs: number | null;
  parseIssueRatePct: number | null;
  notEndTurn: number;
  classAccuracyPct: number | null;
  confusion: Record<ProtoClassGroup, Record<ProtoClassGroup, number>>;
  fields: ProtoFieldStats[];
  errors: ProtoErrorRow[];
  worst: { file_name: string; errors: number }[];
  checks: { id: string; fired: number; withError: number }[];
  byInputMode: {
    mode: string;
    labeled: number;
    classAccuracyPct: number | null;
    fieldAccuracyPct: number | null;
  }[];
  compare: null | {
    matched: number;
    classAccuracyBeforePct: number | null;
    classAccuracyAfterPct: number | null;
    fields: { field: ProtoResultField; beforePct: number | null; afterPct: number | null }[];
  };
}

interface SelectedRun {
  readonly run: ProtoRunRecord;
  readonly index: number;
}

function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((100 * part) / whole);
}

function fieldValue(
  record: { readonly fields: readonly { key: ProtoFieldKey; value: string | null }[] },
  key: ProtoFieldKey,
): string | null {
  return record.fields.find((field) => field.key === key)?.value ?? null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Latest ok run per document that matches the selector. */
function selectRuns(
  runs: readonly { run: ProtoRunRecord; index: number }[],
  selector?: ProtoRunSelector,
): Map<string, SelectedRun> {
  const selected = new Map<string, SelectedRun>();
  for (const { run, index } of runs) {
    if (!run.ok) continue;
    if (selector && run.prompt_version !== selector.promptVersion) continue;
    if (selector?.model !== undefined && run.model !== selector.model) continue;
    const current = selected.get(run.doc_id);
    if (!current || Date.parse(run.extracted_at) > Date.parse(current.run.extracted_at)) {
      selected.set(run.doc_id, { run, index });
    }
  }
  return selected;
}

interface DocOutcome {
  readonly fileName: string;
  readonly mode: string;
  readonly classOk: boolean;
  readonly fieldVerdicts: readonly { field: ProtoResultField; verdict: ProtoVerdict }[];
  readonly errors: readonly ProtoErrorRow[];
}

/** Scores one labeled document against its selected run. */
function scoreDocument(selected: SelectedRun, label: ProtoLabelRecord): DocOutcome {
  const { run } = selected;
  const labeledClass = fieldValue(label, 'class') ?? '';
  const predictedClass = fieldValue(run, 'class') ?? '';
  const classOk = classGroupOf(labeledClass) === classGroupOf(predictedClass);
  const fieldVerdicts: { field: ProtoResultField; verdict: ProtoVerdict }[] = [];
  const errors: ProtoErrorRow[] = [];
  if (classGroupOf(labeledClass) !== 'spam') {
    for (const field of PROTO_RESULT_FIELDS) {
      const labeled = fieldValue(label, field) ?? '';
      const predicted = fieldValue(run, field);
      const verdict = fieldVerdict(field, labeled, predicted);
      fieldVerdicts.push({ field, verdict });
      if (verdict === 'wrong' || verdict === 'missing' || verdict === 'hallucinated') {
        errors.push({
          file_name: run.file_name,
          field,
          verdict,
          labeled,
          predicted: predicted ?? '',
        });
      }
    }
  }
  if (!classOk) {
    errors.push({
      file_name: run.file_name,
      field: 'class',
      verdict: 'wrong',
      labeled: labeledClass,
      predicted: predictedClass,
    });
  }
  return { fileName: run.file_name, mode: run.input_mode, classOk, fieldVerdicts, errors };
}

function emptyConfusion(): Record<ProtoClassGroup, Record<ProtoClassGroup, number>> {
  const row = (): Record<ProtoClassGroup, number> => ({
    invoice: 0,
    receipt: 0,
    spam: 0,
    other: 0,
  });
  return { invoice: row(), receipt: row(), spam: row(), other: row() };
}

export function buildProtoReport(
  records: readonly ProtoResultRecord[],
  options: { run?: ProtoRunSelector; compareRun?: ProtoRunSelector } = {},
): ProtoReport {
  const indexed = records.map((record, index) => ({ record, index }));
  const allRuns = indexed.flatMap(({ record, index }) =>
    record.kind === 'run' ? [{ run: record, index }] : [],
  );
  const labels = records.filter((record): record is ProtoLabelRecord => record.kind === 'label');
  const latestLabel = new Map<string, ProtoLabelRecord>();
  for (const label of labels) {
    const current = latestLabel.get(label.doc_id);
    if (!current || label.rev > current.rev) latestLabel.set(label.doc_id, label);
  }

  const selected = selectRuns(allRuns, options.run);
  const selectedRuns = [...selected.values()];
  const docsInOrder = [...selected.entries()].sort((a, b) => a[1].index - b[1].index);
  const confusion = emptyConfusion();
  const errors: ProtoErrorRow[] = [];
  const outcomes: { docId: string; outcome: DocOutcome }[] = [];
  const checkFired = new Map<string, Set<string>>();
  const checkWithError = new Map<string, Set<string>>();

  for (const [docId, entry] of docsInOrder) {
    for (const check of entry.run.checks) {
      if (check.severity === 'pass') continue;
      if (!checkFired.has(check.id)) checkFired.set(check.id, new Set());
      checkFired.get(check.id)?.add(docId);
    }
    const label = latestLabel.get(docId);
    if (!label) continue;
    const outcome = scoreDocument(entry, label);
    outcomes.push({ docId, outcome });
    errors.push(...outcome.errors);
    const labeledGroup = classGroupOf(fieldValue(label, 'class') ?? '');
    const predictedGroup = classGroupOf(fieldValue(entry.run, 'class') ?? '');
    confusion[labeledGroup][predictedGroup] += 1;
    if (outcome.errors.length > 0) {
      for (const check of entry.run.checks) {
        if (check.severity === 'pass') continue;
        if (!checkWithError.has(check.id)) checkWithError.set(check.id, new Set());
        checkWithError.get(check.id)?.add(docId);
      }
    }
  }

  const labeledOutcomes = outcomes;
  const scoredOutcomes = labeledOutcomes.filter(({ outcome }) => outcome.fieldVerdicts.length > 0);
  const fields: ProtoFieldStats[] = PROTO_RESULT_FIELDS.map((field) => {
    const counts = { correct: 0, format: 0, wrong: 0, missing: 0, hallucinated: 0 };
    let scored = 0;
    for (const { outcome } of scoredOutcomes) {
      for (const row of outcome.fieldVerdicts) {
        if (row.field !== field) continue;
        scored += 1;
        counts[row.verdict] += 1;
      }
    }
    return {
      field,
      scored,
      ...counts,
      accuracyPct: percentOf(counts.correct + counts.format, scored),
    };
  });

  const worstMap = new Map<string, number>();
  for (const { outcome } of labeledOutcomes) {
    if (outcome.errors.length === 0) continue;
    worstMap.set(outcome.fileName, (worstMap.get(outcome.fileName) ?? 0) + outcome.errors.length);
  }
  const worst = [...worstMap.entries()]
    .map(([file_name, count]) => ({ file_name, errors: count }))
    .sort((a, b) => b.errors - a.errors || a.file_name.localeCompare(b.file_name))
    .slice(0, 10);

  const classOkCount = labeledOutcomes.filter(({ outcome }) => outcome.classOk).length;

  const byMode = new Map<string, DocOutcome[]>();
  for (const { docId, outcome } of labeledOutcomes) {
    const mode = selected.get(docId)?.run.input_mode ?? outcome.mode;
    byMode.set(mode, [...(byMode.get(mode) ?? []), outcome]);
  }
  const byInputMode = [...byMode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mode, outcomes]) => {
      const scoredVerdicts = outcomes.flatMap((outcome) => outcome.fieldVerdicts);
      const fieldOk = scoredVerdicts.filter(
        (row) => row.verdict === 'correct' || row.verdict === 'format',
      ).length;
      return {
        mode,
        labeled: outcomes.length,
        classAccuracyPct: percentOf(
          outcomes.filter((outcome) => outcome.classOk).length,
          outcomes.length,
        ),
        fieldAccuracyPct: percentOf(fieldOk, scoredVerdicts.length),
      };
    });

  const checkIds = uniqueSorted([...checkFired.keys()]);
  const checks = checkIds.map((id) => ({
    id,
    fired: checkFired.get(id)?.size ?? 0,
    withError: checkWithError.get(id)?.size ?? 0,
  }));

  let compare: ProtoReport['compare'] = null;
  if (options.compareRun) {
    const before = selectRuns(allRuns, options.compareRun);
    const matchedDocs = labeledOutcomes.filter(({ docId }) => before.has(docId));
    const beforeOutcomes = matchedDocs.map(({ docId }) =>
      scoreDocument(before.get(docId) as SelectedRun, latestLabel.get(docId) as ProtoLabelRecord),
    );
    const afterOutcomes = matchedDocs.map(({ docId }) => {
      const entry = selected.get(docId) as SelectedRun;
      return scoreDocument(entry, latestLabel.get(docId) as ProtoLabelRecord);
    });
    const fieldPct = (outcomeList: DocOutcome[], field: ProtoResultField): number | null => {
      const rows = outcomeList.flatMap((outcome) =>
        outcome.fieldVerdicts.filter((row) => row.field === field),
      );
      const ok = rows.filter((row) => row.verdict === 'correct' || row.verdict === 'format').length;
      return percentOf(ok, rows.length);
    };
    compare = {
      matched: matchedDocs.length,
      classAccuracyBeforePct: percentOf(
        beforeOutcomes.filter((o) => o.classOk).length,
        beforeOutcomes.length,
      ),
      classAccuracyAfterPct: percentOf(
        afterOutcomes.filter((o) => o.classOk).length,
        afterOutcomes.length,
      ),
      fields: PROTO_RESULT_FIELDS.map((field) => ({
        field,
        beforePct: fieldPct(beforeOutcomes, field),
        afterPct: fieldPct(afterOutcomes, field),
      })),
    };
  }

  const costs = allRuns
    .filter(({ run }) => run.cost_usd !== 'n/a')
    .map(({ run }) => Money.parse(run.cost_usd, 'USD'));
  const latencies = selectedRuns.map(({ run }) => run.latency_ms);

  return {
    verdictRules: PROTO_VERDICT_RULES_VERSION,
    runs: allRuns.length,
    failedRuns: allRuns.filter(({ run }) => !run.ok).length,
    retries: allRuns.reduce((sum, { run }) => sum + (run.attempt - 1), 0),
    documents: selected.size,
    labeled: labeledOutcomes.length,
    labelRevisions: labels.length,
    models: uniqueSorted(selectedRuns.map(({ run }) => run.model)),
    promptVersions: uniqueSorted(selectedRuns.map(({ run }) => run.prompt_version)),
    costUsd: Money.sum(costs, 'USD').toDecimal().toFixed(4),
    meanLatencyMs:
      latencies.length === 0
        ? null
        : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    parseIssueRatePct: percentOf(
      selectedRuns.filter(({ run }) => run.parse_issues.length > 0).length,
      selectedRuns.length,
    ),
    notEndTurn: selectedRuns.filter(({ run }) => run.stop_reason !== 'end_turn').length,
    classAccuracyPct: percentOf(classOkCount, labeledOutcomes.length),
    confusion,
    fields,
    errors,
    worst,
    checks,
    byInputMode,
    compare,
  };
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${value} %`;
}

export function renderProtoReport(report: ProtoReport): string {
  const lines: string[] = [];
  lines.push('# Prototype results', '');
  lines.push(`- Runs: ${report.runs} (failed: ${report.failedRuns}, retries: ${report.retries})`);
  lines.push(`- Documents: ${report.documents} (labeled: ${report.labeled})`);
  lines.push(`- Label revisions: ${report.labelRevisions}`);
  lines.push(`- Models: ${report.models.join(', ') || 'n/a'}`);
  lines.push(`- Prompts: ${report.promptVersions.join(', ') || 'n/a'}`);
  lines.push(`- Cost: ${report.costUsd} USD`);
  lines.push(
    `- Mean latency: ${report.meanLatencyMs === null ? 'n/a' : `${report.meanLatencyMs} ms`}`,
  );
  lines.push(`- Parse issue rate: ${pct(report.parseIssueRatePct)}`);
  lines.push(`- Not end_turn: ${report.notEndTurn}`);
  lines.push(`- Verdict rules: ${report.verdictRules}`, '');

  lines.push('## Class (rows: labeled, columns: model)', '');
  lines.push('| | invoice | receipt | spam | other |', '|---|---|---|---|---|');
  for (const group of PROTO_CLASS_GROUPS) {
    const row = report.confusion[group];
    lines.push(`| ${group} | ${row.invoice} | ${row.receipt} | ${row.spam} | ${row.other} |`);
  }
  lines.push('', `Class accuracy: ${pct(report.classAccuracyPct)}`, '');

  lines.push('## Fields', '');
  lines.push('| field | scored | correct | format | wrong | missing | hallucinated | accuracy |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const row of report.fields) {
    lines.push(
      `| ${row.field} | ${row.scored} | ${row.correct} | ${row.format} | ${row.wrong} | ${row.missing} | ${row.hallucinated} | ${pct(row.accuracyPct)} |`,
    );
  }
  lines.push('');

  lines.push('## Errors', '');
  lines.push('| file | field | verdict | labeled | model |', '|---|---|---|---|---|');
  for (const row of report.errors) {
    lines.push(
      `| ${row.file_name} | ${row.field} | ${row.verdict} | ${row.labeled} | ${row.predicted} |`,
    );
  }
  lines.push('');

  lines.push('## Worst documents', '');
  if (report.worst.length === 0) lines.push('None.');
  for (const row of report.worst) lines.push(`- ${row.file_name}: ${row.errors} errors`);
  lines.push('');

  lines.push('## Checks', '');
  lines.push('| check | fired | with an error |', '|---|---|---|');
  for (const row of report.checks) lines.push(`| ${row.id} | ${row.fired} | ${row.withError} |`);
  lines.push('');

  lines.push('## By input mode', '');
  lines.push('| mode | labeled | class accuracy | field accuracy |', '|---|---|---|---|');
  for (const row of report.byInputMode) {
    lines.push(
      `| ${row.mode} | ${row.labeled} | ${pct(row.classAccuracyPct)} | ${pct(row.fieldAccuracyPct)} |`,
    );
  }
  lines.push('');

  if (report.compare) {
    const { compare } = report;
    lines.push('## Compared with the other run selection', '');
    lines.push(`Matched documents: ${compare.matched}`);
    lines.push(
      `Class accuracy: ${pct(compare.classAccuracyBeforePct)} -> ${pct(compare.classAccuracyAfterPct)}`,
      '',
    );
    lines.push('| field | before | after |', '|---|---|---|');
    for (const row of compare.fields) {
      lines.push(`| ${row.field} | ${pct(row.beforePct)} | ${pct(row.afterPct)} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
