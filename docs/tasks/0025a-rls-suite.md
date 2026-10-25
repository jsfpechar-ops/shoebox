# 0025a: RLS catalog, tenancy factories, meta-test and worker cases

Status: todo
Ticket: P0-DB-03 (part a of a/b) | Depends on: 0022a/b merged (PR #36) | Base commit: head of phase/0 | Branch: task/0025-rls-suite | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/db/src/rls-catalog.ts` holds the lists of 05 §10.2–10.3 (global tables, read-only-for-users tables, owner-only tables, …); `packages/db/test/rls/meta.db.test.ts` reads the live catalog of `public` and fails when any table with `org_id` lacks RLS, `_select`, `_worker` or a user write policy, lacks a testkit factory, or has no `org_id` and is not an allowlisted global table (M12 §4.4 item 1, AC-2). `worker.db.test.ts` proves item 4 for every tenant table: `app_worker` without `app.org_id` sees nothing, with org A only A. The three tenancy tables get their testkit factories, which the fixture of 0025b (isolation and role cases) also uses.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles."
- Hard rule 7: no new dependency. This brief adds `@shoebox/testkit` as a **workspace** devDependency of `@shoebox/db` (a link, not a package; `pnpm-lock.yaml` grows by 3 lines). Hard rule 8: never push to `main`.
- M12 §4.4 RLS test suite item 1 (verbatim): "**Meta-test (catalog):** query `information_schema.columns`/`pg_class` for every table in `public` with an `org_id` column → assert `relrowsecurity = true`, at least one policy per command needed (`select`, and `insert/update/delete` unless the table is in `READ_ONLY_FOR_USERS`), and the `app_worker` policy present. Tables without `org_id` must be in an explicit allowlist (the global tables of 05 §10.3: `categories`, `fx_rates`, `bank_codes`, `registry_cache`, `rules_overrides`, `staff_users`, `rate_limit_counters`, plus `audit_log` with its nullable `org_id`; Later: `global_vendor_priors`, `extraction_batches`) with their expected grants. **Adding a table without updating the suite fails CI** (AGENTS rule 3)."
- M12 §4.4 item 4: "**Worker cases:** as `app_worker` without `app.org_id` → 0 rows everywhere; with `app.org_id = A` → only A."
- M12 §9 AC-2: "The RLS meta-test fails when a migration adds a table with `org_id` but no RLS/policy/factory (verified by a deliberately broken fixture migration in the test suite)." AC-3: "… `app_worker` without `app.org_id` reads 0 rows."
- 05 §10.3: "`categories` (read: authenticated), `fx_rates`, `bank_codes` (read: authenticated), `registry_cache`, `rules_overrides`, `staff_users`, `rate_limit_counters` (service role only), plus the Later tables `global_vendor_priors`, `extraction_batches` (service role only). `audit_log` has a nullable `org_id`: users select rows of their orgs; inserts only through server code."
- 05 §10.2 (the rows this brief encodes): `memberships`, `taxpayer_profiles`, `organizations` write: owner only; `privacy_requests` select and write: owner only; `comments` insert: owner, member, accountant; `review_questions` / `accountant_packages`: accountant updates named columns only; `export_profiles`, `export_mappings` insert/update: owner, member, accountant; derived tables (`tax_ledger_entries`, `vat_ledger_entries`, `filing_entries`, `llm_usage_daily`, `extraction_runs`, `ingest_items`, `statement_imports`, `match_suggestions`) users: select only.
- Design choices (brief writer, all verified on Postgres 16 + shim, see end of §2): (1) test files are `*.db.test.ts` so the `db` vitest project runs them and they skip without `DATABASE_URL` (as 0014b/0022b); the test-map pattern `rls` matches the folder. (2) The catalog lives in `packages/db/src/` because 0025b's `scripts/check-tenant-sql.ts` imports `GLOBAL_TABLES` from it. (3) The broken probes of AC-2 are created inside a transaction that is rolled back, so the schema is never left dirty; `auditCatalog()` is pure for that reason. (4) The `organizations` factory returns `id = ctx.orgId` (its org column is `id`), so the suite uses `factoryFor()` and checks the org column itself instead of `registry.build()`. (5) `taxpayer_profiles` has an exclusion constraint (no overlapping segments per org), so its factory gives every build its own closed year derived from the id counter. (6) The fixture's `memberships` rows need `auth.users` rows: `ensureAuthUsers()` reads the FK columns to `auth.users` from `pg_constraint` and upserts them, generic for later tables. (7) `asUser()` sets both `request.jwt.claim.sub` and `request.jwt.claims`, the two GUCs Supabase's `auth.uid()` reads (`current_setting(.., true)` returns `''`, not null, after a transaction-local setting ended on the same session). (8) `seedTenants` orders the tenant tables by their foreign keys (Kahn), so later slices need no manual order.

Anchors (current `origin/phase/0` after PR #36):

`packages/db/src/index.ts` (step 2), line 2:

```ts
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
```

`packages/testkit/src/factories/index.ts` (step 4), three anchors:

```ts
import { createFactoryRegistry, type FactoryRegistry, type TenantFactory } from './registry';
```

```ts
export { createFactoryRegistry } from './registry';
```

```ts
/**
 * The one registry of tenant-table factories that the RLS suite (packages/db/test/rls) iterates.
 * Empty until the migration slices land: each slice adds `src/factories/<area>.ts` exporting its
 * factories and registers them below with `tenantFactories.define('<table>', <factory>)`.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
```

`packages/db/package.json` (step 5):

```json
  "devDependencies": {
    "drizzle-kit": "0.31.11",
```

All code below was run by the brief writer on `origin/task/0022-db-with-tenant` (c6a5745, the state of `phase/0` after PR #36) against Postgres 16 (plain cluster + shim): `tsc` clean for db and testkit, `biome ci` clean, 61 tests pass with `DATABASE_URL` (28 pass + 33 skip without), `pnpm install` changes only the 3 lockfile lines of step 5.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/rls-catalog.ts` | create | the lists of 05 §10.2–10.3 and `orgColumnOf()` |
| `packages/db/src/index.ts` | edit | export the catalog |
| `packages/testkit/src/factories/tenancy.ts` | create | factories of `organizations`, `memberships`, `taxpayer_profiles` |
| `packages/testkit/src/factories/index.ts` | edit | register them |
| `packages/db/package.json` (+ `pnpm-lock.yaml` by `pnpm install`) | edit | `@shoebox/testkit` workspace devDependency |
| `packages/db/test/rls/helpers.ts` | create | catalog query + audit, org A/B fixture, `asUser` |
| `packages/db/test/rls/meta.db.test.ts` | create | item 1 and AC-2 (8 tests) |
| `packages/db/test/rls/worker.db.test.ts` | create | item 4 (4 tests) |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin phase/0 && git checkout -b task/0025-rls-suite origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/src/tenant.ts` and `packages/db/migrations/0003_app_worker.sql` to exist: `ls packages/db/src packages/db/migrations`). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are already Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0025a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/src/rls-catalog.ts`

```ts
// The RLS catalog (M12 §4.4 RLS test suite item 1, 05 §10.2–10.3): the lists the meta-test, the
// generated isolation and role cases and `scripts/check-tenant-sql.ts` read. A new table either has
// `org_id` (then it is a tenant table: RLS, three policies, a testkit factory) or is listed here
// as a global table. Nothing else passes CI (AGENTS rule 3). Names as in 05.

/** Who may read a global table (05 §10.3). Nobody but the service role writes one. */
export type GlobalRead = 'authenticated' | 'service_role';

/** Tables without `org_id` that are allowed to exist, with who may read them (05 §10.3). */
export const GLOBAL_TABLES: Readonly<Record<string, GlobalRead>> = {
  categories: 'authenticated',
  fx_rates: 'authenticated',
  bank_codes: 'authenticated',
  registry_cache: 'service_role',
  rules_overrides: 'service_role',
  staff_users: 'service_role',
  rate_limit_counters: 'service_role',
  // 05 §9.1 Later, listed so the allowlist never has to change for them:
  global_vendor_priors: 'service_role',
  extraction_batches: 'service_role',
};

/** Tenant tables whose org column is not `org_id`. */
export const ORG_COLUMN: Readonly<Record<string, string>> = {
  organizations: 'id',
};

/** Tenant tables with a nullable `org_id` (05 §10.3: users select rows of their orgs). */
export const NULLABLE_ORG_ID: readonly string[] = ['audit_log'];

/**
 * Tenant tables users only read (05 §10.2 derived tables, plus `audit_log`): no insert, update or
 * delete policy for `authenticated`; the worker (`app_worker`) writes them.
 */
export const READ_ONLY_FOR_USERS: readonly string[] = [
  'audit_log',
  'tax_ledger_entries',
  'vat_ledger_entries',
  'filing_entries',
  'llm_usage_daily',
  'extraction_runs',
  'ingest_items',
  'statement_imports',
  'match_suggestions',
];

/** 05 §10.2: written by owners only (a member cannot insert, update or delete). */
export const OWNER_ONLY_TABLES: readonly string[] = [
  'organizations',
  'memberships',
  'taxpayer_profiles',
];

/** 05 §10.2: selected and written by owners only. */
export const OWNER_ONLY_SELECT_TABLES: readonly string[] = ['privacy_requests'];

/**
 * 05 §10.2 / M12 §4.4 role matrix: the only tenant tables an accountant may write at all
 * (`review_questions` and `accountant_packages` only on named columns, checked by their slice).
 */
export const ACCOUNTANT_WRITABLE: readonly string[] = [
  'comments',
  'review_questions',
  'accountant_packages',
  'export_profiles',
  'export_mappings',
];

/**
 * Tenant tables no user may insert through RLS: a new organization is created by server code
 * (there is no membership yet that could satisfy the owner check).
 */
export const NO_USER_INSERT: readonly string[] = ['organizations'];

/** The org column of a tenant table (`org_id` unless listed in ORG_COLUMN). */
export function orgColumnOf(table: string): string {
  return ORG_COLUMN[table] ?? 'org_id';
}
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: edit `packages/db/src/index.ts`

After the anchor line (§2) insert one line, so the file starts:

```ts
export const packageName = '@shoebox/db' as const;
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
export * from './rls-catalog';
export * from './schema/enums';
```

Command: `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → `No fixes applied`, no errors. Commit.

### Step 3: create `packages/testkit/src/factories/tenancy.ts`

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §2 tenancy tables (migration 0002). Columns are snake_case as in SQL; the
 * RLS suite (packages/db/test/rls) inserts the rows as the service role for org A and org B.
 * Every call yields a row that can be inserted next to the previous ones of the same org.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `organizations`: its org column is `id` (05 §10.1), so the row carries `id = ctx.orgId`. */
export const organizationFactory: TenantFactory = (ctx, overrides) => {
  const tag = ctx.orgId.slice(0, 8);
  return {
    id: ctx.orgId,
    name: `Org ${tag}`,
    inbound_email_slug: `org-${tag}`,
    inbound_email_secret: 'ABCDEFGH',
    settings: {},
    ...overrides,
  };
};

/** `memberships`: a viewer with a fresh user id; the suite creates that `auth.users` row. */
export const membershipFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  user_id: ctx.ids.next(),
  role: 'viewer',
  prefs: {},
  ...overrides,
});

/**
 * `taxpayer_profiles`: effective-dated with no overlap per org (exclusion constraint), so each
 * build takes its own closed year, derived from the id counter (build 1 → 2001, build 2 → 2002).
 */
export const taxpayerProfileFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const year = 2000 + (counterOf(id) % 1000);
  return {
    id,
    org_id: ctx.orgId,
    valid_from: `${year}-01-01`,
    valid_to: `${year}-12-31`,
    vat_status: 'neplatce',
    tax_regime: 'pausalni_vydaje',
    legal_name: 'Test s.r.o.',
    ico: '00000000',
    address: {},
    ...overrides,
  };
};

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const tenancyFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['organizations', organizationFactory],
  ['memberships', membershipFactory],
  ['taxpayer_profiles', taxpayerProfileFactory],
];
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/testkit/src/factories/index.ts` (three replacements, anchors in §2)

(a) After the import anchor add `import { tenancyFactories } from './tenancy';` (next line).

(b) After the `export { createFactoryRegistry } from './registry';` anchor add the line
`export { membershipFactory, organizationFactory, taxpayerProfileFactory } from './tenancy';`.

(c) The 6-line anchor (doc comment + `export const tenantFactories` line) becomes:

```ts
/**
 * The one registry of tenant-table factories that the RLS suite (packages/db/test/rls) iterates.
 * Each migration slice adds `src/factories/<area>.ts` exporting its factories and registers them
 * below (a tenant table without a factory fails the RLS meta-test). tenancy.ts covers 0002.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of tenancyFactories) {
  tenantFactories.define(table, factory);
}
```

The rest of the file (`factoryFor`) stays. The whole file is then 22 lines.

Command: `pnpm --filter @shoebox/testkit test 2>&1 | tail -6` → `Tests  29 passed (29)`; then `pnpm exec biome ci packages/testkit 2>&1 | tail -3` → no errors. Commit.

### Step 5: edit `packages/db/package.json` and refresh the lockfile

Replace the anchor (§2) with:

```json
  "devDependencies": {
    "@shoebox/testkit": "workspace:*",
    "drizzle-kit": "0.31.11",
```

Command: `pnpm install 2>&1 | tail -2` → `Done in …`; then `git diff --stat 2>&1 | tail -3` → `packages/db/package.json | 1 +` and `pnpm-lock.yaml | 3 +++` only (the lockfile gains `'@shoebox/testkit': specifier: workspace:* / version: link:../testkit` under the db importer). If `pnpm install` wants the network and fails, STOP and report. Commit.

### Step 6: create `packages/db/test/rls/helpers.ts`

```ts
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
      if (READ_ONLY_FOR_USERS.includes(table) && covered) {
        add(`is in READ_ONLY_FOR_USERS but a user policy allows ${privilege}`);
      }
      if (!READ_ONLY_FOR_USERS.includes(table) && !covered) {
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
  await insertRow(sql, table, row);
  return row;
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

/** Deletes everything seedTenants and the probes created (orgs cascade into every tenant table). */
export async function cleanupTenants(sql: Sql): Promise<void> {
  await sql`drop table if exists public.rls_probe_broken, public.rls_probe_nofactory, public.rls_probe_global`;
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
 * Builds a fresh factory row of `table` for `ctx.orgId` and creates its `auth.users` targets with
 * the service connection. Call it before asUser (the service pool has one connection).
 */
export async function buildRow(sql: Sql, table: string, ctx: FactoryContext): Promise<Row> {
  const row = factoryFor(table)(ctx);
  await ensureAuthUsers(sql, table, row);
  return row;
}

/** Inserts a row built by buildRow as the current role of `tx`. */
export async function insertRow(tx: Conn, table: string, row: Row): Promise<void> {
  await tx`insert into ${tx(table)} ${tx(toParams(tx, row) as never)}`;
}
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 7: create `packages/db/test/rls/meta.db.test.ts`

Full file; do not edit it:

```ts
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
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  5 passed (5)` and `Tests  57 passed (57)`. (Without a database: `28 passed | 29 skipped`.) Commit.

### Step 8: create `packages/db/test/rls/worker.db.test.ts`

Full file; do not edit it:

```ts
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
        const codeA = await asWorker(ORG_A, (tx) => insertRow(tx, table, rowA)).then(
          () => null,
          pgCode,
        );
        // organizations: a new id is not app.current_org_id(), so even that insert is refused.
        expect(codeA, `${table}: insert for org A as worker of A`).toBe(
          orgColumnOf(table) === 'id' ? '42501' : null,
        );
      }
    });
  },
);
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  6 passed (6)` and `Tests  61 passed (61)`. Then `pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -3` → no errors. Commit. Write the report (§9) and continue with 0025b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/**`, `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/schema/**`, `packages/db/src/tenant.ts`, `packages/db/test/migrations/**`, `packages/db/test/with-tenant.db.test.ts`, `packages/db/vitest.config.ts`, `packages/testkit/src/factories/registry.ts`, `packages/testkit/test/**`, `vitest.workspace.ts`, root `package.json` (0025b), `docs/v3/**`, `docs/tasks/0023*`, `docs/tasks/0024*`. Hard rules: 3 (this PR is the RLS suite itself), 7 (no new external dependency; the testkit link is a workspace package), 8 (never push to `main`). Never write a connection string with a password, never set a password for `app_worker`. Never run `supabase-shim.sql` against a Supabase database.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                                        # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30    # Tests 61 passed (6 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30  # Tests 33 passed (4 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                                                   # without DATABASE_URL: 28 passed, 33 skipped
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                                              # 29 passed
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                                              # exit 0
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                                         # exit 0
pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -30                                                  # No fixes applied
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); here `DATABASE_URL` from `local-pg.sh` replaces `db:start` because Docker is unavailable. Leave the cluster running for 0025b (`bash packages/db/scripts/local-pg.sh stop` only at the very end of 0025b).

## 7. Acceptance

- [ ] `meta.db.test.ts`: 8 passed with `DATABASE_URL`; `worker.db.test.ts`: 4 passed; `tenancy.db.test.ts` and `with-tenant.db.test.ts` unchanged and green (9 + 12).
- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from pg_tables where schemaname='public' and tablename like 'rls_probe%'"` → `0` after the run (probes rolled back) and `select count(*) from organizations where id::text like 'aaaaaaaa-%' or id::text like 'bbbbbbbb-%'` → `0` (fixture cleaned).
- [ ] `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts` → `1`; the meta test "every registered factory names a migrated tenant table" passes (the three factories are registered and match the migrated tables).
- [ ] `git diff --stat origin/phase/0 -- pnpm-lock.yaml` → `3 +++` only.
- [ ] typecheck of db and testkit exit 0; `biome ci` clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed (the workspace link of step 5 is not one);
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0025a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`packages/db/src/rls-catalog.ts` (every list against 05 §10.2–10.3: a table wrongly listed in `READ_ONLY_FOR_USERS` or `GLOBAL_TABLES` would silence the suite for it), `auditCatalog()` in `helpers.ts` (the `_worker` policy must be `ALL` to exactly `app_worker`; a user policy is any policy not restricted to `app_worker`), the AC-2 cases of `meta.db.test.ts` (7 problems for the broken probe, exactly one for the factory-less probe), `worker.db.test.ts` (the A-scoped worker cannot insert for B: `42501`).

## Owner steps

None. (The `app_worker` password and `WORKER_DATABASE_URL` for Supabase stay as in 0022a.)
