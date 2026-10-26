// Tenant database for the podklady routes (server only). The readers of @shoebox/db run inside
// withTenant(orgId), so the org comes from requireActiveRole and RLS (app.org_id) applies.
import { createTenantDb, type TenantDb } from '@shoebox/db';

let tenantDb: TenantDb | undefined;

export function podkladyDb(): TenantDb {
  if (tenantDb === undefined) {
    const workerUrl = process.env.WORKER_DATABASE_URL;
    const serviceUrl = process.env.DATABASE_URL;
    if (!workerUrl) throw new Error('WORKER_DATABASE_URL is not set');
    // The service pool is never used here; postgres.js connects lazily.
    tenantDb = createTenantDb({ workerUrl, serviceUrl: serviceUrl ?? workerUrl }, { max: 2 });
  }
  return tenantDb;
}
