import {
  addImportRunCounts,
  finishImport,
  type ImportDirection,
  insertImportedRow,
  loadImportRun,
} from '@shoebox/db';
import { type Clock, pragueToday } from '@shoebox/domain';
import {
  type ImportedValues,
  type ImportMapping,
  type ImportRowResult,
  type ImportSpreadsheetRunPayload,
  parseImportRow,
  readSpreadsheet,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import { parseProtoOrg } from '@shoebox/validation';
import type { TenantHandler } from '../registry';

/** Data rows per job run (M01 §4.13). */
export const IMPORT_RUN_ROWS = 200;

interface ImportOptions {
  readonly direction_mode: 'all_expense' | 'all_income' | 'by_sign';
  readonly header_row: number;
}

interface SkippedRow {
  readonly row: number;
  readonly reason: string;
}

export interface ImportRunStore {
  readonly load: typeof loadImportRun;
  readonly addCounts: typeof addImportRunCounts;
  readonly finish: typeof finishImport;
  readonly insertRow: typeof insertImportedRow;
}

export const dbImportRunStore: ImportRunStore = {
  load: loadImportRun,
  addCounts: addImportRunCounts,
  finish: finishImport,
  insertRow: insertImportedRow,
};

export interface ImportRunDeps {
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly clock: Clock;
  /** Queues the next run of the same import, 200 data rows further on. */
  readonly enqueueNext: (payload: ImportSpreadsheetRunPayload) => Promise<unknown>;
  readonly logger?: Pick<Logger, 'info' | 'warn'>;
  readonly store?: ImportRunStore;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionsOf(value: unknown): ImportOptions | null {
  if (!isObject(value)) return null;
  const mode = value.direction_mode;
  const header = value.header_row;
  if (mode !== 'all_expense' && mode !== 'all_income' && mode !== 'by_sign') return null;
  if (typeof header !== 'number' || !Number.isInteger(header) || header < 0) return null;
  return { direction_mode: mode, header_row: header };
}

/** Partner IČO, or the folded partner name when there is no IČO, with document number and gross. */
function dedupeKey(v: ImportedValues): string {
  const party = v.partner_ico ?? (v.partner_name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return [party, v.document_number ?? '', v.total_gross].join('\u0000');
}

/** `by_sign`: a negative gross is an expense and is made positive; otherwise the mode decides. */
function directionOf(
  gross: string,
  mode: ImportOptions['direction_mode'],
): { direction: ImportDirection; gross: string } {
  if (mode === 'all_expense') return { direction: 'expense', gross };
  if (mode === 'all_income') return { direction: 'income', gross };
  if (gross.startsWith('-')) return { direction: 'expense', gross: gross.slice(1) };
  return { direction: 'income', gross };
}

/**
 * Imports the valid rows of one uploaded spreadsheet, 200 data rows per run (M01 §4.13). Each run is
 * one transaction; it enqueues the next run until the last data row is reached, then finishes the import.
 */
export function createImportRunHandler(
  deps: ImportRunDeps,
): TenantHandler<ImportSpreadsheetRunPayload> {
  const store = deps.store ?? dbImportRunStore;

  return async (payload, ctx) => {
    const { tx } = ctx;
    const { orgId, importId } = payload;
    const run = await store.load(tx, { orgId, importId });
    if (run === null || run.state !== 'importing') {
      deps.logger?.info({ importId, state: run?.state ?? null }, 'import.spreadsheet.run skipped');
      return;
    }
    if (run.createdBy === null) {
      deps.logger?.warn({ importId }, 'import.spreadsheet.run stopped: import has no author');
      return;
    }

    const finishWithReason = (reason: string): Promise<void> =>
      store.finish(tx, {
        orgId,
        importId,
        imported: run.importedCount,
        skipped: run.skippedCount + 1,
        duplicates: run.duplicateCount,
        skippedRows: [...run.skippedRows, { row: 0, reason }],
      });

    const options = optionsOf(run.options);
    const mapping = isObject(run.mapping) ? (run.mapping as ImportMapping) : null;
    if (options === null || mapping === null) return finishWithReason('no_mapping');

    const sheet = await readSpreadsheet(await deps.blobs.get(run.storagePath), run.fileName ?? '');
    if (!sheet.ok) return finishWithReason(sheet.reason);

    const dataRows = sheet.rows.slice(options.header_row + 1);
    const parsed: (ImportRowResult | null)[] = dataRows.map((cells) =>
      parseImportRow(cells, mapping),
    );

    // Whole file, every run: a row repeats an earlier row when partner, document number and gross match.
    const seen = new Set<string>();
    const repeated = parsed.map((result) => {
      if (result === null || !result.ok) return false;
      const key = dedupeKey(result.value);
      const isRepeat = seen.has(key);
      seen.add(key);
      return isRepeat;
    });

    const from = payload.fromRow;
    const to = Math.min(from + IMPORT_RUN_ROWS, dataRows.length);
    const org = parseProtoOrg(run.orgIco ?? undefined, run.orgDic ?? undefined);
    const today = pragueToday(deps.clock);

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const skippedRows: SkippedRow[] = [];
    for (let i = from; i < to; i++) {
      const result = parsed[i];
      if (result === null || result === undefined) continue; // empty row: silently skipped
      const sheetRow = options.header_row + 2 + i; // 1-based sheet row
      if (!result.ok) {
        skipped++;
        skippedRows.push({ row: sheetRow, reason: result.reason });
        continue;
      }
      if (repeated[i]) {
        skipped++;
        skippedRows.push({ row: sheetRow, reason: 'duplicate_in_file' });
        continue;
      }
      const { direction, gross } = directionOf(result.value.total_gross, options.direction_mode);
      const written = await store.insertRow(tx, {
        orgId,
        importId,
        row: sheetRow,
        values: { ...result.value, total_gross: gross },
        direction,
        userId: run.createdBy,
        today,
        org,
      });
      if (written.created) {
        imported++;
        if (written.status === 'duplicate') duplicates++;
      }
    }

    const nextFrom = from + IMPORT_RUN_ROWS;
    if (nextFrom < dataRows.length) {
      await store.addCounts(tx, { orgId, importId, imported, skipped, duplicates, skippedRows });
      await deps.enqueueNext({ orgId, importId, fromRow: nextFrom, nonce: payload.nonce });
      deps.logger?.info(
        { importId, fromRow: from, imported, skipped },
        'import.spreadsheet.run chunk',
      );
      return;
    }

    await store.finish(tx, {
      orgId,
      importId,
      imported: run.importedCount + imported,
      skipped: run.skippedCount + skipped,
      duplicates: run.duplicateCount + duplicates,
      skippedRows: [...run.skippedRows, ...skippedRows],
    });
    deps.logger?.info({ importId, imported, skipped, duplicates }, 'import.spreadsheet.run done');
  };
}
