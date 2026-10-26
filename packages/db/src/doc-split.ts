import { and, asc, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { extractionRuns, reviewQuestions } from './schema/document-details';
import { documentPages } from './schema/document-pages';
import { documents, sourceFiles } from './schema/documents';
import type { TenantTx } from './tenant';

/** One uploaded file of a drop, with the document row the upload made for it. */
export interface SplitBatchFile {
  readonly documentId: string;
  readonly sourceFileId: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly receivedDate: string | null;
  readonly status: string;
}

/**
 * The drop's documents that are still waiting to be sorted (status 'received' or 'splitting',
 * not deleted), with their files, in upload order (documents.created_at, then id).
 */
export async function loadSplitBatch(tx: TenantTx, batchId: string): Promise<SplitBatchFile[]> {
  const rows = await tx
    .select({
      documentId: documents.id,
      sourceFileId: sourceFiles.id,
      storagePath: sourceFiles.storagePath,
      mimeType: sourceFiles.mimeType,
      receivedDate: documents.receivedDate,
      status: documents.status,
    })
    .from(documents)
    .innerJoin(sourceFiles, eq(documents.sourceFileId, sourceFiles.id))
    .where(
      and(
        eq(documents.uploadBatchId, batchId),
        inArray(documents.status, ['received', 'splitting']),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(asc(documents.createdAt), asc(documents.id));
  return rows;
}

/** Sets the status of these documents (no-op for an empty list). */
export async function setDocumentsStatus(
  tx: TenantTx,
  documentIds: readonly string[],
  status: 'splitting' | 'received',
): Promise<void> {
  if (documentIds.length === 0) return;
  await tx
    .update(documents)
    .set({ status })
    .where(inArray(documents.id, [...documentIds]));
}

export interface PageRowInput {
  readonly sourceFileId: string;
  readonly filePage: number;
  readonly region: string;
  readonly supplierKey: string;
  readonly docNumber: string;
  readonly labelN: number | null;
  readonly labelOf: number | null;
  readonly hasTotals: boolean;
  readonly startsDocument: boolean;
}

export interface SortPlanDocument {
  /** The upload's row to reuse, or null to insert a new document. */
  readonly documentId: string | null;
  readonly sourceFileId: string; // the file of the first page
  readonly receivedDate: string | null;
  readonly pages: readonly PageRowInput[];
}

export interface SplitRun {
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly latencyMs: number;
}

export interface SortPlan {
  readonly orgId: string;
  readonly batchId: string;
  readonly documents: readonly SortPlanDocument[];
  readonly deleteDocumentIds: readonly string[];
  /** Indexes into `documents`: [earlier, later]. */
  readonly questions: readonly (readonly [number, number])[];
  /** A document of this plan (index) that may continue an open document of an earlier upload. */
  readonly lateQuestions?: readonly {
    readonly document: number;
    readonly otherDocumentId: string;
  }[];
  readonly runs: readonly SplitRun[];
}

function sameInvoicePayload(otherDocumentId: string) {
  return {
    question: 'doc.pages.same_question',
    options: [
      { value: 'yes', label: 'doc.pages.same_yes' },
      { value: 'no', label: 'doc.pages.same_no' },
    ],
    suggested: 'no',
    other_document_id: otherDocumentId,
  };
}

/**
 * Writes the plan in the caller's transaction and returns the document ids in plan order.
 * - A reused document: status 'received', source_file_id = the plan's; its old document_pages rows are deleted.
 * - A new document: inserted with org_id, source_file_id, upload_batch_id = batchId, status 'received', received_date.
 * - Every document gets document_pages rows, positions 1..n in page order.
 * - deleteDocumentIds: deleted_at = now() (soft delete; the files stay).
 * - Each question: a review_questions row (kind 'same_invoice') on the later document, payload { question, options yes/no, suggested 'no', other_document_id: the earlier one } (review deck shape, 0407).
 * - Each late question (0509): the same row and payload, on the plan document, pointing at an open document of an earlier upload.
 * - Each run: an extraction_runs row (stage 'split', method 'llm', ok true, attempt 1) on the first document of the plan.
 */
export async function applySortPlan(tx: TenantTx, plan: SortPlan): Promise<string[]> {
  const ids: string[] = [];

  for (const doc of plan.documents) {
    let documentId = doc.documentId;
    if (documentId !== null) {
      await tx
        .update(documents)
        .set({ status: 'received', sourceFileId: doc.sourceFileId })
        .where(eq(documents.id, documentId));
      await tx.delete(documentPages).where(eq(documentPages.documentId, documentId));
    } else {
      const [inserted] = await tx
        .insert(documents)
        .values({
          orgId: plan.orgId,
          sourceFileId: doc.sourceFileId,
          uploadBatchId: plan.batchId,
          status: 'received',
          receivedDate: doc.receivedDate,
        })
        .returning({ id: documents.id });
      if (!inserted) throw new Error('applySortPlan: document insert returned no row');
      documentId = inserted.id;
    }
    ids.push(documentId);

    if (doc.pages.length > 0) {
      await tx.insert(documentPages).values(
        doc.pages.map((p, i) => ({
          orgId: plan.orgId,
          documentId: documentId,
          position: i + 1,
          sourceFileId: p.sourceFileId,
          filePage: p.filePage,
          region: p.region,
          supplierKey: p.supplierKey,
          docNumber: p.docNumber,
          labelN: p.labelN,
          labelOf: p.labelOf,
          hasTotals: p.hasTotals,
          startsDocument: p.startsDocument,
        })),
      );
    }
  }

  for (const id of plan.deleteDocumentIds) {
    await tx.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id));
  }

  for (const [earlier, later] of plan.questions) {
    const laterId = ids[later];
    const earlierId = ids[earlier];
    if (!laterId || !earlierId) throw new Error('applySortPlan: question index out of range');
    await tx.insert(reviewQuestions).values({
      orgId: plan.orgId,
      documentId: laterId,
      kind: 'same_invoice',
      payload: sameInvoicePayload(earlierId),
    });
  }

  for (const late of plan.lateQuestions ?? []) {
    const laterId = ids[late.document];
    if (!laterId) throw new Error('applySortPlan: late question index out of range');
    await tx.insert(reviewQuestions).values({
      orgId: plan.orgId,
      documentId: laterId,
      kind: 'same_invoice',
      payload: sameInvoicePayload(late.otherDocumentId),
    });
  }

  const firstId = ids[0];
  if (firstId) {
    for (const run of plan.runs) {
      await tx.insert(extractionRuns).values({
        orgId: plan.orgId,
        documentId: firstId,
        stage: 'split',
        method: 'llm',
        ok: true,
        attempt: 1,
        model: run.model,
        promptVersion: run.promptVersion,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cacheReadTokens: run.cacheReadTokens,
        cacheWriteTokens: run.cacheWriteTokens,
        latencyMs: run.latencyMs,
      });
    }
  }

  return ids;
}

export interface OpenPageDocument {
  readonly documentId: string;
  readonly supplierKey: string; // first non-empty supplier_key of its pages, else ''
  readonly docNumber: string; // first non-empty doc_number of its pages, else ''
}

/**
 * Documents of the org that may still miss a page: created at or after `since`, not deleted, not
 * finalized, not from `batchId`, with document_pages rows and none with has_totals. Newest first,
 * at most 20.
 */
export async function findOpenPageDocuments(
  tx: TenantTx,
  since: Date,
  batchId: string,
): Promise<OpenPageDocument[]> {
  const rows = await tx
    .select({
      documentId: documentPages.documentId,
      position: documentPages.position,
      supplierKey: documentPages.supplierKey,
      docNumber: documentPages.docNumber,
      hasTotals: documentPages.hasTotals,
      createdAt: documents.createdAt,
      uploadBatchId: documents.uploadBatchId,
    })
    .from(documentPages)
    .innerJoin(documents, eq(documentPages.documentId, documents.id))
    .where(
      and(
        isNull(documents.deletedAt),
        ne(documents.status, 'finalized'),
        gte(documents.createdAt, since),
      ),
    )
    .orderBy(desc(documents.createdAt), asc(documentPages.position))
    .limit(400);

  const byId = new Map<
    string,
    { uploadBatchId: string | null; hasTotals: boolean; supplierKey: string; docNumber: string }
  >();
  for (const row of rows) {
    let doc = byId.get(row.documentId);
    if (!doc) {
      doc = { uploadBatchId: row.uploadBatchId, hasTotals: false, supplierKey: '', docNumber: '' };
      byId.set(row.documentId, doc);
    }
    if (row.hasTotals) doc.hasTotals = true;
    if (!doc.supplierKey && row.supplierKey) doc.supplierKey = row.supplierKey;
    if (!doc.docNumber && row.docNumber) doc.docNumber = row.docNumber;
  }

  const open: OpenPageDocument[] = [];
  for (const [documentId, doc] of byId) {
    if (open.length >= 20) break;
    if (doc.uploadBatchId === batchId || doc.hasTotals) continue;
    open.push({ documentId, supplierKey: doc.supplierKey, docNumber: doc.docNumber });
  }
  return open;
}
