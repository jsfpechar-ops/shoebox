import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
  readonly runs: readonly SplitRun[];
}

/**
 * Writes the plan in the caller's transaction and returns the document ids in plan order.
 * - A reused document: status 'received', source_file_id = the plan's; its old document_pages rows are deleted.
 * - A new document: inserted with org_id, source_file_id, upload_batch_id = batchId, status 'received', received_date.
 * - Every document gets document_pages rows, positions 1..n in page order.
 * - deleteDocumentIds: deleted_at = now() (soft delete; the files stay).
 * - Each question: a review_questions row (kind 'same_invoice') on the later document, payload { question, options yes/no, suggested 'no', other_document_id: the earlier one } (review deck shape, 0407).
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
      payload: {
        question: 'doc.pages.same_question',
        options: [
          { value: 'yes', label: 'doc.pages.same_yes' },
          { value: 'no', label: 'doc.pages.same_no' },
        ],
        suggested: 'no',
        other_document_id: earlierId,
      },
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
