// doc.categorize.catchup (brief 0622): every 15 minutes, enqueue doc.categorize for documents that
// are ready or needs_review, have lines and were never categorized. The safety net behind the
// enqueue after a read (0621), manual entry and spreadsheet import. Ids only, never content.
import {
  type DocumentToCategorize,
  listDocumentsToCategorize,
  organizations,
  type TenantDb,
  type TenantTx,
} from '@shoebox/db';
import {
  docCategorizeCatchupJob,
  docCategorizeJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry, SystemHandler } from '../registry';

export const CATCHUP_LIMIT = 500;

export interface CategorizeCatchupDeps {
  readonly listOrgIds: () => Promise<string[]>;
  readonly withTenant: <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly enqueue: <P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    payload: P,
  ) => Promise<string | null>;
  readonly logger: Pick<Logger, 'info'>;
  readonly now?: () => number;
  readonly list?: (tx: TenantTx, orgId: string, limit: number) => Promise<DocumentToCategorize[]>;
}

export function createCategorizeCatchupHandler(
  deps: CategorizeCatchupDeps,
): SystemHandler<Record<string, never>> {
  const list = deps.list ?? listDocumentsToCategorize;
  return async () => {
    const nonce = (deps.now ?? Date.now)();
    const orgIds = await deps.listOrgIds();
    let enqueued = 0;
    for (const orgId of orgIds) {
      const docs = await deps.withTenant(orgId, (tx) => list(tx, orgId, CATCHUP_LIMIT));
      for (const doc of docs) {
        const id = await deps.enqueue(docCategorizeJob, {
          orgId,
          documentId: doc.id,
          revision: doc.revision,
          trigger: 'pipeline',
          nonce,
        });
        if (id !== null) enqueued += 1;
      }
    }
    deps.logger.info(
      { event: 'doc.categorize.catchup.done', orgs: orgIds.length, enqueued },
      'categorize catch-up finished',
    );
  };
}

export function registerCategorizeCatchup(
  registry: Pick<JobRegistry, 'registerSystem' | 'enqueue'>,
  db: Pick<TenantDb, 'withTenant' | 'withServiceRole'>,
  logger: Pick<Logger, 'info'>,
): void {
  registry.registerSystem(
    docCategorizeCatchupJob,
    createCategorizeCatchupHandler({
      listOrgIds: () =>
        db.withServiceRole('export', async (tx) =>
          (await tx.select({ id: organizations.id }).from(organizations)).map((row) => row.id),
        ),
      withTenant: (orgId, fn) => db.withTenant(orgId, fn),
      enqueue: (def, payload) => registry.enqueue(def, payload),
      logger,
    }),
  );
}
