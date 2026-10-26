import {
  type FilingRow,
  insertPodkladyFiling,
  latestPodkladyFiling,
  listFilings,
  organizations,
  readPodkladyRows,
  readReserveEstimate,
  setFilingState,
  type TenantDb,
  upsertReserveEstimate,
  upsertVatObligations,
} from '@shoebox/db';
import { createCzRules } from '@shoebox/domain';
import { createT, type MessageKey } from '@shoebox/i18n';
import {
  podkladyGenerateJob,
  podkladyReserveNightlyJob,
  podkladyReserveRefreshJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import { createSupabaseBlobStore, type Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import { createPodkladyGenerateHandler, type PodkladyDeps, type PodkladyStore } from './generate';
import { createReserveNightlyHandler, createReserveRefreshHandler } from './reserve';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function dbPodkladyStore(db: Pick<TenantDb, 'withServiceRole'>): PodkladyStore {
  return {
    readRows: readPodkladyRows,
    latestFiling: latestPodkladyFiling,
    listDrafts: (tx, orgId, year): Promise<FilingRow[]> =>
      listFilings(tx, orgId, {
        periodStart: `${year}-01-01`,
        types: ['PODKLADY_DPFO'],
        states: ['draft'],
      }),
    insertFiling: insertPodkladyFiling,
    setPaths: async (tx, orgId, filingId, paths) => {
      await setFilingState(tx, orgId, filingId, 'generated', paths);
    },
    readReserve: readReserveEstimate,
    upsertReserve: (orgId, row) =>
      db.withServiceRole('admin', (tx) => upsertReserveEstimate(tx, orgId, row)),
    upsertObligations: (tx, orgId, drafts) => upsertVatObligations(tx, orgId, drafts, 1),
    listActiveOrgIds: () =>
      db.withServiceRole('admin', async (tx) =>
        (
          await tx
            .select({ id: organizations.id, deletedAt: organizations.deletedAt })
            .from(organizations)
        )
          .filter((row) => row.deletedAt === null)
          .map((row) => row.id),
      ),
  };
}

export function registerPodkladyJobs(
  registry: Pick<JobRegistry, 'registerTenant' | 'registerSystem' | 'enqueue'>,
  db: Pick<TenantDb, 'withServiceRole'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'podklady jobs not registered');
    return false;
  }
  const t = createT('en');
  const deps: PodkladyDeps = {
    store: dbPodkladyStore(db),
    blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }),
    rules: createCzRules(),
    now: () => new Date(),
    appOrigin: new URL(env.APP_URL ?? 'http://localhost:3000').origin,
    translate: (key: string, params?: Record<string, string | number>) =>
      t(key as MessageKey, params),
    logger,
    enqueue: <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P) =>
      registry.enqueue(def, payload),
  };
  registry.registerTenant(podkladyGenerateJob, createPodkladyGenerateHandler(deps));
  registry.registerTenant(podkladyReserveRefreshJob, createReserveRefreshHandler(deps));
  registry.registerSystem(podkladyReserveNightlyJob, createReserveNightlyHandler(deps));
  logger.info({}, 'podklady jobs registered');
  return true;
}
