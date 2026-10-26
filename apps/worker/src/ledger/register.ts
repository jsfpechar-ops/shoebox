import { organizations, type TenantDb } from '@shoebox/db';
import {
  ledgerRebuildDocumentJob,
  ledgerRebuildOrgJob,
  ledgerVerifyJob,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { JobRegistry } from '../registry';
import {
  createLedgerRebuildDocumentHandler,
  createLedgerRebuildOrgHandler,
  createLedgerVerifyHandler,
} from './handler';

export function registerLedgerJobs(
  registry: Pick<JobRegistry, 'registerTenant' | 'registerSystem' | 'enqueue'>,
  db: Pick<TenantDb, 'withTenant' | 'withServiceRole'>,
  logger: Pick<Logger, 'info' | 'warn'>,
): void {
  const enqueue = <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P) =>
    registry.enqueue(def, payload);
  const deps = { logger, enqueue };
  registry.registerTenant(ledgerRebuildDocumentJob, createLedgerRebuildDocumentHandler(deps));
  registry.registerTenant(ledgerRebuildOrgJob, createLedgerRebuildOrgHandler(deps));
  registry.registerSystem(
    ledgerVerifyJob,
    createLedgerVerifyHandler({
      ...deps,
      listOrgIds: () =>
        db.withServiceRole('export', async (tx) =>
          (await tx.select({ id: organizations.id }).from(organizations)).map((row) => row.id),
        ),
      withTenant: (orgId, fn) => db.withTenant(orgId, fn),
    }),
  );
}
