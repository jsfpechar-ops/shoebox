# 0033a: migration 0007 (platform tables), factories, catalog, RLS suite green

Status: review
Ticket: P0-DB-07 (part a of a/b) | Depends on: 0032a/b merged | Base commit: head of phase/0 after the 0032 PR | Branch: task/0033-db-platform | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0007_platform` creates the six 05 §9 tables (`audit_log`, `rules_overrides`, `llm_usage_daily`, `staff_users`, `privacy_requests`, `rate_limit_counters`) and the function `app.rate_limit_hit()`, with RLS on the three tenant tables (`audit_log` and `llm_usage_daily` select-only for users, `privacy_requests` select and write owner-only) and service-role-only grants on the three global tables. The testkit gets the three tenant factories, the RLS catalog lists `privacy_requests` as owner-only, the suite's cleanup learns about `audit_log` (no foreign key), and 05 names the mechanisms. 0033b adds the Drizzle mirror, `rateLimitHit()` and the two migration tests on the same branch.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; `llm_usage_daily.cost_usd` is `numeric(10,4)` as in 05 §9, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory, and for any table without `org_id` that is not in `GLOBAL_TABLES` or whose `authenticated`/`anon` grants differ from the catalog (`service_role` = no privilege at all). `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. The catalog already lists `rules_overrides`, `staff_users`, `rate_limit_counters` as `service_role` globals, `audit_log` in `NULLABLE_ORG_ID` and `READ_ONLY_FOR_USERS`, `llm_usage_daily` in `READ_ONLY_FOR_USERS`, `privacy_requests` in `OWNER_ONLY_SELECT_TABLES`. Missing: `privacy_requests` in `OWNER_ONLY_TABLES` (otherwise `roles.db.test.ts` expects a member to write it); step 4 adds it.
- 05 §9 DDL of the six tables and the function: pasted verbatim into the migration of step 1. Additions: the `updated_at` trigger of `privacy_requests` (05 conventions, line 9: every table with `updated_at` gets `app.touch_updated_at`), the sequence grant for `audit_log_id_seq` (0003's "grant on all sequences" covered only the sequences that existed then; without it the worker's insert fails with 42501, found by the brief writer), the function's `set search_path = public, pg_temp` (security definer hygiene; body unchanged), the function grants, the RLS calls and the global-table grants.
- Global tables (05 §10.3), why no `org_id`: `rules_overrides` is law data for every org (06 §2 hotfix), `staff_users` is the back-office allowlist (M12 §4.9), `rate_limit_counters` is keyed by `upload:{user}`, `api:{token}` etc. (M12 §4.5). Catalog treatment: `GLOBAL_TABLES[...] = 'service_role'` (already there), so the migration revokes every app-role grant. **Default (confirm at gate):** `app_worker` gets `select` on `rules_overrides` (M02 §9 lists it among the worker's reads; `rules.at(date)` merges it, 06 §2) and nothing on `staff_users` or `rate_limit_counters`; `app.rate_limit_hit()` is executable by `service_role` and `app_worker` only (`revoke … from public, anon, authenticated`), so the API and the worker call it while a browser session cannot.
- `audit_log` (05 §10.3: "nullable `org_id`: users select rows of their orgs; inserts only through server code"): `app.apply_tenant_rls_read_only('audit_log')` (0005) gives `_select` on `org_id in user_org_ids()` (a null `org_id` matches nobody) and `_worker`; no user write policy. It has no foreign key to `organizations` (05 §9, an audit row outlives its org, retention 10 years), so the suite's `cleanupTenants()` cannot rely on the cascade: step 5 adds one delete there. The factory leaves `id` to `bigserial` and `actor_user_id` null.
- `llm_usage_daily`: `app.apply_tenant_rls_read_only('llm_usage_daily')`. Its key is (`org_id`, `day`, `model`), so the factory varies `model` per build (`test-model-<n>`); the suite builds several rows per org.
- `privacy_requests` (05 §10.2 "select and write: owner only"): `app.apply_tenant_rls('privacy_requests', '{owner}')` gives the owner-only `_write`, but its `_select` lets every member read. **Default (confirm at gate):** the migration drops that `_select` and recreates a policy of the same name with `app.user_has_role(org_id, '{owner}')`, so the meta-test still finds `privacy_requests_select` for SELECT, and `isolation.db.test.ts` (which already expects non-owners of `OWNER_ONLY_SELECT_TABLES` to see nothing) passes. `requested_by` is a fresh id from `ctx.ids`; the suite's `ensureAuthUsers()` creates the `auth.users` row.
- `rate_limit_counters` is `unlogged` (05 §9); `app.rate_limit_hit()` is `security definer`, so callers need no privilege on the table. 05 §9.1 Later tables (`global_vendor_priors`, `extraction_batches`, `bank_connections`, `support_access_grants`) are not created.
- **Default (confirm at gate):** the 05 edits are the `privacy_requests` row of §10.2 and the worker-grant sentence of §10.3 (step 6); the six tables themselves are unchanged in 05.
- Test values are placeholders (`test-model-1`, `documents`, `test.touch`); no real names or personal data.

Anchors (`origin/phase/0` after the 0032 PR):

`packages/db/migrations/meta/_journal.json` (step 2), the last entry:

```json
      "tag": "0006_documents_detail",
      "breakpoints": true
    }
  ]
```

`packages/testkit/src/factories/index.ts` (step 4), three one-line anchors (lines 3, 24 and 33 of the 48-line file):

```ts
import { partnerFactories } from './partners';
```

```ts
export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';
```

```ts
 * partners.ts covers 0004, documents.ts covers 0005, document-details.ts covers 0006.
```

`packages/db/src/rls-catalog.ts` (step 4), the 2-line anchor (the end of `OWNER_ONLY_TABLES`):

```ts
  'taxpayer_profiles',
];
```

`packages/db/test/rls/helpers.ts` (step 5), the 4-line anchor:

```ts
/** Deletes everything seedTenants and the probes created (orgs cascade into every tenant table). */
export async function cleanupTenants(sql: Sql): Promise<void> {
  await sql`drop table if exists public.rls_probe_broken, public.rls_probe_nofactory, public.rls_probe_global`;
  await sql`delete from organizations where id in (${ORG_A}, ${ORG_B})`;
```

`docs/v3/05-data-model.md` (step 6), two one-line anchors (the §10.2 row, and inside the §10.3 paragraph):

```
| `privacy_requests` | select and write: owner only |
```

```
select, insert, update, delete on `registry_cache` (the pipeline caches registry lookups as the worker). The RLS meta-test
```

All code below was run by the brief writer on `origin/claude/phase-0-resume-oaa6ss` (phase/0 at 4ef062c plus the 0032a/b steps applied by hand) against Postgres 16 (plain cluster + shim): migrations apply through `runMigrations`, `tsc` clean for db and testkit, `biome ci` clean, `migration-lint` OK, the db suite green twice in a row on one database (fixtures cleaned), `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0007_platform.sql` | create | 6 tables, function, trigger, grants, RLS |
| `packages/db/migrations/meta/_journal.json` | edit | entry 6 |
| `packages/testkit/src/factories/platform.ts` | create | 3 factories |
| `packages/testkit/src/factories/index.ts` | edit | register them |
| `packages/db/src/rls-catalog.ts` | edit | `privacy_requests` owner-only write |
| `packages/db/test/rls/helpers.ts` | edit | cleanup of `audit_log` |
| `docs/v3/05-data-model.md` | edit | §10.2 row, §10.3 sentence (rule 5) |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 112–197
- Step 2 code: lines 207–217
- Step 3 code: lines 225–275
- Step 4 code: lines 287–304
- Step 5 code: lines 316–323
- Step 6 code: lines 335–341

Setup (once): `git fetch origin phase/0 && git checkout -b task/0033-db-platform origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0006_documents_detail.sql` and `packages/db/src/schema/document-details.ts` to exist: `ls packages/db/migrations packages/db/src/schema`; if not, STOP: 0032 is not merged). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0033a step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/migrations/0007_platform.sql`

```sql
-- 0007_platform: 05 §9 Platform: audit_log, rules_overrides, llm_usage_daily, staff_users,
-- privacy_requests, rate_limit_counters and app.rate_limit_hit(). Three tenant tables: audit_log
-- (nullable org_id, users select rows of their orgs, inserts only through server code) and
-- llm_usage_daily are select-only for users (05 §10.2, app.apply_tenant_rls_read_only(), 0005);
-- privacy_requests is select and write owner-only (05 §10.2: an owner-only <t>_select replaces the
-- default one). Three global tables (05 §10.3, service role only): rules_overrides (the worker
-- reads it: M02 §9), staff_users, rate_limit_counters (reached only through the security definer
-- function). The 05 §9.1 Later tables are not created. Forward-only.

create table audit_log (                                             -- GLOBAL shape, but rows carry org_id; select via RLS on org_id
  id bigserial primary key,
  org_id uuid, actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user','system','accountant','api','staff')),
  entity text not null, entity_id uuid, action text not null,
  diff jsonb, at timestamptz not null default now()
);
create index on audit_log (org_id, at);
-- 0003's "grant on all sequences" covered only the sequences that existed then; without this the
-- worker's insert (bigserial default) fails with 42501.
grant usage, select on sequence audit_log_id_seq to app_worker;

create table rules_overrides (                                       -- GLOBAL; admin hotfix of law data (audited, 06 §2)
  id uuid primary key default gen_random_uuid(),
  rule_key text not null, valid_from date not null, valid_to date,
  value jsonb not null, reason text not null, source text not null, created_by text not null,
  created_at timestamptz not null default now()
);

create table llm_usage_daily (                                       -- tenant-keyed counters; worker writes, owner may read
  org_id uuid not null references organizations(id) on delete cascade,
  day date not null, model text not null,
  calls integer not null, input_tokens bigint not null, output_tokens bigint not null, cost_usd numeric(10,4) not null,
  primary key (org_id, day, model)
);

create table staff_users (                                           -- GLOBAL, service role only (M12 §4.9)
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','support')),
  created_at timestamptz not null default now()
);

create table privacy_requests (                                      -- export / closure (M12 §4.6); RLS owner only
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('export','close_archive','close_delete')),
  requested_by uuid not null references auth.users(id),
  state text not null default 'pending' check (state in ('pending','running','ready','scheduled','done','cancelled','failed')),
  scheduled_for timestamptz, result_path text, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger privacy_requests_touch_updated_at before update on privacy_requests
  for each row execute function app.touch_updated_at();

create unlogged table rate_limit_counters (                          -- GLOBAL; fixed-window counters, no Redis (M12 §4.5)
  key text not null, window_start timestamptz not null, hits integer not null,
  primary key (key, window_start)
);
-- security definer: the caller needs no privilege on rate_limit_counters; search_path is pinned
-- so the body always resolves public.rate_limit_counters (job ops.rate_limit_gc deletes windows
-- older than 2 days).
create function app.rate_limit_hit(p_key text, p_max int, p_window_s int) returns boolean
  language sql volatile security definer set search_path = public, pg_temp as $$
  insert into rate_limit_counters as c (key, window_start, hits)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s), 1)
  on conflict (key, window_start) do update set hits = c.hits + 1
  returning hits <= p_max
$$;
revoke execute on function app.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, int, int) to service_role, app_worker;

-- Tenant RLS (05 §10.1, §10.2).
select app.apply_tenant_rls_read_only('audit_log');
select app.apply_tenant_rls_read_only('llm_usage_daily');
select app.apply_tenant_rls('privacy_requests', '{owner}');
-- 05 §10.2 "privacy_requests | select and write: owner only": the generated <t>_select lets every
-- member of the org read, so it is replaced by an owner-only one (same name, the meta-test's).
drop policy privacy_requests_select on privacy_requests;
create policy privacy_requests_select on privacy_requests for select
  using (app.user_has_role(org_id, '{owner}'::member_role[]));

-- Global tables (05 §10.3): service role only. Supabase's default privileges grant everything on
-- a new table to anon, authenticated and service_role, so the app-role grants are revoked (plain
-- Postgres: no-ops). The worker (app_worker, 0003) reads rules_overrides (rules.at(date), 06 §2;
-- M02 §9) and gets nothing on staff_users or rate_limit_counters (it calls app.rate_limit_hit()).
revoke all on rules_overrides, staff_users, rate_limit_counters from anon, authenticated;
grant select on rules_overrides to app_worker;
```

Command: `grep -c "^create table\|^create unlogged table" packages/db/migrations/0007_platform.sql` → `6`; `grep -c "^select app.apply_tenant_rls" packages/db/migrations/0007_platform.sql` → `3`; `node scripts/migration-lint.ts packages/db/migrations/0007_platform.sql 2>&1 | tail -1` → `migration-lint: OK (1 file(s))`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor (§2) with:

```json
      "tag": "0006_documents_detail",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1760745600006,
      "tag": "0007_platform",
      "breakpoints": true
    }
  ]
```

Command: `python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))'` → `7`. Commit.

### Step 3: create `packages/testkit/src/factories/platform.ts`

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §9 Platform tenant tables (migration 0007): audit_log, llm_usage_daily,
 * privacy_requests. The global tables of 0007 (rules_overrides, staff_users, rate_limit_counters)
 * have no factory: the RLS suite iterates tenant tables only. Columns are snake_case as in SQL;
 * money is a numeric string (never a float). `requested_by` is a fresh id from `ctx.ids`; the RLS
 * suite's `ensureAuthUsers()` creates that auth.users row. `actor_user_id` stays null (no FK).
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `audit_log` has a bigserial `id` (left to the database) and no foreign keys. */
export const auditLogFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  actor_kind: 'system',
  entity: 'documents',
  entity_id: ctx.ids.next(),
  action: 'test.touch',
  ...overrides,
});

/** `llm_usage_daily` has no `id`: its key is (org_id, day, model), so `model` varies per build. */
export const llmUsageDailyFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  day: '2026-01-15',
  model: `test-model-${counterOf(ctx.ids.next())}`,
  calls: 1,
  input_tokens: 1000,
  output_tokens: 200,
  cost_usd: '0.0100',
  ...overrides,
});

export const privacyRequestFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  kind: 'export',
  requested_by: ctx.ids.next(),
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const platformFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['audit_log', auditLogFactory],
  ['llm_usage_daily', llmUsageDailyFactory],
  ['privacy_requests', privacyRequestFactory],
];
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/testkit/src/factories/index.ts` and `packages/db/src/rls-catalog.ts` (anchors in §2)

(a) `factories/index.ts`: after the line `import { partnerFactories } from './partners';` insert `import { platformFactories } from './platform';` (one line).

(b) `factories/index.ts`: after the line `export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';` insert:

```ts
export { auditLogFactory, llmUsageDailyFactory, privacyRequestFactory } from './platform';
```

(c) `factories/index.ts`: the comment line ` * partners.ts covers 0004, documents.ts covers 0005, document-details.ts covers 0006.` becomes two lines:

```ts
 * partners.ts covers 0004, documents.ts covers 0005, document-details.ts covers 0006,
 * platform.ts covers 0007.
```

and the loop line `  ...documentDetailFactories,` (the only one, a few lines below) gets a new line after it: `  ...platformFactories,` (the array then lists tenancy, partner, document, documentDetail, platform). The file is then 52 lines (`wc -l`).

(d) `rls-catalog.ts`: the 2-line anchor becomes:

```ts
  'taxpayer_profiles',
  'privacy_requests',
];
```

The file is then 79 lines.

Command: `pnpm --filter @shoebox/testkit test 2>&1 | tail -4` → `Tests  85 passed (85)`; `pnpm exec biome ci packages/testkit packages/db/src 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 5: edit `packages/db/test/rls/helpers.ts`

Replace the 4-line anchor (§2) with:

```ts
/**
 * Deletes everything seedTenants and the probes created (orgs cascade into every tenant table;
 * audit_log has no foreign key, 05 §9, so its rows go explicitly).
 */
export async function cleanupTenants(sql: Sql): Promise<void> {
  await sql`drop table if exists public.rls_probe_broken, public.rls_probe_nofactory, public.rls_probe_global`;
  await sql`delete from audit_log where org_id in (${ORG_A}, ${ORG_B})`;
  await sql`delete from organizations where id in (${ORG_A}, ${ORG_B})`;
```

The file is then 484 lines (`wc -l`).

Command: `pnpm exec biome ci packages/db/test 2>&1 | tail -3` → no errors; then `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  11 passed (11)` and `Tests  95 passed (95)` (the suite now covers 22 tenant tables; `tenancy.db.test.ts` migrates from scratch). Run it a second time: the same counts (cleanup works). Commit.

### Step 6: edit `docs/v3/05-data-model.md`

(a) §10.2: replace the one-line anchor (the `privacy_requests` row) with:

```
| `privacy_requests` | select and write: owner only (since 0007: `app.apply_tenant_rls('privacy_requests', '{owner}')`, then `privacy_requests_select` replaced by an owner-only policy of the same name) |
```

(b) §10.3: replace the one-line anchor `select, insert, update, delete on `registry_cache` (the pipeline caches registry lookups as the worker). The RLS meta-test` (part of one long line; keep the rest of the line) with:

```
select, insert, update, delete on `registry_cache` (the pipeline caches registry lookups as the worker); since 0007 also select on `rules_overrides` (`rules.at(date)`, 06 §2), usage on `audit_log_id_seq`, and execute on `app.rate_limit_hit()` (with `service_role`; `authenticated` and `anon` may not call it, and nobody but the function touches `rate_limit_counters`). The RLS meta-test
```

Command: `grep -c "since 0007" docs/v3/05-data-model.md` → `2`; `python3 scripts/context_lint.py 2>&1 | tail -3` → `context lint: OK` (a WARN line about status.md is fine). Commit. Write the report (§9) and continue with 0033b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/0001_*.sql` to `0006_*.sql`, `packages/db/scripts/**`, `packages/db/src/**` except the one `rls-catalog.ts` insertion (0033b adds `schema/platform.ts` and `rate-limit.ts`), `packages/db/test/**` except the one `helpers.ts` replacement (0033b adds the tests), `packages/testkit/src/factories/registry.ts`, `tenancy.ts`, `partners.ts`, `documents.ts`, `document-details.ts`, `packages/testkit/test/**`, `scripts/**`, `.github/**`, `docs/v3/**` except the two 05 lines. Hard rules 1, 3, 5, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database. No table of 05 §9.1, §6, §7 or §8 is created here.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                   # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30   # Tests 95 passed (11 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 67 skipped
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                         # 85 passed
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                    # exit 0
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -30                             # No fixes applied, no errors
node scripts/migration-lint.ts packages/db/migrations/0007_platform.sql 2>&1 | tail -3     # migration-lint: OK
python3 scripts/pii_guard.py --all packages/testkit/src/factories/platform.ts packages/db/migrations/0007_platform.sql 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                                             # context lint: OK
```

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"` → `7`; `select count(*) from pg_tables where schemaname='public'` → `29`.
- [ ] `psql "$DATABASE_URL" -tAc "select policyname from pg_policies where tablename='audit_log' order by 1"` → `audit_log_select`, `audit_log_worker`; the same for `llm_usage_daily`; `… tablename='privacy_requests'` → `privacy_requests_select`, `privacy_requests_worker`, `privacy_requests_write`; `psql "$DATABASE_URL" -tAc "select qual from pg_policies where policyname='privacy_requests_select'"` contains `user_has_role` and `owner`.
- [ ] `psql "$DATABASE_URL" -tAc "select relname from pg_class where relname in ('rules_overrides','staff_users','rate_limit_counters') and relrowsecurity"` → no rows; `select relpersistence from pg_class where relname='rate_limit_counters'` → `u`; `select has_table_privilege('authenticated','staff_users','select')` → `f`; `select has_function_privilege('authenticated','app.rate_limit_hit(text,int,int)','execute')` → `f`, the same for `app_worker` → `t`.
- [ ] `psql "$DATABASE_URL" -tAc "select tgname from pg_trigger where tgname='privacy_requests_touch_updated_at'"` → one row; `select has_sequence_privilege('app_worker','audit_log_id_seq','usage')` → `t`.
- [ ] `meta`, `isolation`, `roles`, `worker` tests green with 22 tenant tables, twice in a row; `psql "$DATABASE_URL" -tAc "select count(*) from audit_log"` → `0` after the run.
- [ ] `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts` → `1`; `grep -c "'privacy_requests'" packages/db/src/rls-catalog.ts` → `2`; `grep -c "since 0007" docs/v3/05-data-model.md` → `2`.

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

Write `docs/tasks/0033a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`0007_platform.sql` column by column against 05 §9 (`audit_log.id bigserial`, nullable `org_id` and `actor_user_id` without foreign keys, the `actor_kind`, `role`, `kind` and `state` check lists, `cost_usd numeric(10,4)`, `input_tokens`/`output_tokens bigint`, the composite primary keys of `llm_usage_daily` and `rate_limit_counters`, `rate_limit_counters` unlogged, `staff_users.user_id` on delete cascade, `privacy_requests.requested_by` without on delete), the function body (identical to 05: window start `to_timestamp(floor(epoch / p_window_s) * p_window_s)`, `on conflict … do update set hits = c.hits + 1`, `returning hits <= p_max`; `security definer` with pinned `search_path`), the grants (`revoke … from public, anon, authenticated` on the function; `revoke all … from anon, authenticated` on the three globals; `app_worker` only `select` on `rules_overrides` and `usage` on the sequence), the RLS block (`audit_log` and `llm_usage_daily` through the read-only helper; `privacy_requests` with `'{owner}'` and the replaced `_select`), the catalog (`privacy_requests` now in `OWNER_ONLY_TABLES` and `OWNER_ONLY_SELECT_TABLES`), the cleanup line in `helpers.ts` (deletes only org A and B rows of `audit_log`).

## Owner steps

None.
