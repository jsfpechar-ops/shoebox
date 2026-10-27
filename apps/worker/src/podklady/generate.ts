// M06 §6 worker service: build the annual podklady (PDF + XLSX) for one org and year, idempotent per
// ledger hash and answers version. Never submits anything (AGENTS rule 8). Logs carry ids only:
// no amounts, no names.

import type {
  FilingRow,
  PodkladyFilingInsert,
  PodkladyRows,
  ReserveRow,
  TenantTx,
} from '@shoebox/db';
import {
  buildPodkladySummary,
  type CzRules,
  EMPTY_ANSWERS,
  type IncomeTaxObligationDraft,
  LEDGER_ALGO_VERSION,
  type PodkladyAnswers,
  podkladyAnswersSchema,
  pragueDateOf,
} from '@shoebox/domain';
import {
  buildPodkladyPdf,
  buildPodkladyXlsx,
  PDF_MIME,
  type Translate,
  XLSX_MIME,
} from '@shoebox/exports';
import type { PodkladyGeneratePayload, TenantJobDefinition } from '@shoebox/pipeline';
import { type BlobStore, blobPath, type Logger } from '@shoebox/platform';
import type { TenantHandler } from '../registry';

export type Enqueue = <P extends { orgId: string }>(
  def: TenantJobDefinition<P>,
  payload: P,
) => Promise<string | null>;

export interface PodkladyStore {
  readRows(
    tx: TenantTx,
    orgId: string,
    year: number,
    buildVersion: bigint,
    fxMaxLookbackDays: number,
  ): Promise<PodkladyRows>;
  latestFiling(tx: TenantTx, orgId: string, year: number): Promise<FilingRow | null>;
  listDrafts(tx: TenantTx, orgId: string, year: number): Promise<FilingRow[]>;
  insertFiling(
    tx: TenantTx,
    orgId: string,
    input: PodkladyFilingInsert,
    rows: PodkladyRows,
  ): Promise<{ filingId: string; supersededIds: string[] }>;
  setPaths(
    tx: TenantTx,
    orgId: string,
    filingId: string,
    paths: { pdfPath: string | null; xlsxPath: string | null },
  ): Promise<void>;
  readReserve(tx: TenantTx, orgId: string): Promise<ReserveRow | null>;
  /** Runs on the service role inside. */
  upsertReserve(orgId: string, row: Omit<ReserveRow, 'computedAt'>): Promise<void>;
  upsertObligations(
    tx: TenantTx,
    orgId: string,
    drafts: readonly IncomeTaxObligationDraft[],
  ): Promise<number>;
  listActiveOrgIds(): Promise<string[]>;
}

export interface PodkladyDeps {
  readonly store: PodkladyStore;
  readonly blobs: Pick<BlobStore, 'put'>;
  readonly rules: CzRules;
  readonly now: () => Date;
  readonly appOrigin: string;
  readonly translate: Translate;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly enqueue: Enqueue;
  /** Test seam; the default is the real PDF builder. */
  readonly pdf?: typeof buildPodkladyPdf;
}

export interface GenerateResult {
  readonly filingId: string | null;
  readonly created: boolean;
  readonly blocked: boolean;
  readonly pdfFailed: boolean;
}

const PDF_ATTEMPTS = 3;
const REUSABLE_STATES = ['generated', 'downloaded', 'marked_filed'];

interface StoredTotals {
  readonly ledgerHash?: unknown;
  readonly answersVersion?: unknown;
}

const totalsOf = (filing: FilingRow): StoredTotals => (filing.totals ?? {}) as StoredTotals;

/** The wizard answers of the draft that carries this answers version, else the empty answers. */
function answersFrom(drafts: readonly FilingRow[], answersVersion: number): PodkladyAnswers {
  const draft = drafts.find((d) => totalsOf(d).answersVersion === answersVersion);
  if (draft === undefined) return EMPTY_ANSWERS;
  const parsed = podkladyAnswersSchema.safeParse(draft.inputs);
  return parsed.success ? parsed.data : EMPTY_ANSWERS;
}

export async function generatePodklady(
  tx: TenantTx,
  orgId: string,
  payload: PodkladyGeneratePayload,
  deps: PodkladyDeps,
): Promise<GenerateResult> {
  const { store } = deps;
  const { year } = payload;
  const now = deps.now();
  const today = pragueDateOf(now.getTime());

  const rows = await store.readRows(
    tx,
    orgId,
    year,
    BigInt(LEDGER_ALGO_VERSION),
    deps.rules.at(`${year}-12-31`).get('fx.max_lookback_days'),
  );
  const latest = await store.latestFiling(tx, orgId, year);
  if (
    latest !== null &&
    REUSABLE_STATES.includes(latest.state) &&
    totalsOf(latest).ledgerHash === rows.ledgerHash &&
    totalsOf(latest).answersVersion === payload.answersVersion
  ) {
    return { filingId: latest.id, created: false, blocked: false, pdfFailed: false };
  }

  const answers = answersFrom(await store.listDrafts(tx, orgId, year), payload.answersVersion);
  const summary = buildPodkladySummary(
    {
      year,
      taxpayer: rows.taxpayer,
      profiles: rows.profiles,
      entries: rows.entries,
      assetLines: rows.assetLines,
      privateUse: rows.privateUse,
      vatFilings: rows.vatFilings,
      transactions: rows.transactions,
      readiness: rows.readiness,
      answers,
      partialXmlAvailable: false,
    },
    deps.rules,
    today,
  );
  if (summary.blocked) {
    deps.logger.info({ event: 'podklady.blocked', orgId, year }, 'podklady blocked');
    return { filingId: null, created: false, blocked: true, pdfFailed: false };
  }

  const build = deps.pdf ?? buildPodkladyPdf;
  let pdf: Uint8Array | null = null;
  for (let attempt = 1; attempt <= PDF_ATTEMPTS && pdf === null; attempt += 1) {
    try {
      pdf = await build(summary, deps.translate);
    } catch {
      pdf = null;
    }
  }
  const pdfFailed = pdf === null;
  if (pdfFailed) {
    deps.logger.warn({ event: 'podklady.pdf_failed', orgId, year }, 'podklady pdf failed');
  }
  const xlsx = buildPodkladyXlsx(
    summary,
    { appOrigin: deps.appOrigin, label: deps.translate },
    now,
  );

  const { filingId } = await store.insertFiling(
    tx,
    orgId,
    {
      year,
      totals: {
        ledgerHash: rows.ledgerHash,
        answersVersion: payload.answersVersion,
        regime: summary.regime,
        headline: {
          income: summary.headline.income.toFixed2(),
          expenses: summary.headline.expenses.toFixed2(),
          base: summary.headline.base.toFixed2(),
        },
        incomeTotal: summary.totals.incomeTotal.toFixed2(),
        deductibleTotal: summary.totals.deductibleTotal.toFixed2(),
        privatePart: summary.totals.privatePart.toFixed2(),
      },
      answers,
      answersVersion: payload.answersVersion,
      pdfPath: null,
      xlsxPath: null,
      generatedBy: payload.requestedBy,
      at: now,
    },
    rows,
  );

  let pdfPath: string | null = null;
  if (pdf !== null) {
    pdfPath = blobPath(orgId, 'filings', filingId, `podklady-${year}.pdf`);
    await deps.blobs.put(pdfPath, pdf, PDF_MIME);
  }
  const xlsxPath = blobPath(orgId, 'filings', filingId, `podklady-${year}.xlsx`);
  await deps.blobs.put(xlsxPath, xlsx, XLSX_MIME);
  await store.setPaths(tx, orgId, filingId, { pdfPath, xlsxPath });

  deps.logger.info(
    { event: 'podklady.generated', orgId, year, filingId, created: true },
    'podklady generated',
  );
  return { filingId, created: true, blocked: false, pdfFailed };
}

export function createPodkladyGenerateHandler(
  deps: PodkladyDeps,
): TenantHandler<PodkladyGeneratePayload> {
  return async (payload, ctx) => {
    await generatePodklady(ctx.tx, payload.orgId, payload, deps);
  };
}
