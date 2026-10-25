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

export function namesMatch(expected: string, actual: string): boolean {
  const a = normalizeName(expected);
  const b = normalizeName(actual);
  if (a === '' || b === '') return a === b;
  return a === b || a.includes(b) || b.includes(a);
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

export function moneyText(value: string | null, currency: string): string | null {
  if (value === null) return null;
  try {
    return Money.parse(value, currency).toFixed2();
  } catch {
    return null;
  }
}

export function rateText(value: string): string {
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
