import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orgColumnOf } from '../../src/rls-catalog';
import {
  buildRow,
  type Conn,
  cleanupTenants,
  DATABASE_URL,
  deleteCount,
  insertRow,
  ORG_A,
  ORG_B,
  pgCode,
  seedTenants,
  serviceSql,
  type Tenants,
  updateCount,
  visibleOrgs,
  workerUrlFrom,
} from './helpers';

// M12 §4.4 RLS test suite item 4 and §9 AC-3, for every tenant table of the catalog: as
// `app_worker` without `app.org_id` each table is empty; with `app.org_id = A` only A's rows are
// visible and writable. The worker connection is WORKER_DATABASE_URL or DATABASE_URL with the user
// replaced by `app_worker` (trust auth on the local cluster). withTenant() itself is covered by
// test/with-tenant.db.test.ts.
const ROLLBACK = Symbol('rollback');
/** Tenant tables keyed by org_id alone (05): the suite already seeds their only row per org. */
const ONE_ROW_PER_ORG: readonly string[] = ['tax_reserve_estimates'];

describe.skipIf(DATABASE_URL === undefined)(
  'RLS worker cases: app_worker × every tenant table',
  () => {
    const url = DATABASE_URL ?? '';
    let sql: Sql;
    let worker: Sql;
    let tenants: Tenants;

    /** Runs fn as app_worker with `app.org_id` = orgId (or unset) and rolls back. */
    async function asWorker<T>(orgId: string | null, fn: (tx: Conn) => Promise<T>): Promise<T> {
      let result: T | undefined;
      try {
        await worker.begin(async (tx) => {
          if (orgId !== null) {
            await tx`select set_config('app.org_id', ${orgId}, true)`;
          }
          result = await fn(tx);
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) {
          throw e;
        }
      }
      return result as T;
    }

    beforeAll(async () => {
      sql = serviceSql(url);
      tenants = await seedTenants(sql, url);
      worker = postgres(process.env.WORKER_DATABASE_URL ?? workerUrlFrom(url), {
        max: 1,
        onnotice: () => undefined,
      });
    });

    afterAll(async () => {
      await worker?.end();
      if (sql !== undefined) {
        await cleanupTenants(sql);
        await sql.end();
      }
    });

    it('connects as app_worker and the fixture has rows of both orgs in every tenant table', async () => {
      const [who] = await worker`select current_user as u`;
      expect(who?.u).toBe('app_worker');
      for (const table of tenants.tables) {
        expect(await visibleOrgs(sql, table), table).toEqual(
          expect.arrayContaining([ORG_A, ORG_B]),
        );
      }
    });

    it('without app.org_id every tenant table is empty, also after a tenant transaction ended', async () => {
      for (const table of tenants.tables) {
        expect(await visibleOrgs(worker, table), table).toEqual([]);
      }
      await asWorker(ORG_A, async (tx) => {
        expect(await visibleOrgs(tx, 'organizations')).toEqual([ORG_A]);
      });
      for (const table of tenants.tables) {
        const [row] = await worker`select app.current_org_id()::text as org`;
        expect(row?.org).toBeNull();
        expect(await visibleOrgs(worker, table), table).toEqual([]);
      }
    });

    it('with app.org_id = A only A rows are visible; B rows cannot be updated or deleted', async () => {
      for (const table of tenants.tables) {
        await asWorker(ORG_A, async (tx) => {
          expect(await visibleOrgs(tx, table), table).toEqual([ORG_A]);
          expect(await updateCount(tx, table, ORG_B), table).toBe(0);
          expect(await deleteCount(tx, table, ORG_B), table).toBe(0);
          expect(await updateCount(tx, table, ORG_A), table).toBeGreaterThanOrEqual(1);
        });
      }
    });

    it('with app.org_id = A an insert for org B raises 42501 and an insert for A succeeds', async () => {
      for (const table of tenants.tables) {
        const rowB = await buildRow(sql, table, tenants.ctx.B);
        const rowA = await buildRow(sql, table, tenants.ctx.A);
        if (table === 'organizations') {
          // The org row itself already exists; a fresh id is another org.
          rowB.id = '0000000b-0000-4000-8000-0000000000ff';
          rowB.inbound_email_slug = 'org-probe-b';
          rowA.id = '0000000a-0000-4000-8000-0000000000ff';
          rowA.inbound_email_slug = 'org-probe-a';
        }
        const codeB = await asWorker(ORG_A, (tx) => insertRow(tx, table, rowB)).then(
          () => null,
          pgCode,
        );
        expect(codeB, `${table}: insert for org B as worker of A`).toBe('42501');
        const codeA = await asWorker(ORG_A, async (tx) => {
          // One row per org (org_id is the key): replace the seeded row inside this rolled-back transaction.
          if (ONE_ROW_PER_ORG.includes(table)) {
            await tx`delete from ${tx(table)} where org_id = ${ORG_A}`;
          }
          await insertRow(tx, table, rowA);
        }).then(() => null, pgCode);
        // organizations: a new id is not app.current_org_id(), so even that insert is refused.
        expect(codeA, `${table}: insert for org A as worker of A`).toBe(
          orgColumnOf(table) === 'id' ? '42501' : null,
        );
      }
    });
  },
);
