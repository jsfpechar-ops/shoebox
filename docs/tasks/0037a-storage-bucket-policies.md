# 0037a: migration 0008 (bucket org-files, storage policies), shim stand-in, RLS storage test

Status: review
Ticket: P0-DB-10 (part a of a/b) | Depends on: 0033a/b merged (PR #66) | Base commit: head of phase/0 after PR #66 | Branch: task/0037-storage | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0008_storage` creates the private bucket `org-files` and four `storage.objects` policies for `authenticated` on names `org/{org_id}/…` (select: every member of the org; insert, update, delete: owner or member), plus `app.storage_org_id(name)`, the function that reads the org id out of an object name. The local shim gets a stand-in of `storage.buckets` and `storage.objects` so the policies run on the sandbox's plain Postgres, `packages/db/test/rls/storage.db.test.ts` pins M12 §4.4 RLS suite item 5 (a user of A sees no object of B, so the storage API cannot sign a URL for it; uploads outside own prefix fail), and 05 §10.3 names the mechanism. 0037b adds `BlobStore` in `packages/platform` on the same branch.

## 2. Context

Rules (AGENTS.md, rules.md Database and Privacy), pasted:

- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." Storage has no table of ours, but M12 §4.4 item 5 makes `storage.objects` part of the RLS suite: "`storage.objects` policies on bucket `org-files` with path prefix `org/{org_id}/`: user of A cannot create a signed URL for B's object; uploads outside own prefix fail." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only.
- Hard rule 4 / rules.md Privacy: EU regions only (Supabase Storage lives in the same EU project, ADR-004); no document content in logs; test data is anonymized placeholders (`a` × 64 as a sha, the suite's `aaaaaaaa-…` ids). Hard rule 5: a schema change is a new migration plus a 05 edit (step 5). Hard rule 7: no new dependency (none here). Hard rule 8: never push to `main`.
- ADR-004 (03): "Supabase Storage in the same EU project … storage RLS reuses the org policies. Code talks to a `BlobStore` interface … Layout: `org/{org_id}/files/{sha256}` (content-addressed, dedup within tenant), `org/{org_id}/eml/{message_id}.eml`, `org/{org_id}/exports/…`, `org/{org_id}/filings/…`." M12 §4.5 V4.2: "signed storage URLs expire in 5 min" (0037b). M12 §4.4 role matrix: upload, edit and delete documents are owner and member only; accountant and viewer read.
- How Supabase enforces storage access: every storage API call made with a user's JWT runs as `authenticated` against `storage.objects` with that JWT's claims; creating a signed URL and downloading need a `select` policy that matches the object row, an upload needs an `insert` policy, overwrite `update`, removal `delete`. So "cannot sign a URL for B's object" is, at the database, "`select` on B's row returns nothing", and that is what the test checks (there is no storage API on CI's Supabase: its `db` job starts Postgres and auth only).
- Policy expressions: `app.storage_org_id(name)` returns the uuid of the second path segment when the name matches `^org/<lowercase uuid>/`, else null (`strict`, `immutable`). `org_files_select` uses `app.storage_org_id(name) in (select app.user_org_ids())`; the three write policies use `app.user_has_role(app.storage_org_id(name), '{owner,member}')` (0002: `security definer`, so no recursion into `memberships`). A null org id matches nothing, so a name outside `org/{uuid}/` is invisible and unwritable to users. All four are `to authenticated` only: `app_worker` gets no grant on `storage.objects` (server code and the worker use `BlobStore` with the service key, 0037b). `bucket_id = 'org-files'` is in every expression so a future bucket starts with no access.
- `storage.objects` exists only where Supabase's storage schema exists. The migration's storage part is one `do $$ … $$` block that returns early when `to_regclass('storage.objects') is null` (plpgsql resolves the table names only when it reaches those statements); `app.storage_org_id()` is created unconditionally. The test probes the same thing at collection time (top-level `await`) and `describe.skipIf`s. Step 2 gives the shim (`packages/db/scripts/supabase-shim.sql`, applied by `local-pg.sh` to the plain Postgres only) a stand-in `storage.buckets` / `storage.objects` with the columns the policies and the test use, RLS on and the Supabase grants, so the sandbox runs the real policies. The brief writer also ran the bare case (shim without the storage schema): migration no-op with a NOTICE, test file skipped, 8 migrations applied.
- **Default (confirm at gate):** on CI the `db` job starts Supabase with `-x … storage-api …`; whether the Postgres 17 image alone has `storage.objects` is not known to the brief writer. The executor reads the CI log of `test/rls/storage.db.test.ts` (passed or skipped) and writes it in the report; if skipped, the reviewer decides whether to drop `storage-api` from the exclude list in `.github/workflows/ci.yml` (not this brief).
- **Default (confirm at gate):** the bucket is private (`public = false`), no `file_size_limit` or `allowed_mime_types` on the bucket row: the 50 MiB limit is the project-wide one in `supabase/config.toml` `[storage]`, and MIME admission is M01's (P1-ING-01). The bucket is inserted with `on conflict (id) do nothing` and the policies with `drop policy if exists` first, so the from-scratch run of `tenancy.db.test.ts` (which drops schema `app`, cascading the policies) re-creates them cleanly. The migration-lint's forward-only rules (drop table, drop column, alter type, rename) are not touched.
- `tenancy.db.test.ts` drops only `public` tables and schema `app`: rows in `storage.objects` survive it, so the test deletes its own rows (names under `org/{A}/` and `org/{B}/`) before and after. `seedTenants()` creates the orgs and the eight users; `asUser()` / `errorCodeAs()` run as `authenticated` with the user's JWT claims and roll back.
- The RLS meta-test looks at `public` only, so `storage.objects` is not in `rls-catalog.ts` (no edit there).

Anchors (`origin/phase/0` after PR #66):

`packages/db/migrations/meta/_journal.json` (step 1), the last entry:

```json
      "tag": "0007_platform",
      "breakpoints": true
    }
  ]
```

`packages/db/scripts/supabase-shim.sql` (step 2), the last line of the 30-line file:

```sql
grant execute on function auth.uid() to anon, authenticated, service_role;
```

`docs/v3/05-data-model.md` (step 5), the one-line anchor (the `## 11` heading, with the empty line before it):

```
## 11. Retention
```

All code below was run by the brief writer on `origin/phase/0` plus `origin/task/0033-db-platform` (PR #66) merged, against Postgres 16 (plain cluster + shim): migrations apply through `runMigrations`, `tsc` clean for db, `biome ci` clean, `migration-lint` OK, `check:tenant-sql` OK, the db suite green (15 files, 112 tests) twice on one database, `pii_guard` OK, `context_lint` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0008_storage.sql` | create | function, bucket, 4 policies |
| `packages/db/migrations/meta/_journal.json` | edit | entry 7 |
| `packages/db/scripts/supabase-shim.sql` | edit | storage stand-in (plain Postgres only) |
| `packages/db/test/rls/storage.db.test.ts` | create | RLS suite item 5 |
| `docs/v3/05-data-model.md` | edit | §10.3 storage paragraph (rule 5) |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 80–130 (migration) and 136–146 (journal)
- Step 2 code: lines 156–184
- Step 3 code: lines 194–345
- Step 5 code: lines 359–361

Setup (once): `git fetch origin phase/0 && git checkout -b task/0037-storage origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0007_platform.sql` and `packages/db/src/rate-limit.ts` to exist: `ls packages/db/migrations packages/db/src`; if not, STOP: PR #66 is not merged). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0037a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `packages/db/migrations/0008_storage.sql` and edit `_journal.json`

(a) Create the migration:

```sql
-- 0008_storage: ADR-004 bucket org-files (private) and its storage.objects policies (M12 §4.4 RLS
-- suite item 5, §4.5 V4.2). A user reads only objects named org/{org_id}/... of an org they belong
-- to and inserts, updates or deletes them only as owner or member (M12 §4.4 role matrix: upload,
-- delete documents). app.storage_org_id(name) reads the org id out of an object name and is null
-- for every other shape, so an object outside org/{uuid}/ is invisible and unwritable to users.
-- Server code and the worker reach storage through BlobStore with the service key, never through
-- these policies; app_worker gets nothing on storage.objects. The storage block runs only where
-- storage.objects exists (Supabase; the local shim): on a bare Postgres it is a no-op and
-- test/rls/storage.db.test.ts skips. Forward-only (the policies are re-creatable: drop if exists).

create function app.storage_org_id(p_name text) returns uuid
  language sql immutable strict parallel safe as $$
  select case
    when p_name ~ '^org/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      then split_part(p_name, '/', 2)::uuid
    else null
  end
$$;
grant execute on function app.storage_org_id(text) to anon, authenticated, service_role, app_worker;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '0008_storage: storage.objects absent, bucket and policies skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('org-files', 'org-files', false)
    on conflict (id) do nothing;

  drop policy if exists org_files_select on storage.objects;
  create policy org_files_select on storage.objects for select to authenticated
    using (bucket_id = 'org-files' and app.storage_org_id(name) in (select app.user_org_ids()));

  drop policy if exists org_files_insert on storage.objects;
  create policy org_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));

  drop policy if exists org_files_update on storage.objects;
  create policy org_files_update on storage.objects for update to authenticated
    using (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]))
    with check (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));

  drop policy if exists org_files_delete on storage.objects;
  create policy org_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));
end $$;
```

(b) `_journal.json`: replace the anchor (§2) with:

```json
      "tag": "0007_platform",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1760745600007,
      "tag": "0008_storage",
      "breakpoints": true
    }
  ]
```

Command: `grep -c "^  create policy org_files_" packages/db/migrations/0008_storage.sql` → `4`; `node scripts/migration-lint.ts packages/db/migrations/0008_storage.sql 2>&1 | tail -1` → `migration-lint: OK (1 file(s))`; `python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))'` → `8`. Commit.

### Step 2: edit `packages/db/scripts/supabase-shim.sql`

Append after the anchor line (§2), as the new end of the file:

```sql
-- Storage stand-in (0008): the columns of Supabase's storage.buckets and storage.objects that the
-- org-files policies and test/rls/storage.db.test.ts use. On Supabase the storage-api owns these
-- tables and grants anon, authenticated and service_role every privilege; RLS gates storage.objects.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
```

The file is then 59 lines (`wc -l`).

Command: `psql postgresql://postgres@127.0.0.1:54399/shoebox_test -v ON_ERROR_STOP=1 -q -f packages/db/scripts/supabase-shim.sql 2>&1 | grep -v NOTICE | tail -3` → no output (the shim is idempotent; the cluster already running from setup had the old shim, this applies the storage part); `psql postgresql://postgres@127.0.0.1:54399/shoebox_test -tAc "select to_regclass('storage.objects')"` → `storage.objects`. Commit.

### Step 3: create `packages/db/test/rls/storage.db.test.ts`

```ts
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  cleanupTenants,
  DATABASE_URL,
  errorCodeAs,
  ORG_A,
  ORG_B,
  ROLES,
  seedTenants,
  serviceSql,
  USERS,
} from './helpers';

// M12 §4.4 RLS test suite item 5 (0008_storage, ADR-004): on bucket org-files a user of org A sees
// only objects named org/{A}/... (so the storage API cannot sign a URL for B's object for them),
// inserts only under own prefix and only as owner or member, and cannot update or delete B's
// objects. Needs storage.objects (Supabase, or the local shim); on a bare Postgres the file skips.
const BUCKET = 'org-files';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_NEW = 'c'.repeat(64);
const OBJ_A = `org/${ORG_A}/files/${SHA_A}`;
const OBJ_B = `org/${ORG_B}/files/${SHA_B}`;
const POLICIES = ['org_files_delete', 'org_files_insert', 'org_files_select', 'org_files_update'];

async function hasStorageObjects(url: string | undefined): Promise<boolean> {
  if (url === undefined) {
    return false;
  }
  const sql = serviceSql(url);
  try {
    const [row] = await sql<{ present: boolean }[]>`
      select to_regclass('storage.objects') is not null as present`;
    return row?.present ?? false;
  } finally {
    await sql.end();
  }
}

const STORAGE = await hasStorageObjects(DATABASE_URL);

describe.skipIf(!STORAGE)('RLS storage: bucket org-files, prefix org/{org_id}/', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  async function visibleNames(uid: string | null): Promise<string[]> {
    return asUser(sql, uid, async (tx) => {
      const rows = await tx<{ name: string }[]>`select name from storage.objects
        where bucket_id = ${BUCKET} and name in (${OBJ_A}, ${OBJ_B}) order by name`;
      return rows.map((r) => r.name);
    });
  }

  function insertCode(uid: string, name: string): Promise<string | null> {
    return errorCodeAs(
      sql,
      uid,
      (tx) => tx`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${name})`,
    );
  }

  async function clearObjects(): Promise<void> {
    await sql`delete from storage.objects where bucket_id = ${BUCKET}
      and (name like ${`org/${ORG_A}/%`} or name like ${`org/${ORG_B}/%`})`;
  }

  beforeAll(async () => {
    sql = serviceSql(url);
    await seedTenants(sql, url);
    await clearObjects();
    await sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${OBJ_A}), (${BUCKET}, ${OBJ_B})`;
  });

  afterAll(async () => {
    await clearObjects();
    await cleanupTenants(sql);
    await sql.end();
  });

  it('bucket org-files exists and is private; the four policies and the name parser are there', async () => {
    const [bucket] = await sql<
      { public: boolean }[]
    >`select public from storage.buckets where id = ${BUCKET}`;
    expect(bucket?.public).toBe(false);
    const policies = await sql<{ policyname: string }[]>`select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname like 'org_files_%' order by 1`;
    expect(policies.map((p) => p.policyname)).toEqual(POLICIES);
    const [parsed] = await sql<{ a: string | null; b: string | null; c: string | null }[]>`
      select app.storage_org_id(${OBJ_A}) as a, app.storage_org_id(${`files/${SHA_A}`}) as b,
        app.storage_org_id(${`org/not-a-uuid/files/${SHA_A}`}) as c`;
    expect(parsed).toEqual({ a: ORG_A, b: null, c: null });
  });

  it('every role of A sees only org/A/ objects; B sees only its own; anonymous sees nothing', async () => {
    for (const role of ROLES) {
      expect(await visibleNames(USERS.A[role]), role).toEqual([OBJ_A]);
    }
    expect(await visibleNames(USERS.B.owner)).toEqual([OBJ_B]);
    expect(await visibleNames(null)).toEqual([]);
  });

  it('owner and member of A upload under org/A/; accountant and viewer get 42501', async () => {
    const name = `org/${ORG_A}/files/${SHA_NEW}`;
    expect(await insertCode(USERS.A.owner, name)).toBeNull();
    expect(await insertCode(USERS.A.member, name)).toBeNull();
    expect(await insertCode(USERS.A.accountant, name)).toBe('42501');
    expect(await insertCode(USERS.A.viewer, name)).toBe('42501');
  });

  it('nobody of A uploads under org/B/, outside org/, or under a malformed org segment', async () => {
    const outside = [
      `org/${ORG_B}/files/${SHA_NEW}`,
      `files/${SHA_NEW}`,
      `org/not-a-uuid/files/${SHA_NEW}`,
      `org/${ORG_A.toUpperCase()}/files/${SHA_NEW}`,
    ];
    for (const role of ROLES) {
      for (const name of outside) {
        expect(await insertCode(USERS.A[role], name), `${role} ${name}`).toBe('42501');
      }
    }
  });

  it("A cannot update or delete B's object; member of A deletes own, viewer of A cannot", async () => {
    const touched = await asUser(sql, USERS.A.owner, async (tx) => {
      const updated = await tx`update storage.objects set metadata = '{}'::jsonb
        where bucket_id = ${BUCKET} and name = ${OBJ_B}`;
      const deleted =
        await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_B}`;
      return [updated.count, deleted.count];
    });
    expect(touched).toEqual([0, 0]);
    const viewerDeleted = await asUser(
      sql,
      USERS.A.viewer,
      async (tx) =>
        (await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_A}`)
          .count,
    );
    expect(viewerDeleted).toBe(0);
    const memberDeleted = await asUser(
      sql,
      USERS.A.member,
      async (tx) =>
        (await tx`delete from storage.objects where bucket_id = ${BUCKET} and name = ${OBJ_A}`)
          .count,
    );
    expect(memberDeleted).toBe(1);
  });
});
```

Command: `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors; `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db exec vitest run test/rls/storage.db.test.ts 2>&1 | tail -6` → `Tests  5 passed (5)` (if it says `5 skipped`, step 2's shim did not apply: STOP). Commit.

### Step 4: the whole db suite, twice

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  15 passed (15)` and `Tests  112 passed (112)` (`tenancy.db.test.ts` migrates from scratch and re-creates the policies). Run it a second time: the same counts (cleanup works). Then `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no `DATABASE_URL`) → `29 passed | 83 skipped`. Nothing to commit.

### Step 5: edit `docs/v3/05-data-model.md`

Replace the one-line anchor `## 11. Retention` (§2) with the paragraph, an empty line and the heading:

```
**Storage objects** (ADR-004; migration 0008): bucket `org-files` is private. `storage.objects` has four policies for `authenticated` on names `org/{org_id}/…`: `org_files_select` (every member of the org, through `app.user_org_ids()`) and `org_files_insert`, `org_files_update`, `org_files_delete` (owner or member, through `app.user_has_role`). `app.storage_org_id(name)` reads the org id out of an object name and is null for any other shape, so an object outside `org/{uuid}/` is invisible and unwritable to users. Server code and the worker reach storage through `BlobStore` (`packages/platform`) with the service key, never through these policies; `app_worker` has no grant on `storage.objects`. The RLS suite's `storage.db.test.ts` (M12 §4.4 item 5) pins this and skips where `storage.objects` does not exist.

## 11. Retention
```

Command: `grep -c "migration 0008" docs/v3/05-data-model.md` → `1`; `python3 scripts/context_lint.py 2>&1 | tail -3` → `context lint: OK` (a WARN line about status.md is fine). Commit. Write the report (§9) and continue with 0037b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/0001_*.sql` to `0007_*.sql`, `packages/db/scripts/local-pg.sh`, `packages/db/src/**` (no catalog change: `storage.objects` is not a `public` table), `packages/db/test/**` except the one new file, `packages/testkit/**`, `packages/platform/**` (0037b), `supabase/config.toml`, `.github/**`, `scripts/**`, `docs/v3/**` except the one 05 replacement. Hard rules 3, 4, 5, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database. No public table, no `org_id` column, no change to `rls-catalog.ts`.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                   # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
psql postgresql://postgres@127.0.0.1:54399/shoebox_test -v ON_ERROR_STOP=1 -q -f packages/db/scripts/supabase-shim.sql 2>&1 | grep -v NOTICE | tail -3   # no output
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db exec vitest run test/rls/storage.db.test.ts 2>&1 | tail -6   # 5 passed
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30   # Tests 112 passed (15 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 29 passed, 83 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db 2>&1 | tail -30                                              # No fixes applied, no errors
node scripts/migration-lint.ts packages/db/migrations/0008_storage.sql 2>&1 | tail -3      # migration-lint: OK
python3 scripts/pii_guard.py --all packages/db/migrations/0008_storage.sql packages/db/test/rls/storage.db.test.ts packages/db/scripts/supabase-shim.sql 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                                             # context lint: OK
```

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"` → `8`; `select count(*) from pg_tables where schemaname='public'` → `29` (unchanged: no public table).
- [ ] `psql "$DATABASE_URL" -tAc "select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' order by 1"` → `org_files_delete|DELETE`, `org_files_insert|INSERT`, `org_files_select|SELECT`, `org_files_update|UPDATE`, each with roles `{authenticated}`; `select public from storage.buckets where id='org-files'` → `f`.
- [ ] `psql "$DATABASE_URL" -tAc "select app.storage_org_id('org/aaaaaaaa-0000-4000-8000-00000000000a/files/x')"` → `aaaaaaaa-0000-4000-8000-00000000000a`; `select app.storage_org_id('files/x') is null` → `t`; `select has_table_privilege('app_worker','storage.objects','select')` → `f`.
- [ ] `storage.db.test.ts`: 5 tests passed on the local cluster (not skipped), the whole db suite 112 passed twice in a row; `psql "$DATABASE_URL" -tAc "select count(*) from storage.objects"` → `0` after the run.
- [ ] `grep -c "migration 0008" docs/v3/05-data-model.md` → `1`; `wc -l packages/db/scripts/supabase-shim.sql` → `59`.
- [ ] Report says whether CI's `test/rls/storage.db.test.ts` ran or skipped (§2 default).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- the migration fails on CI's Supabase with `must be owner of table objects` (42501) or `relation "storage.buckets" does not exist`: paste the CI line in the report;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0037a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`0008_storage.sql`: the regex of `app.storage_org_id()` (lowercase uuid only; an uppercase or malformed segment is null, which the test pins), `strict immutable` (a null name is null, no error), the four policies all `to authenticated` with `bucket_id = 'org-files'` in every expression, select through `app.user_org_ids()` and the three writes through `app.user_has_role(…, '{owner,member}')` (accountant and viewer read only, M12 §4.4 role matrix), `update` with both `using` and `with check` (no renaming an object into another org), the early `return` on a missing `storage.objects`, `on conflict (id) do nothing` on the bucket, `drop policy if exists` before each create. The shim: stand-in columns match Supabase's (`bucket_id text`, `name text`, `unique (bucket_id, name)`), RLS enabled, grants to the three app roles, nothing for `app_worker`. The test: probes at collection time and skips, cleans its rows before and after, uses only the suite's placeholder ids and `'a' × 64` shas. CI: whether the storage test ran (report item).

## Owner steps

None.
