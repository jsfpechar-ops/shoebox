# 0028b: Drizzle mirror of 0004, migration test, 05 §10.3 edit

Status: todo
Ticket: P0-DB-04 (part b of a/b) | Depends on: 0028a (same branch) | Base commit: head of task/0028-db-partners after 0028a | Branch: task/0028-db-partners | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The typed side of 0028a: `packages/db/src/schema/partners.ts` mirrors the seven tables of migration 0004 for Drizzle queries, a new `schema/index.ts` gathers every schema module so `DbSchema` (and `db.query.<table>`) knows each slice, and `test/migrations/partners.db.test.ts` pins what the RLS suite does not: the 05 §10.3 grants of the four global tables, the unique keys, the cascade from `partners`, the `categories` self-reference and the `numeric(12,6)` FX scale. 05 §10.3 gets the `app_worker` grant sentence (hard rule 5).

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, FX `numeric(12,6)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory, and for any table without `org_id` that is not in `GLOBAL_TABLES` (whose grants it checks: `authenticated` has exactly `[SELECT]` or nothing, `anon` nothing). `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`.
- 03 ADR / `packages/db` convention (from `schema/tenancy.ts`): "The SQL file is the source of truth for DDL; this file gives typed queries." Constraints Drizzle has no API for (triggers, RLS, grants) exist only in SQL; checks and uniques are mirrored where Drizzle can express them.
- `scripts/check-tenant-sql.ts` (0025b) reads every `export const <name> = pgTable('<table>', …)` in `packages/db/src/schema/*.ts` and treats it as a tenant table unless the table is in `GLOBAL_TABLES`: the four global tables of this slice are listed there already, so queries on them outside `withTenant` pass the check.
- 05 §10.3 (verbatim, the line step 6 extends): "`audit_log` has a nullable `org_id`: users select rows of their orgs; inserts only through server code. The RLS meta-test (M12 §4.4) holds this list as its allowlist; a new table without `org_id` that is not listed fails CI."
- The categories self-reference and the `ingest_items` self-references of the next slice need the Drizzle idiom `.references((): AnyPgColumn => table.column)` (TypeScript cannot infer a self-referential column type).

Anchors (branch `task/0028-db-partners` after 0028a; unchanged since cb71a1f):

`packages/db/src/tenant.ts` (step 3), line 9:

```ts
import * as schema from './schema/tenancy';
```

`packages/db/src/index.ts` (step 4), lines 4–5:

```ts
export * from './schema/enums';
export * from './schema/tenancy';
```

`docs/v3/05-data-model.md` §10.3 (step 6), one anchor on one line: `inserts only through server code. The RLS meta-test (M12 §4.4)`.

All code below was run by the brief writer on `origin/phase/0` at cb71a1f (PR #49 merged: 0025a/b RLS suite, 0023c, 0027, 0026b) against Postgres 16 (plain cluster + shim): migrations apply from scratch through `runMigrations` and twice through `drizzle-kit migrate` (second run a no-op), `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/partners.ts` | create | Drizzle mirror of 0004 |
| `packages/db/src/schema/index.ts` | create | re-exports every schema module |
| `packages/db/src/tenant.ts` | edit | `DbSchema` from `./schema/index` |
| `packages/db/src/index.ts` | edit | export `./schema/partners` |
| `packages/db/test/migrations/partners.db.test.ts` | create | 8 tests |
| `docs/v3/05-data-model.md` | edit | §10.3 `app_worker` grants (rule 5) |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1: lines 70–223
- Step 2: lines 227–235
- Step 3: lines 239–244
- Step 4: lines 245–253
- Step 5: lines 257–463
- Step 6: lines 467–473

Setup: `git checkout task/0028-db-partners && git log --oneline -1` → `0028a step 6`. `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (already running is fine).

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0028b step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/src/schema/partners.ts`

```ts
// Drizzle mirror of migrations/0004_partners_registries.sql (05 §3 Partners and registries, §5
// Classification support). The SQL file is the source of truth for DDL; this file gives typed
// queries. RLS policies, grants and the updated_at trigger exist only in SQL.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { directionEnum, taxEffectEnum, vatTreatmentEnum } from './enums';
import { organizations } from './tenancy';

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ico: text('ico'),
    dic: text('dic'),
    vatId: text('vat_id'),
    country: char('country', { length: 2 }).notNull().default('CZ'),
    address: jsonb('address'),
    isVatPayer: boolean('is_vat_payer'),
    isUnreliablePayer: boolean('is_unreliable_payer'),
    registryCheckedAt: timestamp('registry_checked_at', { withTimezone: true }),
    emailDomains: text('email_domains').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('partners_org_id_ico_key').on(t.orgId, t.ico),
    unique('partners_org_id_vat_id_key').on(t.orgId, t.vatId),
  ],
);

export const partnerBankAccounts = pgTable(
  'partner_bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    accountNumber: text('account_number'),
    bankCode: text('bank_code'),
    iban: text('iban'),
    bic: text('bic'),
    publishedInCrpdph: boolean('published_in_crpdph'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
  },
  (t) => [
    unique('partner_bank_accounts_org_id_partner_id_iban_key').on(t.orgId, t.partnerId, t.iban),
  ],
);

/** GLOBAL (05 §10.3): service role and app_worker only. */
export const registryCache = pgTable(
  'registry_cache',
  {
    source: text('source').notNull(),
    key: text('key').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.key] }),
    check('registry_cache_source_check', sql`${t.source} in ('ares','crpdph','vies')`),
  ],
);

/** GLOBAL (05 §10.3): ČNB daily fixing; read by authenticated. `rate` is numeric(12,6), never a float. */
export const fxRates = pgTable(
  'fx_rates',
  {
    rateDate: date('rate_date').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    amount: integer('amount').notNull(),
    rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.rateDate, t.currency] })],
);

/** GLOBAL (05 §10.3): ČNB bank code list; read by authenticated. */
export const bankCodes = pgTable('bank_codes', {
  code: char('code', { length: 4 }).primaryKey(),
  name: text('name').notNull(),
  bic: text('bic'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
});

/** GLOBAL (05 §10.3): the category taxonomy (04 §3.1); read by authenticated, seeded by P0-DB-11. */
export const categories = pgTable('categories', {
  code: text('code').primaryKey(),
  direction: directionEnum('direction').notNull(),
  taxEffect: taxEffectEnum('tax_effect').notNull(),
  labelCs: text('label_cs').notNull(),
  labelEn: text('label_en').notNull(),
  explanationCs: text('explanation_cs').notNull(),
  icon: text('icon'),
  sort: integer('sort').notNull(),
  replacedBy: text('replaced_by').references((): AnyPgColumn => categories.code),
  validFrom: date('valid_from').notNull().default('2000-01-01'),
  validTo: date('valid_to'),
});

export const vendorProfiles = pgTable(
  'vendor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    defaultCategoryCode: text('default_category_code').references(() => categories.code),
    defaultVatTreatment: vatTreatmentEnum('default_vat_treatment'),
    defaultBusinessFlag: text('default_business_flag'),
    confirmations: integer('confirmations').notNull().default(0),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    multiCategory: boolean('multi_category').notNull().default(false),
    extractionHints: jsonb('extraction_hints').notNull().default({}),
  },
  (t) => [
    unique('vendor_profiles_org_id_partner_id_key').on(t.orgId, t.partnerId),
    check(
      'vendor_profiles_default_business_flag_check',
      sql`${t.defaultBusinessFlag} in ('business','personal','mixed')`,
    ),
  ],
);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: create `packages/db/src/schema/index.ts`

```ts
// Every Drizzle table in one module: `DbSchema` in tenant.ts is `typeof import('./schema/index')`,
// so db.query.<table> knows each migration slice. Each slice adds its `export * from './<area>'`.
export * from './enums';
export * from './partners';
export * from './tenancy';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 3: edit `packages/db/src/tenant.ts`

The anchor line becomes `import * as schema from './schema/index';` (nothing else changes; `DbSchema = typeof schema` now covers all tables).

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/db/src/index.ts`

Between the two anchor lines insert `export * from './schema/partners';`, so lines 4–6 read:

```ts
export * from './schema/enums';
export * from './schema/partners';
export * from './schema/tenancy';
```

Command: `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no database) → `28 passed | 43 skipped`. Commit.

### Step 5: create `packages/db/test/migrations/partners.db.test.ts`

Full file; do not edit it:

```ts
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { GLOBAL_TABLES } from '../../src/rls-catalog';

// 0004_partners_registries (05 §3, §5, §10.3): the seven tables, the grants of the four global
// tables for the app roles and app_worker, the unique keys, the categories self-reference and the
// numeric scales. Migrates forward only (tenancy.db.test.ts owns the from-scratch run); its two
// orgs use the prefix cccccccc so the RLS suite's cleanup never touches them.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_C = 'cccccccc-0000-4000-8000-000000000001';
const ORG_D = 'cccccccc-0000-4000-8000-000000000002';
const TABLES_0004 = [
  'bank_codes',
  'categories',
  'fx_rates',
  'partner_bank_accounts',
  'partners',
  'registry_cache',
  'vendor_profiles',
] as const;
const GLOBAL_0004 = ['bank_codes', 'categories', 'fx_rates', 'registry_cache'] as const;

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0004: partners, registries, categories', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  async function privileges(role: string, table: string): Promise<string[]> {
    const rows = await sql<{ p: string }[]>`
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p
      where has_table_privilege(${role}, ${`public.${table}`}, p)`;
    return rows.map((r) => r.p);
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
    await sql`delete from categories where code in ('test_old', 'test_new')`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_C}, 'Org C', 'org-c-0004', 'CCCCCCCC'), (${ORG_D}, 'Org D', 'org-d-0004', 'DDDDDDDD')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
      await sql`delete from categories where code in ('test_old', 'test_new')`;
      await sql.end();
    }
  });

  it('creates the seven tables of 05 §3 and §5 and not global_vendor_priors (05 §9.1 Later)', async () => {
    const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables
      where schemaname = 'public' and tablename = any(${[...TABLES_0004, 'global_vendor_priors']})
      order by 1`;
    expect(rows.map((r) => r.t)).toEqual([...TABLES_0004]);
  });

  it('the global tables have no org_id, no RLS and are listed in GLOBAL_TABLES', async () => {
    for (const table of GLOBAL_0004) {
      expect(GLOBAL_TABLES[table], table).toBeDefined();
      const cols = await sql`select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name = 'org_id'`;
      expect(cols, table).toHaveLength(0);
      const rel = await sql`select relrowsecurity as rls from pg_class c
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${table}`;
      expect(rel[0]?.rls, table).toBe(false);
    }
  });

  it('grants of 05 §10.3: authenticated reads categories, fx_rates, bank_codes only; anon nothing', async () => {
    for (const table of ['categories', 'fx_rates', 'bank_codes']) {
      expect(await privileges('authenticated', table), table).toEqual(['SELECT']);
      expect(await privileges('app_worker', table), table).toEqual(['SELECT']);
    }
    expect(await privileges('authenticated', 'registry_cache')).toEqual([]);
    expect(await privileges('app_worker', 'registry_cache')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
    ]);
    for (const table of GLOBAL_0004) {
      expect(await privileges('anon', table), table).toEqual([]);
    }
  });

  it('the three tenant tables have _select, _worker and _write policies', async () => {
    for (const table of ['partners', 'partner_bank_accounts', 'vendor_profiles']) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ]);
    }
  });

  it('partners: (org_id, ico) is unique per org, the same IČO is fine in another org; updated_at is touched', async () => {
    const [p] =
      await sql`insert into partners (org_id, name, ico) values (${ORG_C}, 'Alfa', '12345678')
      returning id, created_at, updated_at`;
    expect(p?.updated_at).toEqual(p?.created_at);
    expect(
      await code(
        sql`insert into partners (org_id, name, ico) values (${ORG_C}, 'Alfa 2', '12345678')`,
      ),
    ).toBe('23505');
    expect(
      await code(
        sql`insert into partners (org_id, name, ico) values (${ORG_D}, 'Alfa D', '12345678')`,
      ),
    ).toBeNull();
    const [u] = await sql`update partners set name = 'Alfa s.r.o.' where id = ${p?.id}
      returning updated_at > created_at as touched, email_domains`;
    expect(u?.touched).toBe(true);
    expect(u?.email_domains).toEqual([]);
  });

  it('partner_bank_accounts and vendor_profiles follow their partner (cascade) and keys', async () => {
    const [p] =
      await sql`insert into partners (org_id, name) values (${ORG_C}, 'Beta') returning id`;
    await sql`insert into partner_bank_accounts (org_id, partner_id, iban) values (${ORG_C}, ${p?.id}, 'CZ65 0800 0000 1920 0014 5399')`;
    expect(
      await code(
        sql`insert into partner_bank_accounts (org_id, partner_id, iban) values (${ORG_C}, ${p?.id}, 'CZ65 0800 0000 1920 0014 5399')`,
      ),
    ).toBe('23505');
    await sql`insert into vendor_profiles (org_id, partner_id) values (${ORG_C}, ${p?.id})`;
    expect(
      await code(sql`insert into vendor_profiles (org_id, partner_id) values (${ORG_C}, ${p?.id})`),
    ).toBe('23505');
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_business_flag) values (${ORG_C}, gen_random_uuid(), 'company')`,
      ),
    ).toBe('23514');
    await sql`delete from partners where id = ${p?.id}`;
    const left = await sql`select 1 from partner_bank_accounts where partner_id = ${p?.id}
      union all select 1 from vendor_profiles where partner_id = ${p?.id}`;
    expect(left).toHaveLength(0);
  });

  it('categories: replaced_by points at a category; vendor_profiles.default_category_code must exist', async () => {
    expect(
      await code(
        sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort, replaced_by)
          values ('test_old', 'in', 'deductible_expense', 'Stará', 'Old', 'x', 1, 'test_missing')`,
      ),
    ).toBe('23503');
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort)
      values ('test_new', 'in', 'deductible_expense', 'Nová', 'New', 'x', 2)`;
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort, replaced_by, valid_to)
      values ('test_old', 'in', 'deductible_expense', 'Stará', 'Old', 'x', 1, 'test_new', '2025-12-31')`;
    const [old] = await sql`select valid_from::text as f from categories where code = 'test_old'`;
    expect(old?.f).toBe('2000-01-01');
    const [p] =
      await sql`insert into partners (org_id, name) values (${ORG_C}, 'Gama') returning id`;
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_category_code) values (${ORG_C}, ${p?.id}, 'nope')`,
      ),
    ).toBe('23503');
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_category_code) values (${ORG_C}, ${p?.id}, 'test_new')`,
      ),
    ).toBeNull();
  });

  it('fx_rates.rate is numeric(12,6) and the registry cache keys by (source, key)', async () => {
    const [col] = await sql`select numeric_precision as p, numeric_scale as s
      from information_schema.columns where table_name = 'fx_rates' and column_name = 'rate'`;
    expect([col?.p, col?.s]).toEqual([12, 6]);
    await sql`insert into fx_rates (rate_date, currency, amount, rate, published_at)
      values ('2026-01-02', 'EUR', 1, 25.1234565, '2026-01-02T13:30:00Z')
      on conflict (rate_date, currency) do update set rate = excluded.rate`;
    const [fx] =
      await sql`select rate::text as r from fx_rates where rate_date = '2026-01-02' and currency = 'EUR'`;
    expect(fx?.r).toBe('25.123457');
    await sql`delete from fx_rates where rate_date = '2026-01-02' and currency = 'EUR'`;
    expect(
      await code(sql`insert into registry_cache (source, key, payload) values ('xyz', '1', '{}')`),
    ).toBe('23514');
    await sql`insert into registry_cache (source, key, payload) values ('ares', '00000000', '{"test": true}')
      on conflict (source, key) do update set payload = excluded.payload, fetched_at = now()`;
    await sql`delete from registry_cache where source = 'ares' and key = '00000000'`;
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  9 passed (9)` and `Tests  79 passed (79)`. Then `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors. Commit.

### Step 6: edit `docs/v3/05-data-model.md` §10.3

On the anchor line, replace `inserts only through server code. The RLS meta-test (M12 §4.4)` with:

```
inserts only through server code. `app_worker` (0003) is a server role, not an app role: the migration that creates a global table grants it explicitly (0003's blanket grant covered only the tables that existed then): select on `categories`, `fx_rates`, `bank_codes`; select, insert, update, delete on `registry_cache` (the pipeline caches registry lookups as the worker). The RLS meta-test (M12 §4.4)
```

The rest of the line stays.

Command: `python3 scripts/context_lint.py 2>&1 | tail -3` → OK (no new findings). Commit. Write the report (§9). Owner merges the PR of `task/0028-db-partners` into `phase/0`.

## 5. Do not touch

`packages/db/migrations/**` (0028a owns 0004), `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/rls-catalog.ts`, `packages/db/src/schema/enums.ts`, `packages/db/src/schema/tenancy.ts`, `packages/db/test/rls/**`, `packages/db/test/migrations/tenancy.db.test.ts`, `packages/db/test/with-tenant.db.test.ts`, `packages/testkit/**`, `scripts/**`, `.github/**`, `docs/v3/**` except the one §10.3 line. Hard rules 1, 3, 5, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database.

## 6. Commands

```
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 79 passed (9 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 51 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db 2>&1 | tail -30                                              # No fixes applied, no errors
pnpm check:tenant-sql 2>&1 | tail -30                                                       # exit 0 (no unscoped tenant query was added)
python3 scripts/context_lint.py 2>&1 | tail -30                                             # OK
```

## 7. Acceptance

- [ ] `partners.db.test.ts`: 8 passed with `DATABASE_URL`; the whole db suite 79 passed; `psql "$DATABASE_URL" -tAc "select count(*) from organizations where id::text like 'cccccccc-%'"` → `0` after the run (fixture cleaned).
- [ ] `grep -c "pgTable(" packages/db/src/schema/partners.ts` → `7`; `grep -n "schema/index" packages/db/src/tenant.ts` → line 9.
- [ ] `grep -c "app_worker" docs/v3/05-data-model.md` increased by 1 against `origin/phase/0` (`git diff origin/phase/0 --stat -- docs/v3/05-data-model.md` → `1 +, 1 -`).
- [ ] typecheck exit 0; `biome ci` clean; `pnpm check:tenant-sql` exit 0.

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

Write `docs/tasks/0028b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`schema/partners.ts` against `0004_partners_registries.sql` column by column (`numeric` precision/scale, `char` lengths, nullability, defaults; `rate` and the money columns must stay `numeric`, never `real`/`double`), the grant assertions in `partners.db.test.ts` (they are the executable form of 05 §10.3), the one-line 05 edit.

## Owner steps

1. Review the PR of `task/0028-db-partners` (0028a + 0028b) and merge it into `phase/0`.
2. Confirm or change the two defaults named in the 0028a report: (a) `app_worker` may read `categories`, `fx_rates`, `bank_codes` and write `registry_cache`; (b) `vendor_profiles` (05 §5) is in migration 0004 together with §3. If (a) changes, the grant block at the end of 0004 is the only place to edit (before the migration reaches Supabase; afterwards it is a new migration).
