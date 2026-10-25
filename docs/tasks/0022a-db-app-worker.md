# 0022a: `app_worker` role, worker policies and the RLS helper update

Status: review
Ticket: P0-DB-02 (part a of a/b) | Depends on: 0014b (merged, PR #29) | Base commit: head of phase/0 (64be8b8 at writing) | Branch: task/0022-db-with-tenant | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0003_app_worker` creates the worker role `app_worker` (login, no BYPASSRLS), the helper `app.apply_worker_rls(table, org_column)` that adds the `<t>_worker` policy to a tenant table, and makes `app.apply_tenant_rls()` call it, so every later tenant table gets its worker policy in the same call that gives it `_select` and `_write`. The worker will connect as this role (0022b adds `withTenant`), and a query without `app.org_id` set sees zero rows instead of all rows: this is what keeps a worker bug from becoming a cross-tenant leak.

Also: the two db test files that exist after 0022b share one database, so both vitest configs stop running db test files in parallel.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR."
- Hard rule 5: "A schema change is a new migration plus a 05 edit." (step 6 edits 05 §10.1.)
- 05 §10.1 (verbatim, the worker lines):

```sql
-- worker role that respects RLS (M12 §4.4): no BYPASSRLS; withTenant() sets app.org_id per transaction
create role app_worker login noinherit nobypassrls;
grant usage on schema public, app to app_worker;
grant select, insert, update, delete on all tables in schema public to app_worker;
create policy documents_worker on documents for all to app_worker
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);
```

- M12 §4.4 Worker isolation: "every tenant policy gets an extra permissive policy `for all to app_worker using (org_id = current_setting('app.org_id', true)::uuid) with check (same)`. A query without `withTenant` sees zero rows instead of all rows."
- M12 §4.4 RLS test suite item 1: the meta-test (P0-DB-03) asserts "the `app_worker` policy present" on every table with `org_id`; item 4: "as `app_worker` without `app.org_id` → 0 rows everywhere; with `app.org_id = A` → only A."
- Two deviations from the 05 text, both verified on Postgres 16 by the brief writer and written into 05 in step 6: (1) the role is created inside `do $$ if not exists … $$` because roles are cluster-wide and the db test migrates the same cluster from scratch (`drop schema app cascade` keeps the role); (2) the policy compares with `app.current_org_id()` = `nullif(current_setting('app.org_id', true), '')::uuid`, because after a transaction-local `set_config` ends, `current_setting(.., true)` returns `''` on that session and `''::uuid` raises `22P02` instead of hiding the rows.
- `app.apply_tenant_rls` of 0002 is replaced with `create or replace` (same signature, same body plus a final `perform app.apply_worker_rls(...)`). The three tables of 0002 get their worker policy by explicit calls at the end of 0003.
- On Supabase the migrating role `postgres` has CREATEROLE, so `create role` works in a migration there too. The password of `app_worker` is never in a migration (owner step).

Anchors (current `origin/phase/0`):

`packages/db/migrations/meta/_journal.json`, last entry (step 2):

```json
    { "idx": 1, "version": "7", "when": 1760745600001, "tag": "0002_tenancy", "breakpoints": true }
```

`packages/db/test/migrations/tenancy.db.test.ts` (step 3), four anchors:

```ts
describe.skipIf(DATABASE_URL === undefined)('0001 + 0002: enums, tenancy tables and RLS', () => {
```

```ts
  it('migrates from scratch and records both migrations once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(2);
```

```ts
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
```

`packages/db/vitest.config.ts` (step 4):

```ts
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
```

`vitest.workspace.ts` (step 5), inside the `db` project:

```ts
      include: ['packages/db/test/**/*.db.test.ts'],
```

`docs/v3/05-data-model.md` §10.1 (step 6), three anchors: the line
`-- generated for every table with org_id (migration helper app.apply_tenant_rls(table, write_roles)):`,
the 7-line block quoted above (from `-- worker role that respects RLS` to the `with check` line), and the bullet that starts
`- The worker connects as \`app_worker\` and runs every tenant query inside \`withTenant(orgId, fn)\`, which sets \`app.org_id\` for the transaction.`

All code below was run by the brief writer on `origin/phase/0` (64be8b8) against Postgres 16 (plain cluster + shim): migrations apply from scratch and through `drizzle-kit migrate`, `tsc` clean, `biome ci` clean, `context_lint` OK, 37 tests pass with `DATABASE_URL` (28 pass + 9 skip without).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0003_app_worker.sql` | create | role, `app.current_org_id()`, `app.apply_worker_rls()`, replaced `app.apply_tenant_rls()`, 3 calls |
| `packages/db/migrations/meta/_journal.json` | edit | entry 2 |
| `packages/db/test/migrations/tenancy.db.test.ts` | edit | 3 migrations, `_worker` policy expected |
| `packages/db/vitest.config.ts` | edit | `fileParallelism: false` |
| `vitest.workspace.ts` | edit | `fileParallelism: false` in the `db` project |
| `docs/v3/05-data-model.md` | edit | §10.1 worker lines (rule 5) |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin phase/0 && git checkout -b task/0022-db-with-tenant origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0002_tenancy.sql` to exist: `ls packages/db/migrations`). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -2` → last line `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; the steps can still be typechecked, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0022a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/migrations/0003_app_worker.sql`

```sql
-- 0003_app_worker: the worker role that respects RLS (05 §10.1, M12 §4.4 Worker isolation).
-- app_worker has no BYPASSRLS; withTenant(orgId, fn) (packages/db/src/tenant.ts) sets app.org_id
-- for one transaction and the <t>_worker policy lets it see exactly that org. Without the setting
-- the policy compares with null and the worker sees zero rows. Forward-only.
--
-- Roles are cluster-wide, so the role is created only when missing (a test database that is
-- migrated from scratch keeps the role). The password is set by the owner outside migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker login noinherit nobypassrls;
  end if;
end $$;

grant usage on schema public, app to app_worker;
grant select, insert, update, delete on all tables in schema public to app_worker;
grant usage, select on all sequences in schema public to app_worker;
grant execute on function app.user_org_ids() to app_worker;
grant execute on function app.user_has_role(uuid, member_role[]) to app_worker;

-- Org of the current transaction, as set by withTenant(). nullif: after a transaction-local
-- set_config ends, current_setting(.., true) returns '' (not null) on the same session, and
-- ''::uuid would raise instead of hiding the rows.
create function app.current_org_id() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
grant execute on function app.current_org_id() to anon, authenticated, service_role, app_worker;

-- Migration helper: adds the <t>_worker policy to a tenant table. p_org_column is 'id' for
-- organizations itself. Re-runnable (drops the policy first).
create function app.apply_worker_rls(p_table text, p_org_column text default 'org_id')
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_worker', p_table);
  execute format(
    'create policy %I on public.%I for all to app_worker '
    || 'using (%I = app.current_org_id()) with check (%I = app.current_org_id())',
    p_table || '_worker', p_table, p_org_column, p_org_column);
  execute format('grant select, insert, update, delete on public.%I to app_worker', p_table);
end
$$;

-- From now on app.apply_tenant_rls() creates all three policies (<t>_select, <t>_write, <t>_worker),
-- so every later migration keeps calling it once per tenant table.
create or replace function app.apply_tenant_rls(
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
  perform app.apply_worker_rls(p_table, p_org_column);
end
$$;

-- The three tenancy tables of 0002 get their worker policy now.
select app.apply_worker_rls('organizations', 'id');
select app.apply_worker_rls('memberships');
select app.apply_worker_rls('taxpayer_profiles');
```

Command: `grep -c 'app_worker' packages/db/migrations/0003_app_worker.sql` → `12`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor line (§2) with these lines (this is the Biome formatting of the new entry; keep it):

```json
    { "idx": 1, "version": "7", "when": 1760745600001, "tag": "0002_tenancy", "breakpoints": true },
    {
      "idx": 2,
      "version": "7",
      "when": 1760745600002,
      "tag": "0003_app_worker",
      "breakpoints": true
    }
```

Command: `node -e "const j=JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8')); console.log(j.entries.map(e=>e.tag).join(','))"` → `0001_enums,0002_tenancy,0003_app_worker`. Commit.

### Step 3: edit `packages/db/test/migrations/tenancy.db.test.ts`

Four replacements, anchors in §2 (find each with `grep -nF`):

(a) `'0001 + 0002: enums, tenancy tables and RLS'` → `'0001 + 0003: enums, tenancy tables and RLS'`.

(b) The 3-line anchor becomes:

```ts
  it('migrates from scratch and records all three migrations once', async () => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]?.n).toBe(3);
```

(c) The whole `it.each(TENANT_TABLES)(...)` block (12 lines, from `it.each(TENANT_TABLES)('%s has RLS enabled with _select and _write policies'` to its closing `});`) becomes:

```ts
  it.each(TENANT_TABLES)(
    '%s has RLS enabled with _select, _write and _worker policies',
    async (table) => {
      const rel = await sql`select relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${table}`;
      expect(rel[0]?.relrowsecurity).toBe(true);
      const policies = await sql`select policyname, cmd from pg_policies
      where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ]);
    },
  );
```

Nothing else in the file changes (the `beforeAll` drop list stays: `drop schema app cascade` removes the 0003 functions, the role survives and 0003 is written for that).

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  3 passed (3)` and `Tests  37 passed (37)`. (Without a database: `pnpm --filter @shoebox/db test 2>&1 | tail -8` → `28 passed | 9 skipped`.) Commit.

### Step 4: edit `packages/db/vitest.config.ts`

Replace the anchor line (§2) with:

```ts
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // The *.db.test.ts files share one DATABASE_URL and migrate from scratch: never in parallel.
    fileParallelism: false,
```

Command: `pnpm exec biome ci packages/db/vitest.config.ts 2>&1 | tail -3` → `No fixes applied` / no errors. Commit.

### Step 5: edit `vitest.workspace.ts`

Replace the anchor line (§2) with:

```ts
      include: ['packages/db/test/**/*.db.test.ts'],
      fileParallelism: false,
```

Command: `pnpm exec biome ci vitest.workspace.ts 2>&1 | tail -3` → no errors; then `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 6: edit `docs/v3/05-data-model.md` (§10.1, three replacements)

(a) The line `-- generated for every table with org_id (migration helper app.apply_tenant_rls(table, write_roles)):` becomes two lines:

```
-- generated for every table with org_id by the migration helper app.apply_tenant_rls(table, write_roles, org_column):
-- <t>_select, <t>_write and (since 0003_app_worker) <t>_worker. org_column is 'id' for organizations itself.
```

(b) The 7-line worker block quoted in §2 becomes:

```sql
-- worker role that respects RLS (M12 §4.4): no BYPASSRLS; withTenant() sets app.org_id per transaction.
-- Migration 0003_app_worker: the role is created only when missing (roles are cluster-wide); its password is set by the owner.
create role app_worker login noinherit nobypassrls;
grant usage on schema public, app to app_worker;
grant select, insert, update, delete on all tables in schema public to app_worker;
-- nullif: after a transaction-local set_config ends, current_setting(.., true) returns '' (not null) on that session.
create function app.current_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
-- generated by app.apply_worker_rls(table, org_column), the last step of app.apply_tenant_rls():
create policy documents_worker on documents for all to app_worker
  using (org_id = app.current_org_id())
  with check (org_id = app.current_org_id());
```

(c) In the bullet, replace the opening phrase
`- The worker connects as \`app_worker\` and runs every tenant query inside \`withTenant(orgId, fn)\`, which sets \`app.org_id\` for the transaction.`
with
`- The worker connects as \`app_worker\` (\`WORKER_DATABASE_URL\`; migrations and \`withServiceRole\` use \`DATABASE_URL\`) and runs every tenant query inside \`withTenant(orgId, fn)\`, which sets \`app.org_id\` for the transaction.`
The rest of the bullet stays.

Command: `python3 scripts/context_lint.py 2>&1 | tail -2` → `context lint: OK` (a WARN about status.md is fine). Commit. Then write the report (§9) and continue with 0022b on the same branch.

## 5. Do not touch

`packages/db/migrations/0001_enums.sql`, `packages/db/migrations/0002_tenancy.sql` (never edit an applied migration), `packages/db/scripts/**`, `packages/db/src/**` (0022b), `packages/db/package.json`, root `package.json`, `docs/v3/**` other than the §10.1 lines of step 6. Hard rules: 3 (worker policy + test in the same PR: steps 1 and 3), 5 (migration + 05 edit: steps 1 and 6), 7 (no new dependency), 8 (never push to `main`). Never set a password for `app_worker` in any file. Never run `supabase-shim.sql` against a Supabase database.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -2                                                        # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30    # Tests 37 passed (3 files)
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30  # 9 passed (tenancy through the root db project)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                                                   # without DATABASE_URL: 28 passed, 9 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                                              # exit 0
pnpm exec biome ci packages/db vitest.workspace.ts 2>&1 | tail -30                                               # No fixes applied
python3 scripts/context_lint.py 2>&1 | tail -3                                                                   # context lint: OK
```

Test-map row for `packages/db`: `pnpm --filter @shoebox/db test -- migrations rls` (needs `pnpm db:start`); here `DATABASE_URL` from `local-pg.sh` replaces `db:start` because Docker is unavailable. Leave the cluster running for 0022b (`bash packages/db/scripts/local-pg.sh stop` only at the very end).

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select rolcanlogin, rolinherit, rolbypassrls from pg_roles where rolname='app_worker'"` → `t|f|f`.
- [ ] `psql "$DATABASE_URL" -tAc "select tablename, policyname from pg_policies where policyname like '%_worker' order by 1"` → the three tenancy tables.
- [ ] `tenancy.db.test.ts`: 9 passed with `DATABASE_URL`, 9 skipped without.
- [ ] `drizzle.__drizzle_migrations` has 3 rows after the test.
- [ ] `context_lint` OK; 05 §10.1 shows `app.current_org_id()` and `app.apply_worker_rls`.

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

Write `docs/tasks/0022a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`packages/db/migrations/0003_app_worker.sql` (the role has `login` and `nobypassrls`; the policy uses `app.current_org_id()`; `apply_tenant_rls` keeps its 0002 body and only adds the `perform`), the `tenancy.db.test.ts` diff (the expected policy list grew by `_worker`, nothing else relaxed), the 05 diff.

## Owner steps

None for this part. After the PR merges and before the worker is deployed (P0-WORK ticket), on the Supabase project: SQL editor → `alter role app_worker password '<generated>';` and store `WORKER_DATABASE_URL` (same host and database as `DATABASE_URL`, user `app_worker`, that password) as a secret for the worker environment. Never in the repo.
