// M05 filing I/O: reads what a VAT period needs, writes filings with their document and entry
// snapshots, supersedes open filings, marks them filed, and keeps VAT obligations current.
// No computation here (0344 does that). Every query is org-scoped (rule 3).

import { createHash } from 'node:crypto';
import { BOOKABLE_CLASSES, type ObligationDraft } from '@shoebox/domain';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { VatEntryRow } from './ledger-rebuild';
import { documentLines, documentLinks, validationResults } from './schema/document-details';
import { documents } from './schema/documents';
import { filingDocuments, filingEntries, filings } from './schema/filings';
import { vatLedgerEntries } from './schema/ledgers';
import { obligations } from './schema/obligations';
import { partners } from './schema/partners';
import { taxpayerProfiles } from './schema/tenancy';
import type { TenantTx } from './tenant';

type FilingRecord = typeof filings.$inferSelect;
type FilingTypeValue = FilingRecord['type'];
type FilingKindValue = FilingRecord['kind'];
type FilingStateValue = FilingRecord['state'];
type FilingOriginValue = FilingRecord['origin'];
type FilingEntryInsert = typeof filingEntries.$inferInsert;

export interface PeriodEntryRow extends VatEntryRow {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly buildVersion: string;
}
export interface PeriodLineRow {
  readonly lineType: string;
  readonly vatTreatment: string | null;
  readonly vatRateType: string;
  readonly businessSharePct: string;
  readonly rcCommodityCode: string | null;
  readonly categoryCode: string | null;
  readonly linkedIssuedInvoiceId: string | null /* coveredByDocumentId */;
}
export interface PeriodDocumentRow {
  readonly id: string;
  readonly revision: number;
  readonly class: string;
  readonly status: string;
  readonly taxDocStatus: string;
  readonly businessFlag: string;
  readonly vatPointDate: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly documentNumber: string | null;
  readonly partner: {
    readonly dic: string | null;
    readonly vatId: string | null;
    readonly country: string | null;
    readonly vatIdValid: boolean | null;
    readonly documentShowsDic: boolean;
  } | null;
  readonly correctsDocumentId: string | null;
  readonly correctsVatPointDate: string | null;
  readonly hasBlockingValidation: boolean;
  readonly lines: readonly PeriodLineRow[];
}
export interface ProfileVersionRow {
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly vatStatus: string;
  readonly vatPeriod: string | null;
  readonly entityType: string;
  readonly dic: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly address: unknown;
  readonly fuCode: string | null;
  readonly ufoCode: string | null;
  readonly mainActivityNace: string | null;
  readonly filingEmail: string | null;
  readonly filingPhone: string | null;
  readonly foreignServiceDppdPolicy: string;
}
export interface PeriodLedger {
  readonly entries: readonly PeriodEntryRow[];
  readonly documents: readonly PeriodDocumentRow[];
  readonly profiles: readonly ProfileVersionRow[];
  readonly ledgerHash: string;
}

export function ledgerHashOf(
  entries: ReadonlyArray<{ documentId: string; buildVersion: string }>,
): string {
  return createHash('sha256')
    .update(JSON.stringify(entries.map((e) => [e.documentId, e.buildVersion]).sort()))
    .digest('hex');
}

/** Entries with period_start = periodStart; documents = those entries' documents ∪ documents (not deleted, bookable class) whose coalesce(vat_point_date, duzp, issue_date) is in [periodStart, periodEnd]; profiles overlapping the period, ordered by valid_from. `documentShowsDic` = partnerSnapshot?.dic present (documents.partner_snapshot jsonb) — false when unknown. */
export async function readPeriodLedger(
  tx: TenantTx,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodLedger> {
  const entryRows = await tx
    .select({ entry: vatLedgerEntries, revision: documents.revision })
    .from(vatLedgerEntries)
    .innerJoin(documents, eq(documents.id, vatLedgerEntries.documentId))
    .where(and(eq(vatLedgerEntries.orgId, orgId), eq(vatLedgerEntries.periodStart, periodStart)))
    .orderBy(asc(vatLedgerEntries.documentId), asc(vatLedgerEntries.id));
  const entries: PeriodEntryRow[] = entryRows.map(({ entry: e, revision }) => ({
    periodStart: e.periodStart,
    periodEnd: e.periodEnd,
    vatPointDate: e.vatPointDate,
    vatPointRule: e.vatPointRule,
    lineId: e.lineId,
    vatTreatment: e.vatTreatment,
    vatRateType: e.vatRateType,
    vatRatePct: e.vatRatePct,
    baseCzk: e.baseCzk,
    vatCzk: e.vatCzk,
    deductionPct: e.deductionPct,
    currency: e.currency,
    baseForeign: e.baseForeign,
    fxRate: e.fxRate,
    fxAmount: e.fxAmount,
    fxRateDate: e.fxRateDate,
    dphdp3Rows: e.dphdp3Rows,
    khSection: e.khSection,
    khDocumentTotalCzk: e.khDocumentTotalCzk,
    shvCode: e.shvCode,
    counterpartyVatId: e.counterpartyVatId,
    evidenceNumber: e.evidenceNumber,
    documentId: e.documentId,
    documentRevision: revision,
    buildVersion: String(e.buildVersion),
  }));

  const entryDocIds = [...new Set(entries.map((e) => e.documentId))];
  const docRows = await tx
    .select({
      id: documents.id,
      revision: documents.revision,
      class: documents.class,
      status: documents.status,
      taxDocStatus: documents.taxDocStatus,
      businessFlag: documents.businessFlag,
      vatPointDate: documents.vatPointDate,
      issueDate: documents.issueDate,
      duzp: documents.duzp,
      documentNumber: documents.documentNumber,
      partnerId: documents.partnerId,
      partnerSnapshot: documents.partnerSnapshot,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        or(
          entryDocIds.length > 0 ? inArray(documents.id, entryDocIds) : sql`false`,
          and(
            isNull(documents.deletedAt),
            inArray(documents.class, [...BOOKABLE_CLASSES]),
            sql`coalesce(${documents.vatPointDate}, ${documents.duzp}, ${documents.issueDate}) between ${periodStart}::date and ${periodEnd}::date`,
          ),
        ),
      ),
    )
    .orderBy(asc(documents.id));
  const docIds = docRows.map((d) => d.id);
  const scoped = <T>(fn: () => Promise<T[]>): Promise<T[]> =>
    docIds.length === 0 ? Promise.resolve([]) : fn();

  const lineRows = await scoped(() =>
    tx
      .select({
        documentId: documentLines.documentId,
        lineType: documentLines.lineType,
        vatTreatment: documentLines.vatTreatment,
        vatRateType: documentLines.vatRateType,
        businessSharePct: documentLines.businessSharePct,
        rcCommodityCode: documentLines.rcCommodityCode,
        categoryCode: documentLines.categoryCode,
        coveredByDocumentId: documentLines.coveredByDocumentId,
      })
      .from(documentLines)
      .where(and(eq(documentLines.orgId, orgId), inArray(documentLines.documentId, docIds)))
      .orderBy(asc(documentLines.documentId), asc(documentLines.position)),
  );
  const linkRows = await scoped(() =>
    tx
      .select({ from: documentLinks.fromDocumentId, to: documentLinks.toDocumentId })
      .from(documentLinks)
      .where(
        and(
          eq(documentLinks.orgId, orgId),
          eq(documentLinks.kind, 'corrects'),
          inArray(documentLinks.fromDocumentId, docIds),
        ),
      ),
  );
  const correctsByDoc = new Map(linkRows.map((l) => [l.from, l.to]));
  const targetIds = [...new Set(linkRows.map((l) => l.to))];
  const targetRows =
    targetIds.length === 0
      ? []
      : await tx
          .select({ id: documents.id, vatPointDate: documents.vatPointDate })
          .from(documents)
          .where(and(eq(documents.orgId, orgId), inArray(documents.id, targetIds)));
  const targetDate = new Map(targetRows.map((t) => [t.id, t.vatPointDate]));
  const blockingRows = await scoped(() =>
    tx
      .select({ documentId: validationResults.documentId })
      .from(validationResults)
      .where(
        and(
          eq(validationResults.orgId, orgId),
          eq(validationResults.state, 'open'),
          eq(validationResults.severity, 'blocking'),
          inArray(validationResults.documentId, docIds),
        ),
      ),
  );
  const blocking = new Set(blockingRows.map((b) => b.documentId));
  const partnerIds = [...new Set(docRows.map((d) => d.partnerId).filter((p) => p !== null))];
  const partnerRows =
    partnerIds.length === 0
      ? []
      : await tx
          .select({
            id: partners.id,
            dic: partners.dic,
            vatId: partners.vatId,
            country: partners.country,
          })
          .from(partners)
          .where(and(eq(partners.orgId, orgId), inArray(partners.id, partnerIds)));
  const partnerById = new Map(partnerRows.map((p) => [p.id, p]));

  const profileRows = await tx
    .select()
    .from(taxpayerProfiles)
    .where(
      and(
        eq(taxpayerProfiles.orgId, orgId),
        lte(taxpayerProfiles.validFrom, periodEnd),
        or(isNull(taxpayerProfiles.validTo), gte(taxpayerProfiles.validTo, periodStart)),
      ),
    )
    .orderBy(asc(taxpayerProfiles.validFrom));

  const documentsOut: PeriodDocumentRow[] = docRows.map((d) => {
    const partner = d.partnerId ? partnerById.get(d.partnerId) : undefined;
    const snapshotDic = (d.partnerSnapshot as { dic?: unknown } | null)?.dic;
    const correctsId = correctsByDoc.get(d.id) ?? null;
    return {
      id: d.id,
      revision: d.revision,
      class: d.class,
      status: d.status,
      taxDocStatus: d.taxDocStatus,
      businessFlag: d.businessFlag,
      vatPointDate: d.vatPointDate,
      issueDate: d.issueDate,
      duzp: d.duzp,
      documentNumber: d.documentNumber,
      partner: partner
        ? {
            dic: partner.dic,
            vatId: partner.vatId,
            country: partner.country,
            vatIdValid: null, // TODO(P1-REG): no VIES flag column yet
            documentShowsDic: typeof snapshotDic === 'string' && snapshotDic.length > 0,
          }
        : null,
      correctsDocumentId: correctsId,
      correctsVatPointDate: correctsId ? (targetDate.get(correctsId) ?? null) : null,
      hasBlockingValidation: blocking.has(d.id),
      lines: lineRows
        .filter((l) => l.documentId === d.id)
        .map((l) => ({
          lineType: l.lineType,
          vatTreatment: l.vatTreatment,
          vatRateType: l.vatRateType,
          businessSharePct: l.businessSharePct,
          rcCommodityCode: l.rcCommodityCode,
          categoryCode: l.categoryCode,
          linkedIssuedInvoiceId: l.coveredByDocumentId,
        })),
    };
  });

  return {
    entries,
    documents: documentsOut,
    profiles: profileRows.map((p) => ({
      validFrom: p.validFrom,
      validTo: p.validTo,
      vatStatus: p.vatStatus,
      vatPeriod: p.vatPeriod,
      entityType: p.entityType,
      dic: p.dic,
      firstName: p.firstName,
      lastName: p.lastName,
      title: p.title,
      address: p.address,
      fuCode: p.fuCode,
      ufoCode: p.ufoCode,
      mainActivityNace: p.mainActivityNace,
      filingEmail: p.filingEmail,
      filingPhone: p.filingPhone,
      foreignServiceDppdPolicy: p.foreignServiceDppdPolicy,
    })),
    ledgerHash: ledgerHashOf(entries),
  };
}

export interface FilingRow {
  readonly id: string;
  readonly type: string;
  readonly kind: string;
  readonly origin: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly state: string;
  readonly amendsFilingId: string | null;
  readonly bundleId: string | null;
  readonly formVersion: string | null;
  readonly totals: unknown;
  readonly simpleCheck: unknown;
  readonly xmlPath: string | null;
  readonly pdfPath: string | null;
  readonly xlsxPath: string | null;
  readonly xsdValid: boolean | null;
  readonly xsdErrors: unknown;
  readonly generatedAt: string | null;
  readonly markedFiledAt: string | null;
  readonly filedOn: string | null;
  readonly submissionRef: string | null;
  readonly discoveredOn: string | null;
  readonly sourceDocumentId: string | null;
}
export interface FilingInsert {
  readonly orgId: string;
  readonly type: string;
  readonly kind: string;
  readonly origin?: 'generated' | 'imported';
  readonly sourceDocumentId?: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly state: string;
  readonly amendsFilingId?: string | null;
  readonly bundleId?: string | null;
  readonly formVersion?: string | null;
  readonly totals: unknown;
  readonly simpleCheck: unknown;
  readonly xmlPath?: string | null;
  readonly pdfPath?: string | null;
  readonly xlsxPath?: string | null;
  readonly xsdValid?: boolean | null;
  readonly xsdErrors?: unknown;
  readonly generatedAt?: Date | null;
  readonly generatedBy?: string | null;
  readonly discoveredOn?: string | null;
  readonly markedFiledAt?: Date | null;
  readonly filedOn?: string | null;
}

/** Snapshot row as stored in filing_entries (the snapshot has no period, buildVersion or FX columns). */
export interface FilingEntryRow {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly vatTreatment: string;
  readonly vatRateType: string;
  readonly dphdp3Rows: readonly string[];
  readonly khSection: string | null;
  readonly shvCode: number | null;
  readonly counterpartyVatId: string | null;
  readonly evidenceNumber: string | null;
  readonly vatPointDate: string;
  readonly baseCzk: string;
  readonly vatCzk: string;
}

const OPEN_FILING_STATES: FilingStateValue[] = ['draft', 'generated', 'downloaded'];

/** Marks open filings of (type, period, kind) superseded so a new row can take the slot. Returns the ids. */
export async function supersedeOpenFilings(
  tx: TenantTx,
  orgId: string,
  type: string,
  periodStart: string,
  kind: string,
): Promise<string[]> {
  const rows = await tx
    .update(filings)
    .set({ state: 'superseded' })
    .where(
      and(
        eq(filings.orgId, orgId),
        eq(filings.type, type as FilingTypeValue),
        eq(filings.periodStart, periodStart),
        eq(filings.kind, kind as FilingKindValue),
        inArray(filings.state, OPEN_FILING_STATES),
      ),
    )
    .returning({ id: filings.id });
  return rows.map((r) => r.id);
}

/** Inserts filings, filing_documents and filing_entries on the given transaction. */
export async function insertFiling(
  tx: TenantTx,
  filing: FilingInsert,
  documentRows: ReadonlyArray<{ documentId: string; revision: number }>,
  entries: readonly PeriodEntryRow[],
): Promise<string> {
  const [row] = await tx
    .insert(filings)
    .values({
      orgId: filing.orgId,
      type: filing.type as FilingTypeValue,
      kind: filing.kind as FilingKindValue,
      origin: (filing.origin ?? 'generated') as FilingOriginValue,
      sourceDocumentId: filing.sourceDocumentId ?? null,
      periodStart: filing.periodStart,
      periodEnd: filing.periodEnd,
      state: filing.state as FilingStateValue,
      amendsFilingId: filing.amendsFilingId ?? null,
      bundleId: filing.bundleId ?? null,
      formVersion: filing.formVersion ?? null,
      totals: filing.totals,
      simpleCheck: filing.simpleCheck,
      xmlPath: filing.xmlPath ?? null,
      pdfPath: filing.pdfPath ?? null,
      xlsxPath: filing.xlsxPath ?? null,
      xsdValid: filing.xsdValid ?? null,
      xsdErrors: filing.xsdErrors ?? null,
      generatedAt: filing.generatedAt ?? null,
      generatedBy: filing.generatedBy ?? null,
      discoveredOn: filing.discoveredOn ?? null,
      markedFiledAt: filing.markedFiledAt ?? null,
      filedOn: filing.filedOn ?? null,
    })
    .returning({ id: filings.id });
  if (!row) throw new Error('insertFiling: insert returned no row');
  const filingId = row.id;
  if (documentRows.length > 0) {
    await tx.insert(filingDocuments).values(
      documentRows.map((d) => ({
        filingId,
        orgId: filing.orgId,
        documentId: d.documentId,
        documentRevision: d.revision,
      })),
    );
  }
  if (entries.length > 0) {
    await tx.insert(filingEntries).values(
      entries.map(
        (e): FilingEntryInsert => ({
          filingId,
          orgId: filing.orgId,
          documentId: e.documentId,
          documentRevision: e.documentRevision,
          vatTreatment: e.vatTreatment as FilingEntryInsert['vatTreatment'],
          vatRateType: e.vatRateType as FilingEntryInsert['vatRateType'],
          dphdp3Rows: [...e.dphdp3Rows],
          khSection: e.khSection,
          shvCode: e.shvCode,
          counterpartyVatId: e.counterpartyVatId,
          evidenceNumber: e.evidenceNumber,
          vatPointDate: e.vatPointDate,
          baseCzk: e.baseCzk,
          vatCzk: e.vatCzk,
        }),
      ),
    );
  }
  return filingId;
}

function toFilingRow(r: FilingRecord): FilingRow {
  return {
    ...r,
    generatedAt: r.generatedAt?.toISOString() ?? null,
    markedFiledAt: r.markedFiledAt?.toISOString() ?? null,
  };
}

export async function readFiling(
  tx: TenantTx,
  orgId: string,
  filingId: string,
): Promise<FilingRow | null> {
  const [row] = await tx
    .select()
    .from(filings)
    .where(and(eq(filings.orgId, orgId), eq(filings.id, filingId)))
    .limit(1);
  return row ? toFilingRow(row) : null;
}

/** Newest generated_at first (drafts without generated_at last). */
export async function listFilings(
  tx: TenantTx,
  orgId: string,
  filter: { periodStart?: string; types?: readonly string[]; states?: readonly string[] },
): Promise<FilingRow[]> {
  const conditions = [eq(filings.orgId, orgId)];
  if (filter.periodStart !== undefined)
    conditions.push(eq(filings.periodStart, filter.periodStart));
  if (filter.types !== undefined && filter.types.length > 0) {
    conditions.push(inArray(filings.type, filter.types as FilingTypeValue[]));
  }
  if (filter.states !== undefined && filter.states.length > 0) {
    conditions.push(inArray(filings.state, filter.states as FilingStateValue[]));
  }
  const rows = await tx
    .select()
    .from(filings)
    .where(and(...conditions))
    .orderBy(sql`${filings.generatedAt} desc nulls last`);
  return rows.map(toFilingRow);
}

export async function readFilingEntries(
  tx: TenantTx,
  orgId: string,
  filingId: string,
): Promise<FilingEntryRow[]> {
  const rows = await tx
    .select()
    .from(filingEntries)
    .where(and(eq(filingEntries.orgId, orgId), eq(filingEntries.filingId, filingId)))
    .orderBy(asc(filingEntries.documentId));
  return rows.map((r) => ({
    documentId: r.documentId,
    documentRevision: r.documentRevision,
    vatTreatment: r.vatTreatment,
    vatRateType: r.vatRateType,
    dphdp3Rows: r.dphdp3Rows,
    khSection: r.khSection,
    shvCode: r.shvCode,
    counterpartyVatId: r.counterpartyVatId,
    evidenceNumber: r.evidenceNumber,
    vatPointDate: r.vatPointDate,
    baseCzk: r.baseCzk,
    vatCzk: r.vatCzk,
  }));
}

export async function setFilingState(
  tx: TenantTx,
  orgId: string,
  filingId: string,
  state: string,
  patch: {
    xmlPath?: string | null;
    pdfPath?: string | null;
    xlsxPath?: string | null;
    xsdValid?: boolean | null;
    xsdErrors?: unknown;
  } = {},
): Promise<boolean> {
  const rows = await tx
    .update(filings)
    .set({ ...patch, state: state as FilingStateValue })
    .where(and(eq(filings.orgId, orgId), eq(filings.id, filingId)))
    .returning({ id: filings.id });
  return rows.length > 0;
}

/** generated|downloaded → marked_filed. An opravne filing also supersedes the filing it amends. */
export async function markFilingFiled(
  tx: TenantTx,
  orgId: string,
  filingId: string,
  input: { filedOn: string; submissionRef?: string | null; at: Date },
): Promise<'ok' | 'not_found' | 'wrong_state'> {
  const [current] = await tx
    .select({ state: filings.state, kind: filings.kind, amendsFilingId: filings.amendsFilingId })
    .from(filings)
    .where(and(eq(filings.orgId, orgId), eq(filings.id, filingId)))
    .limit(1);
  if (!current) return 'not_found';
  if (current.state !== 'generated' && current.state !== 'downloaded') return 'wrong_state';
  await tx
    .update(filings)
    .set({
      state: 'marked_filed',
      markedFiledAt: input.at,
      filedOn: input.filedOn,
      submissionRef: input.submissionRef ?? null,
    })
    .where(and(eq(filings.orgId, orgId), eq(filings.id, filingId)));
  if (current.kind === 'opravne' && current.amendsFilingId) {
    await tx
      .update(filings)
      .set({ state: 'superseded' })
      .where(and(eq(filings.orgId, orgId), eq(filings.id, current.amendsFilingId)));
  }
  return 'ok';
}

/** Inserts or refreshes obligations. A user-done row keeps its state. filing_id is never touched. */
export async function upsertVatObligations(
  tx: TenantTx,
  orgId: string,
  drafts: readonly ObligationDraft[],
  generatorVersion: number,
): Promise<number> {
  if (drafts.length === 0) return 0;
  const rows = await tx
    .insert(obligations)
    .values(
      drafts.map((d) => ({
        orgId,
        kind: d.kind,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        legalDueDate: d.legalDueDate,
        dueDate: d.dueDate,
        amountEstimate: d.amountEstimate === null ? null : d.amountEstimate.toFixed2(),
        state: d.state,
        doneSource: d.doneSource,
        sourceRule: d.sourceRule,
        generatorVersion,
      })),
    )
    .onConflictDoUpdate({
      target: [obligations.orgId, obligations.kind, obligations.periodStart],
      set: {
        periodEnd: sql`excluded.period_end`,
        legalDueDate: sql`excluded.legal_due_date`,
        dueDate: sql`excluded.due_date`,
        amountEstimate: sql`excluded.amount_estimate`,
        state: sql`case when ${obligations.doneSource} = 'user' then ${obligations.state} else excluded.state end`,
        sourceRule: sql`excluded.source_rule`,
        generatorVersion: sql`excluded.generator_version`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: obligations.id });
  return rows.length;
}

/** Marks an obligation done by a filing, unless the user set it done. */
export async function completeObligation(
  tx: TenantTx,
  orgId: string,
  kind: string,
  periodStart: string,
  filingId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .update(obligations)
    .set({ state: 'done', doneAt: at, doneSource: 'filing', filingId, updatedAt: at })
    .where(
      and(
        eq(obligations.orgId, orgId),
        eq(obligations.kind, kind),
        eq(obligations.periodStart, periodStart),
        sql`${obligations.doneSource} is distinct from 'user'`,
      ),
    )
    .returning({ id: obligations.id });
  return rows.length > 0;
}

/** Refreshes the totals and the classifier result of an open amendment draft. */
export async function updateFilingTotals(
  tx: TenantTx,
  orgId: string,
  filingId: string,
  totals: unknown,
  simpleCheck: unknown,
): Promise<boolean> {
  const rows = await tx
    .update(filings)
    .set({ totals, simpleCheck })
    .where(and(eq(filings.orgId, orgId), eq(filings.id, filingId)))
    .returning({ id: filings.id });
  return rows.length > 0;
}

/** The (document, revision) pairs a filing was built from. */
export async function readFilingDocuments(
  tx: TenantTx,
  orgId: string,
  filingId: string,
): Promise<Array<{ documentId: string; revision: number }>> {
  const rows = await tx
    .select({
      documentId: filingDocuments.documentId,
      revision: filingDocuments.documentRevision,
    })
    .from(filingDocuments)
    .where(and(eq(filingDocuments.orgId, orgId), eq(filingDocuments.filingId, filingId)))
    .orderBy(asc(filingDocuments.documentId));
  return rows;
}

export interface AmendmentObligationInput {
  readonly kind: 'vat_amendment' | 'kh_nasledne';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueDate: string;
  /** Decimal string with 2 places, may be negative; null for KH. */
  readonly amountEstimate: string | null;
  readonly filingId: string;
  readonly sourceRule: string;
}

/** Opens (or refreshes) the amendment obligation. A user-done row keeps its state. */
export async function upsertAmendmentObligation(
  tx: TenantTx,
  orgId: string,
  input: AmendmentObligationInput,
  generatorVersion: number,
): Promise<void> {
  await tx
    .insert(obligations)
    .values({
      orgId,
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      legalDueDate: input.dueDate,
      dueDate: input.dueDate,
      amountEstimate: input.amountEstimate,
      state: 'open',
      sourceRule: input.sourceRule,
      generatorVersion,
      filingId: input.filingId,
    })
    .onConflictDoUpdate({
      target: [obligations.orgId, obligations.kind, obligations.periodStart],
      set: {
        periodEnd: sql`excluded.period_end`,
        legalDueDate: sql`excluded.legal_due_date`,
        dueDate: sql`excluded.due_date`,
        amountEstimate: sql`excluded.amount_estimate`,
        state: sql`case when ${obligations.doneSource} = 'user' then ${obligations.state} else 'open' end`,
        filingId: sql`excluded.filing_id`,
        sourceRule: sql`excluded.source_rule`,
        generatorVersion: sql`excluded.generator_version`,
        updatedAt: sql`now()`,
      },
    });
}
