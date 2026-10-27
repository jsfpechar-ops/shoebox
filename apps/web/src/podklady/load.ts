// Podklady loaders (server only): rows through @shoebox/db readers inside withTenant, then pure builders.

import {
  latestPodkladyFiling,
  type PodkladyRows,
  readPodkladyRows,
  readReserveEstimate,
  readTaxpayerHeaderAt,
  type TaxpayerHeaderRow,
} from '@shoebox/db';
import {
  buildPodkladySummary,
  createCzRules,
  EMPTY_ANSWERS,
  LEDGER_ALGO_VERSION,
  type MemberRole,
  type PodkladySummary,
  pragueToday,
} from '@shoebox/domain';
import { isPartialXmlAvailable } from '@shoebox/tax-xml';
import { podkladyDb } from './db';
import { buildPodkladyPreview } from './preview';
import type { PodkladyPreviewView, TaxReserveView } from './view';
import { serializeMoney } from './view';

const clock = { now: (): number => Date.now() };

export function hasPodkladyData(rows: PodkladyRows): boolean {
  return rows.entries.length > 0;
}

function partialAvailable(year: number, rules: ReturnType<typeof createCzRules>): boolean {
  try {
    return isPartialXmlAvailable(year, rules);
  } catch {
    return false;
  }
}

async function loadCore(orgId: string, year: number) {
  const rules = createCzRules();
  const { rows, latest, profileAtYearEnd } = await podkladyDb().withTenant(orgId, async (tx) => ({
    rows: await readPodkladyRows(
      tx,
      orgId,
      year,
      BigInt(LEDGER_ALGO_VERSION),
      rules.at(`${year}-12-31`).get('fx.max_lookback_days'),
    ),
    latest: await latestPodkladyFiling(tx, orgId, year),
    profileAtYearEnd: await readTaxpayerHeaderAt(tx, orgId, `${year}-12-31`),
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
      partialXmlAvailable: partialAvailable(year, rules),
    },
    rules,
    pragueToday(clock),
  );
  return { summary, latest, ledgerHash: rows.ledgerHash, profileAtYearEnd };
}

/** Summary, ledger hash and the header profile of one year (used by the partial XML route). */
export async function loadPodkladySummary(
  orgId: string,
  year: number,
): Promise<{
  summary: PodkladySummary;
  ledgerHash: string;
  profileAtYearEnd: TaxpayerHeaderRow | null;
}> {
  const { summary, ledgerHash, profileAtYearEnd } = await loadCore(orgId, year);
  return { summary, ledgerHash, profileAtYearEnd };
}

/** The live preview of one year: summary and readiness are computed now, never stored. */
export async function loadPodkladyPreview(
  orgId: string,
  year: number,
  role: MemberRole,
): Promise<PodkladyPreviewView> {
  const { summary, latest, ledgerHash } = await loadCore(orgId, year);
  return buildPodkladyPreview(summary, latest, role, ledgerHash);
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
