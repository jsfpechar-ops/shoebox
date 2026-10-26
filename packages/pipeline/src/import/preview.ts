// Import preview (M01 §6, brief 0214): what an import would do with a sheet and a mapping, computed
// without writing anything. Pure: the HTTP routes call it, the tests call it directly.
import type { ImportMapping, ImportTarget } from './mapping';
import { type ImportedValues, type ImportRowResult, parseImportRow } from './row';

export interface ImportOptions {
  readonly direction_mode: 'all_expense';
  readonly header_row: number; // index into the sheet rows
}

export type ImportSkipReason = Extract<ImportRowResult, { ok: false }>['reason'];

export interface ImportPreviewRow {
  readonly rowNumber: number; // 1-based line number in the sheet
  readonly result: ImportRowResult;
}

export interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[]; // first 10 non-empty data rows
  readonly counts: {
    readonly valid: number;
    readonly skipped: Partial<Record<ImportSkipReason, number>>;
    readonly duplicateInFile: number;
  };
}

export const PREVIEW_ROW_LIMIT = 10;

/** Identity of a row inside one file: the same document written twice in the sheet. */
function fileKey(v: ImportedValues): string {
  return [
    v.issue_date,
    v.total_gross,
    v.currency,
    v.partner_ico ?? '',
    v.document_number ?? '',
  ].join('\u001f');
}

/**
 * Preview of one import. Data rows are the sheet rows after `options.header_row`; empty rows are
 * not data and are not counted. A row whose key repeats an earlier valid row counts as
 * `duplicateInFile` and not as `valid`.
 */
export function buildImportPreview(
  sheet: readonly (readonly string[])[],
  headerRow: number,
  mapping: ImportMapping,
  options: ImportOptions,
): ImportPreview {
  const rows: ImportPreviewRow[] = [];
  const skipped: Partial<Record<ImportSkipReason, number>> = {};
  const seen = new Set<string>();
  let valid = 0;
  let duplicateInFile = 0;
  void options;

  for (let index = headerRow + 1; index < sheet.length; index += 1) {
    const row = sheet[index];
    if (row === undefined) continue;
    const result = parseImportRow(row, mapping);
    if (result === null) continue;
    if (rows.length < PREVIEW_ROW_LIMIT) rows.push({ rowNumber: index + 1, result });
    if (!result.ok) {
      skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
      continue;
    }
    const key = fileKey(result.value);
    if (seen.has(key)) {
      duplicateInFile += 1;
      continue;
    }
    seen.add(key);
    valid += 1;
  }

  return { rows, counts: { valid, skipped, duplicateInFile } };
}

/** Targets an import must map before it can start. */
export const REQUIRED_IMPORT_TARGETS: readonly ImportTarget[] = ['issue_date', 'total_gross'];

export function missingRequiredTargets(mapping: ImportMapping): ImportTarget[] {
  return REQUIRED_IMPORT_TARGETS.filter((t) => mapping[t] === undefined);
}
