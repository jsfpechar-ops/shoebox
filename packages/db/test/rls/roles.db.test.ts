import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNTANT_WRITABLE,
  NO_USER_INSERT,
  OWNER_ONLY_TABLES,
  READ_ONLY_FOR_USERS,
} from '../../src/rls-catalog';
import {
  asUser,
  buildRow,
  cleanupTenants,
  DATABASE_URL,
  deleteCount,
  errorCodeAs,
  insertRow,
  ORG_A,
  type Role,
  seedTenants,
  serviceSql,
  type Tenants,
  USERS,
  updateCount,
} from './helpers';

// M12 §4.4 RLS test suite item 3 (role cases) for every tenant table of the catalog, inside org A:
// a viewer writes nothing; an accountant writes only the ACCOUNTANT_WRITABLE tables (their
// column rules are tested by the slice that adds them); a member writes everything except the
// OWNER_ONLY_TABLES; nobody but the worker writes READ_ONLY_FOR_USERS tables; the owner writes
// every table a user may write. 42501 = insufficient_privilege (RLS with check).

/** What the role matrix (M12 §4.4, 05 §10.2) says this role may do with this table. */
function mayWrite(table: string, role: Role): boolean {
  if (READ_ONLY_FOR_USERS.includes(table)) {
    return false;
  }
  switch (role) {
    case 'owner':
      return true;
    case 'member':
      return !OWNER_ONLY_TABLES.includes(table);
    case 'accountant':
      return ACCOUNTANT_WRITABLE.includes(table);
    case 'viewer':
      return false;
  }
}

describe.skipIf(DATABASE_URL === undefined)(
  'RLS role cases: owner, member, accountant, viewer of org A',
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

    it('mayWrite follows 05 §10.2 for the tenancy tables', () => {
      expect(mayWrite('organizations', 'owner')).toBe(true);
      expect(mayWrite('memberships', 'member')).toBe(false);
      expect(mayWrite('taxpayer_profiles', 'accountant')).toBe(false);
      expect(mayWrite('taxpayer_profiles', 'viewer')).toBe(false);
      expect(mayWrite('comments', 'accountant')).toBe(true);
      expect(mayWrite('ingest_items', 'owner')).toBe(false);
    });

    it('a viewer cannot insert, update or delete in any tenant table', async () => {
      for (const table of tenants.tables) {
        const row = await buildRow(sql, table, tenants.ctx.A);
        expect(
          await errorCodeAs(sql, USERS.A.viewer, (tx) => insertRow(tx, table, row)),
          `${table}: insert as viewer`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.viewer, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as viewer`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('an accountant writes only the ACCOUNTANT_WRITABLE tables', async () => {
      for (const table of tenants.tables.filter((t) => !ACCOUNTANT_WRITABLE.includes(t))) {
        const row = await buildRow(sql, table, tenants.ctx.A);
        expect(
          await errorCodeAs(sql, USERS.A.accountant, (tx) => insertRow(tx, table, row)),
          `${table}: insert as accountant`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.accountant, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as accountant`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('an accountant updates only answer, answered_by, answered_at of review_questions (05 §10.2)', async () => {
      expect(tenants.tables).toContain('review_questions');
      expect(mayWrite('extraction_runs', 'owner')).toBe(false);
      const uid = USERS.A.accountant;
      const answered = await asUser(
        sql,
        uid,
        (tx) => tx`update review_questions set answer = '{"confirmed": true}',
          answered_by = ${uid}, answered_at = now() where org_id = ${ORG_A} returning id`,
      );
      expect(answered.length, 'accountant answers').toBeGreaterThanOrEqual(1);
      for (const change of ["kind = 'other'", "payload = '{}'", 'document_id = null']) {
        expect(
          await errorCodeAs(sql, uid, (tx) =>
            tx.unsafe(`update review_questions set ${change} where org_id = '${ORG_A}'`),
          ),
          `accountant sets ${change}`,
        ).toBe('42501');
      }
      const row = await buildRow(sql, 'review_questions', tenants.ctx.A);
      expect(await errorCodeAs(sql, uid, (tx) => insertRow(tx, 'review_questions', row))).toBe(
        '42501',
      );
      expect(await asUser(sql, uid, (tx) => deleteCount(tx, 'review_questions', ORG_A))).toBe(0);
      const owner = await asUser(
        sql,
        USERS.A.owner,
        (tx) => tx`update review_questions set kind = 'other' where org_id = ${ORG_A} returning id`,
      );
      expect(owner.length, 'owner changes kind').toBeGreaterThanOrEqual(1);
    });

    it('a member cannot write organizations, memberships or taxpayer_profiles (05 §10.2)', async () => {
      for (const table of ['organizations', 'memberships', 'taxpayer_profiles']) {
        expect(tenants.tables, table).toContain(table);
        const row = await buildRow(sql, table, tenants.ctx.A);
        if (table === 'organizations') {
          row.id = '0000000a-0000-4000-8000-0000000000fd';
          row.inbound_email_slug = 'org-probe-member';
        }
        expect(
          await errorCodeAs(sql, USERS.A.member, (tx) => insertRow(tx, table, row)),
          `${table}: insert as member`,
        ).toBe('42501');
        const counts = await asUser(sql, USERS.A.member, async (tx) => ({
          updated: await updateCount(tx, table, ORG_A),
          deleted: await deleteCount(tx, table, ORG_A),
        }));
        expect(counts, `${table} as member`).toEqual({ updated: 0, deleted: 0 });
      }
    });

    it('owner and member insert, update and delete exactly where the role matrix allows', async () => {
      for (const table of tenants.tables) {
        for (const role of ['owner', 'member'] as const) {
          const allowed = mayWrite(table, role);
          const row = await buildRow(sql, table, tenants.ctx.A);
          if (!NO_USER_INSERT.includes(table)) {
            const code = await errorCodeAs(sql, USERS.A[role], (tx) => insertRow(tx, table, row));
            expect(code, `${table}: insert as ${role}`).toBe(allowed ? null : '42501');
          }
          const counts = await asUser(sql, USERS.A[role], async (tx) => {
            if (table === 'documents') {
              // A filed return keeps its evidence: filing rows reference documents without cascade
              // (05 §8). Clear them as the service role inside this rolled-back transaction.
              await tx`reset role`;
              await tx`delete from filing_entries where org_id = ${ORG_A}`;
              await tx`delete from filing_documents where org_id = ${ORG_A}`;
              await tx`set local role authenticated`;
            }
            return {
              updated: await updateCount(tx, table, ORG_A),
              deleted: await deleteCount(tx, table, ORG_A),
            };
          });
          if (allowed) {
            expect(counts.updated, `${table}: update as ${role}`).toBeGreaterThanOrEqual(1);
            expect(counts.deleted, `${table}: delete as ${role}`).toBeGreaterThanOrEqual(1);
          } else {
            expect(counts, `${table} as ${role}`).toEqual({ updated: 0, deleted: 0 });
          }
        }
      }
    });
  },
);
