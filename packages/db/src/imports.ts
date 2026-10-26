// Spreadsheet import writer (M01 §4.13, 05 §6): one parsed row becomes one imported document, and an
// import can be undone. Amounts stay decimal strings into numeric columns (never a float).
import type { LegalDate } from '@shoebox/domain';
import {
  checkInputFromFields,
  type ProtoOrg,
  runProtoChecks,
  validationRowsOf,
} from '@shoebox/validation';
import { and, eq, sql } from 'drizzle-orm';
import { documentFields, documentLines, validationResults } from './schema/document-details';
import { documents, sourceFiles } from './schema/documents';
import { importMappings, spreadsheetImports } from './schema/imports';
import { organizations } from './schema/tenancy';
import { markIfSemanticDuplicate } from './semantic-dedupe';
import type { TenantTx } from './tenant';

/** Structurally identical to `ImportedValues` of `@shoebox/pipeline` (db does not depend on pipeline). */
export interface ImportedValues {
  readonly issue_date: string;
  readonly total_gross: string;
  readonly currency: string;
  readonly partner_name: string | null;
  readonly partner_ico: string | null;
  readonly document_number: string | null;
  readonly total_vat: string | null;
  readonly total_net: string | null;
  readonly variable_symbol: string | null;
  readonly due_date: string | null;
  readonly description: string | null;
  readonly paid: boolean | null;
  readonly paid_on: string | null;
}

export type ImportDirection = 'expense' | 'income';

/** Undo is refused for an import older than this many days. */
export const IMPORT_UNDO_DAYS = 30;

export async function createSpreadsheetImport(
  tx: TenantTx,
  input: { orgId: string; sourceFileId: string; rowCount: number; userId: string },
): Promise<string> {
  const [row] = await tx
    .insert(spreadsheetImports)
    .values({
      orgId: input.orgId,
      sourceFileId: input.sourceFileId,
      rowCount: input.rowCount,
      createdBy: input.userId,
    })
    .returning({ id: spreadsheetImports.id });
  if (!row) throw new Error('import insert returned no row');
  return row.id;
}

/** The `document_fields` map of one imported row (same key grammar as manual entry). */
function importedFields(v: ImportedValues, direction: ImportDirection): Record<string, string> {
  const party = direction === 'expense' ? 'supplier' : 'buyer';
  const f: Record<string, string> = {};
  if (v.partner_name !== null) f[`${party}.name`] = v.partner_name;
  if (v.partner_ico !== null) f[`${party}.ico`] = v.partner_ico;
  f['dates.issue_date'] = v.issue_date;
  if (v.due_date !== null) f['dates.due_date'] = v.due_date;
  f['totals.gross'] = v.total_gross;
  if (v.total_vat !== null) f['totals.vat'] = v.total_vat;
  if (v.total_net !== null) f['totals.net'] = v.total_net;
  f.currency = v.currency;
  if (v.document_number !== null) f.document_number = v.document_number;
  if (v.variable_symbol !== null) f['payment.variable_symbol'] = v.variable_symbol;
  if (v.paid_on !== null) f['payment.paid_on'] = v.paid_on;
  return f;
}

/**
 * Writes one parsed row as an imported document with its fields, one line and the proto checks.
 * Idempotent per (importId, row): a second call returns the existing document and writes nothing.
 */
export async function insertImportedRow(
  tx: TenantTx,
  input: {
    orgId: string;
    importId: string;
    row: number;
    values: ImportedValues;
    direction: ImportDirection;
    userId: string;
    today: LegalDate;
    org: ProtoOrg | undefined;
  },
): Promise<{ documentId: string; status: string; created: boolean }> {
  const { orgId, importId, row, values: v, direction, userId, today, org } = input;

  const existing = await tx
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.importId, importId),
        eq(documents.importRow, row),
      ),
    )
    .limit(1);
  if (existing[0])
    return { documentId: existing[0].id, status: existing[0].status, created: false };

  const docClass =
    direction === 'income'
      ? 'issued_invoice'
      : v.document_number !== null
        ? 'received_invoice'
        : 'received_receipt';
  const partner: Record<string, string> = {};
  if (v.partner_name !== null) partner.name = v.partner_name;
  if (v.partner_ico !== null) partner.ico = v.partner_ico;

  const [doc] = await tx
    .insert(documents)
    .values({
      orgId,
      entryMode: 'imported',
      sourceFileId: null,
      importId,
      importRow: row,
      status: 'received',
      class: docClass,
      classSource: 'user',
      direction: direction === 'expense' ? 'in' : 'out',
      receivedDate: today,
      partnerSnapshot: partner,
      issueDate: v.issue_date,
      dueDate: v.due_date,
      currency: v.currency,
      totalGross: v.total_gross,
      totalVat: v.total_vat,
      totalNet: v.total_net,
      documentNumber: v.document_number,
      variableSymbol: v.variable_symbol,
      isPaidPerDocument: v.paid === true,
    })
    .returning({ id: documents.id });
  if (!doc) throw new Error('document insert returned no row');
  const documentId = doc.id;

  const fields = importedFields(v, direction);
  await tx.insert(documentFields).values(
    Object.entries(fields).map(([fieldKey, valueText]) => ({
      orgId,
      documentId,
      fieldKey,
      valueText,
      source: 'user' as const,
      setBy: userId,
    })),
  );
  await tx.insert(documentLines).values({
    orgId,
    documentId,
    position: 1,
    description: v.description,
    gross: v.total_gross,
  });

  const results = validationRowsOf(
    runProtoChecks(
      checkInputFromFields(fields, docClass),
      org === undefined ? { today } : { today, org },
    ),
  );
  if (results.length > 0) {
    await tx.insert(validationResults).values(
      results.map((r) => ({
        orgId,
        documentId,
        ruleId: r.ruleId,
        ruleVersion: r.ruleVersion,
        severity: r.severity,
        params: r.params,
      })),
    );
  }
  const status = results.some((r) => r.severity === 'blocking') ? 'needs_review' : 'ready';
  await tx
    .update(documents)
    .set({ status })
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)));

  const original = await markIfSemanticDuplicate(tx, orgId, documentId);
  return { documentId, status: original === null ? status : 'duplicate', created: true };
}

export async function finishImport(
  tx: TenantTx,
  input: {
    orgId: string;
    importId: string;
    imported: number;
    skipped: number;
    duplicates: number;
    skippedRows: ReadonlyArray<{ row: number; reason: string }>;
  },
): Promise<void> {
  await tx
    .update(spreadsheetImports)
    .set({
      state: 'done',
      importedCount: input.imported,
      skippedCount: input.skipped,
      duplicateCount: input.duplicates,
      skippedRows: input.skippedRows,
      finishedAt: sql`now()`,
    })
    .where(
      and(eq(spreadsheetImports.id, input.importId), eq(spreadsheetImports.orgId, input.orgId)),
    );
}

/**
 * Soft-deletes the documents of an import that are not finalized and have no user field written
 * after the import finished. Null when the import is unknown or older than 30 days.
 */
export async function undoImport(
  tx: TenantTx,
  input: { orgId: string; importId: string; now: Date },
): Promise<{ removed: number; kept: number } | null> {
  const { orgId, importId, now } = input;
  const [imp] = await tx
    .select({ createdAt: spreadsheetImports.createdAt, finishedAt: spreadsheetImports.finishedAt })
    .from(spreadsheetImports)
    .where(and(eq(spreadsheetImports.id, importId), eq(spreadsheetImports.orgId, orgId)))
    .limit(1);
  if (!imp) return null;
  if (now.getTime() - imp.createdAt.getTime() > IMPORT_UNDO_DAYS * 86_400_000) return null;
  const since = imp.finishedAt ?? now;

  const removed = await tx.execute<{ id: string }>(sql`
    update documents d set deleted_at = ${now.toISOString()}::timestamptz
    where d.org_id = ${orgId} and d.import_id = ${importId} and d.deleted_at is null
      and d.status <> 'finalized'
      and not exists (
        select 1 from document_fields f
        where f.document_id = d.id and f.source = 'user' and f.created_at > ${since.toISOString()}::timestamptz)
    returning d.id`);
  const left = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from documents
    where org_id = ${orgId} and import_id = ${importId} and deleted_at is null`);
  await tx
    .update(spreadsheetImports)
    .set({ state: 'undone', undoneAt: now })
    .where(and(eq(spreadsheetImports.id, importId), eq(spreadsheetImports.orgId, orgId)));
  return { removed: removed.length, kept: left[0]?.n ?? 0 };
}

/** One import run as the worker reads it: the import, its source file, mapping and org identifiers. */
export interface ImportRunRecord {
  readonly state: string;
  readonly storagePath: string;
  readonly fileName: string | null;
  /** `import_mappings.mapping` (`{target: columnIndex}`); null when the import has no mapping row. */
  readonly mapping: unknown;
  /** `import_mappings.options`; null when the import has no mapping row. */
  readonly options: unknown;
  readonly createdBy: string | null;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly duplicateCount: number;
  readonly skippedRows: ReadonlyArray<{ row: number; reason: string }>;
  readonly orgIco: string | null;
  readonly orgDic: string | null;
}

/** Loads one import with its source file, mapping and org identifiers. Null when unknown in this org. */
export async function loadImportRun(
  tx: TenantTx,
  input: { orgId: string; importId: string },
): Promise<ImportRunRecord | null> {
  const [row] = await tx
    .select({
      state: spreadsheetImports.state,
      storagePath: sourceFiles.storagePath,
      fileName: sourceFiles.originalFilename,
      mapping: importMappings.mapping,
      options: importMappings.options,
      createdBy: spreadsheetImports.createdBy,
      importedCount: spreadsheetImports.importedCount,
      skippedCount: spreadsheetImports.skippedCount,
      duplicateCount: spreadsheetImports.duplicateCount,
      skippedRows: spreadsheetImports.skippedRows,
      orgIco: organizations.ico,
      orgDic: organizations.dic,
    })
    .from(spreadsheetImports)
    .innerJoin(sourceFiles, eq(sourceFiles.id, spreadsheetImports.sourceFileId))
    .leftJoin(importMappings, eq(importMappings.id, spreadsheetImports.mappingId))
    .innerJoin(organizations, eq(organizations.id, spreadsheetImports.orgId))
    .where(
      and(eq(spreadsheetImports.id, input.importId), eq(spreadsheetImports.orgId, input.orgId)),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    skippedRows: row.skippedRows as ReadonlyArray<{ row: number; reason: string }>,
  };
}

/** Adds one run's counts to the import and appends its skipped rows; the import stays `importing`. */
export async function addImportRunCounts(
  tx: TenantTx,
  input: {
    orgId: string;
    importId: string;
    imported: number;
    skipped: number;
    duplicates: number;
    skippedRows: ReadonlyArray<{ row: number; reason: string }>;
  },
): Promise<void> {
  await tx
    .update(spreadsheetImports)
    .set({
      importedCount: sql`${spreadsheetImports.importedCount} + ${input.imported}`,
      skippedCount: sql`${spreadsheetImports.skippedCount} + ${input.skipped}`,
      duplicateCount: sql`${spreadsheetImports.duplicateCount} + ${input.duplicates}`,
      skippedRows: sql`${spreadsheetImports.skippedRows} || ${JSON.stringify(input.skippedRows)}::jsonb`,
    })
    .where(
      and(eq(spreadsheetImports.id, input.importId), eq(spreadsheetImports.orgId, input.orgId)),
    );
}
