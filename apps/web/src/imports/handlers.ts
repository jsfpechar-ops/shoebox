// Spreadsheet import HTTP logic (M01 §6, brief 0215): plain functions over an injected `ImportDeps`,
// so the routes stay thin and the tests use a fake. Each returns the HTTP status and the JSON body.
import { IMPORT_UNDO_DAYS } from '@shoebox/db';
import {
  buildImportPreview,
  findHeaderRow,
  headerSignature,
  IMPORT_LIMITS,
  IMPORT_TARGETS,
  type ImportMapping,
  type ImportOptions,
  missingRequiredTargets,
  readSpreadsheet,
  suggestMapping,
} from '@shoebox/pipeline';
import { filePath } from '@shoebox/platform';
import { z } from 'zod';
import { sha256Hex } from '../documents/upload';

export interface ImportAuth {
  readonly orgId: string;
  readonly userId: string;
}

export interface ImportFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface ImportRecord {
  readonly id: string;
  readonly orgId: string;
  readonly state: string;
  readonly sourceFileId: string;
  readonly storagePath: string;
  readonly fileName: string;
  readonly rowCount: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly duplicateCount: number;
  readonly createdAt: string;
}

export interface HandlerResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface ImportDeps {
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>; // existing object is not an error
  download(path: string): Promise<Uint8Array | null>;
  insertSourceFile(row: {
    orgId: string;
    sha256: string;
    storagePath: string;
    mimeType: string;
    byteSize: number;
    originalFilename: string;
    filenameNfc: string;
    uploadedBy: string;
  }): Promise<{ id: string; created: boolean }>; // created false = same org+sha256 existed
  /** The import of this source file, if the org has one. */
  findImportBySource(sourceFileId: string): Promise<{ createdAt: string } | null>;
  insertImport(row: {
    orgId: string;
    sourceFileId: string;
    rowCount: number;
    userId: string;
  }): Promise<string>;
  loadImport(id: string): Promise<ImportRecord | null>;
  findSavedMapping(
    orgId: string,
    headerSignature: string,
  ): Promise<{ mapping: ImportMapping; options: ImportOptions } | null>;
  /** Upserts the `documents` mapping of this header signature; returns its id. */
  saveMapping(row: {
    orgId: string;
    userId: string;
    headerSignature: string;
    mapping: ImportMapping;
    options: ImportOptions;
  }): Promise<string>;
  /** Sets mapping and state `importing` only when the import is `parsed`; false otherwise. */
  markStarted(importId: string, mappingId: string): Promise<boolean>;
  enqueueRun(orgId: string, importId: string, fromRow: number): Promise<void>;
  enqueueUndo(orgId: string, importId: string): Promise<void>;
}

const mappingSchema = z.partialRecord(z.enum(IMPORT_TARGETS), z.number().int().min(0));
const optionsSchema = z.object({
  direction_mode: z.literal('all_expense'),
  header_row: z.number().int().min(0),
});
const bodySchema = z.object({ mapping: mappingSchema, options: optionsSchema });

function fail(status: number, error: string, extra: Record<string, unknown> = {}): HandlerResult {
  return { status, body: { error, ...extra } };
}

type StoredSheet =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly error: string };

async function readStored(
  deps: ImportDeps,
  record: Pick<ImportRecord, 'storagePath' | 'fileName'>,
): Promise<StoredSheet> {
  const bytes = await deps.download(record.storagePath);
  if (bytes === null) return { ok: false, error: 'import.unreadable' };
  const sheet = await readSpreadsheet(bytes, record.fileName);
  return sheet.ok ? { ok: true, rows: sheet.rows } : { ok: false, error: `import.${sheet.reason}` };
}

/** The import when it belongs to the caller's org; null otherwise (never reveals another org's row). */
async function loadOwned(
  deps: ImportDeps,
  auth: ImportAuth,
  id: string,
): Promise<ImportRecord | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const record = await deps.loadImport(id);
  return record !== null && record.orgId === auth.orgId ? record : null;
}

/** POST /api/v1/imports: stores the file, parses it inline and returns the first preview. */
export async function createImport(
  deps: ImportDeps,
  auth: ImportAuth,
  file: ImportFile,
): Promise<HandlerResult> {
  if (file.bytes.byteLength > IMPORT_LIMITS.bytes) return fail(413, 'import.too_large');
  const sha256 = sha256Hex(file.bytes);
  const storagePath = filePath(auth.orgId, sha256);
  const mimeType = file.type === '' ? 'application/octet-stream' : file.type;
  await deps.putFile(storagePath, file.bytes, mimeType);
  const source = await deps.insertSourceFile({
    orgId: auth.orgId,
    sha256,
    storagePath,
    mimeType,
    byteSize: file.bytes.byteLength,
    originalFilename: file.name,
    filenameNfc: file.name.normalize('NFC'),
    uploadedBy: auth.userId,
  });
  if (!source.created) {
    const prior = await deps.findImportBySource(source.id);
    if (prior !== null) return fail(409, 'import.already', { importedAt: prior.createdAt });
  }
  const sheet = await readSpreadsheet(file.bytes, file.name);
  if (!sheet.ok) return fail(422, `import.${sheet.reason}`);
  const headerRow = findHeaderRow(sheet.rows);
  if (headerRow === null) return fail(422, 'import.no_header');
  const headers = sheet.rows[headerRow] ?? [];
  const saved = await deps.findSavedMapping(auth.orgId, headerSignature(headers));
  const mapping: ImportMapping =
    saved?.mapping ?? suggestMapping(headers, sheet.rows.slice(headerRow + 1, headerRow + 11));
  const options: ImportOptions =
    saved === null
      ? { direction_mode: 'all_expense', header_row: headerRow }
      : { ...saved.options, header_row: headerRow };
  const id = await deps.insertImport({
    orgId: auth.orgId,
    sourceFileId: source.id,
    rowCount: Math.max(0, sheet.rows.length - headerRow - 1),
    userId: auth.userId,
  });
  return {
    status: 201,
    body: {
      id,
      headers,
      mapping,
      options,
      preview: buildImportPreview(sheet.rows, headerRow, mapping, options),
    },
  };
}

/** POST /api/v1/imports/{id}/preview: the same preview for another mapping. Writes nothing. */
export async function previewImport(
  deps: ImportDeps,
  auth: ImportAuth,
  id: string,
  body: unknown,
): Promise<HandlerResult> {
  const record = await loadOwned(deps, auth, id);
  if (record === null) return fail(404, 'import.not_found');
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(400, 'import.body');
  const stored = await readStored(deps, record);
  if (!stored.ok) return fail(422, stored.error);
  const { mapping, options } = parsed.data;
  return {
    status: 200,
    body: { id, preview: buildImportPreview(stored.rows, options.header_row, mapping, options) },
  };
}

/** POST /api/v1/imports/{id}/start: saves the mapping and queues the first run (rows from 0). */
export async function startImport(
  deps: ImportDeps,
  auth: ImportAuth,
  id: string,
  body: unknown,
): Promise<HandlerResult> {
  const record = await loadOwned(deps, auth, id);
  if (record === null) return fail(404, 'import.not_found');
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(400, 'import.body');
  const { mapping, options } = parsed.data;
  const missing = missingRequiredTargets(mapping);
  if (missing.length > 0) return fail(422, 'import.missing_targets', { missing });
  if (record.state !== 'parsed') return fail(409, 'import.state');
  const stored = await readStored(deps, record);
  if (!stored.ok) return fail(422, stored.error);
  const mappingId = await deps.saveMapping({
    orgId: auth.orgId,
    userId: auth.userId,
    headerSignature: headerSignature(stored.rows[options.header_row] ?? []),
    mapping,
    options,
  });
  if (!(await deps.markStarted(id, mappingId))) return fail(409, 'import.state');
  await deps.enqueueRun(auth.orgId, id, 0);
  return { status: 202, body: { id, state: 'importing' } };
}

/** POST /api/v1/imports/{id}/undo: queues the undo for an import up to 30 days old. */
export async function undoImport(
  deps: ImportDeps,
  auth: ImportAuth,
  id: string,
): Promise<HandlerResult> {
  const record = await loadOwned(deps, auth, id);
  if (record === null) return fail(404, 'import.not_found');
  if (Date.now() - Date.parse(record.createdAt) > IMPORT_UNDO_DAYS * 86_400_000)
    return fail(410, 'import.undo_expired');
  await deps.enqueueUndo(auth.orgId, id);
  return { status: 202, body: { id, state: 'undoing' } };
}

/** GET /api/v1/imports/{id}: the state and the counts. */
export async function getImport(
  deps: ImportDeps,
  auth: ImportAuth,
  id: string,
): Promise<HandlerResult> {
  const record = await loadOwned(deps, auth, id);
  if (record === null) return fail(404, 'import.not_found');
  return {
    status: 200,
    body: {
      id,
      state: record.state,
      rowCount: record.rowCount,
      importedCount: record.importedCount,
      skippedCount: record.skippedCount,
      duplicateCount: record.duplicateCount,
      createdAt: record.createdAt,
    },
  };
}
