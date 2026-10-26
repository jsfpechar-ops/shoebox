// Podklady loaders (server only): rows through @shoebox/db readers inside withTenant, then pure builders.

import {
  latestPodkladyFiling,
  type PodkladyRows,
  readPodkladyRows,
  readReserveEstimate,
} from '@shoebox/db';
import {
  buildPodkladySummary,
  createCzRules,
  EMPTY_ANSWERS,
  LEDGER_ALGO_VERSION,
  type MemberRole,
  pragueToday,
} from '@shoebox/domain';
import { podkladyDb } from './db';
import { buildPodkladyPreview } from './preview';
import type { PodkladyPreviewView, TaxReserveView } from './view';
import { serializeMoney } from './view';

const clock = { now: (): number => Date.now() };

export function hasPodkladyData(rows: PodkladyRows): boolean {
  return rows.entries.length > 0;
}

/** The live preview of one year: summary and readiness are computed now, never stored. */
export async function loadPodkladyPreview(
  orgId: string,
  year: number,
  role: MemberRole,
): Promise<PodkladyPreviewView> {
  const { rows, latest } = await podkladyDb().withTenant(orgId, async (tx) => ({
    rows: await readPodkladyRows(tx, orgId, year, BigInt(LEDGER_ALGO_VERSION)),
    latest: await latestPodkladyFiling(tx, orgId, year),
  }));
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
      answers: EMPTY_ANSWERS,
      partialXmlAvailable: false, // TODO(0367): isPartialXmlAvailable(year) once the web app may import @shoebox/tax-xml
    },
    createCzRules(),
    pragueToday(clock),
  );
  return buildPodkladyPreview(summary, latest, role, rows.ledgerHash);
}

const NONE: TaxReserveView = {
  kind: 'none',
  asOf: null,
  computedAt: null,
  display: null,
  paid: null,
  due: null,
  labelKey: 'reserve.label',
  badgeKey: 'reserve.badge',
  howKey: 'reserve.how',
  payload: null,
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The cached tax-reserve estimate (written by the worker); `none` when there is no row. */
export async function loadTaxReserve(orgId: string): Promise<TaxReserveView> {
  const row = await podkladyDb().withTenant(orgId, (tx) => readReserveEstimate(tx, orgId));
  if (row === null) return NONE;
  const payload = serializeMoney(row.payload) as Record<string, unknown> | null;
  const base = {
    asOf: row.asOf,
    computedAt: row.computedAt.toISOString(),
    badgeKey: 'reserve.badge',
    howKey: 'reserve.how',
    payload,
  } as const;
  if (row.kind === 'pausalni_dan') {
    return {
      ...base,
      kind: 'pausalni_dan',
      display: null,
      paid: text(payload?.paid),
      due: text(payload?.dueYtd),
      labelKey: 'reserve.pausalni_dan',
    };
  }
  return {
    ...base,
    kind: 'estimate',
    display: text(payload?.display),
    paid: null,
    due: null,
    labelKey: 'reserve.label',
  };
}
