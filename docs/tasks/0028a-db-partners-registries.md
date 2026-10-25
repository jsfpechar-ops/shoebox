# 0028a: migration 0004 (partners, registries, categories, vendor_profiles), factories, RLS suite green

Status: todo
Ticket: P0-DB-04 (part a of a/b) | Depends on: 0025b merged (PR #48) | Base commit: cb71a1f (head of phase/0) | Branch: task/0028-db-partners | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0004_partners_registries` creates the 05 §3 tables (`partners`, `partner_bank_accounts` and the global `registry_cache`, `fx_rates`, `bank_codes`, `categories`) and the 05 §5 table `vendor_profiles`, with RLS for the three tenant tables and the exact grants of 05 §10.3 for the four global ones. The testkit gets their factories and the RLS suite a generic "create the parent row" helper, so the catalog-driven suite stays green with child tables; the from-scratch migration test stops hard-coding the table list, so later slices do not touch it. 0028b adds the Drizzle mirror, the migration test and the 05 edit on the same branch.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, FX `numeric(12,6)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory, and for any table without `org_id` that is not in `GLOBAL_TABLES` (whose grants it checks: `authenticated` has exactly `[SELECT]` or nothing, `anon` nothing). `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`.
- 05 §3 and §5 DDL: pasted verbatim into the migration of step 1 (the only differences from 05: the `updated_at` trigger on `partners`, the RLS and grant lines at the end, a `-- 05 §5` comment). 05 §5: "`global_vendor_priors` (cross-tenant priors) is **Later** (§9.1)": not created.
- 05 §10.3: "`categories` (read: authenticated), `fx_rates`, `bank_codes` (read: authenticated), `registry_cache`, `rules_overrides`, `staff_users`, `rate_limit_counters` (service role only) … The RLS meta-test (M12 §4.4) holds this list as its allowlist". `rls-catalog.ts` already lists all four global tables of this slice and needs no change.
- Grants, brief-writer decisions (verified; owner question in the report of 0028b): (1) Supabase's default privileges grant everything on a new table to `anon`, `authenticated`, `service_role`, so the migration revokes from `anon`, `authenticated` and re-grants exactly (no-ops on plain Postgres). (2) `app_worker` (0003) is granted per table because 0003's `grant … on all tables` covered only the tables that existed then: select on the three read tables, select/insert/update/delete on `registry_cache` (the pipeline caches ARES/VIES lookups as the worker; 05 §10.3 "service role only" is about app roles, 0028b writes this into 05).
- Factories and foreign keys (brief-writer design, verified): a child factory (`partner_bank_accounts`, `vendor_profiles`) puts a fresh `ctx.ids.next()` into its FK column; `ensureParentRows()` (step 5, in `test/rls/helpers.ts`) reads the single-column FKs of the table from `pg_constraint` and inserts the missing parent with the parent's own factory (`{ id: value }` override) as the service role, recursively. Every build is therefore insertable on its own, unique keys per build hold (`(org_id, ico)` from the id counter, `(org_id, partner_id)` by the fresh partner), and the roles test's "owner inserts a second row" case gets `null`, not `23505`. Array columns (`email_domains`) are left to their SQL default because `toParams()` sends arrays as json.
- `test/migrations/tenancy.db.test.ts` drops a hard-coded table list before migrating from scratch and asserts `3` migrations; with 0004 the drop would leave `partners` behind and `create table` would fail. Step 6 makes it drop every public table and compare the count with `meta/_journal.json`.

Anchors (`origin/phase/0` at cb71a1f):

`packages/db/migrations/meta/_journal.json` (step 2), the last entry:

```json
      "tag": "0003_app_worker",
      "breakpoints": true
    }
  ]
```

`packages/testkit/src/factories/index.ts` (step 4), three anchors:

```ts
import { tenancyFactories } from './tenancy';
```

```ts
export { membershipFactory, organizationFactory, taxpayerProfileFactory } from './tenancy';
```

```ts
 * below (a tenant table without a factory fails the RLS meta-test). tenancy.ts covers 0002.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of tenancyFactories) {
  tenantFactories.define(table, factory);
}
```

`packages/db/test/rls/helpers.ts` (step 5), three anchors:

```ts
  await ensureAuthUsers(sql, table, row);
  await insertRow(sql, table, row);
  return row;
}
```

```ts
 * Builds a fresh factory row of `table` for `ctx.orgId` and creates its `auth.users` targets with
 * the service connection. Call it before asUser (the service pool has one connection).
 */
export async function buildRow(sql: Sql, table: string, ctx: FactoryContext): Promise<Row> {
  const row = factoryFor(table)(ctx);
  await ensureAuthUsers(sql, table, row);
  return row;
}
```

`packages/db/test/migrations/tenancy.db.test.ts` (step 6), six anchors:

```ts
import { runMigrations } from '../../src/migrate';
```

```ts
const ROLLBACK = Symbol('rollback');
```

```ts
    // From scratch: drop everything 0001/0002 create (extensions and auth stay).
```

```ts
      drop table if exists public.taxpayer_profiles, public.memberships, public.organizations cascade;
```

```ts
  it('migrates from scratch and records all three migrations once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(3);
```

```ts
    expect(tables.map((r) => r.tablename)).toEqual([
      'memberships',
      'organizations',
      'taxpayer_profiles',
    ]);
```

All code below was run by the brief writer on `origin/phase/0` at cb71a1f (PR #49 merged: 0025a/b RLS suite, 0023c, 0027, 0026b) against Postgres 16 (plain cluster + shim): migrations apply from scratch through `runMigrations` and twice through `drizzle-kit migrate` (second run a no-op), `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0004_partners_registries.sql` | create | 7 tables, RLS, grants |
| `packages/db/migrations/meta/_journal.json` | edit | entry 3 |
| `packages/testkit/src/factories/partners.ts` | create | 3 factories |
| `packages/testkit/src/factories/index.ts` | edit | register them |
| `packages/db/test/rls/helpers.ts` | edit | `ensureParentRows()` in `insertFactoryRow` and `buildRow` |
| `packages/db/test/migrations/tenancy.db.test.ts` | edit | from scratch drops every public table; count = journal |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1: lines 136–227
- Step 2: lines 231–247
- Step 3: lines 251–315
- Step 4: lines 319–349
- Step 5: lines 353–425
- Step 6: lines 429–481

Setup (once): `git fetch origin phase/0 && git checkout -b task/0028-db-partners origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/test/rls/roles.db.test.ts` and `packages/db/src/rls-catalog.ts` to exist: `ls packages/db/test/rls packages/db/src`; if not, STOP: 0025b is not merged). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0028a step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/migrations/0004_partners_registries.sql`

```sql
-- 0004_partners_registries: 05 §3 Partners and registries (partners, partner_bank_accounts and the
-- global tables registry_cache, fx_rates, bank_codes, categories) and 05 §5 Classification support
-- (vendor_profiles). Tenant tables get their three policies through app.apply_tenant_rls()
-- (05 §10.1). Global tables have no org_id and no RLS (05 §10.3): app roles only read them, and
-- only where 05 says so. global_vendor_priors is Later (05 §9.1) and is not created. Forward-only.

create table partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  ico text, dic text, vat_id text,                   -- vat_id = foreign VAT (IE…, NL…)
  country char(2) not null default 'CZ',
  address jsonb,
  is_vat_payer boolean, is_unreliable_payer boolean,
  registry_checked_at timestamptz,
  email_domains text[] not null default '{}',        -- learned from inbound e-mails
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, ico), unique (org_id, vat_id)
);
create trigger partners_touch_updated_at before update on partners
  for each row execute function app.touch_updated_at();

create table partner_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  account_number text, bank_code text, iban text, bic text,
  published_in_crpdph boolean, checked_at timestamptz,
  unique (org_id, partner_id, iban)
);

create table registry_cache (                        -- GLOBAL, service role only
  source text not null check (source in ('ares','crpdph','vies')),
  key text not null,                                 -- IČO / DIČ / VAT ID
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source, key)
);
create table fx_rates (                              -- GLOBAL; ČNB daily fixing
  rate_date date not null, currency char(3) not null,
  amount integer not null, rate numeric(12,6) not null,
  published_at timestamptz not null,
  primary key (rate_date, currency)
);
create table bank_codes (                            -- GLOBAL; ČNB bank code list, monthly refresh (M03 ID_BANK_CODE_UNKNOWN, M07 BIC)
  code char(4) primary key, name text not null, bic text,
  valid_from date not null, valid_to date
);

create table categories (                            -- GLOBAL seed data (04 §3.1); here because document_lines references it
  code text primary key,
  direction direction not null,
  tax_effect tax_effect not null,
  label_cs text not null, label_en text not null, explanation_cs text not null,
  icon text, sort integer not null,
  replaced_by text references categories(code),     -- retired category → successor (M04 §8)
  valid_from date not null default '2000-01-01', valid_to date
);

-- 05 §5 Classification support
create table vendor_profiles (                                      -- per-tenant memory
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  default_category_code text references categories(code),
  default_vat_treatment vat_treatment,
  default_business_flag text check (default_business_flag in ('business','personal','mixed')),
  confirmations integer not null default 0,                        -- user-confirmed count
  last_confirmed_at timestamptz,
  pinned boolean not null default false,                           -- user rule "Vždy takto"
  multi_category boolean not null default false,                   -- Alza, IKEA: per-line decisions
  extraction_hints jsonb not null default '{}',                    -- field positions, number formats (M02 §4.8)
  unique (org_id, partner_id)
);

-- Tenant tables: default write roles owner, member (05 §10.1); _select, _write, _worker policies.
select app.apply_tenant_rls('partners');
select app.apply_tenant_rls('partner_bank_accounts');
select app.apply_tenant_rls('vendor_profiles');

-- Global tables (05 §10.3). Supabase's default privileges grant everything on a new table to anon,
-- authenticated and service_role, so the app-role grants are revoked first and re-granted exactly
-- (plain Postgres: the revokes are no-ops). The worker (app_worker, 0003) reads what the pipeline
-- needs and maintains registry_cache; the 0003 "grant on all tables" covered only existing tables.
revoke all on registry_cache, fx_rates, bank_codes, categories from anon, authenticated;
grant select on categories, fx_rates, bank_codes to authenticated;
grant select on categories, fx_rates, bank_codes to app_worker;
grant select, insert, update, delete on registry_cache to app_worker;
```

Command: `grep -c "^select app.apply_tenant_rls" packages/db/migrations/0004_partners_registries.sql` → `3`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor (§2) with:

```json
      "tag": "0003_app_worker",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1760745600003,
      "tag": "0004_partners_registries",
      "breakpoints": true
    }
  ]
```

Command: `python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))'` → `4`. Commit.

### Step 3: create `packages/testkit/src/factories/partners.ts`

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §3 / §5 tenant tables (migration 0004): partners, partner_bank_accounts,
 * vendor_profiles. Columns are snake_case as in SQL. A child row points its foreign key at a
 * fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()` creates that parent row (with the
 * parent's own factory) before the child is inserted, so every build is insertable on its own.
 * Array columns (`email_domains`) are left to their SQL default: the suite sends arrays as json.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `partners`: unique (org_id, ico), so the IČO is derived from the id counter. */
export const partnerFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const n = counterOf(id);
  return {
    id,
    org_id: ctx.orgId,
    name: `Partner ${n}`,
    ico: String(10000000 + (n % 90000000)),
    country: 'CZ',
    ...overrides,
  };
};

/** `partner_bank_accounts`: one account of a fresh partner. */
export const partnerBankAccountFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    partner_id: ctx.ids.next(),
    account_number: String(1000000000 + (counterOf(id) % 1000000000)),
    bank_code: '0800',
    iban: `CZ6508000000${String(1000000000 + (counterOf(id) % 1000000000))}`,
    ...overrides,
  };
};

/** `vendor_profiles`: unique (org_id, partner_id), so each build has its own fresh partner. */
export const vendorProfileFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  partner_id: ctx.ids.next(),
  confirmations: 0,
  pinned: false,
  multi_category: false,
  extraction_hints: {},
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const partnerFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['partners', partnerFactory],
  ['partner_bank_accounts', partnerBankAccountFactory],
  ['vendor_profiles', vendorProfileFactory],
];
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/testkit/src/factories/index.ts` (three replacements, anchors in §2)

(a) Before the `import { tenancyFactories } from './tenancy';` anchor insert the line `import { partnerFactories } from './partners';` (it must be the first line of the file; Biome sorts imports by path).

(b) Before the `export { membershipFactory, … } from './tenancy';` anchor insert the line
`export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';` (it goes directly after the blank line that follows the imports, before the `export type { FactoryContext, … } from './registry';` line).

(c) The 6-line anchor becomes:

```ts
 * below (a tenant table without a factory fails the RLS meta-test). tenancy.ts covers 0002,
 * partners.ts covers 0004.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [...tenancyFactories, ...partnerFactories]) {
  tenantFactories.define(table, factory);
}
```

The file is then 24 lines (`wc -l`) and starts:

```ts
import { partnerFactories } from './partners';
import { createFactoryRegistry, type FactoryRegistry, type TenantFactory } from './registry';
import { tenancyFactories } from './tenancy';

export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';
export type { FactoryContext, FactoryRegistry, Row, TenantFactory } from './registry';
export { createFactoryRegistry } from './registry';
export { membershipFactory, organizationFactory, taxpayerProfileFactory } from './tenancy';
```

Command: `pnpm --filter @shoebox/testkit test 2>&1 | tail -4` → `Tests  85 passed (85)`; then `pnpm exec biome ci packages/testkit 2>&1 | tail -3` → no errors. Commit.

### Step 5: edit `packages/db/test/rls/helpers.ts` (two replacements, anchors in §2)

(a) The 4-line anchor inside `insertFactoryRow` becomes (one line added, then the new helper after the function):

```ts
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
```

(b) The `buildRow` anchor (doc comment + function) becomes:

```ts
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
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors; `pnpm exec biome ci packages/db/test 2>&1 | tail -3` → no errors. Commit.

### Step 6: edit `packages/db/test/migrations/tenancy.db.test.ts` (six replacements, anchors in §2)

(a) The import anchor becomes three lines:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/migrate';
```

The two `node:` lines go to the very top of the file, before `import { ENUMS } from '@shoebox/domain';` (Biome order); the `MIGRATIONS_FOLDER` line replaces the old `runMigrations` import in place.

(b) After the `const ROLLBACK = Symbol('rollback');` anchor add:

```ts
/** Number of migrations in meta/_journal.json: every slice adds one, this test need not change. */
const JOURNAL_ENTRIES = (
  JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  }
).entries.length;
```

(c) The comment anchor becomes `    // From scratch: drop every public table, schema app and the enums (extensions and auth stay).`

(d) The `drop table if exists public.taxpayer_profiles, …` anchor line becomes:

```ts
      do $$
      declare t text;
      begin
        for t in select tablename from pg_tables where schemaname = 'public' loop
          execute format('drop table if exists public.%I cascade', t);
        end loop;
      end $$;
```

(e) The 3-line `it(` anchor becomes:

```ts
  it('migrates from scratch and records every journal migration once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(JOURNAL_ENTRIES).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.n).toBe(JOURNAL_ENTRIES);
```

(f) The 5-line `toEqual([` anchor becomes:

```ts
    expect(tables.map((r) => r.tablename)).toEqual(
      expect.arrayContaining(['memberships', 'organizations', 'taxpayer_profiles']),
    );
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  8 passed (8)` and `Tests  71 passed (71)` (without a database: `28 passed | 43 skipped`). Then `pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -3` → no errors. Commit. Write the report (§9) and continue with 0028b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/0001_*.sql`, `0002_*.sql`, `0003_*.sql`, `packages/db/scripts/**`, `packages/db/src/**` (0028b adds the Drizzle mirror), `packages/db/test/rls/*.db.test.ts`, `packages/db/test/with-tenant.db.test.ts`, `packages/testkit/src/factories/registry.ts`, `packages/testkit/src/factories/tenancy.ts`, `packages/testkit/test/**`, `scripts/**`, `.github/**`, `docs/v3/**` (0028b edits 05). Hard rules: 1 (`numeric(15,2)` / `numeric(12,6)` as in 05), 3, 5 (05 edit in 0028b, same PR), 7, 8. Never write a connection string with a password, never set a password for `app_worker`. Never run `supabase-shim.sql` against a Supabase database. `global_vendor_priors` is not created.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                   # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 71 passed (8 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30                     # same 71
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 43 skipped
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                         # 85 passed
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                    # exit 0
pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -30                             # No fixes applied, no errors
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); here `DATABASE_URL` from `local-pg.sh` replaces `db:start` because Docker is unavailable. CI (0027) runs the same suite on Postgres 17 (local Supabase) and checks that every journal entry is applied exactly once.

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'"` → `bank_codes,categories,fx_rates,memberships,organizations,partner_bank_accounts,partners,registry_cache,taxpayer_profiles,vendor_profiles` (no `global_vendor_priors`).
- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"` → `4`.
- [ ] `psql "$DATABASE_URL" -tAc "select tablename, policyname from pg_policies where tablename in ('partners','partner_bank_accounts','vendor_profiles') order by 1,2" | wc -l` → `9` (three policies each).
- [ ] `psql "$DATABASE_URL" -tAc "select has_table_privilege('authenticated','registry_cache','select'), has_table_privilege('authenticated','categories','insert'), has_table_privilege('authenticated','fx_rates','select'), has_table_privilege('app_worker','registry_cache','insert')"` → `f|f|t|t`.
- [ ] `meta.db.test.ts`, `isolation.db.test.ts`, `roles.db.test.ts`, `worker.db.test.ts` green with the six tenant tables (the fixture rows of `partner_bank_accounts` and `vendor_profiles` each got their own `partners` row from `ensureParentRows`); `tenancy.db.test.ts` green after a from-scratch run.
- [ ] `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts` → `1`; `grep -c "ensureParentRows" packages/db/test/rls/helpers.ts` → `3`.
- [ ] typecheck of db and testkit exit 0; `biome ci` clean.

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

Write `docs/tasks/0028a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`0004_partners_registries.sql` (every column against 05 §3/§5: `numeric(12,6)` on `fx_rates.rate`, the unique keys, the `categories.replaced_by` self-reference; the grant block: `authenticated` must not write any global table, `anon` must have nothing, `app_worker` writes only `registry_cache`), `ensureParentRows()` in `helpers.ts` (inserts as the service role only rows the factories define; recursion ends because every parent factory references only fresh ids or none), the tenancy test's generic drop loop (it runs only inside that test's from-scratch `beforeAll`, on `DATABASE_URL`).

## Owner steps

None. (Defaults applied, to confirm in the 0028b review: `app_worker` grants on the global tables; `vendor_profiles` (05 §5) ships in the same migration as §3 because it is one table and the ticket is one slice.)
