import { llmCostUsd, Money } from '@shoebox/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { linesOfReading } from './document-lines-of-reading';
import {
  documentFields,
  documentLines,
  documentVatSummary,
  extractionRuns,
  validationResults,
} from './schema/document-details';
import { documents, sourceFiles } from './schema/documents';
import { pipelineEvents } from './schema/pipeline-events';
import { organizations } from './schema/tenancy';
import { markIfSemanticDuplicate } from './semantic-dedupe';
import type { TenantTx } from './tenant';

export interface DocumentForRead {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
  readonly revision: number;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly orgIco: string | null;
  readonly orgDic: string | null;
}

export interface ReadingPatch {
  readonly class: string;
  readonly classSource: 'llm' | 'rule';
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
  readonly fields: readonly {
    fieldKey: string;
    valueText: string;
    source: 'llm' | 'isdoc' | 'qr' | 'pdf_text' | 'vendor_memory';
  }[];
  readonly validations: readonly {
    ruleId: string;
    ruleVersion: number;
    severity: 'blocking' | 'warning';
    params: Record<string, unknown>;
  }[];
  readonly run: {
    /** How the values were read; default 'llm'. 'isdoc' = from the file's ISDOC data, no model call. 'rule' = skipped by the free pre-check, no model call. */
    readonly method?: 'llm' | 'isdoc' | 'rule';
    readonly model: string | null;
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
      revision: documents.revision,
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
      method: run.method ?? 'llm',
      ok: true,
      model: run.model,
      promptVersion: run.promptVersion,
      attempt: run.attempt,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheReadTokens: run.cacheReadTokens,
      cacheWriteTokens: run.cacheWriteTokens,
      latencyMs: run.latencyMs,
      costUsd: llmCostUsd(run.model, run),
    })
    .returning({ id: extractionRuns.id });
  if (!inserted) throw new Error('extraction run insert returned no row');
  const runId = inserted.id;
  const precheck = write.validations.find((check) => check.ruleId === 'PRECHECK_SKIPPED');
  await tx.insert(pipelineEvents).values({
    orgId,
    documentId,
    kind: 'read',
    code: write.status,
    detail: typeof precheck?.params.reason === 'string' ? precheck.params.reason : null,
    extractionRunId: runId,
    method: run.method ?? 'llm',
    model: run.model,
    promptVersion: run.promptVersion,
    attempt: run.attempt,
    blocking: write.validations.filter((c) => c.severity === 'blocking').map((c) => c.ruleId),
    warnings: write.validations.filter((c) => c.severity === 'warning').map((c) => c.ruleId),
  });

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

  // Lines (M02 §6 step 5): replace, carrying what the user classified by hand where (position, gross) match.
  const [stored] = await tx
    .select({ rounding: documents.rounding })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)))
    .limit(1);
  const currency = write.patch.currency;
  const nextLines = linesOfReading({
    currency,
    vatSummary: write.vatSummary,
    totalNet: write.patch.totalNet,
    totalVat: write.patch.totalVat,
    totalGross: write.patch.totalGross,
    rounding: stored?.rounding ?? '0',
  });
  const oldLines = await tx
    .select({
      position: documentLines.position,
      gross: documentLines.gross,
      categoryCode: documentLines.categoryCode,
      vatTreatment: documentLines.vatTreatment,
      businessSharePct: documentLines.businessSharePct,
      deductibility: documentLines.deductibility,
      classificationSource: documentLines.classificationSource,
    })
    .from(documentLines)
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documentId)));
  await tx
    .delete(documentLines)
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documentId)));
  if (nextLines.length > 0) {
    await tx.insert(documentLines).values(
      nextLines.map((line) => {
        const kept = oldLines.find(
          (old) =>
            old.position === line.position &&
            old.classificationSource === 'user' &&
            old.gross !== null &&
            Money.parse(old.gross, currency).compare(Money.parse(line.gross, currency)) === 0,
        );
        return {
          orgId,
          documentId,
          position: line.position,
          lineType: line.lineType,
          net: line.net,
          vat: line.vat,
          gross: line.gross,
          vatRateType: line.vatRateType,
          vatRatePct: line.vatRatePct,
          ...(kept === undefined
            ? {}
            : {
                categoryCode: kept.categoryCode,
                vatTreatment: kept.vatTreatment,
                businessSharePct: kept.businessSharePct,
                deductibility: kept.deductibility,
                classificationSource: kept.classificationSource,
              }),
        };
      }),
    );
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

  if (write.status !== 'supporting') {
    await markIfSemanticDuplicate(tx, orgId, documentId);
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
  const [run] = await tx
    .insert(extractionRuns)
    .values({
      orgId: failure.orgId,
      documentId: failure.documentId,
      stage: 'extract',
      method: 'llm',
      ok: false,
      model: failure.model,
      promptVersion: failure.promptVersion,
      attempt: failure.attempt,
      error: failure.error,
    })
    .returning({ id: extractionRuns.id });
  await tx.insert(pipelineEvents).values({
    orgId: failure.orgId,
    documentId: failure.documentId,
    kind: 'read_failed',
    code: failure.error.slice(0, 64),
    detail: failure.final ? 'final' : 'retry',
    extractionRunId: run?.id ?? null,
    method: 'llm',
    model: failure.model,
    promptVersion: failure.promptVersion,
    attempt: failure.attempt,
  });
  if (failure.final) {
    await tx
      .update(documents)
      .set({ status: 'failed' })
      .where(and(eq(documents.id, failure.documentId), eq(documents.orgId, failure.orgId)));
  }
}
