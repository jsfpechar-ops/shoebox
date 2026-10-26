// M06 §4.11, §4.12 worker: the tax-reserve estimate cache and the income-tax obligations of one org.
// Debounce: the registry has no 60 s option, so the entity id `reserve-{reason}` dedupes queued jobs.
// Logs carry ids and counts only.

import type { TenantTx } from '@shoebox/db';
import {
  buildPodkladySummary,
  CZK,
  computeTaxReserve,
  EMPTY_ANSWERS,
  incomeTaxObligationsFor,
  LEDGER_ALGO_VERSION,
  type LegalDate,
  Money,
  type ProfileSegment,
  pragueDateOf,
} from '@shoebox/domain';
import {
  type PodkladyReserveNightlyPayload,
  type PodkladyReserveRefreshPayload,
  podkladyReserveRefreshJob,
} from '@shoebox/pipeline';
import type { SystemHandler, TenantHandler } from '../registry';
import type { PodkladyDeps } from './generate';

export interface RefreshResult {
  readonly kind: 'estimate' | 'pausalni_dan' | 'none';
  readonly obligations: number;
}

/** Money to a decimal string, anywhere in the tree (Money has toJSON, so the raw value is read from `this`). */
export function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
      const raw = this[key];
      return raw instanceof Money ? raw.toFixed2() : v;
    }),
  );
}

const covering = (segments: readonly ProfileSegment[], date: LegalDate): ProfileSegment | null =>
  segments.find((s) => s.validFrom <= date && (s.validTo === null || s.validTo >= date)) ?? null;

export async function refreshReserve(
  tx: TenantTx,
  orgId: string,
  reason: PodkladyReserveRefreshPayload['reason'],
  deps: PodkladyDeps,
): Promise<RefreshResult> {
  const { store } = deps;
  const today = pragueDateOf(deps.now().getTime());
  const year = Number.parseInt(today.slice(0, 4), 10);
  const rows = await store.readRows(tx, orgId, year, BigInt(LEDGER_ALGO_VERSION));
  const segment = covering(rows.profiles, today);
  if (segment === null) {
    deps.logger.info(
      { event: 'podklady.reserve.refreshed', orgId, reason, kind: 'none' },
      'reserve',
    );
    return { kind: 'none', obligations: 0 };
  }

  const estimate = computeTaxReserve(
    {
      year,
      regime: segment.taxRegime,
      pausalRate: segment.pausalRate,
      pausalDanBand: segment.pausalDanBand,
      entries: rows.entries,
      payments: rows.transactions,
    },
    deps.rules,
    today,
  );
  if (estimate !== null) {
    await store.upsertReserve(orgId, {
      asOf: today,
      taxYear: year,
      kind: estimate.kind,
      payload: serialize(estimate),
      ledgerHash: rows.ledgerHash,
    });
  }

  // The summary carries the paušální daň return check and the year's income total (empty answers).
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
      partialXmlAvailable: false,
    },
    deps.rules,
    today,
  );
  const maxIncome = deps.rules.at(today).get('pausalni_dan.eligibility').max_income;
  const inYear = rows.profiles.filter(
    (s) => s.validFrom <= `${year}-12-31` && (s.validTo === null || s.validTo >= `${year}-01-01`),
  );
  const drafts = incomeTaxObligationsFor(
    {
      year,
      profiles: rows.profiles,
      advances: rows.transactions
        .filter((t) => t.categoryCode === 'tax_pausal_advance' && t.bookedOn.startsWith(`${year}-`))
        .map((t) => ({ bookedOn: t.bookedOn, amount: t.amount })),
      pausalniDanReturnRequired: summary.pausalniDan?.returnRequired ?? false,
      eligibleForEntry:
        segment.taxRegime !== 'pausalni_dan' &&
        !inYear.some((s) => s.vatStatus === 'platce') &&
        summary.totals.incomeTotal.compare(Money.parse(String(maxIncome), CZK)) <= 0,
    },
    today,
    deps.rules,
  );
  const obligations = await store.upsertObligations(tx, orgId, drafts);
  deps.logger.info(
    {
      event: 'podklady.reserve.refreshed',
      orgId,
      reason,
      kind: estimate?.kind ?? 'none',
      obligations,
    },
    'reserve refreshed',
  );
  return { kind: estimate?.kind ?? 'none', obligations };
}

export function createReserveRefreshHandler(
  deps: PodkladyDeps,
): TenantHandler<PodkladyReserveRefreshPayload> {
  return async (payload, ctx) => {
    await refreshReserve(ctx.tx, payload.orgId, payload.reason, deps);
  };
}

export function createReserveNightlyHandler(
  deps: PodkladyDeps,
): SystemHandler<PodkladyReserveNightlyPayload> {
  return async () => {
    const orgIds = await deps.store.listActiveOrgIds();
    for (const orgId of orgIds) {
      await deps.enqueue<PodkladyReserveRefreshPayload>(podkladyReserveRefreshJob, {
        orgId,
        reason: 'nightly',
        nonce: Date.now(),
      });
    }
    deps.logger.info(
      { event: 'podklady.reserve.nightly', orgs: orgIds.length },
      'reserve refresh fanned out',
    );
  };
}
