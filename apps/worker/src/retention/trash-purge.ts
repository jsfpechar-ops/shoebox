// retention.trash_purge (M12 §4.6): batches of app.purge_trash on the service connection; the
// Storage delete runs inside the transaction, so a failed delete rolls the batch back for a retry.
import { purgeTrash, type ServiceTx, type TenantDb, type TrashPurge } from '@shoebox/db';
import { pragueToday } from '@shoebox/domain';
import { retentionTrashPurgeJob } from '@shoebox/pipeline';
import { type BlobStore, createSupabaseBlobStore, type Logger, orgIdOfPath } from '@shoebox/platform';
import type { JobRegistry, SystemHandler } from '../registry';

export const TRASH_DAYS = 30;
const BATCH = 200;
const MAX_BATCHES = 50;

export interface TrashPurgeDeps {
  readonly db: Pick<TenantDb, 'withServiceRole'>;
  readonly blobs: Pick<BlobStore, 'delete'>;
  readonly logger: Pick<Logger, 'info'>;
  readonly now?: () => number;
  readonly purge?: (tx: ServiceTx, cutoff: Date, today: string, limit: number) => Promise<TrashPurge>;
}

export function createTrashPurgeHandler(deps: TrashPurgeDeps): SystemHandler<Record<string, never>> {
  const purge = deps.purge ?? purgeTrash;
  return async () => {
    const now = deps.now?.() ?? Date.now();
    const cutoff = new Date(now - TRASH_DAYS * 86_400_000);
    const today = pragueToday({ now: () => now });
    let documents = 0;
    let objects = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const result = await deps.db.withServiceRole('retention', async (tx) => {
        const r = await purge(tx, cutoff, today, BATCH);
        const paths = r.paths.filter((path) => orgIdOfPath(path) !== null);
        if (paths.length > 0) await deps.blobs.delete(paths);
        return { documents: r.documents, objects: paths.length };
      });
      documents += result.documents;
      objects += result.objects;
      if (result.documents < BATCH) break;
    }
    deps.logger.info({ documents, objects }, 'retention.trash_purge done');
  };
}

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function registerTrashPurge(
  registry: Pick<JobRegistry, 'registerSystem'>,
  db: Pick<TenantDb, 'withServiceRole'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    logger.warn({ missing: REQUIRED.filter((name) => !env[name]) }, 'retention.trash_purge not registered');
    return false;
  }
  registry.registerSystem(
    retentionTrashPurgeJob,
    createTrashPurgeHandler({ db, blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }), logger }),
  );
  return true;
}
