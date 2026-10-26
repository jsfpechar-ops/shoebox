import { createTenantDb, organizations, type TenantDb } from '@shoebox/db';
import { runMigrations } from '@shoebox/db/migrate';
import { defineTenantJob, documentStagePayload } from '@shoebox/pipeline';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobRegistry, type JobRegistry, jobIdFromKey } from '../src/registry';

// Runs in the `db` vitest project against DATABASE_URL (local-pg.sh or Supabase CLI). pg-boss
// uses the service connection and its own schema `pgboss_test`; handlers run as `app_worker`
// (WORKER_DATABASE_URL, or DATABASE_URL with the user replaced by app_worker on the trust-auth
// cluster). Skipped without DATABASE_URL. Cleans its own queues and rows.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_E = 'eeeeeeee-0000-4000-8000-000000000005';
const ORG_F = 'ffffffff-0000-4000-8000-000000000006';
const DOC_1 = '11111111-0000-4000-8000-0000000000d1';
const DOC_2 = '22222222-0000-4000-8000-0000000000d2';
const DOC_3 = '33333333-0000-4000-8000-0000000000d3';
const QUEUES = [
  'doc.classify',
  'doc.classify.dlq',
  'doc.extract',
  'doc.extract.dlq',
  'doc.split',
  'doc.split.dlq',
];

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const classify = defineTenantJob({
  name: 'doc.classify',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});
const extract = defineTenantJob({
  name: 'doc.extract',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
  // Same attempt count as production (retryLimit 4 = 5 attempts), no delay so the test is fast.
  retry: { retryDelaySeconds: 0, retryBackoff: false },
});
const split = defineTenantJob({
  name: 'doc.split',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});

describe.skipIf(DATABASE_URL === undefined)('worker registry on pg-boss', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let db: TenantDb;
  let boss: PgBoss;
  let registry: JobRegistry;
  let extractAttempts = 0;
  const seenBySplit: { orgId: string; orgs: string[] }[] = [];

  beforeAll(async () => {
    await runMigrations(serviceUrl);
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 2 },
    );
    await db.withServiceRole('admin', (tx) =>
      tx
        .insert(organizations)
        .values([
          { id: ORG_E, name: 'Org E', inboundEmailSlug: 'org-e', inboundEmailSecret: 'EEEEEEEE' },
          { id: ORG_F, name: 'Org F', inboundEmailSlug: 'org-f', inboundEmailSecret: 'FFFFFFFF' },
        ])
        .onConflictDoNothing(),
    );
    boss = new PgBoss({ connectionString: serviceUrl, schema: 'pgboss_test', max: 3 });
    boss.on('error', () => undefined);
    await boss.start();
    for (const name of QUEUES) await boss.deleteQueue(name);
    registry = createJobRegistry({
      boss,
      db,
      logger: { info: () => undefined, warn: () => undefined },
      pollingIntervalSeconds: 0.5,
    });
    registry.registerTenant(extract, async () => {
      extractAttempts += 1;
      throw new Error('always fails');
    });
    registry.registerTenant(split, async (payload, { tx }) => {
      const rows = await tx.select({ id: organizations.id }).from(organizations);
      seenBySplit.push({ orgId: payload.orgId, orgs: rows.map((r) => r.id) });
    });
    await registry.start();
  }, 30_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    const cleanup = new PgBoss({ connectionString: serviceUrl, schema: 'pgboss_test', max: 1 });
    cleanup.on('error', () => undefined);
    await cleanup.start();
    for (const name of QUEUES) await cleanup.deleteQueue(name);
    await cleanup.stop({ graceful: false });
    // As app_worker inside withTenant a bare delete removes only that org's row.
    for (const orgId of [ORG_E, ORG_F]) {
      await db?.withTenant(orgId, (tx) => tx.delete(organizations));
    }
    await db?.close();
  }, 30_000);

  it('the same idempotency key enqueued twice gives one job', async () => {
    const payload = { orgId: ORG_E, documentId: DOC_1 };
    const first = await registry.enqueue(classify, payload);
    const second = await registry.enqueue(classify, payload);
    expect(first).toBe(jobIdFromKey(`${ORG_E}:doc.classify:${DOC_1}:1`));
    expect(second).toBeNull();
    const jobs = await boss.findJobs('doc.classify', { key: `${ORG_E}:doc.classify:${DOC_1}:1` });
    expect(jobs).toHaveLength(1);
    const other = await registry.enqueue(classify, { orgId: ORG_F, documentId: DOC_1 });
    expect(other).not.toBeNull();
    expect(await boss.findJobs('doc.classify')).toHaveLength(2);
  });

  it('a payload with a non-id field is rejected and nothing is queued', async () => {
    await expect(
      registry.enqueue(classify, { orgId: ORG_E, documentId: DOC_2, note: 'x' } as never),
    ).rejects.toThrow();
    expect(await boss.findJobs('doc.classify', { data: { documentId: DOC_2 } })).toHaveLength(0);
  });

  it('5 failed attempts move the job to doc.extract.dlq', async () => {
    const payload = { orgId: ORG_E, documentId: DOC_3 };
    const id = await registry.enqueue(extract, payload);
    expect(id).not.toBeNull();
    const dead = await waitFor(async () => {
      const jobs = await boss.findJobs('doc.extract.dlq');
      return jobs.length > 0 ? jobs : undefined;
    });
    expect(dead).toHaveLength(1);
    expect(dead[0]?.data).toEqual(payload);
    expect(extractAttempts).toBe(5);
    const [original] = await boss.findJobs('doc.extract', { id: id ?? '' });
    expect(original?.state).toBe('failed');
  }, 20_000);

  it('the handler receives a tenant transaction that sees only its own org', async () => {
    await registry.enqueue(split, { orgId: ORG_E, documentId: DOC_1 });
    await registry.enqueue(split, { orgId: ORG_F, documentId: DOC_1 });
    await waitFor(async () => (seenBySplit.length >= 2 ? true : undefined));
    const byOrg = Object.fromEntries(seenBySplit.map((s) => [s.orgId, s.orgs]));
    expect(byOrg[ORG_E]).toEqual([ORG_E]);
    expect(byOrg[ORG_F]).toEqual([ORG_F]);
  }, 20_000);
});
