# 0022b: `withTenant`, `withServiceRole` and the worker isolation test

Status: review
Ticket: P0-DB-02 (part b of a/b) | Depends on: 0022a (same branch) | Base commit: head of task/0022-db-with-tenant after 0022a | Branch: task/0022-db-with-tenant | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/db/src/tenant.ts` gives the worker `withTenant(orgId, fn)`, which opens a transaction on the `app_worker` connection, runs `select set_config('app.org_id', $1, true)` and hands `fn` a `TenantTx`; and `withServiceRole(reason, fn)`, which runs on the service connection and accepts only `retention | export | admin | migration`. The database test proves the goal of P0-DB-02: as `app_worker` without `app.org_id` every tenant table is empty, with org C only C's rows are visible and writable, and the setting does not survive the commit.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 3: "Every query is org-scoped." · rules.md: "No raw SQL outside `packages/db`."
- Hard rule 7: no new dependency. `drizzle-orm` 0.45.3 and `postgres` 3.4.9 are already in `packages/db/package.json` (decisions 2026-10-18 [deps]).
- M12 §6 Interfaces (verbatim):

```ts
// packages/db
export function withTenant<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
export function withServiceRole<T>(reason: 'retention' | 'export' | 'admin' | 'migration', fn: (tx: ServiceTx) => Promise<T>): Promise<T>;
```

- M12 §4.4 Worker isolation: "`withTenant(orgId, fn)` opens a transaction and runs `select set_config('app.org_id', $1, true)` … A query without `withTenant` sees zero rows instead of all rows. The service role is used only by migrations, retention/export jobs that legitimately span tenants (they still iterate per org through `withTenant`), and the admin back-office."
- 05 §10.1 (after 0022a): "The worker connects as `app_worker` (`WORKER_DATABASE_URL`; migrations and `withServiceRole` use `DATABASE_URL`) and runs every tenant query inside `withTenant(orgId, fn)`."
- Backlog acceptance: "`withTenant(orgId, fn)` sets `app.org_id` local to the transaction; `withServiceRole(reason, fn)` only for `retention|export|admin|migration`. Test: as `app_worker` without `app.org_id` → 0 rows; with org A → only A rows; setting does not leak after commit."
- Design choices (brief writer, verified): the module-level functions of M12 §6 delegate to a process-wide `TenantDb` set once by `configureDb({ workerUrl, serviceUrl })` (the worker entry point will call it from env; `packages/db` itself never reads `process.env`). `createTenantDb()` is the testable factory. `TenantTx` and `ServiceTx` are Drizzle transaction handles with a phantom brand, so a function typed for `TenantTx` cannot receive a `ServiceTx`. The test file is `with-tenant.db.test.ts` (the ticket wrote `with-tenant.test.ts`; the `db` vitest project includes only `*.db.test.ts`, as in 0014b). The test never drops the schema; it migrates forward and removes its own rows, and 0022a made db test files run one after another.
- The worker connection in the test is `WORKER_DATABASE_URL` or, when unset, `DATABASE_URL` with the user replaced by `app_worker` and no password; the cluster of `local-pg.sh` was started with `--auth=trust`, so that logs in. On a Supabase database the CI job (P0-CI-02) will set `WORKER_DATABASE_URL`.
- Drizzle wraps driver errors in `DrizzleQueryError`; the SQLSTATE is on `error.cause.code`. The test's `pgCode()` reads both.

Anchor, `packages/db/src/index.ts` (step 2), current last line:

```ts
export * from './schema/tenancy';
```

All code below was run by the brief writer on `origin/phase/0` + 0022a against Postgres 16 (plain cluster + shim): `tsc` clean, `biome ci` clean, 49 tests pass with `DATABASE_URL` (28 pass + 21 skip without), `drizzle-kit migrate` applies.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/tenant.ts` | create | `createTenantDb`, `configureDb`, `withTenant`, `withServiceRole`, `closeDb`, types |
| `packages/db/src/index.ts` | edit | export them |
| `packages/db/test/with-tenant.db.test.ts` | create | worker isolation test (12 tests) |

No other file may change.

## 4. Steps

Setup (once): `git checkout task/0022-db-with-tenant && git log --oneline -1` (expect the last 0022a commit) and `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0022b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/src/tenant.ts`

```ts
// withTenant / withServiceRole (M12 §6, 05 §10.1). The worker connects as `app_worker` (no
// BYPASSRLS, migration 0003) and runs every tenant query inside withTenant(orgId, fn), which sets
// `app.org_id` for exactly one transaction; the <t>_worker policies then show that org only. A
// query outside withTenant sees zero rows. withServiceRole runs on the service connection
// (BYPASSRLS) and is allowed only for the four reasons of M12 §6.
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/tenancy';

export type DbSchema = typeof schema;
/** Drizzle database over postgres.js with the Shoebox schema. */
export type Db = PostgresJsDatabase<DbSchema>;
/** The transaction handle Drizzle passes to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

declare const TX_KIND: unique symbol;
/** A transaction on the worker connection with `app.org_id` set. Only withTenant creates one. */
export type TenantTx = Tx & { readonly [TX_KIND]: 'tenant' };
/** A transaction on the service connection (bypasses RLS). Only withServiceRole creates one. */
export type ServiceTx = Tx & { readonly [TX_KIND]: 'service' };

export const SERVICE_ROLE_REASONS = ['retention', 'export', 'admin', 'migration'] as const;
export type ServiceRoleReason = (typeof SERVICE_ROLE_REASONS)[number];

export interface DbConnections {
  /** Connection string of role `app_worker` (env `WORKER_DATABASE_URL`). */
  workerUrl: string;
  /** Connection string of the migrating/service role `postgres` (env `DATABASE_URL`). */
  serviceUrl: string;
}

export interface TenantDb {
  withTenant<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  withServiceRole<T>(reason: ServiceRoleReason, fn: (tx: ServiceTx) => Promise<T>): Promise<T>;
  /** Drizzle over the `app_worker` pool. Outside withTenant every tenant table reads as empty. */
  readonly worker: Db;
  /** Drizzle over the service pool. Migrations, retention, export and admin only. */
  readonly service: Db;
  /** Closes both pools. */
  close(): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isServiceRoleReason(reason: unknown): reason is ServiceRoleReason {
  return (SERVICE_ROLE_REASONS as readonly unknown[]).includes(reason);
}

/** Two pools (worker, service) and the two scoped transaction helpers over them. */
export function createTenantDb(conn: DbConnections, options: { max?: number } = {}): TenantDb {
  const poolOptions = { max: options.max ?? 4, onnotice: () => undefined };
  const workerSql: Sql = postgres(conn.workerUrl, poolOptions);
  const serviceSql: Sql = postgres(conn.serviceUrl, poolOptions);
  const worker: Db = drizzle(workerSql, { schema });
  const service: Db = drizzle(serviceSql, { schema });

  return {
    worker,
    service,
    withTenant(orgId, fn) {
      if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
        throw new TypeError('withTenant: orgId must be a UUID');
      }
      return worker.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
        return fn(tx as TenantTx);
      });
    },
    withServiceRole(reason, fn) {
      if (!isServiceRoleReason(reason)) {
        throw new TypeError(
          `withServiceRole: reason must be one of ${SERVICE_ROLE_REASONS.join('|')}`,
        );
      }
      return service.transaction((tx) => fn(tx as ServiceTx));
    },
    async close() {
      await Promise.all([workerSql.end(), serviceSql.end()]);
    },
  };
}

let defaultDb: TenantDb | undefined;

/** Sets the process-wide connections used by withTenant / withServiceRole. Call once at startup. */
export function configureDb(conn: DbConnections, options: { max?: number } = {}): TenantDb {
  defaultDb = createTenantDb(conn, options);
  return defaultDb;
}

function requireDb(): TenantDb {
  if (defaultDb === undefined) {
    throw new Error('packages/db: configureDb({ workerUrl, serviceUrl }) was not called');
  }
  return defaultDb;
}

/** Runs fn as `app_worker` inside one transaction scoped to orgId (05 §10.1). */
export function withTenant<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return requireDb().withTenant(orgId, fn);
}

/** Runs fn on the service connection; only for retention, export, admin or migration work. */
export function withServiceRole<T>(
  reason: ServiceRoleReason,
  fn: (tx: ServiceTx) => Promise<T>,
): Promise<T> {
  return requireDb().withServiceRole(reason, fn);
}

/** Closes the process-wide pools set by configureDb (no-op when not configured). */
export async function closeDb(): Promise<void> {
  const db = defaultDb;
  defaultDb = undefined;
  await db?.close();
}
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 2: edit `packages/db/src/index.ts`

After the anchor line (§2) append:

```ts
export {
  closeDb,
  configureDb,
  createTenantDb,
  type Db,
  type DbConnections,
  type DbSchema,
  SERVICE_ROLE_REASONS,
  type ServiceRoleReason,
  type ServiceTx,
  type TenantDb,
  type TenantTx,
  type Tx,
  withServiceRole,
  withTenant,
} from './tenant';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors; `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → no errors. Commit.

### Step 3: create `packages/db/test/with-tenant.db.test.ts`

Full file; do not edit it:

```ts
import { count, sql as dsql, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { memberships, organizations, taxpayerProfiles } from '../src/schema/tenancy';
import {
  closeDb,
  configureDb,
  createTenantDb,
  type Db,
  SERVICE_ROLE_REASONS,
  type ServiceRoleReason,
  type TenantDb,
  withServiceRole,
  withTenant,
} from '../src/tenant';

// Runs in the `db` vitest project against DATABASE_URL (service role `postgres`). The worker
// connection is WORKER_DATABASE_URL or, when unset, DATABASE_URL with the user replaced by
// `app_worker` (works on the trust-auth cluster of scripts/local-pg.sh). Skipped without
// DATABASE_URL. Never drops the schema: it only migrates forward and cleans its own rows.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_C = 'cccccccc-0000-4000-8000-000000000003';
const ORG_D = 'dddddddd-0000-4000-8000-000000000004';
const USER_C = '55555555-0000-4000-8000-000000000005';
const USER_D = '66666666-0000-4000-8000-000000000006';
const ROLLBACK = Symbol('rollback');

/** SQLSTATE of a postgres.js error, also when Drizzle wrapped it in DrizzleQueryError. */
function pgCode(e: unknown): string {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code ?? 'unknown';
}

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('0003: app_worker, withTenant, withServiceRole', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let workerUrl = '';
  let sql: Sql;
  let db: TenantDb;

  async function countAll(tx: Pick<Db, 'select'>) {
    const [o] = await tx.select({ n: count() }).from(organizations);
    const [m] = await tx.select({ n: count() }).from(memberships);
    const [p] = await tx.select({ n: count() }).from(taxpayerProfiles);
    return { organizations: o?.n ?? -1, memberships: m?.n ?? -1, taxpayerProfiles: p?.n ?? -1 };
  }

  beforeAll(async () => {
    workerUrl = process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl);
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`drop table if exists public.rls_probe`;
    await sql`insert into auth.users (id) values (${USER_C}), (${USER_D}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_C}, 'Org C', 'org-c', 'CCCCCCCC'), (${ORG_D}, 'Org D', 'org-d', 'DDDDDDDD')
      on conflict (id) do nothing`;
    await sql`insert into memberships (org_id, user_id, role)
      values (${ORG_C}, ${USER_C}, 'owner'), (${ORG_D}, ${USER_D}, 'owner')
      on conflict (org_id, user_id) do nothing`;
    await sql`insert into taxpayer_profiles
      (org_id, valid_from, vat_status, tax_regime, legal_name, ico, address)
      values (${ORG_C}, '2026-01-01', 'neplatce', 'pausalni_vydaje', 'C s.r.o.', '00000001', '{}'),
             (${ORG_D}, '2026-01-01', 'neplatce', 'pausalni_vydaje', 'D s.r.o.', '00000002', '{}')`;
    db = createTenantDb({ workerUrl, serviceUrl }, { max: 1 });
  });

  afterAll(async () => {
    await db?.close();
    await closeDb();
    await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
    await sql`delete from auth.users where id in (${USER_C}, ${USER_D})`;
    await sql?.end();
  });

  it('creates role app_worker with login, noinherit and no BYPASSRLS', async () => {
    const rows = await sql`select rolcanlogin, rolinherit, rolbypassrls, rolsuper
      from pg_roles where rolname = 'app_worker'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rolcanlogin: true,
      rolinherit: false,
      rolbypassrls: false,
      rolsuper: false,
    });
  });

  it.each(['organizations', 'memberships', 'taxpayer_profiles'])(
    '%s has a _worker policy for all commands restricted to app_worker',
    async (table) => {
      const rows = await sql`select cmd, roles, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = ${table} and policyname = ${`${table}_worker`}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cmd).toBe('ALL');
      expect(rows[0]?.roles).toEqual(['app_worker']);
      expect(rows[0]?.qual).toContain('app.current_org_id()');
      expect(rows[0]?.with_check).toContain('app.current_org_id()');
    },
  );

  it('app.apply_tenant_rls creates _select, _write and _worker on a new tenant table', async () => {
    try {
      await sql`create table public.rls_probe (id uuid primary key default gen_random_uuid(), org_id uuid not null)`;
      await sql`select app.apply_tenant_rls('rls_probe')`;
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = 'rls_probe' order by policyname`;
      expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
        ['rls_probe_select', 'SELECT'],
        ['rls_probe_worker', 'ALL'],
        ['rls_probe_write', 'ALL'],
      ]);
    } finally {
      await sql`drop table if exists public.rls_probe`;
    }
  });

  it('as app_worker without app.org_id every tenant table is empty', async () => {
    const [who] = await db.worker.execute<{ u: string; org: string | null }>(
      dsql`select current_user as u, app.current_org_id()::text as org`,
    );
    expect(who?.u).toBe('app_worker');
    expect(who?.org).toBeNull();
    expect(await countAll(db.worker)).toEqual({
      organizations: 0,
      memberships: 0,
      taxpayerProfiles: 0,
    });
  });

  it('withTenant(C) sees only org C and cannot write into org D', async () => {
    const seen = await db.withTenant(ORG_C, async (tx) => {
      const orgs = await tx.select({ id: organizations.id }).from(organizations);
      const profiles = await tx
        .select({ orgId: taxpayerProfiles.orgId })
        .from(taxpayerProfiles)
        .where(eq(taxpayerProfiles.orgId, ORG_D));
      const members = await tx.select({ orgId: memberships.orgId }).from(memberships);
      return { orgs: orgs.map((o) => o.id), crossProfiles: profiles.length, members };
    });
    expect(seen.orgs).toEqual([ORG_C]);
    expect(seen.crossProfiles).toBe(0);
    expect(seen.members.every((m) => m.orgId === ORG_C)).toBe(true);

    const code = await db
      .withTenant(ORG_C, (tx) =>
        tx.update(organizations).set({ name: 'hacked' }).where(eq(organizations.id, ORG_D)),
      )
      .then((r) => (r.count === 0 ? 'no-rows' : 'updated'), pgCode);
    expect(code).toBe('no-rows');

    const insertCode = await db
      .withTenant(ORG_C, (tx) =>
        tx.insert(taxpayerProfiles).values({
          orgId: ORG_D,
          validFrom: '2020-01-01',
          validTo: '2020-12-31',
          vatStatus: 'neplatce',
          taxRegime: 'pausalni_vydaje',
          legalName: 'X',
          ico: '00000003',
          address: {},
        }),
      )
      .then(() => null, pgCode);
    expect(insertCode).toBe('42501');
  });

  it('a throw inside withTenant rolls the transaction back and is rethrown', async () => {
    await expect(
      db.withTenant(ORG_C, async (tx) => {
        await tx.update(organizations).set({ name: 'rolled back' });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    const rows = await sql`select name from organizations where id = ${ORG_C}`;
    expect(rows[0]?.name).toBe('Org C');
  });

  it('app.org_id does not leak after commit; the next withTenant sees its own org', async () => {
    await db.withTenant(ORG_C, async (tx) => {
      await tx.update(organizations).set({ name: 'Org C' }).where(eq(organizations.id, ORG_C));
    });
    // Same pooled connection (max: 1), outside any transaction.
    const [after] = await db.worker.execute<{ org: string | null }>(
      dsql`select app.current_org_id()::text as org`,
    );
    expect(after?.org).toBeNull();
    expect(await countAll(db.worker)).toEqual({
      organizations: 0,
      memberships: 0,
      taxpayerProfiles: 0,
    });
    const orgsD = await db.withTenant(ORG_D, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    expect(orgsD.map((o) => o.id)).toEqual([ORG_D]);
  });

  it('withTenant rejects a non-UUID orgId before touching the database', () => {
    expect(() => db.withTenant('org-c', async () => undefined)).toThrow(TypeError);
    expect(() => db.withTenant('', async () => undefined)).toThrow(TypeError);
  });

  it('withServiceRole sees every org and accepts only the four reasons', async () => {
    expect(SERVICE_ROLE_REASONS).toEqual(['retention', 'export', 'admin', 'migration']);
    const ids = await db.withServiceRole('export', async (tx) => {
      const rows = await tx.select({ id: organizations.id }).from(organizations);
      return rows.map((r) => r.id);
    });
    expect(ids).toEqual(expect.arrayContaining([ORG_C, ORG_D]));
    expect(() => db.withServiceRole('cron' as ServiceRoleReason, async () => undefined)).toThrow(
      TypeError,
    );
  });

  it('module-level withTenant / withServiceRole need configureDb first, then delegate', async () => {
    expect(() => withTenant(ORG_C, async () => undefined)).toThrow(/configureDb/);
    expect(() => withServiceRole('admin', async () => undefined)).toThrow(/configureDb/);
    configureDb({ workerUrl, serviceUrl }, { max: 1 });
    const orgs = await withTenant(ORG_C, (tx) =>
      tx.select({ id: organizations.id }).from(organizations),
    );
    expect(orgs.map((o) => o.id)).toEqual([ORG_C]);
    const [n] = await withServiceRole('admin', (tx) =>
      tx.select({ n: count() }).from(organizations),
    );
    expect(n?.n).toBeGreaterThanOrEqual(2);
    await closeDb();
    expect(() => withTenant(ORG_C, async () => undefined)).toThrow(/configureDb/);
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  4 passed (4)` and `Tests  49 passed (49)`. If the local cluster is not available: `pnpm --filter @shoebox/db test 2>&1 | tail -8` → `28 passed | 21 skipped` (say so in the report). Commit. Then write the report (§9); the PR covers 0022a + 0022b.

## 5. Do not touch

`packages/db/migrations/**`, `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/schema/**`, `packages/db/test/migrations/**`, `packages/db/test/enums-parity.test.ts`, `packages/db/package.json`, `vitest.workspace.ts`, `docs/v3/**`. Hard rules: 3 (the test is the RLS case of this PR), 7 (no new dependency; `drizzle-orm` and `postgres` are already there), 8 (never push to `main`). `packages/db` never reads `process.env` in `src/` (the test does, as 0014b's test does). Never put a connection string with a password in any file.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                                        # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30    # Tests 49 passed (4 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30  # Tests 21 passed (2 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                                                   # without DATABASE_URL: 28 passed, 21 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                                              # exit 0
pnpm exec biome ci packages/db vitest.workspace.ts 2>&1 | tail -30                                               # No fixes applied
bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1                                                         # stopped
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); here `DATABASE_URL` from `local-pg.sh` replaces `db:start` because Docker is unavailable. The `rls` pattern matches no file yet (P0-DB-03 adds `test/rls/`); the worker cases live in `with-tenant.db.test.ts`.

## 7. Acceptance

- [ ] `with-tenant.db.test.ts`: 12 passed with `DATABASE_URL`, 12 skipped without; `tenancy.db.test.ts` still 9 passed.
- [ ] `grep -c 'process.env' packages/db/src/tenant.ts` → `0`.
- [ ] `grep -n "export function withTenant\|export function withServiceRole" packages/db/src/tenant.ts` → both lines, signatures as in M12 §6.
- [ ] `pnpm --filter @shoebox/db typecheck` exit 0; `pnpm exec biome ci packages/db` clean.
- [ ] PR `task/0022-db-with-tenant` → `phase/0` opened by the executor with both reports linked (title `0022: app_worker, withTenant, withServiceRole (P0-DB-02)`).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0022b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`packages/db/src/tenant.ts` (the `set_config` call is parameterized and `is_local = true`; `withTenant` runs on the **worker** pool and `withServiceRole` on the service pool, never swapped; the UUID check runs before any query), the test's "does not leak after commit" and "cannot write into org D" cases.

## Owner steps

1. After the PR merges: nothing to deploy yet. Before the worker ships (P0-WORK), set the `app_worker` password on Supabase (SQL editor: `alter role app_worker password '<generated>';`) and store `WORKER_DATABASE_URL` as a worker secret, as 0022a says.
2. Decide the env name if you dislike `WORKER_DATABASE_URL` (used only in comments, 05 §10.1 and the test fallback so far); say so in the review and the orchestrator renames it in a later brief.
