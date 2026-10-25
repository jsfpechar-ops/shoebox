import { tenantFactories } from '@shoebox/testkit';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { GLOBAL_TABLES, ORG_COLUMN, READ_ONLY_FOR_USERS } from '../../src/rls-catalog';
import {
  auditCatalog,
  type Conn,
  cleanupTenants,
  DATABASE_URL,
  loadCatalog,
  type Problem,
  serviceSql,
  tenantTablesOf,
} from './helpers';

// M12 §4.4 RLS test suite item 1 (meta-test, catalog-driven) and §9 AC-2. Runs in the `db`
// vitest project against DATABASE_URL; skipped without it. The schema is migrated forward, never
// dropped; the broken probes live inside rolled-back transactions.
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('RLS meta-test: catalog of public tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  /** Audits the catalog after `ddl` ran, inside a transaction that is rolled back. */
  async function auditWith(ddl: (tx: Conn) => Promise<void>): Promise<Problem[]> {
    let problems: Problem[] = [];
    try {
      await sql.begin(async (tx) => {
        await ddl(tx);
        problems = auditCatalog(await loadCatalog(tx));
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return problems;
  }

  beforeAll(async () => {
    sql = serviceSql(url);
    await runMigrations(url);
    await cleanupTenants(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('every public table is a tenant table with RLS, policies and a factory, or an allowlisted global table', async () => {
    const catalog = await loadCatalog(sql);
    expect(catalog.length).toBeGreaterThanOrEqual(3);
    expect(auditCatalog(catalog)).toEqual([]);
  });

  it('every registered factory names a migrated tenant table', async () => {
    const tenantTables = tenantTablesOf(await loadCatalog(sql));
    for (const table of tenantFactories.tables()) {
      expect(tenantTables, `factory "${table}" has no table`).toContain(table);
    }
    expect(tenantTables).toEqual(
      expect.arrayContaining(['organizations', 'memberships', 'taxpayer_profiles']),
    );
  });

  it('the catalog lists are disjoint and name only snake_case tables', () => {
    const lists = [Object.keys(GLOBAL_TABLES), Object.keys(ORG_COLUMN), READ_ONLY_FOR_USERS];
    for (const list of lists) {
      for (const table of list) {
        expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
    for (const table of Object.keys(GLOBAL_TABLES)) {
      expect(READ_ONLY_FOR_USERS, `${table} is global, not a tenant table`).not.toContain(table);
      expect(Object.keys(ORG_COLUMN)).not.toContain(table);
    }
  });

  it('AC-2: a table with org_id and no RLS, policies or factory fails the audit', async () => {
    const problems = await auditWith(async (tx) => {
      await tx`create table public.rls_probe_broken (id uuid primary key default gen_random_uuid(), org_id uuid not null)`;
    });
    expect(problems.map((p) => p.table)).toEqual(Array(7).fill('rls_probe_broken'));
    const text = problems.map((p) => p.problem).join('\n');
    expect(text).toContain('RLS is not enabled');
    expect(text).toContain('policy rls_probe_broken_select');
    expect(text).toContain('policy rls_probe_broken_worker');
    expect(text).toContain('no user policy allows INSERT');
    expect(text).toContain('no testkit factory');
  });

  it('AC-2: a tenant table with correct policies but no factory fails with exactly that problem', async () => {
    const problems = await auditWith(async (tx) => {
      await tx`create table public.rls_probe_nofactory (id uuid primary key default gen_random_uuid(), org_id uuid not null)`;
      await tx`select app.apply_tenant_rls('rls_probe_nofactory')`;
    });
    expect(problems).toEqual([
      { table: 'rls_probe_nofactory', problem: expect.stringContaining('no testkit factory') },
    ]);
  });

  it('a table without org_id that is not in GLOBAL_TABLES fails', async () => {
    const problems = await auditWith(async (tx) => {
      await tx`create table public.rls_probe_global (id uuid primary key default gen_random_uuid(), name text)`;
    });
    expect(problems).toEqual([
      { table: 'rls_probe_global', problem: expect.stringContaining('not in GLOBAL_TABLES') },
    ]);
  });

  it('a READ_ONLY_FOR_USERS table with a user write policy fails, and a nullable org_id must be listed', () => {
    const base = {
      hasOrgId: true,
      orgIdNullable: false,
      rls: true,
      grants: { authenticated: ['SELECT'], anon: [] },
    };
    const policies = (t: string) => [
      { name: `${t}_select`, cmd: 'SELECT', roles: ['public'] },
      { name: `${t}_write`, cmd: 'ALL', roles: ['public'] },
      { name: `${t}_worker`, cmd: 'ALL', roles: ['app_worker'] },
    ];
    const has = { has: () => true };
    expect(
      auditCatalog(
        [{ ...base, table: 'ingest_items', policies: policies('ingest_items') }],
        has,
      ).map((p) => p.problem),
    ).toEqual([
      'is in READ_ONLY_FOR_USERS but a user policy allows INSERT',
      'is in READ_ONLY_FOR_USERS but a user policy allows UPDATE',
      'is in READ_ONLY_FOR_USERS but a user policy allows DELETE',
    ]);
    expect(
      auditCatalog(
        [
          {
            ...base,
            table: 'ingest_items',
            policies: policies('ingest_items')
              .slice(0, 1)
              .concat(policies('ingest_items').slice(2)),
          },
        ],
        has,
      ),
    ).toEqual([]);
    expect(
      auditCatalog(
        [{ ...base, orgIdNullable: true, table: 'documents', policies: policies('documents') }],
        has,
      ).map((p) => p.problem),
    ).toEqual(['org_id is nullable but the table is not in NULLABLE_ORG_ID']);
    expect(
      auditCatalog(
        [
          {
            ...base,
            orgIdNullable: true,
            table: 'audit_log',
            policies: policies('audit_log').filter((p) => p.name !== 'audit_log_write'),
          },
        ],
        has,
      ),
    ).toEqual([]);
  });

  it('a global table is checked for its grants (05 §10.3)', () => {
    const global = (table: string, authenticated: string[], anon: string[] = []) => ({
      table,
      hasOrgId: false,
      orgIdNullable: false,
      rls: false,
      policies: [],
      grants: { authenticated, anon },
    });
    expect(auditCatalog([global('categories', ['SELECT'])])).toEqual([]);
    expect(auditCatalog([global('staff_users', [])])).toEqual([]);
    expect(
      auditCatalog([global('categories', ['SELECT', 'INSERT'])]).map((p) => p.problem),
    ).toEqual(['global table: authenticated must have exactly [SELECT], has [SELECT,INSERT]']);
    expect(auditCatalog([global('staff_users', ['SELECT'])]).map((p) => p.problem)).toEqual([
      'global table: authenticated must have exactly [], has [SELECT]',
    ]);
    expect(
      auditCatalog([global('categories', ['SELECT'], ['SELECT'])]).map((p) => p.problem),
    ).toEqual(['global table: anon must have no privilege, has [SELECT]']);
  });
});
