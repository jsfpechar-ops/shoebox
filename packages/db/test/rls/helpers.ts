import {
  createIdGenerator,
  type FactoryContext,
  factoryFor,
  fakeClock,
  type Row,
  tenantFactories,
} from '@shoebox/testkit';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { runMigrations } from '../../src/migrate';
import {
  GLOBAL_TABLES,
  NULLABLE_ORG_ID,
  ORG_COLUMN,
  orgColumnOf,
  READ_ONLY_FOR_USERS,
  USER_UPDATE_ONLY,
} from '../../src/rls-catalog';

/**
 * Shared pieces of the RLS suite (M12 §4.4): the catalog query and its audit (meta.db.test.ts),
 * the org A / org B fixture built from the testkit factories, and the "run as this user, then
 * roll back" helper. Every *.db.test.ts in this folder seeds in beforeAll and cleans in afterAll;
 * the db vitest project runs files one after another on one DATABASE_URL.
 */

export const DATABASE_URL = process.env.DATABASE_URL;

/** A pool or a transaction handle: what the query helpers accept. */
export type Conn = Sql | TransactionSql;

export const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
export const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

export const ROLES = ['owner', 'member', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export type OrgKey = 'A' | 'B';

/** One user per role per org; the memberships are inserted by seedTenants. */
export const USERS: Readonly<Record<OrgKey, Readonly<Record<Role, string>>>> = {
  A: {
    owner: 'aaaaaaaa-0000-4000-8000-0000000a0001',
    member: 'aaaaaaaa-0000-4000-8000-0000000a0002',
    accountant: 'aaaaaaaa-0000-4000-8000-0000000a0003',
    viewer: 'aaaaaaaa-0000-4000-8000-0000000a0004',
  },
  B: {
    owner: 'bbbbbbbb-0000-4000-8000-0000000b0001',
    member: 'bbbbbbbb-0000-4000-8000-0000000b0002',
    accountant: 'bbbbbbbb-0000-4000-8000-0000000b0003',
    viewer: 'bbbbbbbb-0000-4000-8000-0000000b0004',
  },
};

const ROLLBACK = Symbol('rollback');

export function serviceSql(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => undefined });
}

/** `DATABASE_URL` with the user replaced by `app_worker` (trust auth on the local cluster). */
export function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

/** SQLSTATE of a postgres.js error, also when Drizzle wrapped it. */
export function pgCode(e: unknown): string {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code ?? 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Catalog (item 1)

export interface PolicyInfo {
  name: string;
  cmd: string;
  roles: string[];
}

export interface TableInfo {
  table: string;
  hasOrgId: boolean;
  orgIdNullable: boolean;
  rls: boolean;
  policies: PolicyInfo[];
  /** `has_table_privilege(role, table, privilege)` for authenticated and anon. */
  grants: { authenticated: string[]; anon: string[] };
}

export interface Problem {
  table: string;
  problem: string;
}

const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

/** Every table of schema `public` with what the meta-test needs to know about it. */
export async function loadCatalog(sql: Conn): Promise<TableInfo[]> {
  const tables = await sql<{ table: string; rls: boolean }[]>`
    select c.relname as "table", c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`;
  const columns = await sql<{ table: string; nullable: boolean }[]>`
    select table_name as "table", is_nullable = 'YES' as nullable
    from information_schema.columns
    where table_schema = 'public' and column_name = 'org_id'`;
  const policies = await sql<{ table: string; name: string; cmd: string; roles: string[] }[]>`
    select tablename as "table", policyname as name, cmd, roles::text[] as roles
    from pg_policies where schemaname = 'public' order by tablename, policyname`;
  const grants = await sql<{ table: string; grantee: string; privilege: string }[]>`
    select c.relname as "table", r.rolname as grantee, p.privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('authenticated'), ('anon')) as r(rolname)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, p.privilege)`;
  return tables.map((t) => {
    const col = columns.find((c) => c.table === t.table);
    return {
      table: t.table,
      hasOrgId: col !== undefined,
      orgIdNullable: col?.nullable ?? false,
      rls: t.rls,
      policies: policies
        .filter((p) => p.table === t.table)
        .map(({ name, cmd, roles }) => ({
          name,
          cmd,
          roles,
        })),
      grants: {
        authenticated: grants
          .filter((g) => g.table === t.table && g.grantee === 'authenticated')
          .map((g) => g.privilege),
        anon: grants
          .filter((g) => g.table === t.table && g.grantee === 'anon')
          .map((g) => g.privilege),
      },
    };
  });
}

export function isTenantTable(info: Pick<TableInfo, 'table' | 'hasOrgId'>): boolean {
  return info.hasOrgId || info.table in ORG_COLUMN;
}

/** Sorted names of the tenant tables in a catalog. */
export function tenantTablesOf(catalog: TableInfo[]): string[] {
  return catalog
    .filter(isTenantTable)
    .map((t) => t.table)
    .sort();
}

function userPolicyCovers(policies: PolicyInfo[], privilege: string): boolean {
  return policies.some(
    (p) =>
      (p.cmd === 'ALL' || p.cmd === privilege) &&
      !(p.roles.length === 1 && p.roles[0] === 'app_worker'),
  );
}

/**
 * The meta-test rule (M12 §4.4 item 1, AGENTS rule 3). Pure, so a deliberately broken table can
 * be audited inside a rolled-back transaction. Empty result = the schema passes.
 */
export function auditCatalog(
  catalog: TableInfo[],
  factories: { has(table: string): boolean } = tenantFactories,
): Problem[] {
  const problems: Problem[] = [];
  for (const info of catalog) {
    const { table } = info;
    const add = (problem: string) => problems.push({ table, problem });
    if (!isTenantTable(info)) {
      const read = GLOBAL_TABLES[table];
      if (read === undefined) {
        add('has no org_id and is not in GLOBAL_TABLES (05 §10.3); a tenant table needs org_id');
        continue;
      }
      const wanted = read === 'authenticated' ? ['SELECT'] : [];
      if (info.grants.authenticated.join(',') !== wanted.join(',')) {
        add(
          `global table: authenticated must have exactly [${wanted}], has [${info.grants.authenticated}]`,
        );
      }
      if (info.grants.anon.length > 0) {
        add(`global table: anon must have no privilege, has [${info.grants.anon}]`);
      }
      continue;
    }
    if (info.hasOrgId && info.orgIdNullable && !NULLABLE_ORG_ID.includes(table)) {
      add('org_id is nullable but the table is not in NULLABLE_ORG_ID');
    }
    if (!info.rls) {
      add('RLS is not enabled (call app.apply_tenant_rls in the migration)');
    }
    const select = info.policies.find((p) => p.name === `${table}_select`);
    if (select === undefined || select.cmd !== 'SELECT') {
      add(`policy ${table}_select for SELECT is missing`);
    }
    const worker = info.policies.find((p) => p.name === `${table}_worker`);
    if (worker === undefined || worker.cmd !== 'ALL' || worker.roles.join(',') !== 'app_worker') {
      add(`policy ${table}_worker for ALL to app_worker is missing`);
    }
    for (const privilege of PRIVILEGES.slice(1)) {
      const covered = userPolicyCovers(info.policies, privilege);
      const updateOnly = USER_UPDATE_ONLY.includes(table);
      const mayUse = updateOnly ? privilege === 'UPDATE' : !READ_ONLY_FOR_USERS.includes(table);
      if (!mayUse && covered) {
        add(
          updateOnly
            ? `is in USER_UPDATE_ONLY but a user policy allows ${privilege}`
            : `is in READ_ONLY_FOR_USERS but a user policy allows ${privilege}`,
        );
      }
      if (mayUse && !covered) {
        add(`no user policy allows ${privilege} (add it or list the table in READ_ONLY_FOR_USERS)`);
      }
    }
    if (!factories.has(table)) {
      add('no testkit factory (add one in packages/testkit/src/factories/ and register it)');
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Fixture: org A and org B with one factory row in every tenant table (item 2)

export interface Tenants {
  ctx: Readonly<Record<OrgKey, FactoryContext>>;
  /** Tenant tables in an insert order that respects foreign keys. */
  tables: string[];
}

/** Tenant tables ordered so that every table comes after the tables it references. */
export async function insertOrder(sql: Conn, tables: string[]): Promise<string[]> {
  const edges = await sql<{ child: string; parent: string }[]>`
    select cl.relname as child, pa.relname as parent
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_class pa on pa.oid = c.confrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_namespace pn on pn.oid = pa.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public' and cl.oid <> pa.oid`;
  const pending = new Set(tables);
  const ordered: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter((t) => !edges.some((e) => e.child === t && pending.has(e.parent)))
      .sort();
    if (ready.length === 0) {
      throw new Error(`rls helpers: foreign-key cycle among ${[...pending].join(', ')}`);
    }
    for (const t of ready) {
      pending.delete(t);
      ordered.push(t);
    }
  }
  return ordered;
}

const authUserColumns = new Map<string, string[]>();

/** Inserts an `auth.users` row for every column of `table` that references it. */
export async function ensureAuthUsers(sql: Sql, table: string, row: Row): Promise<void> {
  let cols = authUserColumns.get(table);
  if (cols === undefined) {
    const rows = await sql<{ column: string }[]>`
      select a.attname as "column"
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.conrelid = ${`public.${table}`}::regclass
        and c.confrelid = 'auth.users'::regclass`;
    cols = rows.map((r) => r.column);
    authUserColumns.set(table, cols);
  }
  for (const col of cols) {
    const id = row[col];
    if (typeof id === 'string') {
      await sql`insert into auth.users (id) values (${id}) on conflict (id) do nothing`;
    }
  }
}

/** A factory row as postgres.js parameters (plain objects and arrays become json). */
export function toParams(sql: Conn, row: Row): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v !== null && typeof v === 'object' && !(v instanceof Date) ? sql.json(v as never) : v,
    ]),
  );
}

/** Inserts one factory row of `table` for `ctx.orgId` with the service role. */
export async function insertFactoryRow(
  sql: Sql,
  table: string,
  ctx: FactoryContext,
  overrides?: Row,
): Promise<Row> {
  const row = factoryFor(table)(ctx, overrides);
  if (row[orgColumnOf(table)] !== ctx.orgId) {
    throw new Error(`factory for "${table}" must set ${orgColumnOf(table)} to ctx.orgId`);
  }
  await ensureAuthUsers(sql, table, row);
  await ensureParentRows(sql, table, row, ctx);
  await insertRow(sql, table, row);
  return row;
}

interface ParentFk {
  column: string;
  parent: string;
  parentColumn: string;
}

const parentFks = new Map<string, ParentFk[]>();

/**
 * Creates the missing parent rows of `row`: for every single-column foreign key of `table` to
 * another public table with a factory, a string value that matches no parent row becomes a
 * parent built by that table's factory (`{ [parentColumn]: value }` overrides). Child factories
 * put a fresh `ctx.ids.next()` there, so every build is insertable without a shared fixture.
 */
export async function ensureParentRows(
  sql: Sql,
  table: string,
  row: Row,
  ctx: FactoryContext,
): Promise<void> {
  let fks = parentFks.get(table);
  if (fks === undefined) {
    const rows = await sql<{ column: string; parent: string; parent_column: string }[]>`
      select a.attname as "column", pa.relname as parent, pattr.attname as parent_column
      from pg_constraint c
      join pg_class pa on pa.oid = c.confrelid
      join pg_namespace pn on pn.oid = pa.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pattr on pattr.attrelid = c.confrelid and pattr.attnum = c.confkey[1]
      where c.contype = 'f' and c.conrelid = ${`public.${table}`}::regclass
        and pn.nspname = 'public' and pa.relname <> ${table} and array_length(c.conkey, 1) = 1`;
    fks = rows.map((r) => ({ column: r.column, parent: r.parent, parentColumn: r.parent_column }));
    parentFks.set(table, fks);
  }
  for (const fk of fks) {
    const value = row[fk.column];
    if (typeof value !== 'string' || !tenantFactories.has(fk.parent)) {
      continue;
    }
    const found =
      await sql`select 1 from ${sql(fk.parent)} where ${sql(fk.parentColumn)} = ${value}`;
    if (found.length === 0) {
      await insertFactoryRow(sql, fk.parent, ctx, { [fk.parentColumn]: value });
    }
  }
}

function freshContexts(): Record<OrgKey, FactoryContext> {
  return {
    A: { orgId: ORG_A, ids: createIdGenerator(0xa), clock: fakeClock() },
    B: { orgId: ORG_B, ids: createIdGenerator(0xb), clock: fakeClock() },
  };
}

/** Migrates, removes leftovers, then builds org A and org B (one row per tenant table, four users each). */
export async function seedTenants(sql: Sql, url: string): Promise<Tenants> {
  await runMigrations(url);
  await cleanupTenants(sql);
  const tables = await insertOrder(sql, tenantTablesOf(await loadCatalog(sql)));
  const ctx = freshContexts();
  for (const table of tables) {
    await insertFactoryRow(sql, table, ctx.A);
    await insertFactoryRow(sql, table, ctx.B);
  }
  for (const org of ['A', 'B'] as const) {
    for (const role of ROLES) {
      const uid = USERS[org][role];
      await sql`insert into auth.users (id) values (${uid}) on conflict (id) do nothing`;
      await sql`insert into memberships (org_id, user_id, role)
        values (${ctx[org].orgId}, ${uid}, ${role}) on conflict (org_id, user_id) do nothing`;
    }
  }
  return { ctx, tables };
}

/**
 * Deletes everything seedTenants and the probes created (orgs cascade into every tenant table;
 * audit_log has no foreign key, 05 §9, so its rows go explicitly).
 */
export async function cleanupTenants(sql: Sql): Promise<void> {
  await sql`drop table if exists public.rls_probe_broken, public.rls_probe_nofactory, public.rls_probe_global`;
  await sql`delete from audit_log where org_id in (${ORG_A}, ${ORG_B})`;
  await sql`delete from organizations where id in (${ORG_A}, ${ORG_B})`;
  await sql`delete from auth.users where id::text like 'aaaaaaaa-%' or id::text like 'bbbbbbbb-%'
    or id::text like '0000000a-%' or id::text like '0000000b-%'`;
}

// ---------------------------------------------------------------------------------------------
// Run as a user (items 2 and 3)

/**
 * Runs fn as `authenticated` with the JWT claims of `uid` (null = anonymous) inside a transaction
 * that is always rolled back. Sets both GUCs Supabase's auth.uid() reads.
 */
export async function asUser<T>(
  sql: Sql,
  uid: string | null,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (uid !== null) {
        const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true),
          set_config('request.jwt.claims', ${claims}, true)`;
      }
      await tx`set local role authenticated`;
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

/** SQLSTATE of the error fn raises as that user, or null when it succeeds. */
export async function errorCodeAs(
  sql: Sql,
  uid: string | null,
  fn: (tx: TransactionSql) => Promise<unknown>,
): Promise<string | null> {
  try {
    await asUser(sql, uid, fn);
    return null;
  } catch (e) {
    return pgCode(e);
  }
}

/** Rows of `table` visible to the current role, split by org column value. */
export async function visibleOrgs(tx: Conn, table: string): Promise<string[]> {
  const col = orgColumnOf(table);
  const rows = await tx<{ org: string | null }[]>`
    select distinct ${tx(col)}::text as org from ${tx(table)} order by 1`;
  return rows.map((r) => r.org ?? 'null');
}

/** `update <table> set <org> = <org> where <org> = orgId returning 1`: the rows the role may update. */
export async function updateCount(tx: Conn, table: string, orgId: string): Promise<number> {
  const col = orgColumnOf(table);
  const rows = await tx`update ${tx(table)} set ${tx(col)} = ${tx(col)}
    where ${tx(col)} = ${orgId} returning 1`;
  return rows.length;
}

/** `delete from <table> where <org> = orgId returning 1`: the rows the role may delete. */
export async function deleteCount(tx: Conn, table: string, orgId: string): Promise<number> {
  const col = orgColumnOf(table);
  const rows = await tx`delete from ${tx(table)} where ${tx(col)} = ${orgId} returning 1`;
  return rows.length;
}

/**
 * Builds a fresh factory row of `table` for `ctx.orgId` and creates its `auth.users` targets and
 * its parent rows with the service connection. Call it before asUser (the service pool has one
 * connection).
 */
export async function buildRow(sql: Sql, table: string, ctx: FactoryContext): Promise<Row> {
  const row = factoryFor(table)(ctx);
  await ensureAuthUsers(sql, table, row);
  await ensureParentRows(sql, table, row, ctx);
  return row;
}

/** Inserts a row built by buildRow as the current role of `tx`. */
export async function insertRow(tx: Conn, table: string, row: Row): Promise<void> {
  await tx`insert into ${tx(table)} ${tx(toParams(tx, row) as never)}`;
}
