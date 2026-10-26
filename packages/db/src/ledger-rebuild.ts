import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { CategorizeFxRow, CategorizeProfileRow } from './document-categorize';
import { documentLines, documentVatSummary } from './schema/document-details';
import { documents } from './schema/documents';
import { taxLedgerEntries, vatLedgerEntries } from './schema/ledgers';
import { fxRates, partners } from './schema/partners';
import { taxpayerProfiles } from './schema/tenancy';
import type { TenantTx } from './tenant';

export interface LedgerDocumentRow {
  readonly id: string;
  readonly orgId: string;
  readonly revision: number;
  readonly class: string;
  readonly direction: string | null;
  readonly status: string;
  readonly deleted: boolean;
  readonly taxDocStatus: string;
  readonly businessFlag: string;
  readonly currency: string;
  readonly documentNumber: string | null;
  readonly totalGross: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly receivedDate: string | null;
  readonly dueDate: string | null;
  readonly servicePeriodFrom: string | null;
  readonly servicePeriodTo: string | null;
  readonly paidAt: string | null;
  readonly vatPointDate: string | null;
  readonly isPaidPerDocument: boolean | null;
  readonly paymentMethod: string | null;
  readonly fxRate: string | null;
  readonly fxRateDate: string | null;
  readonly partnerId: string | null;
}
export interface LedgerLineRow {
  readonly id: string;
  readonly position: number;
  readonly lineType: string;
  readonly net: string | null;
  readonly vat: string | null;
  readonly gross: string | null;
  readonly categoryCode: string | null;
  readonly businessSharePct: string;
  readonly coveredByDocumentId: string | null;
  readonly vatTreatment: string | null;
  readonly vatRateType: string;
  readonly vatRatePct: string | null;
}
export interface LedgerRecapRow {
  readonly vatRateType: string;
  readonly vatRatePct: string;
  readonly base: string;
  readonly vat: string;
}
export interface LedgerPartnerRow {
  readonly country: string;
  readonly dic: string | null;
  readonly vatId: string | null;
}
export interface LedgerInputs {
  readonly doc: LedgerDocumentRow;
  readonly lines: readonly LedgerLineRow[];
  readonly recap: readonly LedgerRecapRow[];
  readonly partner: LedgerPartnerRow | null;
  readonly profiles: readonly CategorizeProfileRow[];
  readonly fxRates: readonly CategorizeFxRow[];
  /** stage_version.ledger of the document, when present. */
  readonly current: {
    readonly v: number;
    readonly h: string;
    readonly buildVersion: string;
  } | null;
}
/** Everything the builders read, including soft-deleted documents (their rebuild removes stale rows). Null when the id is unknown to this org. fx rows: the document currency, 120 days back from issue_date (none for CZK). */
export async function loadLedgerInputs(
  tx: TenantTx,
  documentId: string,
): Promise<LedgerInputs | null> {
  const [row] = await tx
    .select({
      id: documents.id,
      orgId: documents.orgId,
      revision: documents.revision,
      class: documents.class,
      direction: documents.direction,
      status: documents.status,
      deletedAt: documents.deletedAt,
      taxDocStatus: documents.taxDocStatus,
      businessFlag: documents.businessFlag,
      currency: documents.currency,
      documentNumber: documents.documentNumber,
      totalGross: documents.totalGross,
      issueDate: documents.issueDate,
      duzp: documents.duzp,
      receivedDate: documents.receivedDate,
      dueDate: documents.dueDate,
      servicePeriodFrom: documents.servicePeriodFrom,
      servicePeriodTo: documents.servicePeriodTo,
      paidAt: documents.paidAt,
      vatPointDate: documents.vatPointDate,
      isPaidPerDocument: documents.isPaidPerDocument,
      paymentMethod: documents.paymentMethod,
      fxRate: documents.fxRate,
      fxRateDate: documents.fxRateDate,
      partnerId: documents.partnerId,
      stageVersion: documents.stageVersion,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!row) return null;
  const { deletedAt, stageVersion, ...rest } = row;

  const lines = await tx
    .select({
      id: documentLines.id,
      position: documentLines.position,
      lineType: documentLines.lineType,
      net: documentLines.net,
      vat: documentLines.vat,
      gross: documentLines.gross,
      categoryCode: documentLines.categoryCode,
      businessSharePct: documentLines.businessSharePct,
      coveredByDocumentId: documentLines.coveredByDocumentId,
      vatTreatment: documentLines.vatTreatment,
      vatRateType: documentLines.vatRateType,
      vatRatePct: documentLines.vatRatePct,
    })
    .from(documentLines)
    .where(and(eq(documentLines.orgId, row.orgId), eq(documentLines.documentId, documentId)))
    .orderBy(asc(documentLines.position));

  const recap = await tx
    .select({
      vatRateType: documentVatSummary.vatRateType,
      vatRatePct: documentVatSummary.vatRatePct,
      base: documentVatSummary.base,
      vat: documentVatSummary.vat,
    })
    .from(documentVatSummary)
    .where(
      and(eq(documentVatSummary.orgId, row.orgId), eq(documentVatSummary.documentId, documentId)),
    );

  const [partner] = row.partnerId
    ? await tx
        .select({ country: partners.country, dic: partners.dic, vatId: partners.vatId })
        .from(partners)
        .where(eq(partners.id, row.partnerId))
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
    .where(eq(taxpayerProfiles.orgId, row.orgId))
    .orderBy(asc(taxpayerProfiles.validFrom));

  const fx =
    row.currency === 'CZK' || row.issueDate === null
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
              eq(fxRates.currency, row.currency),
              sql`${fxRates.rateDate} between (${row.issueDate}::date - 120) and ${row.issueDate}::date`,
            ),
          );

  return {
    doc: { ...rest, deleted: deletedAt !== null },
    lines,
    recap,
    partner: partner ?? null,
    profiles,
    fxRates: fx,
    current: parseCurrent(stageVersion),
  };
}

function parseCurrent(raw: unknown): { v: number; h: string; buildVersion: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ledger = (raw as Record<string, unknown>).ledger;
  if (typeof ledger !== 'object' || ledger === null) return null;
  const { v, h, build_version: bv } = ledger as Record<string, unknown>;
  if (typeof v !== 'number' || typeof h !== 'string') return null;
  if (typeof bv !== 'number' && typeof bv !== 'string') return null;
  return { v, h, buildVersion: String(bv) };
}

export interface TaxEntryRow {
  readonly entryDate: string;
  readonly taxYear: number;
  readonly basis: string;
  readonly lineId: string | null;
  readonly paymentLinkId: string | null;
  readonly transactionId: string | null;
  readonly categoryCode: string;
  readonly taxEffect: string;
  readonly amountCzk: string;
  readonly businessSharePct: string;
  readonly businessAmountCzk: string;
}
export interface VatEntryRow {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly vatPointDate: string;
  readonly vatPointRule: string;
  readonly lineId: string | null;
  readonly vatTreatment: string;
  readonly vatRateType: string;
  readonly vatRatePct: string;
  readonly baseCzk: string;
  readonly vatCzk: string;
  readonly deductionPct: string;
  readonly currency: string;
  readonly baseForeign: string | null;
  readonly fxRate: string | null;
  readonly fxAmount: number | null;
  readonly fxRateDate: string | null;
  readonly dphdp3Rows: readonly string[];
  readonly khSection: string | null;
  readonly khDocumentTotalCzk: string | null;
  readonly shvCode: number | null;
  readonly counterpartyVatId: string | null;
  readonly evidenceNumber: string | null;
}
export interface LedgerReplaceWrite {
  readonly orgId: string;
  readonly documentId: string;
  readonly algoVersion: number;
  readonly inputHash: string;
  readonly tax: readonly TaxEntryRow[];
  readonly vat: readonly VatEntryRow[];
}
/** Takes the advisory lock, deletes the document's rows in both ledgers, inserts the new ones with one fresh build_version, writes stage_version.ledger = {v, h, build_version}. Returns the build_version (as a decimal string). */
export async function replaceLedgerEntries(
  tx: TenantTx,
  write: LedgerReplaceWrite,
): Promise<string> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${write.orgId} || ':ledger:' || ${write.documentId}))`,
  );
  const seq = (await tx.execute(
    sql`select nextval('ledger_build_version_seq')::text as bv`,
  )) as unknown as { bv: string }[];
  const buildVersion = String(seq[0]?.bv);

  await tx
    .delete(taxLedgerEntries)
    .where(
      and(
        eq(taxLedgerEntries.orgId, write.orgId),
        eq(taxLedgerEntries.documentId, write.documentId),
      ),
    );
  await tx
    .delete(vatLedgerEntries)
    .where(
      and(
        eq(vatLedgerEntries.orgId, write.orgId),
        eq(vatLedgerEntries.documentId, write.documentId),
      ),
    );

  if (write.tax.length > 0) {
    await tx.insert(taxLedgerEntries).values(
      write.tax.map((r) => ({
        orgId: write.orgId,
        entryDate: r.entryDate,
        taxYear: r.taxYear,
        basis: r.basis,
        documentId: write.documentId,
        lineId: r.lineId,
        paymentLinkId: r.paymentLinkId,
        transactionId: r.transactionId,
        categoryCode: r.categoryCode,
        taxEffect: r.taxEffect as (typeof taxLedgerEntries.$inferInsert)['taxEffect'],
        amountCzk: r.amountCzk,
        businessSharePct: r.businessSharePct,
        businessAmountCzk: r.businessAmountCzk,
        buildVersion: sql`${buildVersion}::bigint`,
      })),
    );
  }
  if (write.vat.length > 0) {
    await tx.insert(vatLedgerEntries).values(
      write.vat.map((r) => ({
        orgId: write.orgId,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        vatPointDate: r.vatPointDate,
        vatPointRule: r.vatPointRule,
        documentId: write.documentId,
        lineId: r.lineId,
        vatTreatment: r.vatTreatment as (typeof vatLedgerEntries.$inferInsert)['vatTreatment'],
        vatRateType: r.vatRateType as (typeof vatLedgerEntries.$inferInsert)['vatRateType'],
        vatRatePct: r.vatRatePct,
        baseCzk: r.baseCzk,
        vatCzk: r.vatCzk,
        deductionPct: r.deductionPct,
        currency: r.currency,
        baseForeign: r.baseForeign,
        fxRate: r.fxRate,
        fxAmount: r.fxAmount,
        fxRateDate: r.fxRateDate,
        dphdp3Rows: [...r.dphdp3Rows],
        khSection: r.khSection,
        khDocumentTotalCzk: r.khDocumentTotalCzk,
        shvCode: r.shvCode,
        counterpartyVatId: r.counterpartyVatId,
        evidenceNumber: r.evidenceNumber,
        buildVersion: sql`${buildVersion}::bigint`,
      })),
    );
  }

  await tx.execute(sql`update documents
    set stage_version = stage_version || jsonb_build_object('ledger', jsonb_build_object('v', ${write.algoVersion}::int, 'h', ${write.inputHash}::text, 'build_version', ${buildVersion}::bigint))
    where id = ${write.documentId} and org_id = ${write.orgId}`);

  return buildVersion;
}

/** Current rows of one document, ordered deterministically (tax: entry_date, line_id, basis; vat: vat_point_date, vat_treatment, vat_rate_type), without id/build_version: for AC-5 and ledger.verify. */
export async function readLedgerEntries(
  tx: TenantTx,
  documentId: string,
): Promise<{ tax: TaxEntryRow[]; vat: VatEntryRow[]; buildVersion: string | null }> {
  const tax = await tx
    .select({
      entryDate: taxLedgerEntries.entryDate,
      taxYear: taxLedgerEntries.taxYear,
      basis: taxLedgerEntries.basis,
      lineId: taxLedgerEntries.lineId,
      paymentLinkId: taxLedgerEntries.paymentLinkId,
      transactionId: taxLedgerEntries.transactionId,
      categoryCode: taxLedgerEntries.categoryCode,
      taxEffect: taxLedgerEntries.taxEffect,
      amountCzk: taxLedgerEntries.amountCzk,
      businessSharePct: taxLedgerEntries.businessSharePct,
      businessAmountCzk: taxLedgerEntries.businessAmountCzk,
    })
    .from(taxLedgerEntries)
    .where(eq(taxLedgerEntries.documentId, documentId))
    .orderBy(
      asc(taxLedgerEntries.entryDate),
      asc(taxLedgerEntries.lineId),
      asc(taxLedgerEntries.basis),
    );

  const vat = await tx
    .select({
      periodStart: vatLedgerEntries.periodStart,
      periodEnd: vatLedgerEntries.periodEnd,
      vatPointDate: vatLedgerEntries.vatPointDate,
      vatPointRule: vatLedgerEntries.vatPointRule,
      lineId: vatLedgerEntries.lineId,
      vatTreatment: vatLedgerEntries.vatTreatment,
      vatRateType: vatLedgerEntries.vatRateType,
      vatRatePct: vatLedgerEntries.vatRatePct,
      baseCzk: vatLedgerEntries.baseCzk,
      vatCzk: vatLedgerEntries.vatCzk,
      deductionPct: vatLedgerEntries.deductionPct,
      currency: vatLedgerEntries.currency,
      baseForeign: vatLedgerEntries.baseForeign,
      fxRate: vatLedgerEntries.fxRate,
      fxAmount: vatLedgerEntries.fxAmount,
      fxRateDate: vatLedgerEntries.fxRateDate,
      dphdp3Rows: vatLedgerEntries.dphdp3Rows,
      khSection: vatLedgerEntries.khSection,
      khDocumentTotalCzk: vatLedgerEntries.khDocumentTotalCzk,
      shvCode: vatLedgerEntries.shvCode,
      counterpartyVatId: vatLedgerEntries.counterpartyVatId,
      evidenceNumber: vatLedgerEntries.evidenceNumber,
    })
    .from(vatLedgerEntries)
    .where(eq(vatLedgerEntries.documentId, documentId))
    .orderBy(
      asc(vatLedgerEntries.vatPointDate),
      asc(vatLedgerEntries.vatTreatment),
      asc(vatLedgerEntries.vatRateType),
    );

  const [taxMax] = await tx
    .select({ bv: sql<string | null>`max(${taxLedgerEntries.buildVersion})::text` })
    .from(taxLedgerEntries)
    .where(eq(taxLedgerEntries.documentId, documentId));
  const [vatMax] = await tx
    .select({ bv: sql<string | null>`max(${vatLedgerEntries.buildVersion})::text` })
    .from(vatLedgerEntries)
    .where(eq(vatLedgerEntries.documentId, documentId));
  const candidates = [taxMax?.bv, vatMax?.bv].filter((x): x is string => typeof x === 'string');
  const buildVersion =
    candidates.length === 0 ? null : candidates.reduce((a, b) => (BigInt(a) >= BigInt(b) ? a : b));

  return { tax, vat: vat as VatEntryRow[], buildVersion };
}

/** Document ids of the org for a full rebuild: not deleted, issue_date >= from (when given), ordered by issue_date nulls last then id, with offset/limit. */
export async function listDocumentsForRebuild(
  tx: TenantTx,
  orgId: string,
  from: string | null,
  offset: number,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        isNull(documents.deletedAt),
        from === null ? undefined : gte(documents.issueDate, from),
      ),
    )
    .orderBy(sql`${documents.issueDate} asc nulls last`, asc(documents.id))
    .offset(offset)
    .limit(limit);
  return rows.map((r) => r.id);
}
