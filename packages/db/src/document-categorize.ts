import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  documentFields,
  documentLines,
  extractionRuns,
  reviewQuestions,
} from './schema/document-details';
import { documents } from './schema/documents';
import { fxRates, partners, vendorProfiles } from './schema/partners';
import { organizations, taxpayerProfiles } from './schema/tenancy';
import type { TenantTx } from './tenant';
export interface CategorizeLineRow {
  readonly id: string;
  readonly position: number;
  readonly lineType: string;
  readonly description: string | null;
  readonly quantity: string | null;
  readonly net: string | null;
  readonly vat: string | null;
  readonly gross: string | null;
  readonly vatRateType: string;
  readonly vatRatePct: string | null;
  readonly vatTreatment: string | null;
  readonly categoryCode: string | null;
  readonly businessSharePct: string;
  readonly deductibility: string | null;
  readonly coveredByDocumentId: string | null;
  readonly rcCommodityCode: string | null;
  readonly classificationSource: string | null;
  readonly classificationConfidence: string | null;
}
export interface CategorizeFieldRow {
  readonly fieldKey: string;
  readonly valueText: string | null;
  readonly valueJson: unknown;
  readonly source: string;
} // current rows only
export interface CategorizeQuestionRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly answer: unknown;
  readonly answeredAt: Date | null;
}
export interface CategorizeProfileRow {
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly vatStatus: string;
  readonly vatPeriod: string | null;
  readonly foreignServiceDppdPolicy: string | null;
  readonly mainActivityNace: string | null;
}
export interface CategorizePartnerRow {
  readonly id: string;
  readonly name: string;
  readonly ico: string | null;
  readonly dic: string | null;
  readonly vatId: string | null;
  readonly country: string;
  readonly isVatPayer: boolean | null;
}
export interface CategorizeVendorRow {
  readonly id: string;
  readonly partnerId: string;
  readonly defaultCategoryCode: string | null;
  readonly defaultVatTreatment: string | null;
  readonly defaultBusinessFlag: string | null;
  readonly confirmations: number;
  readonly pinned: boolean;
  readonly multiCategory: boolean;
  readonly extractionHints: unknown;
}
export interface CategorizeFxRow {
  readonly rateDate: string;
  readonly currency: string;
  readonly amount: number;
  readonly rate: string;
}
export interface DocumentForCategorize {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
  readonly revision: number;
  readonly class: string;
  readonly direction: string | null;
  readonly taxDocStatus: string;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly receivedDate: string | null;
  readonly servicePeriodFrom: string | null;
  readonly servicePeriodTo: string | null;
  readonly paidAt: string | null;
  readonly vatPointDate: string | null;
  readonly currency: string;
  readonly fxRate: string | null;
  readonly fxRateDate: string | null;
  readonly totalGross: string | null;
  readonly paymentMethod: string | null;
  readonly isPaidPerDocument: boolean | null;
  readonly businessFlag: string;
  readonly summaryCs: string | null;
  readonly partnerId: string | null;
  readonly partnerSnapshot: unknown;
  readonly buyerSnapshot: unknown;
  readonly stageVersion: unknown;
  readonly orgIco: string | null;
  readonly orgDic: string | null;
  readonly orgSettings: unknown;
  readonly lines: readonly CategorizeLineRow[];
  readonly fields: readonly CategorizeFieldRow[];
  readonly questions: readonly CategorizeQuestionRow[];
  readonly partner: CategorizePartnerRow | null;
  readonly vendor: CategorizeVendorRow | null;
  readonly profiles: readonly CategorizeProfileRow[];
  /** fx_rates rows of the document's currency within 120 days before issue_date (empty for CZK). */
  readonly fxRates: readonly CategorizeFxRow[];
}
/** Not-deleted document with lines (position order), current fields, all questions of the document, partner, vendor profile of that partner, the org's taxpayer profiles (valid_from order) and fx rows. Null when absent. */
export async function loadDocumentForCategorize(
  tx: TenantTx,
  documentId: string,
): Promise<DocumentForCategorize | null> {
  const [doc] = await tx
    .select({
      id: documents.id,
      orgId: documents.orgId,
      status: documents.status,
      revision: documents.revision,
      class: documents.class,
      direction: documents.direction,
      taxDocStatus: documents.taxDocStatus,
      issueDate: documents.issueDate,
      duzp: documents.duzp,
      receivedDate: documents.receivedDate,
      servicePeriodFrom: documents.servicePeriodFrom,
      servicePeriodTo: documents.servicePeriodTo,
      paidAt: documents.paidAt,
      vatPointDate: documents.vatPointDate,
      currency: documents.currency,
      fxRate: documents.fxRate,
      fxRateDate: documents.fxRateDate,
      totalGross: documents.totalGross,
      paymentMethod: documents.paymentMethod,
      isPaidPerDocument: documents.isPaidPerDocument,
      businessFlag: documents.businessFlag,
      summaryCs: documents.summaryCs,
      partnerId: documents.partnerId,
      partnerSnapshot: documents.partnerSnapshot,
      buyerSnapshot: documents.buyerSnapshot,
      stageVersion: documents.stageVersion,
      orgIco: organizations.ico,
      orgDic: organizations.dic,
      orgSettings: organizations.settings,
    })
    .from(documents)
    .innerJoin(organizations, eq(organizations.id, documents.orgId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!doc) return null;

  const lines = await tx
    .select({
      id: documentLines.id,
      position: documentLines.position,
      lineType: documentLines.lineType,
      description: documentLines.description,
      quantity: documentLines.quantity,
      net: documentLines.net,
      vat: documentLines.vat,
      gross: documentLines.gross,
      vatRateType: documentLines.vatRateType,
      vatRatePct: documentLines.vatRatePct,
      vatTreatment: documentLines.vatTreatment,
      categoryCode: documentLines.categoryCode,
      businessSharePct: documentLines.businessSharePct,
      deductibility: documentLines.deductibility,
      coveredByDocumentId: documentLines.coveredByDocumentId,
      rcCommodityCode: documentLines.rcCommodityCode,
      classificationSource: documentLines.classificationSource,
      classificationConfidence: documentLines.classificationConfidence,
    })
    .from(documentLines)
    .where(and(eq(documentLines.orgId, doc.orgId), eq(documentLines.documentId, documentId)))
    .orderBy(asc(documentLines.position));

  const fields = await tx
    .select({
      fieldKey: documentFields.fieldKey,
      valueText: documentFields.valueText,
      valueJson: documentFields.valueJson,
      source: documentFields.source,
    })
    .from(documentFields)
    .where(
      and(
        eq(documentFields.orgId, doc.orgId),
        eq(documentFields.documentId, documentId),
        eq(documentFields.isCurrent, true),
      ),
    );

  const questions = await tx
    .select({
      id: reviewQuestions.id,
      kind: reviewQuestions.kind,
      payload: reviewQuestions.payload,
      answer: reviewQuestions.answer,
      answeredAt: reviewQuestions.answeredAt,
    })
    .from(reviewQuestions)
    .where(and(eq(reviewQuestions.orgId, doc.orgId), eq(reviewQuestions.documentId, documentId)));

  const [partner] = doc.partnerId
    ? await tx
        .select({
          id: partners.id,
          name: partners.name,
          ico: partners.ico,
          dic: partners.dic,
          vatId: partners.vatId,
          country: partners.country,
          isVatPayer: partners.isVatPayer,
        })
        .from(partners)
        .where(and(eq(partners.id, doc.partnerId), eq(partners.orgId, doc.orgId)))
        .limit(1)
    : [];

  const [vendor] = doc.partnerId
    ? await tx
        .select({
          id: vendorProfiles.id,
          partnerId: vendorProfiles.partnerId,
          defaultCategoryCode: vendorProfiles.defaultCategoryCode,
          defaultVatTreatment: vendorProfiles.defaultVatTreatment,
          defaultBusinessFlag: vendorProfiles.defaultBusinessFlag,
          confirmations: vendorProfiles.confirmations,
          pinned: vendorProfiles.pinned,
          multiCategory: vendorProfiles.multiCategory,
          extractionHints: vendorProfiles.extractionHints,
        })
        .from(vendorProfiles)
        .where(
          and(eq(vendorProfiles.orgId, doc.orgId), eq(vendorProfiles.partnerId, doc.partnerId)),
        )
        .limit(1)
    : [];

  const profiles = await tx
    .select({
      validFrom: taxpayerProfiles.validFrom,
      validTo: taxpayerProfiles.validTo,
      vatStatus: taxpayerProfiles.vatStatus,
      vatPeriod: taxpayerProfiles.vatPeriod,
      foreignServiceDppdPolicy: taxpayerProfiles.foreignServiceDppdPolicy,
      mainActivityNace: taxpayerProfiles.mainActivityNace,
    })
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.orgId, doc.orgId))
    .orderBy(asc(taxpayerProfiles.validFrom));

  const fxRows =
    doc.currency === 'CZK' || doc.issueDate === null
      ? []
      : await tx
          .select({
            rateDate: fxRates.rateDate,
            currency: fxRates.currency,
            amount: fxRates.amount,
            rate: fxRates.rate,
          })
          .from(fxRates)
          .where(
            and(
              eq(fxRates.currency, doc.currency),
              sql`${fxRates.rateDate} between (${doc.issueDate}::date - 120) and ${doc.issueDate}::date`,
            ),
          );

  return {
    ...doc,
    lines,
    fields,
    questions,
    partner: partner ?? null,
    vendor: vendor ?? null,
    profiles,
    fxRates: fxRows,
  };
}

export interface CategorizationLineWrite {
  readonly lineId: string;
  readonly categoryCode: string | null;
  readonly vatTreatment: string | null;
  readonly vatRatePct: string | null;
  readonly businessSharePct: string;
  readonly deductibility: string | null;
  readonly classificationSource: string | null;
  readonly classificationConfidence: string | null;
}
export interface CategorizationFieldWrite {
  readonly fieldKey: string;
  readonly valueText: string | null;
  readonly valueJson?: unknown;
  readonly source: 'llm' | 'rule' | 'vendor_memory' | 'derived' | 'user';
  readonly confidence: string | null;
  readonly setBy?: string | null;
}
export interface CategorizationQuestionWrite {
  readonly kind: string;
  readonly payload: unknown;
}
export interface CategorizationRunWrite {
  readonly model: string;
  readonly promptVersion: string;
  readonly attempt: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly error: string | null;
}
export interface CategorizationWrite {
  readonly orgId: string;
  readonly documentId: string;
  readonly status: 'ready' | 'needs_review';
  readonly document: {
    readonly businessFlag: string;
    readonly summaryCs: string | null;
    readonly vatPointDate: string | null;
    readonly fxRate: string | null;
    readonly fxRateDate: string | null;
    readonly categorizeVersion: number;
  };
  readonly lines: readonly CategorizationLineWrite[];
  readonly fields: readonly CategorizationFieldWrite[];
  readonly questions: readonly CategorizationQuestionWrite[];
  readonly runs: readonly CategorizationRunWrite[];
}
/**
 * One transaction (the caller's tx): inserts the runs (stage 'categorize', method 'llm'); for each field: when a current
 * row of the same key has source 'user' and the new source is not 'user' → skip; else flip current rows of that key and
 * insert the new one; updates each line; inserts each question unless an unanswered question of the same kind already
 * exists for the document; updates documents (status, business_flag, summary_cs, vat_point_date, fx_rate, fx_rate_date,
 * stage_version = stage_version || {"categorize": categorizeVersion}). Returns the number of fields written.
 */
export async function saveCategorization(
  tx: TenantTx,
  write: CategorizationWrite,
): Promise<number> {
  const { orgId, documentId } = write;

  let runId: string | null = null;
  for (const run of write.runs) {
    const [inserted] = await tx
      .insert(extractionRuns)
      .values({
        orgId,
        documentId,
        stage: 'categorize',
        method: 'llm',
        ok: run.ok,
        model: run.model,
        promptVersion: run.promptVersion,
        attempt: run.attempt,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cacheReadTokens: run.cacheReadTokens,
        cacheWriteTokens: run.cacheWriteTokens,
        latencyMs: run.latencyMs,
        error: run.error,
      })
      .returning({ id: extractionRuns.id });
    if (!inserted) throw new Error('extraction run insert returned no row');
    runId = inserted.id;
  }

  const currentFields = await tx
    .select({ fieldKey: documentFields.fieldKey, source: documentFields.source })
    .from(documentFields)
    .where(
      and(
        eq(documentFields.orgId, orgId),
        eq(documentFields.documentId, documentId),
        eq(documentFields.isCurrent, true),
      ),
    );
  const userKeys = new Set(
    currentFields.filter((row) => row.source === 'user').map((row) => row.fieldKey),
  );

  let written = 0;
  for (const field of write.fields) {
    // A user-entered value is never overwritten by llm, rule or vendor_memory output.
    if (userKeys.has(field.fieldKey) && field.source !== 'user') continue;
    await tx
      .update(documentFields)
      .set({ isCurrent: false })
      .where(
        and(
          eq(documentFields.orgId, orgId),
          eq(documentFields.documentId, documentId),
          eq(documentFields.fieldKey, field.fieldKey),
          eq(documentFields.isCurrent, true),
        ),
      );
    await tx.insert(documentFields).values({
      orgId,
      documentId,
      fieldKey: field.fieldKey,
      valueText: field.valueText,
      valueJson: field.valueJson,
      source: field.source,
      confidence: field.confidence,
      extractionRunId: runId,
      setBy: field.setBy ?? null,
      isCurrent: true,
    });
    if (field.source === 'user') userKeys.add(field.fieldKey);
    written += 1;
  }

  for (const line of write.lines) {
    await tx
      .update(documentLines)
      .set({
        categoryCode: line.categoryCode,
        vatTreatment: line.vatTreatment as (typeof documentLines.$inferInsert)['vatTreatment'],
        vatRatePct: line.vatRatePct,
        businessSharePct: line.businessSharePct,
        deductibility: line.deductibility,
        classificationSource:
          line.classificationSource as (typeof documentLines.$inferInsert)['classificationSource'],
        classificationConfidence: line.classificationConfidence,
      })
      .where(
        and(
          eq(documentLines.id, line.lineId),
          eq(documentLines.orgId, orgId),
          eq(documentLines.documentId, documentId),
        ),
      );
  }

  for (const question of write.questions) {
    const [open] = await tx
      .select({ id: reviewQuestions.id })
      .from(reviewQuestions)
      .where(
        and(
          eq(reviewQuestions.orgId, orgId),
          eq(reviewQuestions.documentId, documentId),
          eq(reviewQuestions.kind, question.kind),
          isNull(reviewQuestions.answeredAt),
        ),
      )
      .limit(1);
    if (open) continue;
    await tx.insert(reviewQuestions).values({
      orgId,
      documentId,
      kind: question.kind,
      payload: question.payload,
    });
  }

  await tx
    .update(documents)
    .set({
      status: write.status,
      businessFlag: write.document.businessFlag,
      summaryCs: write.document.summaryCs,
      vatPointDate: write.document.vatPointDate,
      fxRate: write.document.fxRate,
      fxRateDate: write.document.fxRateDate,
      stageVersion: sql`${documents.stageVersion} || ${JSON.stringify({ categorize: write.document.categorizeVersion })}::jsonb`,
    })
    .where(and(eq(documents.id, documentId), eq(documents.orgId, orgId)));

  return written;
}
