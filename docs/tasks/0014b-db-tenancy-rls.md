# 0014b: tenancy tables, RLS helpers and the database test

Status: review
Ticket: P0-DB-01 (part b of a/b/c) | Depends on: 0014a (same branch) | Base commit: head of task/0014-db-scaffold after 0014a | Branch: task/0014-db-scaffold | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migrate `organizations`, `memberships` and `taxpayer_profiles` (05 §2) together with `app.user_org_ids()`, `app.user_has_role()` and the `app.apply_tenant_rls()` helper (05 §10.1), apply owner-only writes to the three tables (05 §10.2), add the Drizzle schema and a database test that migrates from scratch and proves isolation between two orgs. Every tenant table from here on is protected by these three functions, so a hole here is a cross-tenant data leak.

The test runs against `DATABASE_URL`. Docker (and so `supabase start`) is not available in the executor sandbox, so this brief ships a small script that starts a plain Postgres 16 from the binaries already installed in the sandbox and adds a stand-in `auth` schema. The same test runs unchanged against local Supabase (P0-CI-02 adds the CI job).

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR."
- "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR."
- 05 conventions: `id uuid primary key default gen_random_uuid()`; every tenant table has `org_id … references organizations(id) on delete cascade`, an index that starts with `org_id`, RLS enabled; `updated_at` is kept by trigger `app.touch_updated_at`.
- 05 §10.1 Pattern (verbatim):

```sql
create function app.user_org_ids() returns setof uuid language sql stable security definer as $$
  select org_id from memberships where user_id = auth.uid()
$$;
create function app.user_has_role(p_org uuid, p_roles member_role[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles))
$$;
-- generated for every table with org_id (migration helper app.apply_tenant_rls(table, write_roles)):
alter table documents enable row level security;
create policy documents_select on documents for select using (org_id in (select app.user_org_ids()));
create policy documents_write  on documents for all
  using (app.user_has_role(org_id, '{owner,member}')) with check (app.user_has_role(org_id, '{owner,member}'));
```

- 05 §10.1: "Default write roles = `owner`, `member`. `accountant` and `viewer` read everything in the org." The `app_worker` role and `<t>_worker` policies are P0-DB-02 (brief later), not this brief.
- 05 §10.2: `memberships`, `taxpayer_profiles`, `organizations`: write owner only. (For `organizations` the org id column is `id`, hence the third helper parameter.)
- 05 §2 `invitations` is not in this ticket's Goal (Phase 2 table); it comes with a later DB ticket. Say so in the report.
- Supabase: `auth.uid()` reads the JWT subject from `request.jwt.claim.sub` / `request.jwt.claims`; the tests set it with `set_config(..., true)` inside a transaction and `set local role authenticated`. On a plain Postgres the shim script creates the same roles, `auth.users` and `auth.uid()`.
- `security definer` functions are owned by the migrating role (`postgres`), which bypasses RLS on Supabase (BYPASSRLS) and locally (superuser), so the membership lookup cannot recurse into the memberships policies.
- Root `vitest.workspace.ts`: the `db` project includes only `packages/db/test/**/*.db.test.ts`; the `unit` project (CI today) excludes them. The test file is therefore `tenancy.db.test.ts` (the ticket wrote `tenancy.test.ts`; same test, name follows the workspace convention). It skips itself when `DATABASE_URL` is unset so `pnpm test:unit` stays green.

Current `packages/db/migrations/meta/_journal.json` after 0014a (anchor for step 2):

```json
    { "idx": 0, "version": "7", "when": 1760745600000, "tag": "0001_enums", "breakpoints": true }
```

Current `packages/db/src/index.ts` after 0014a (anchor for step 6):

```ts
export const packageName = '@shoebox/db' as const;
export * from './schema/enums';
```

All code below was run once by the brief writer against `phase/0` + 0014a on Postgres 16.15 (plain cluster + shim): migrations apply, `drizzle-kit migrate` applies them too, `tsc` clean, `biome ci` clean, 9 database tests + 27 parity tests pass.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0002_tenancy.sql` | create | 3 tables, trigger, 3 `app.*` functions, RLS applied |
| `packages/db/migrations/meta/_journal.json` | edit | entry 1 |
| `packages/db/scripts/supabase-shim.sql` | create | roles, `auth.users`, `auth.uid()` for a plain Postgres |
| `packages/db/scripts/local-pg.sh` | create | start/stop a local Postgres 16 and print `DATABASE_URL` |
| `packages/db/src/migrate.ts` | create | `runMigrations(databaseUrl)` |
| `packages/db/src/schema/tenancy.ts` | create | Drizzle mirror of the three tables |
| `packages/db/src/index.ts` | edit | export migrate + tenancy |
| `packages/db/test/migrations/tenancy.db.test.ts` | create | from-scratch migrate, enum parity, exclusion, RLS |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin task/0014-db-scaffold && git checkout task/0014-db-scaffold && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0001_enums.sql` to exist: `ls packages/db/migrations`).

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0014b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/migrations/0002_tenancy.sql`

```sql
-- 0002_tenancy: organizations, memberships, taxpayer_profiles (05 §2), the RLS helpers
-- app.user_org_ids(), app.user_has_role(), app.apply_tenant_rls() (05 §10.1) and the owner-only
-- write rule for these three tables (05 §10.2). Forward-only. invitations (05 §2) is a later ticket.

-- updated_at trigger (05 conventions)
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text, dic text,
  inbound_email_slug text unique not null,          -- local part of {slug}-{secret}@in.<domain>
  inbound_email_secret text not null,               -- 8 chars Crockford base32, rotatable (M01 §4.10)
  inbound_email_secret_prev text,                   -- still accepted until _prev_until (rotation grace, 7 days)
  inbound_email_secret_prev_until timestamptz,
  settings jsonb not null default '{}',             -- zod OrgSettings
  closed_at timestamptz, archive_mode boolean not null default false,   -- account closure (M12 §4.6)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create trigger organizations_touch_updated_at before update on organizations
  for each row execute function app.touch_updated_at();

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  invited_by uuid references auth.users(id),
  prefs jsonb not null default '{}',                -- per-user UI + notification prefs (zod MembershipPrefs)
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_id on memberships (user_id);

create table taxpayer_profiles (                     -- effective-dated; no overlaps per org (exclusion constraint)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  valid_from date not null, valid_to date,           -- null = open-ended
  vat_status vat_status not null,
  vat_period vat_period,
  tax_regime tax_regime not null,
  pausal_rate smallint check (pausal_rate in (80,60,40,30)),
  pausal_dan_band smallint check (pausal_dan_band in (1,2,3)),
  entity_type text not null default 'osvc' check (entity_type in ('osvc','sro')),
  legal_name text not null, ico text not null, dic text,
  first_name text, last_name text, title text,       -- EPO VetaP (M05 §4.7, M06 §4.10)
  filing_email text, filing_phone text,
  address jsonb not null,                            -- {street, house_number, orientation_number, city, zip, country}
  fu_code text, ufo_code text, main_activity_nace text,
  insurer text check (insurer in ('vzp','vozp','cpzp','ozp','zpskoda','zpmv','rbp')),
  has_accountant boolean not null default false,
  foreign_service_dppd_policy text not null default 'service_period_end'
    check (foreign_service_dppd_policy in ('service_period_end','issue_date')),
  created_at timestamptz not null default now(),
  exclude using gist (org_id with =, daterange(valid_from, coalesce(valid_to,'infinity'::date), '[]') with &&)
);
create index taxpayer_profiles_org_id_valid_from on taxpayer_profiles (org_id, valid_from);

-- RLS helpers (05 §10.1). security definer: the owner (postgres) bypasses RLS on memberships,
-- so the lookup cannot recurse into the memberships policies.
create function app.user_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid()
$$;
create function app.user_has_role(p_org uuid, p_roles member_role[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)
  )
$$;

-- Migration helper: enables RLS on a tenant table and creates <t>_select / <t>_write (05 §10.1).
-- p_org_column is 'id' for organizations itself. Re-runnable (drops the two policies first).
create function app.apply_tenant_rls(
  p_table text,
  p_write_roles member_role[] default '{owner,member}',
  p_org_column text default 'org_id'
) returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format(
    'create policy %I on public.%I for select using (%I in (select app.user_org_ids()))',
    p_table || '_select', p_table, p_org_column);
  execute format('drop policy if exists %I on public.%I', p_table || '_write', p_table);
  execute format(
    'create policy %I on public.%I for all using (app.user_has_role(%I, %L::member_role[])) '
    || 'with check (app.user_has_role(%I, %L::member_role[]))',
    p_table || '_write', p_table, p_org_column, p_write_roles, p_org_column, p_write_roles);
  -- Supabase grants these by default privileges; plain Postgres (local test cluster) does not.
  execute format('grant select, insert, update, delete on public.%I to authenticated', p_table);
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
grant execute on function app.user_org_ids() to anon, authenticated, service_role;
grant execute on function app.user_has_role(uuid, member_role[]) to anon, authenticated, service_role;

-- 05 §10.2: memberships, taxpayer_profiles, organizations are written by owners only.
select app.apply_tenant_rls('organizations', '{owner}', 'id');
select app.apply_tenant_rls('memberships', '{owner}');
select app.apply_tenant_rls('taxpayer_profiles', '{owner}');
```

Command: `grep -c 'apply_tenant_rls' packages/db/migrations/0002_tenancy.sql` → `5`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor line (§2) with these two lines:

```json
    { "idx": 0, "version": "7", "when": 1760745600000, "tag": "0001_enums", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1760745600001, "tag": "0002_tenancy", "breakpoints": true }
```

Command: `node -e "const j=JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8')); console.log(j.entries.map(e=>e.tag).join(','))"` → `0001_enums,0002_tenancy`. Commit.

### Step 3: create `packages/db/scripts/supabase-shim.sql`

```sql
-- Stand-in for the objects a Supabase database already has (roles, schema auth, auth.uid()).
-- Applied ONLY to a plain Postgres 16 started by scripts/local-pg.sh; never to Supabase. Idempotent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
-- Same definition as Supabase: the user id comes from the JWT claim set on the connection.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
```

Command: `grep -c 'create role' packages/db/scripts/supabase-shim.sql` → `3`. Commit.

### Step 4: create `packages/db/scripts/local-pg.sh`

```bash
#!/usr/bin/env bash
# Plain Postgres 16 for the db tests where Docker (and so `supabase start`) is not available.
# Usage: packages/db/scripts/local-pg.sh start|stop|url   (needs the `postgres` OS user; runs as root or as postgres)
# After `start`, export the printed DATABASE_URL and run `pnpm test:db`.
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDIR="${SHOEBOX_PGDIR:-/var/lib/postgresql/shoebox-local}"
PGPORT="${SHOEBOX_PGPORT:-54399}"
DBNAME="shoebox_test"
URL="postgresql://postgres@127.0.0.1:${PGPORT}/${DBNAME}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" = "0" ]; then AS_PG=(runuser -u postgres --); else AS_PG=(); fi

case "${1:-}" in
  start)
    if [ ! -d "$PGDIR/data" ]; then
      "${AS_PG[@]}" mkdir -p "$PGDIR"
      "${AS_PG[@]}" "$PGBIN/initdb" -D "$PGDIR/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
    fi
    if ! "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" status >/dev/null 2>&1; then
      "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" -l "$PGDIR/pg.log" \
        -o "-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1" -w start >/dev/null
    fi
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q -tAc \
      "select 1 from pg_database where datname = '$DBNAME'" | grep -q 1 \
      || psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q -c "create database $DBNAME"
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -q -f "$HERE/supabase-shim.sql"
    echo "DATABASE_URL=$URL"
    ;;
  stop)
    "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" -m fast stop >/dev/null
    echo "stopped"
    ;;
  url)
    echo "DATABASE_URL=$URL"
    ;;
  *)
    echo "usage: $0 start|stop|url" >&2
    exit 2
    ;;
esac
```

Command: `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -3` → last line `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines about existing objects are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, stop (§8) and write that in the report; steps 5 to 8 can still be written and typechecked, only the database run is blocked. Commit.

### Step 5: create `packages/db/src/migrate.ts`

```ts
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Absolute path of `packages/db/migrations` (SQL files + `meta/_journal.json`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Schema that holds Drizzle's migration ledger (`drizzle.__drizzle_migrations`). */
export const MIGRATIONS_SCHEMA = 'drizzle';

/**
 * Applies every migration listed in `migrations/meta/_journal.json` that is not yet recorded,
 * in journal order, each in its own transaction. Forward-only. Safe to call twice.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
  } finally {
    await sql.end();
  }
}
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 6: create `packages/db/src/schema/tenancy.ts`

```ts
// Drizzle mirror of migrations/0002_tenancy.sql (05 §2). The SQL file is the source of truth for
// DDL; this file gives typed queries. The exclusion constraint on taxpayer_profiles, the
// updated_at trigger and the RLS policies exist only in SQL (Drizzle has no API for them).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { memberRoleEnum, taxRegimeEnum, vatPeriodEnum, vatStatusEnum } from './enums';

/** Supabase Auth's users table (managed by Supabase; referenced, never migrated here). */
export const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ico: text('ico'),
  dic: text('dic'),
  inboundEmailSlug: text('inbound_email_slug').notNull().unique(),
  inboundEmailSecret: text('inbound_email_secret').notNull(),
  inboundEmailSecretPrev: text('inbound_email_secret_prev'),
  inboundEmailSecretPrevUntil: timestamp('inbound_email_secret_prev_until', { withTimezone: true }),
  settings: jsonb('settings').notNull().default({}),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  archiveMode: boolean('archive_mode').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    invitedBy: uuid('invited_by').references(() => authUsers.id),
    prefs: jsonb('prefs').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_id').on(t.userId)],
);

export const taxpayerProfiles = pgTable(
  'taxpayer_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    vatStatus: vatStatusEnum('vat_status').notNull(),
    vatPeriod: vatPeriodEnum('vat_period'),
    taxRegime: taxRegimeEnum('tax_regime').notNull(),
    pausalRate: smallint('pausal_rate'),
    pausalDanBand: smallint('pausal_dan_band'),
    entityType: text('entity_type').notNull().default('osvc'),
    legalName: text('legal_name').notNull(),
    ico: text('ico').notNull(),
    dic: text('dic'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    title: text('title'),
    filingEmail: text('filing_email'),
    filingPhone: text('filing_phone'),
    address: jsonb('address').notNull(),
    fuCode: text('fu_code'),
    ufoCode: text('ufo_code'),
    mainActivityNace: text('main_activity_nace'),
    insurer: text('insurer'),
    hasAccountant: boolean('has_accountant').notNull().default(false),
    foreignServiceDppdPolicy: text('foreign_service_dppd_policy')
      .notNull()
      .default('service_period_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('taxpayer_profiles_org_id_valid_from').on(t.orgId, t.validFrom),
    check('taxpayer_profiles_pausal_rate_check', sql`${t.pausalRate} in (80,60,40,30)`),
    check('taxpayer_profiles_pausal_dan_band_check', sql`${t.pausalDanBand} in (1,2,3)`),
    check('taxpayer_profiles_entity_type_check', sql`${t.entityType} in ('osvc','sro')`),
    check(
      'taxpayer_profiles_insurer_check',
      sql`${t.insurer} in ('vzp','vozp','cpzp','ozp','zpskoda','zpmv','rbp')`,
    ),
    check(
      'taxpayer_profiles_foreign_service_dppd_policy_check',
      sql`${t.foreignServiceDppdPolicy} in ('service_period_end','issue_date')`,
    ),
  ],
);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 7: edit `packages/db/src/index.ts`

Replace the whole file (anchor in §2) with:

```ts
export const packageName = '@shoebox/db' as const;
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
export * from './schema/enums';
export * from './schema/tenancy';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 8: create `packages/db/test/migrations/tenancy.db.test.ts`

Full file; do not edit it:

```ts
import { ENUMS } from '@shoebox/domain';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// Runs in the `db` vitest project (root vitest.workspace.ts) against DATABASE_URL: local Supabase
// (`pnpm db:start`) or a plain Postgres 16 prepared by packages/db/scripts/local-pg.sh.
// Skipped without DATABASE_URL so `pnpm test:unit` and a bare `vitest run` stay green.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const OWNER_A = '11111111-0000-4000-8000-000000000001';
const MEMBER_A = '22222222-0000-4000-8000-000000000002';
const VIEWER_A = '33333333-0000-4000-8000-000000000003';
const OWNER_B = '44444444-0000-4000-8000-000000000004';
const TENANT_TABLES = ['organizations', 'memberships', 'taxpayer_profiles'] as const;

const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('0001 + 0002: enums, tenancy tables and RLS', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  /** Runs fn as `authenticated` with the given JWT subject (null = anonymous) and rolls back. */
  async function as<T>(uid: string | null, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        if (uid !== null) {
          await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
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
  async function errorCodeAs(
    uid: string | null,
    fn: (tx: TransactionSql) => Promise<unknown>,
  ): Promise<string | null> {
    try {
      await as(uid, fn);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }

  function insertProfile(
    tx: TransactionSql,
    orgId: string,
    validFrom: string,
    validTo: string | null,
  ): Promise<unknown> {
    return tx`insert into taxpayer_profiles
      (org_id, valid_from, valid_to, vat_status, tax_regime, legal_name, ico, address)
      values (${orgId}, ${validFrom}, ${validTo}, 'neplatce', 'pausalni_vydaje', 'Test s.r.o.', '00000000', '{}')`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    // From scratch: drop everything 0001/0002 create (extensions and auth stay).
    const dropTypes = Object.keys(ENUMS)
      .map((name) => `drop type if exists public.${name} cascade;`)
      .join('\n');
    await sql.unsafe(`
      drop schema if exists drizzle cascade;
      drop table if exists public.taxpayer_profiles, public.memberships, public.organizations cascade;
      drop schema if exists app cascade;
      ${dropTypes}
    `);
    await runMigrations(url);
    await runMigrations(url); // idempotent
    await sql`insert into auth.users (id) values (${OWNER_A}), (${MEMBER_A}), (${VIEWER_A}), (${OWNER_B})
      on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_A}, 'Org A', 'org-a', 'AAAAAAAA'), (${ORG_B}, 'Org B', 'org-b', 'BBBBBBBB')`;
    await sql`insert into memberships (org_id, user_id, role) values
      (${ORG_A}, ${OWNER_A}, 'owner'), (${ORG_A}, ${MEMBER_A}, 'member'),
      (${ORG_A}, ${VIEWER_A}, 'viewer'), (${ORG_B}, ${OWNER_B}, 'owner')`;
    await sql.begin((tx) => insertProfile(tx, ORG_A, '2026-01-01', null));
    await sql.begin((tx) => insertProfile(tx, ORG_B, '2026-01-01', null));
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('migrates from scratch and records both migrations once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(2);
    const tables =
      await sql`select tablename from pg_tables where schemaname = 'public' order by 1`;
    expect(tables.map((r) => r.tablename)).toEqual([
      'memberships',
      'organizations',
      'taxpayer_profiles',
    ]);
  });

  it('Postgres enum values equal @shoebox/domain ENUMS', async () => {
    const rows = await sql<{ name: string; labels: string[] }[]>`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
      group by t.typname`;
    const db = Object.fromEntries(rows.map((r) => [r.name, r.labels]));
    expect(Object.keys(db).sort()).toEqual(Object.keys(ENUMS).sort());
    for (const [name, values] of Object.entries(ENUMS)) {
      expect(db[name], name).toEqual([...values]);
    }
  });

  it('rejects overlapping taxpayer_profiles segments of one org (exclusion constraint)', async () => {
    const overlap = await sql
      .begin((tx) => insertProfile(tx, ORG_A, '2026-06-01', '2026-12-31'))
      .then(
        () => null,
        (e: { code?: string }) => e.code ?? 'unknown',
      );
    expect(overlap).toBe('23P01');
    // A segment that ends before the open-ended one starts is fine; rolled back.
    const before = await sql
      .begin(async (tx) => {
        await insertProfile(tx, ORG_A, '2025-01-01', '2025-12-31');
        throw ROLLBACK;
      })
      .then(
        () => null,
        (e: unknown) => (e === ROLLBACK ? null : (e as { code?: string }).code),
      );
    expect(before).toBeNull();
  });

  it.each(TENANT_TABLES)('%s has RLS enabled with _select and _write policies', async (table) => {
    const rel = await sql`select relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}`;
    expect(rel[0]?.relrowsecurity).toBe(true);
    const policies = await sql`select policyname, cmd from pg_policies
      where schemaname = 'public' and tablename = ${table} order by policyname`;
    expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
      [`${table}_select`, 'SELECT'],
      [`${table}_write`, 'ALL'],
    ]);
  });

  it('an anonymous session sees no rows', async () => {
    for (const table of TENANT_TABLES) {
      const rows = await as(null, (tx) => tx`select count(*)::int as n from ${tx(table)}`);
      expect(rows[0]?.n, table).toBe(0);
    }
  });

  it('members of org A see only org A rows; org B owner sees only org B', async () => {
    for (const uid of [OWNER_A, MEMBER_A, VIEWER_A]) {
      const orgs = await as(uid, (tx) => tx`select id from organizations order by id`);
      expect(
        orgs.map((o) => o.id),
        uid,
      ).toEqual([ORG_A]);
      const members = await as(uid, (tx) => tx`select distinct org_id from memberships`);
      expect(
        members.map((m) => m.org_id),
        uid,
      ).toEqual([ORG_A]);
      const profiles = await as(uid, (tx) => tx`select distinct org_id from taxpayer_profiles`);
      expect(
        profiles.map((p) => p.org_id),
        uid,
      ).toEqual([ORG_A]);
    }
    const orgsB = await as(OWNER_B, (tx) => tx`select id from organizations`);
    expect(orgsB.map((o) => o.id)).toEqual([ORG_B]);
    const profilesB = await as(OWNER_B, (tx) => tx`select org_id from taxpayer_profiles`);
    expect(profilesB.map((p) => p.org_id)).toEqual([ORG_B]);
  });

  it('only the owner writes organizations, memberships and taxpayer_profiles (05 §10.2)', async () => {
    // owner: update own org (trigger touches updated_at), insert profile and membership in own org
    const updated = await as(OWNER_A, async (tx) => {
      const rows = await tx`update organizations set name = 'Org A renamed' where id = ${ORG_A}
        returning updated_at > created_at as touched`;
      return rows;
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.touched).toBe(true);
    expect(
      await errorCodeAs(OWNER_A, (tx) => insertProfile(tx, ORG_A, '2020-01-01', '2020-12-31')),
    ).toBeNull();
    expect(
      await errorCodeAs(
        OWNER_A,
        (tx) =>
          tx`insert into memberships (org_id, user_id, role) values (${ORG_A}, ${OWNER_B}, 'viewer')`,
      ),
    ).toBeNull();

    // member and viewer: updates touch 0 rows, inserts fail with insufficient_privilege (42501)
    for (const uid of [MEMBER_A, VIEWER_A]) {
      const rows = await as(
        uid,
        (tx) => tx`update organizations set name = 'x' where id = ${ORG_A} returning id`,
      );
      expect(rows, uid).toHaveLength(0);
      const touched = await as(
        uid,
        (tx) => tx`update taxpayer_profiles set dic = 'CZ1' where org_id = ${ORG_A} returning id`,
      );
      expect(touched, uid).toHaveLength(0);
      expect(
        await errorCodeAs(uid, (tx) => insertProfile(tx, ORG_A, '2020-01-01', '2020-12-31')),
        uid,
      ).toBe('42501');
      expect(
        await errorCodeAs(
          uid,
          (tx) =>
            tx`insert into memberships (org_id, user_id, role) values (${ORG_A}, ${OWNER_B}, 'viewer')`,
        ),
        uid,
      ).toBe('42501');
      const deleted = await as(
        uid,
        (tx) => tx`delete from memberships where org_id = ${ORG_A} returning user_id`,
      );
      expect(deleted, uid).toHaveLength(0);
    }

    // an owner of A cannot write into B
    expect(
      await errorCodeAs(OWNER_A, (tx) => insertProfile(tx, ORG_B, '2020-01-01', '2020-12-31')),
    ).toBe('42501');
    const crossUpdate = await as(
      OWNER_A,
      (tx) => tx`update organizations set name = 'x' where id = ${ORG_B} returning id`,
    );
    expect(crossUpdate).toHaveLength(0);
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations 2>&1 | tail -10` → `Tests  9 passed (9)`. If step 4 was blocked: `pnpm --filter @shoebox/db test -- migrations 2>&1 | tail -5` → `Tests  9 skipped (9)` (and say so in the report). Commit.

## 5. Do not touch

`packages/db/migrations/0001_enums.sql`, `packages/db/src/schema/enums.ts`, `packages/db/test/enums-parity.test.ts`, `packages/db/package.json`, `packages/domain/**`, root `package.json`, `vitest.workspace.ts`, `docs/v3/**`. Hard rules: 3 (RLS + test in the same PR: steps 1 and 8), 5 (table and column names are 05 §2 verbatim), 7 (no new dependency; the test uses `postgres` from 0014a), 8 (never push to `main`). Never run the shim against a Supabase database. Do not create the `app_worker` role (P0-DB-02).

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -3                     # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations 2>&1 | tail -30   # Tests 9 passed
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30                 # Tests 37 passed (3 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30               # same 9 tests through the root `db` project
pnpm --filter @shoebox/db test 2>&1 | tail -30                                # without DATABASE_URL: 28 passed, 9 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                           # exit 0
pnpm lint 2>&1 | tail -30                                                     # No fixes applied
bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1                      # stopped
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); here `DATABASE_URL` replaces `db:start` because Docker is unavailable. The `rls` pattern matches no file yet (the M12 §4.4 meta-test suite is a later ticket); the RLS cases live in `tenancy.db.test.ts`.

## 7. Acceptance

- [ ] `packages/db/migrations/0002_tenancy.sql` creates `organizations`, `memberships`, `taxpayer_profiles`, `app.touch_updated_at()`, `app.user_org_ids()`, `app.user_has_role()`, `app.apply_tenant_rls()` and applies RLS to the three tables; `drizzle-kit migrate`/`runMigrations` apply 0001 + 0002 from scratch.
- [ ] `packages/db/test/migrations/tenancy.db.test.ts` (ticket name `tenancy.test.ts`; `.db.` suffix per the root vitest workspace): from-scratch migrate; overlapping profile segments rejected by the exclusion constraint (`23P01`); RLS enabled with `_select`/`_write` policies per 05 §10.1 on every table; owner-only writes per 05 §10.2 (member and viewer: 0 rows updated, inserts `42501`; owner of A cannot write B). 9 tests pass against `DATABASE_URL`.
- [ ] Postgres enum values equal `packages/domain` ENUMS against the live database (test 2) and in the SQL text (0014a).
- [ ] `packages/db/src/schema/tenancy.ts` typechecks and mirrors 05 §2 column for column.
- [ ] `pnpm lint`, `pnpm --filter @shoebox/db typecheck` pass; `pnpm --filter @shoebox/db test` without `DATABASE_URL` skips the db test instead of failing.
- Not in this part: `supabase/config.toml` and the root `db:start`/`db:reset`/`db:migrate` scripts (0014c); `invitations` (later DB ticket); `app_worker` (P0-DB-02); the CI `db` job (P0-CI-02).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- `local-pg.sh start` fails (write the exact error; finish steps 5 to 8 with typecheck only);
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0014b-report.md` (600 tokens at most) and set `Status: review`. Then `git push origin task/0014-db-scaffold 2>&1 | tail -3`. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -20`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/db/migrations/0002_tenancy.sql`: read every line. Check: the three `create table` blocks match 05 §2 column for column; both functions are `security definer` with `set search_path = public`; `apply_tenant_rls` uses `%I` for identifiers and `%L` for the role array (no string concatenation of untrusted input); `grant` lines go to `anon, authenticated, service_role` only; the three `select app.apply_tenant_rls(...)` calls pass `'{owner}'` (05 §10.2), and `'id'` for `organizations`.
- `packages/db/scripts/supabase-shim.sql`: must never be run against Supabase (it would `create or replace` `auth.uid()`); the script only runs it on the local plain cluster.
- `packages/db/test/migrations/tenancy.db.test.ts`: the `beforeAll` drops `drizzle`, `app`, the three tables and the 25 types. It is meant for a throwaway database; the reviewer confirms nothing points `DATABASE_URL` at a shared database (P0-CI-02 will use the Supabase local stack).
- Known gaps for later tickets: a brand-new user has no membership yet, so creating the first organization and owner membership must run server-side with the service role (sign-up flow, M10); `app_worker` policies (P0-DB-02); the M12 §4.4 catalog meta-test.

## Owner steps

1. None for this part. When P0-CI-02 arrives, the CI `db` job will run `supabase start` (Docker) and set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`; nothing to create or configure now.
