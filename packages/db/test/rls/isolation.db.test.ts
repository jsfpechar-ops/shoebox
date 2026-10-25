import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ONLY_SELECT_TABLES } from '../../src/rls-catalog';
import {
  asUser,
  buildRow,
  cleanupTenants,
  DATABASE_URL,
  deleteCount,
  errorCodeAs,
  insertRow,
  ORG_A,
  ORG_B,
  ROLES,
  seedTenants,
  serviceSql,
  type Tenants,
  USERS,
  updateCount,
  visibleOrgs,
} from './helpers';

// M12 §4.4 RLS test suite item 2 (generated isolation cases) and §9 AC-3. For every tenant table
// of the catalog × every role of org A, run as `authenticated` with the JWT claims set: B's rows
// are invisible, an insert for org B raises 42501, update and delete of B's rows touch 0 rows.
// The fixture comes from the testkit factories; a table without a factory fails in beforeAll.

describe.skipIf(DATABASE_URL === undefined)(
  'RLS isolation: org A × org B for every tenant table and role',
  () => {
    const url = DATABASE_URL ?? '';
    let sql: Sql;
    let tenants: Tenants;

    beforeAll(async () => {
      sql = serviceSql(url);
      tenants = await seedTenants(sql, url);
    });

    afterAll(async () => {
      if (sql !== undefined) {
        await cleanupTenants(sql);
        await sql.end();
      }
    });

    it('the fixture has one factory row per org in every tenant table', async () => {
      expect(tenants.tables.length).toBeGreaterThanOrEqual(3);
      for (const table of tenants.tables) {
        expect(await visibleOrgs(sql, table), table).toEqual(
          expect.arrayContaining([ORG_A, ORG_B]),
        );
      }
    });

    it('an anonymous session sees no row of any tenant table', async () => {
      for (const table of tenants.tables) {
        expect(await asUser(sql, null, (tx) => visibleOrgs(tx, table)), table).toEqual([]);
      }
    });

    it('every role of org A sees only A rows (or none, where only the owner may select)', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const seen = await asUser(sql, USERS.A[role], (tx) => visibleOrgs(tx, table));
          const ownerOnly = role !== 'owner' && OWNER_ONLY_SELECT_TABLES.includes(table);
          const expected = ownerOnly ? [] : [ORG_A];
          expect(seen, `${table} as ${role} of A`).toEqual(expected);
        }
        expect(await asUser(sql, USERS.B.owner, (tx) => visibleOrgs(tx, table)), table).toEqual([
          ORG_B,
        ]);
      }
    });

    it('every role of org A gets 42501 on an insert for org B', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const row = await buildRow(sql, table, tenants.ctx.B);
          if (table === 'organizations') {
            row.id = '0000000b-0000-4000-8000-0000000000fe';
            row.inbound_email_slug = 'org-probe-iso';
          }
          const code = await errorCodeAs(sql, USERS.A[role], (tx) => insertRow(tx, table, row));
          expect(code, `${table}: insert for B as ${role} of A`).toBe('42501');
        }
      }
    });

    it('every role of org A updates and deletes 0 rows of org B', async () => {
      for (const table of tenants.tables) {
        for (const role of ROLES) {
          const counts = await asUser(sql, USERS.A[role], async (tx) => ({
            updated: await updateCount(tx, table, ORG_B),
            deleted: await deleteCount(tx, table, ORG_B),
          }));
          expect(counts, `${table} as ${role} of A`).toEqual({ updated: 0, deleted: 0 });
        }
      }
    });
  },
);
