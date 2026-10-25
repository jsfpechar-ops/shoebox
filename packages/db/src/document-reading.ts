import { and, eq, isNull } from 'drizzle-orm';
import {
  documentFields,
  documentVatSummary,
  extractionRuns,
  validationResults,
} from './schema/document-details';
import { documents, sourceFiles } from './schema/documents';
import { organizations } from './schema/tenancy';
import type { TenantTx } from './tenant';

export interface DocumentForRead {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly orgIco: string | null;
  readonly orgDic: string | null;
}

export interface ReadingPatch {
  readonly class: string;
  readonly classSource: 'llm';
  readonly direction: 'in';
  readonly taxDocStatus: 'full_tax_document' | 'not_tax_document' | 'unknown';
  readonly partnerSnapshot: Record<string, string | null> | null;
  readonly buyerSnapshot: Record<string, string | null> | null;
  readonly documentNumber: string | null;
  readonly variableSymbol: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  readonly paymentMethod: 'bank_transfer' | 'card' | 'cash' | 'cod' | 'other' | null;
  readonly payToAccount: Record<string, string | null> | null;
  readonly isPaidPerDocument: boolean | null;
}

export interface ReadingWrite {
  readonly orgId: string;
  readonly documentId: string;
  readonly status: 'ready' | 'needs_review' | 'supporting';
  readonly patch: ReadingPatch;
  readonly vatSummary: readonly {
    vatRateType: 'standard' | 'reduced' | 'zero' | 'none';
    vatRatePct: string;
    base: string;
    vat: string;
  }[];
  readonly fields: readonly { fieldKey: string; valueText: string; source: 'llm' }[];
  readonly validations: readonly {
    ruleId: string;
    ruleVersion: number;
    severity: 'blocking' | 'warning';
    params: Record<string, unknown>;
  }[];
  readonly run: {
    readonly model: string;
    readonly promptVersion: string;
    readonly attempt: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly latencyMs: number;
  };
}

/** The document (not deleted) with its file and the org's IČO/DIČ; null when absent or another org's. */
export async function loadDocumentForRead(
  tx: TenantTx,
  documentId: string,
): Promise<DocumentForRead | null> {
  const [row] = await tx
    .select({
      id: documents.id,
      orgId: documents.orgId,
      status: documents.status,
      storagePath: sourceFiles.storagePath,
      mimeType: sourceFiles.mimeType,
      orgIco: organizations.ico,
      orgDic: organizations.dic,
    })
    .from(documents)
    .innerJoin(sourceFiles, eq(sourceFiles.id, documents.sourceFileId))
    .innerJoin(organizations, eq(organizations.id, documents.orgId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Sets only the status (e.g. 'extracting' before the model call). */
export async function setDocumentStatus(
  tx: TenantTx,
  documentId: string,
  status: 'extracting' | 'failed',
): Promise<void> {
  await tx.update(documents).set({ status }).where(eq(documents.id, documentId));
}

/** Writes one successful reading; returns the extraction run id. */
export async function saveDocumentReading(tx: TenantTx, write: ReadingWrite): Promise<string> {
  const { orgId, documentId, run } = write;

  const [inserted] = await tx
    .insert(extractionRuns)
    .values({
      orgId,
      documentId,
      stage: 'extract',
      method: 'llm',
      ok: true,
      model: run.model,
      promptVersion: run.promptVersion,
      attempt: run.attempt,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheReadTokens: run.cacheReadTokens,
      cacheWriteTokens: run.cacheWriteTokens,
      latencyMs: run.latencyMs,
    })
    .returning({ id: extractionRuns.id });
  if (!inserted) throw new Error('extraction run insert returned no row');
  const runId = inserted.id;

  await tx
    .update(documents)
    .set({
      ...write.patch,
      class: write.patch.class as (typeof documents.$inferInsert)['class'],
      status: write.status,
    })
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)));

  await tx
    .delete(documentVatSummary)
    .where(and(eq(documentVatSummary.orgId, orgId), eq(documentVatSummary.documentId, documentId)));
  if (write.vatSummary.length > 0) {
    await tx
      .insert(documentVatSummary)
      .values(write.vatSummary.map((row) => ({ orgId, documentId, ...row })));
  }

  await tx
    .update(documentFields)
    .set({ isCurrent: false })
    .where(
      and(
        eq(documentFields.orgId, orgId),
        eq(documentFields.documentId, documentId),
        eq(documentFields.isCurrent, true),
      ),
    );
  if (write.fields.length > 0) {
    await tx.insert(documentFields).values(
      write.fields.map((field) => ({
        orgId,
        documentId,
        fieldKey: field.fieldKey,
        valueText: field.valueText,
        source: field.source,
        extractionRunId: runId,
        isCurrent: true,
      })),
    );
  }

  await tx
    .delete(validationResults)
    .where(
      and(
        eq(validationResults.orgId, orgId),
        eq(validationResults.documentId, documentId),
        eq(validationResults.state, 'open'),
      ),
    );
  if (write.validations.length > 0) {
    await tx
      .insert(validationResults)
      .values(
        write.validations.map((check) => ({
          orgId,
          documentId,
          ruleId: check.ruleId,
          ruleVersion: check.ruleVersion,
          severity: check.severity,
          params: check.params,
        })),
      )
      .onConflictDoNothing();
  }

  return runId;
}

/** Records a failed model call; with `final` the document becomes 'failed'. `error` is a code, never content. */
export async function recordFailedRead(
  tx: TenantTx,
  failure: {
    orgId: string;
    documentId: string;
    model: string;
    promptVersion: string;
    attempt: number;
    error: string;
    final: boolean;
  },
): Promise<void> {
  await tx.insert(extractionRuns).values({
    orgId: failure.orgId,
    documentId: failure.documentId,
    stage: 'extract',
    method: 'llm',
    ok: false,
    model: failure.model,
    promptVersion: failure.promptVersion,
    attempt: failure.attempt,
    error: failure.error,
  });
  if (failure.final) {
    await tx
      .update(documents)
      .set({ status: 'failed' })
      .where(and(eq(documents.id, failure.documentId), eq(documents.orgId, failure.orgId)));
  }
}
