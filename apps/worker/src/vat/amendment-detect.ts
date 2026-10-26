// M05 §4.11 vat.amendment.detect: after a ledger rebuild of a period with a marked_filed filing,
// recompute, diff against the filed snapshot and, when something changed, propose the amendment
// kind, open a draft amendment filing and an obligation. Nothing is generated or submitted here.
// Logs carry ids and counts only.

import {
  type FilingEntryRow,
  insertFiling,
  type PeriodEntryRow,
  readFilingDocuments,
  readFilingEntries,
  type TenantTx,
  updateFilingTotals,
  upsertAmendmentObligation,
} from '@shoebox/db';
import {
  chooseAmendmentKind,
  computeDphdp3,
  computeKh,
  computeShv,
  diffFilings,
  type FilingDiff,
  type FilingKind,
  type FilingSnapshot,
  isEmptyDiff,
  type LegalDate,
  monthAfter,
  parseLegalDate,
  periodEndOf,
  pragueDateOf,
  snapshotOfDphdp3,
  snapshotOfKh,
  snapshotOfShv,
} from '@shoebox/domain';
import { type VatAmendmentDetectPayload, vatWorkbookGenerateJob } from '@shoebox/pipeline';
import { z } from 'zod';
import type { TenantHandler } from '../registry';
import { khLookup, toEntryDraft } from './map';
import {
  type Computed,
  computePeriod,
  formInfo,
  resolve,
  stateChanged,
  type VatDeps,
} from './service';

export type DetectForm = 'DPHDP3' | 'DPHKH1' | 'DPHSHV';

export type DetectResult =
  | { readonly outcome: 'no_filing' | 'no_change' }
  | {
      readonly outcome: 'amendment_proposed';
      readonly form: DetectForm;
      readonly kind: FilingKind;
      readonly draftFilingId: string;
      readonly dueDate: LegalDate;
      readonly diff: FilingDiff;
    }
  | { readonly outcome: 'needs_accountant'; readonly reason: string };

/** The reads and writes the detector adds on top of VatStore. */
export interface AmendStore {
  readonly readFilingDocuments: typeof readFilingDocuments;
  readonly readFilingEntries: typeof readFilingEntries;
  readonly updateFilingTotals: typeof updateFilingTotals;
  readonly upsertAmendmentObligation: typeof upsertAmendmentObligation;
}

export const dbAmendStore: AmendStore = {
  readFilingDocuments,
  readFilingEntries,
  updateFilingTotals,
  upsertAmendmentObligation,
};

export type DetectDeps = VatDeps & {
  readonly today?: () => LegalDate;
  readonly amendStore?: AmendStore;
};

const AMENDMENT_SOURCE_RULE = 'm05.amendment.v1';
const AMENDMENT_GENERATOR_VERSION = 1;
const OPEN_STATES: readonly string[] = ['draft', 'generated', 'downloaded'];

const TotalsSchema = z.object({
  rows: z.record(z.string(), z.object({ base: z.number(), tax: z.number() })).default({}),
  row62: z.number().default(0),
  row63: z.number().default(0),
  row64: z.number().default(0),
  row65: z.number().default(0),
});

function docMap(
  rows: ReadonlyArray<{ documentId: string; revision: number }>,
): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.documentId, r.revision]));
}

function toPeriodEntry(e: FilingEntryRow, start: LegalDate, end: LegalDate): PeriodEntryRow {
  return {
    periodStart: start,
    periodEnd: end,
    vatPointDate: e.vatPointDate,
    vatPointRule: 'issue_date',
    lineId: null,
    vatTreatment: e.vatTreatment,
    vatRateType: e.vatRateType,
    vatRatePct: '0',
    baseCzk: e.baseCzk,
    vatCzk: e.vatCzk,
    deductionPct: '100',
    currency: 'CZK',
    baseForeign: null,
    fxRate: null,
    fxAmount: null,
    fxRateDate: null,
    dphdp3Rows: [...e.dphdp3Rows],
    khSection: e.khSection,
    khDocumentTotalCzk: null,
    shvCode: e.shvCode,
    counterpartyVatId: e.counterpartyVatId,
    evidenceNumber: e.evidenceNumber,
    documentId: e.documentId,
    documentRevision: e.documentRevision,
    buildVersion: '0',
  };
}

interface FiledFiling {
  readonly id: string;
  readonly type: DetectForm;
  readonly kind: FilingKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly totals: unknown;
}

async function filedSnapshot(
  tx: TenantTx,
  orgId: string,
  f: FiledFiling,
  computed: Computed,
  s: ReturnType<typeof resolve>,
  a: AmendStore,
): Promise<FilingSnapshot> {
  const meta = { kind: f.kind, periodStart: f.periodStart, periodEnd: f.periodEnd };
  const documents = docMap(await a.readFilingDocuments(tx, orgId, f.id));
  if (f.type === 'DPHDP3') {
    const t = TotalsSchema.parse(f.totals);
    const rows: Record<string, { base?: number; tax?: number }> = { ...t.rows };
    rows['62'] = { tax: t.row62 };
    rows['63'] = { tax: t.row63 };
    rows['64'] = { tax: t.row64 };
    rows['65'] = { tax: t.row65 };
    return { type: 'DPHDP3', ...meta, rows, documents, kh: {}, shv: {} };
  }
  const entries = (await a.readFilingEntries(tx, orgId, f.id))
    .map((e) => toPeriodEntry(e, f.periodStart, f.periodEnd))
    .map(toEntryDraft);
  if (f.type === 'DPHKH1') {
    const dp3 = computeDphdp3(entries, computed.status, s.rules, computed.period.start);
    return snapshotOfKh(computeKh(entries, dp3, khLookup(computed.ledger)), documents, meta);
  }
  return snapshotOfShv(computeShv(entries, s.rules, f.periodStart), documents, meta);
}

function nextSnapshot(f: FiledFiling, computed: Computed): FilingSnapshot | null {
  const { ledger } = computed;
  const meta = { kind: f.kind, periodStart: f.periodStart, periodEnd: f.periodEnd };
  const all = docMap(ledger.documents.map((d) => ({ documentId: d.id, revision: d.revision })));
  if (f.type === 'DPHDP3') {
    return computed.dp3 === null ? null : snapshotOfDphdp3(computed.dp3, all, meta);
  }
  if (f.type === 'DPHKH1') {
    return computed.kh === null ? null : snapshotOfKh(computed.kh, all, meta);
  }
  const month = f.periodStart.slice(0, 7);
  const sh = computed.shvByMonth.find((m) => m.monthStart === f.periodStart);
  const docIds = new Set(
    ledger.entries
      .filter((e) => e.shvCode !== null && e.vatPointDate.slice(0, 7) === month)
      .map((e) => e.documentId),
  );
  const docs = docMap(
    ledger.documents
      .filter((d) => docIds.has(d.id))
      .map((d) => ({ documentId: d.id, revision: d.revision })),
  );
  if (sh === undefined) {
    return { type: 'DPHSHV', ...meta, rows: {}, documents: docs, kh: {}, shv: {} };
  }
  return snapshotOfShv(sh, docs, meta);
}

function row64Of(s: FilingSnapshot): number {
  return s.rows['64']?.tax ?? 0;
}

export async function detectAmendments(
  tx: TenantTx,
  orgId: string,
  periodStart: LegalDate,
  deps: DetectDeps,
): Promise<DetectResult[]> {
  const c = resolve(deps);
  const a = deps.amendStore ?? dbAmendStore;
  const computed = await computePeriod(tx, orgId, periodStart, c);
  if ('skipped' in computed) return [{ outcome: 'no_filing' }];
  const { period, classifier } = computed;

  const starts: LegalDate[] = [period.start];
  for (let m = period.start; m <= period.end; m = monthAfter(m)) starts.push(m);
  const filed: FiledFiling[] = [];
  for (const start of new Set(starts)) {
    const rows = await c.store.listFilings(tx, orgId, {
      periodStart: start,
      types: ['DPHDP3', 'DPHKH1', 'DPHSHV'],
      states: ['marked_filed'],
    });
    for (const r of rows) {
      filed.push({
        id: r.id,
        type: r.type as DetectForm,
        kind: r.kind as FilingKind,
        periodStart: parseLegalDate(r.periodStart),
        periodEnd: parseLegalDate(r.periodEnd),
        totals: r.totals,
      });
    }
  }
  if (filed.length === 0) return [{ outcome: 'no_filing' }];

  const today = deps.today?.() ?? pragueDateOf(c.now());
  const results: DetectResult[] = [];
  let workbookQueued = false;
  const needsAccountant = async (filing: FiledFiling, reason: string): Promise<void> => {
    if (!workbookQueued) {
      workbookQueued = true;
      await c.enqueue(vatWorkbookGenerateJob, { orgId, periodStart: period.start });
    }
    c.logger.info(
      { event: 'filing.amendment_needs_accountant', orgId, filingId: filing.id, reason },
      'filing amendment needs accountant',
    );
    results.push({ outcome: 'needs_accountant', reason });
  };

  for (const f of filed) {
    const filedSnap = await filedSnapshot(tx, orgId, f, computed, c, a);
    const next = classifier.verdict === 'simple' ? nextSnapshot(f, computed) : null;
    if (next === null) {
      await needsAccountant(f, 'not_simple');
      continue;
    }
    const diff = diffFilings(filedSnap, next);
    if (isEmptyDiff(diff)) {
      results.push({ outcome: 'no_change' });
      continue;
    }
    const proposal = chooseAmendmentKind(filedSnap, next, today, c.rules);
    if (proposal.kind === 'needs_accountant') {
      await needsAccountant(f, proposal.reason);
      continue;
    }
    const totals = { ledgerHash: computed.ledgerHash, diff, proposal };
    const existing = (
      await c.store.listFilings(tx, orgId, { periodStart: f.periodStart, types: [f.type] })
    ).find((r) => r.kind === proposal.kind && OPEN_STATES.includes(r.state));
    let draftFilingId: string;
    if (existing !== undefined) {
      draftFilingId = existing.id;
      if (existing.state === 'draft') {
        await a.updateFilingTotals(tx, orgId, existing.id, totals, classifier);
      }
    } else {
      draftFilingId = await c.store.insertFiling(
        tx,
        {
          orgId,
          type: f.type,
          kind: proposal.kind,
          periodStart: f.periodStart,
          periodEnd: f.periodEnd,
          state: 'draft',
          amendsFilingId: f.id,
          formVersion: `${f.type} ${formInfo(c.rules, f.type, f.periodStart).version}`,
          totals,
          simpleCheck: classifier,
          discoveredOn: proposal.discoveredOn,
        },
        [],
        [],
      );
      stateChanged(c, draftFilingId, null, 'draft');
    }
    if (f.type !== 'DPHSHV') {
      await a.upsertAmendmentObligation(
        tx,
        orgId,
        {
          kind: f.type === 'DPHDP3' ? 'vat_amendment' : 'kh_nasledne',
          periodStart: f.periodStart,
          periodEnd: periodEndOf(f.periodStart, period.kind),
          dueDate: proposal.dueDate,
          amountEstimate:
            f.type === 'DPHDP3' ? `${(row64Of(next) - row64Of(filedSnap)).toString()}.00` : null,
          filingId: draftFilingId,
          sourceRule: AMENDMENT_SOURCE_RULE,
        },
        AMENDMENT_GENERATOR_VERSION,
      );
    }
    c.logger.info(
      {
        event: 'filing.amendment_needed',
        orgId,
        filingId: draftFilingId,
        amendsFilingId: f.id,
        form: f.type,
        kind: proposal.kind,
      },
      'filing amendment needed',
    );
    results.push({
      outcome: 'amendment_proposed',
      form: f.type,
      kind: proposal.kind,
      draftFilingId,
      dueDate: proposal.dueDate,
      diff,
    });
  }
  return results;
}

export function createVatAmendmentDetectHandler(
  deps: VatDeps,
): TenantHandler<VatAmendmentDetectPayload> {
  return async (payload, ctx) => {
    const results = await detectAmendments(
      ctx.tx,
      payload.orgId,
      parseLegalDate(payload.periodStart),
      deps,
    );
    deps.logger.info(
      {
        event: 'vat.amendment.detect.done',
        orgId: payload.orgId,
        periodStart: payload.periodStart,
        outcomes: results.map((r) => r.outcome),
      },
      'vat.amendment.detect done',
    );
  };
}
