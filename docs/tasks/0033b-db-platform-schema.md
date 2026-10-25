# 0033b: Drizzle mirror of 0007, rateLimitHit() and the platform migration tests

Status: review
Ticket: P0-DB-07 (part b of a/b) | Depends on: 0033a (same branch) | Base commit: head of task/0033-db-platform after 0033a | Branch: task/0033-db-platform | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/db/src/schema/platform.ts` mirrors the six tables of migration 0007 for typed queries (`cost_usd` a `numeric` string, never a float); `packages/db/src/rate-limit.ts` exports `rateLimitHit(key, max, windowS, db)` over `app.rate_limit_hit()`; `test/rate-limit.db.test.ts` pins the ticket's acceptance (3rd hit with max 2 in one window returns false; a new window resets; grants), and `test/migrations/platform.db.test.ts` pins the rest: the six tables with their policies and grants, the global tables unreadable by users, `privacy_requests` owner-only, `audit_log` and `llm_usage_daily` select-only, the checks, the `updated_at` trigger, the cascades and the absence of the 05 §9.1 Later tables.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; `llm_usage_daily.cost_usd` is `numeric(10,4)` (a string in Drizzle), timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit" (done in 0033a). Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- `packages/db` convention (`schema/documents.ts`, `schema/partners.ts`, `schema/document-details.ts`): "The SQL file is the source of truth for DDL; this file gives typed queries." The unlogged flag, the function, the trigger, RLS and grants exist only in SQL; column checks and composite primary keys are mirrored. Index and constraint names in the mirror are the names Postgres generated for the unnamed lines of 05 (`audit_log_org_id_at_idx`, `<table>_pkey`, `<table>_<col>_check`), so a future `drizzle-kit` diff stays quiet. `bigserial` is `bigserial('id', { mode: 'number' })`, `bigint` columns `bigint(..., { mode: 'number' })`.
- Ticket acceptance (backlog P0-DB-07): "`packages/db/test/rate-limit.test.ts`: 3rd hit with max 2 in one window returns false; a new window resets. `staff_users`, `rules_overrides`, `rate_limit_counters` service-role only; `privacy_requests` owner-only (RLS cases); `rateLimitHit(key, max, windowS)` exported from `packages/db`. The 05 §9.1 Later tables are not migrated." **Default (confirm at gate):** the test file is `test/rate-limit.db.test.ts` (the `db` vitest project runs only `*.db.test.ts`, which skip without `DATABASE_URL`); `rateLimitHit` takes the Drizzle handle as a fourth argument (`db: Pick<Db | Tx, 'execute'>`: the API's service `Db`, the worker `Db` or a `Tx`) instead of a hidden process-wide connection; `withServiceRole` has no reason for it (M12 §6 lists retention, export, admin, migration), and a hit must count inside the caller's transaction or pool. The function is `security definer` and executable by `service_role` and `app_worker` only (0033a), so a browser session cannot call it.
- "A new window resets" is tested without sleeping: after the window is exhausted the test moves the counted row's `window_start` back by one window (`update rate_limit_counters … - interval '60 seconds'`), so the next hit opens a fresh window and returns true; two rows remain. Keys start with `test:` and are deleted before and after.
- `platform.db.test.ts` runs its role checks with the same `asUser()` pattern as `documents-detail.db.test.ts` (JWT claims + `set local role authenticated`, rolled back) on one org with four memberships; the global-table check reads `has_table_privilege` for `anon`, `authenticated`, `app_worker` and expects exactly one grant (`rules_overrides`/`app_worker`/`SELECT`). `audit_log` rows of the test org are deleted explicitly (no foreign key); the `null` org row is deleted by its `action`.
- Test data are placeholders (`test-model`, `test.vat.rates`, `Org Platform`); the test org prefix is `ffffffff` so neither the RLS suite's cleanup (`aaaaaaaa`/`bbbbbbbb`) nor the other migration tests (`dddddddd`, `eeeeeeee`) touch it.

Anchors (branch `task/0033-db-platform` after 0033a):

`packages/db/src/schema/index.ts` (step 2), line 6 of 7:

```ts
export * from './partners';
```

`packages/db/src/index.ts` (step 3), two one-line anchors (lines 2 and 8):

```ts
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
```

```ts
export * from './schema/partners';
```

All code below was run by the brief writer on `origin/claude/phase-0-resume-oaa6ss` (phase/0 at 4ef062c plus the 0032a/b and 0033a steps applied by hand) against Postgres 16 (plain cluster + shim): migrations apply through `runMigrations`, `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned), `pii_guard` OK, `check:tenant-sql` exit 0.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/platform.ts` | create | Drizzle mirror of 0007 |
| `packages/db/src/schema/index.ts` | edit | export `./platform` |
| `packages/db/src/rate-limit.ts` | create | `rateLimitHit()` |
| `packages/db/src/index.ts` | edit | export `./schema/platform`, `./rate-limit` |
| `packages/db/test/rate-limit.db.test.ts` | create | 4 tests |
| `packages/db/test/migrations/platform.db.test.ts` | create | 6 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 74–202
- Step 2 (no code block): lines 208–211
- Step 3 code: lines 218–272
- Step 4 code: lines 280–395
- Step 5 code: lines 403–692
- Step 6 (no code block): lines 698–699

Setup: `git checkout task/0033-db-platform && git log --oneline -1` → `0033a step 6`. `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (already running is fine).

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0033b step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/src/schema/platform.ts`

```ts
// Drizzle mirror of migrations/0007_platform.sql (05 §9 Platform). The SQL file is the source of
// truth for DDL; this file gives typed queries. The unlogged flag of rate_limit_counters, the
// function app.rate_limit_hit() (see ../rate-limit.ts), the updated_at trigger, the RLS policies
// and the grants exist only in SQL. cost_usd is numeric(10,4): a string in Drizzle, never a float.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers, organizations } from './tenancy';

/** Tenant table with a nullable org_id (05 §10.3): users select rows of their orgs, server code inserts. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id'),
    actorUserId: uuid('actor_user_id'),
    actorKind: text('actor_kind').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    diff: jsonb('diff'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_id_at_idx').on(t.orgId, t.at),
    check(
      'audit_log_actor_kind_check',
      sql`${t.actorKind} in ('user','system','accountant','api','staff')`,
    ),
  ],
);

/** GLOBAL (05 §10.3): admin hotfix of law data (06 §2); service role writes, the worker reads. */
export const rulesOverrides = pgTable('rules_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleKey: text('rule_key').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  value: jsonb('value').notNull(),
  reason: text('reason').notNull(),
  source: text('source').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tenant-keyed counters, select-only for users (05 §10.2); the worker writes them. */
export const llmUsageDaily = pgTable(
  'llm_usage_daily',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    model: text('model').notNull(),
    calls: integer('calls').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull(),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ name: 'llm_usage_daily_pkey', columns: [t.orgId, t.day, t.model] })],
);

/** GLOBAL (05 §10.3): service role only (M12 §4.9). */
export const staffUsers = pgTable(
  'staff_users',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('staff_users_role_check', sql`${t.role} in ('admin','support')`)],
);

/** Select and write owner-only (05 §10.2). */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => authUsers.id),
    state: text('state').notNull().default('pending'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    resultPath: text('result_path'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'privacy_requests_kind_check',
      sql`${t.kind} in ('export','close_archive','close_delete')`,
    ),
    check(
      'privacy_requests_state_check',
      sql`${t.state} in ('pending','running','ready','scheduled','done','cancelled','failed')`,
    ),
  ],
);

/** GLOBAL (05 §10.3), unlogged in SQL: fixed-window counters written only by app.rate_limit_hit(). */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull(),
  },
  (t) => [primaryKey({ name: 'rate_limit_counters_pkey', columns: [t.key, t.windowStart] })],
);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: edit `packages/db/src/schema/index.ts`

After the `export * from './partners';` anchor line insert `export * from './platform';`, so the file ends with six export lines: document-details, documents, enums, partners, platform, tenancy (8 lines in all).

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors; `pnpm check:tenant-sql 2>&1 | tail -3` → exit 0 (the line ends with `no Drizzle call on a tenant table outside withTenant()`). Commit.

### Step 3: create `packages/db/src/rate-limit.ts` and edit `packages/db/src/index.ts`

(a) create `packages/db/src/rate-limit.ts`:

```ts
// rateLimitHit (M12 §4.5, 05 §9): Postgres-backed fixed-window counters, no Redis. One call to
// app.rate_limit_hit(key, max, window_s) (migration 0007, security definer: the caller needs no
// privilege on rate_limit_counters; execute is granted to service_role and app_worker) counts one
// hit in the current window and says whether it is still within `max`. Keys follow M12 §4.5
// (`upload:{user}`, `api:{token}`, `ares:{user}`, …). Windows older than 2 days are deleted by the
// job ops.rate_limit_gc.
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './tenant';

/** A Drizzle handle that can run app.rate_limit_hit(): the service Db, the worker Db or a Tx. */
export type RateLimitDb = Pick<Db | Tx, 'execute'>;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Counts one hit of `key` in the fixed window of `windowS` seconds and returns true while the
 * window holds at most `max` hits (the call that reaches max + 1 returns false). A new window
 * starts counting from one again.
 */
export async function rateLimitHit(
  key: string,
  max: number,
  windowS: number,
  db: RateLimitDb,
): Promise<boolean> {
  if (typeof key !== 'string' || key === '') {
    throw new TypeError('rateLimitHit: key must be a non-empty string');
  }
  if (!isCount(max)) {
    throw new TypeError('rateLimitHit: max must be a non-negative integer');
  }
  if (!isCount(windowS) || windowS === 0) {
    throw new TypeError('rateLimitHit: windowS must be a positive integer');
  }
  const [row] = await db.execute<{ allowed: boolean }>(
    sql`select app.rate_limit_hit(${key}, ${max}::int, ${windowS}::int) as allowed`,
  );
  return row?.allowed === true;
}
```

(b) `packages/db/src/index.ts`: after the `export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';` anchor line insert `export { type RateLimitDb, rateLimitHit } from './rate-limit';`; after the `export * from './schema/partners';` anchor line insert `export * from './schema/platform';`. Lines 2–10 then read:

```ts
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
export { type RateLimitDb, rateLimitHit } from './rate-limit';
export * from './rls-catalog';
export * from './schema/document-details';
export * from './schema/documents';
export * from './schema/enums';
export * from './schema/partners';
export * from './schema/platform';
export * from './schema/tenancy';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors; `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no database) → `28 passed | 67 skipped`. Commit.

### Step 4: create `packages/db/test/rate-limit.db.test.ts`

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { rateLimitHit } from '../src/rate-limit';

// P0-DB-07 acceptance: rateLimitHit(key, max, windowS, db) over app.rate_limit_hit() (0007):
// the 3rd hit with max 2 in one window returns false; a new window resets. The window change is
// simulated by moving the counted window back, so the test never sleeps. Keys start with `test:`
// and are deleted before and after. Function grants: service_role and app_worker only.
const DATABASE_URL = process.env.DATABASE_URL;
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('rateLimitHit over app.rate_limit_hit()', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let db: ReturnType<typeof drizzle>;

  /** Runs fn as `role` (service connection, `set local role`) and rolls back. */
  async function asRole<T>(role: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('role', ${role}, true)`;
        result = await fn(tx as unknown as Sql);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return result as T;
  }

  function code(p: Promise<unknown>): Promise<string | null> {
    return p.then(
      () => null,
      (e: { code?: string }) => e.code ?? 'unknown',
    );
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    db = drizzle(sql);
    await runMigrations(url);
    await sql`delete from rate_limit_counters where key like 'test:%'`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from rate_limit_counters where key like 'test:%'`;
      await sql.end();
    }
  });

  it('the 3rd hit with max 2 in one window returns false', async () => {
    expect(await rateLimitHit('test:upload:u1', 2, 3600, db)).toBe(true);
    expect(await rateLimitHit('test:upload:u1', 2, 3600, db)).toBe(true);
    expect(await rateLimitHit('test:upload:u1', 2, 3600, db)).toBe(false);
    expect(await rateLimitHit('test:upload:u1', 2, 3600, db)).toBe(false);
    const [row] = await sql`select hits, count(*) over () as windows
      from rate_limit_counters where key = 'test:upload:u1'`;
    expect(row).toMatchObject({ hits: 4, windows: '1' });
    expect(await rateLimitHit('test:upload:u2', 2, 3600, db)).toBe(true);
  });

  it('a new window resets the count', async () => {
    expect(await rateLimitHit('test:api:t1', 1, 60, db)).toBe(true);
    expect(await rateLimitHit('test:api:t1', 1, 60, db)).toBe(false);
    // The current window becomes the previous one; the next hit opens a fresh window.
    await sql`update rate_limit_counters set window_start = window_start - interval '60 seconds'
      where key = 'test:api:t1'`;
    expect(await rateLimitHit('test:api:t1', 1, 60, db)).toBe(true);
    expect(await rateLimitHit('test:api:t1', 1, 60, db)).toBe(false);
    const rows = await sql`select hits from rate_limit_counters where key = 'test:api:t1'
      order by window_start`;
    expect(rows.map((r) => r.hits)).toEqual([2, 2]);
  });

  it('max 0 refuses the first hit; bad arguments throw before any query', async () => {
    expect(await rateLimitHit('test:export:o1', 0, 86400, db)).toBe(false);
    await expect(rateLimitHit('', 1, 60, db)).rejects.toThrow(TypeError);
    await expect(rateLimitHit('test:x', -1, 60, db)).rejects.toThrow(TypeError);
    await expect(rateLimitHit('test:x', 1.5, 60, db)).rejects.toThrow(TypeError);
    await expect(rateLimitHit('test:x', 1, 0, db)).rejects.toThrow(TypeError);
    expect(await sql`select 1 from rate_limit_counters where key = 'test:x'`).toHaveLength(0);
  });

  it('service_role and app_worker may execute it; authenticated and anon may not (05 §10.3)', async () => {
    const fn = 'app.rate_limit_hit(text, int, int)';
    const [grants] = await sql`select
      has_function_privilege('service_role', ${fn}, 'execute') as service_role,
      has_function_privilege('app_worker', ${fn}, 'execute') as app_worker,
      has_function_privilege('authenticated', ${fn}, 'execute') as authenticated,
      has_function_privilege('anon', ${fn}, 'execute') as anon,
      has_table_privilege('app_worker', 'rate_limit_counters', 'select') as worker_table`;
    expect(grants).toEqual({
      service_role: true,
      app_worker: true,
      authenticated: false,
      anon: false,
      worker_table: false,
    });
    const asWorker = await asRole(
      'app_worker',
      (tx) => tx`select app.rate_limit_hit('test:ares:w1', 30, 60) as allowed`,
    );
    expect(asWorker[0]?.allowed).toBe(true);
    expect(
      await code(
        asRole('authenticated', (tx) => tx`select app.rate_limit_hit('test:ares:w1', 30, 60)`),
      ),
    ).toBe('42501');
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  12 passed (12)` and `Tests  99 passed (99)`. Commit.

### Step 5: create `packages/db/test/migrations/platform.db.test.ts`

```ts
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import {
  GLOBAL_TABLES,
  NULLABLE_ORG_ID,
  OWNER_ONLY_SELECT_TABLES,
  OWNER_ONLY_TABLES,
  READ_ONLY_FOR_USERS,
} from '../../src/rls-catalog';

// 0007_platform (05 §9, §10.2, §10.3): the six tables and their policies and grants, the global
// tables unreadable by users, privacy_requests owner-only, audit_log and llm_usage_daily
// select-only, cost_usd numeric, the checks, the updated_at trigger, the cascades, and the 05 §9.1
// Later tables absent. Migrates forward only (tenancy.db.test.ts owns the from-scratch run); its
// org uses the prefix ffffffff so no other file's cleanup touches it.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'ffffffff-0000-4000-8000-000000000001';
const OTHER_ORG = 'ffffffff-0000-4000-8000-000000000002';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a1';
const MEMBER = 'ffffffff-0000-4000-8000-0000000000a2';
const ACCOUNTANT = 'ffffffff-0000-4000-8000-0000000000a3';
const VIEWER = 'ffffffff-0000-4000-8000-0000000000a4';
const USERS = [OWNER, MEMBER, ACCOUNTANT, VIEWER];
const TENANT_0007 = ['audit_log', 'llm_usage_daily', 'privacy_requests'] as const;
const GLOBAL_0007 = ['rate_limit_counters', 'rules_overrides', 'staff_users'] as const;
const LATER_0007 = ['extraction_batches', 'global_vendor_priors', 'support_access_grants'];
const ROLLBACK = Symbol('rollback');

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0007: platform tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  /** Runs fn as `authenticated` with the JWT subject of uid and rolls back. */
  async function asUser<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true),
          set_config('request.jwt.claims', ${claims}, true)`;
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

  async function cleanup(): Promise<void> {
    await sql`delete from audit_log where org_id in (${ORG}, ${OTHER_ORG})`;
    await sql`delete from organizations where id in (${ORG}, ${OTHER_ORG})`;
    await sql`delete from rules_overrides where rule_key like 'test.%'`;
    await sql`delete from staff_users where user_id = any(${USERS})`;
    await sql`delete from auth.users where id::text like 'ffffffff-%'`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await cleanup();
    for (const uid of USERS) {
      await sql`insert into auth.users (id) values (${uid}) on conflict (id) do nothing`;
    }
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret) values
      (${ORG}, 'Org Platform', 'org-platform-0007', 'FFFFFFF1'),
      (${OTHER_ORG}, 'Org Platform B', 'org-platform-0007-b', 'FFFFFFF2')`;
    await sql`insert into memberships (org_id, user_id, role) values
      (${ORG}, ${OWNER}, 'owner'), (${ORG}, ${MEMBER}, 'member'),
      (${ORG}, ${ACCOUNTANT}, 'accountant'), (${ORG}, ${VIEWER}, 'viewer')`;
    await sql`insert into audit_log (org_id, actor_kind, entity, action) values
      (${ORG}, 'system', 'documents', 'test.a'), (${OTHER_ORG}, 'system', 'documents', 'test.b'),
      (null, 'staff', 'rules_overrides', 'test.global')`;
    await sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
      values (${ORG}, '2026-01-15', 'test-model', 3, 1200, 300, '0.0123')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from audit_log where org_id is null and action = 'test.global'`;
      await cleanup();
      await sql.end();
    }
  });

  it('creates the six tables with the expected policies; the 05 §9.1 Later tables do not exist', async () => {
    const tables = await sql<{ t: string; p: string }[]>`select relname as t, relpersistence as p
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relkind = 'r'
        and relname = any(${[...TENANT_0007, ...GLOBAL_0007, ...LATER_0007]}) order by 1`;
    expect(tables.map((r) => r.t)).toEqual([...TENANT_0007, ...GLOBAL_0007].sort());
    expect(tables.find((r) => r.t === 'rate_limit_counters')?.p, 'unlogged').toBe('u');
    for (const table of TENANT_0007) {
      const policies = await sql<{ policyname: string; cmd: string }[]>`select policyname, cmd
        from pg_policies where schemaname = 'public' and tablename = ${table} order by policyname`;
      const expected = [
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
      ];
      if (table === 'privacy_requests') {
        expected.push(['privacy_requests_write', 'ALL']);
      }
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual(expected);
    }
    const noRls =
      await sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relname = any(${[...GLOBAL_0007]}) and relrowsecurity`;
    expect(noRls).toHaveLength(0);
    expect(READ_ONLY_FOR_USERS).toEqual(expect.arrayContaining(['audit_log', 'llm_usage_daily']));
    expect(NULLABLE_ORG_ID).toContain('audit_log');
    expect(OWNER_ONLY_TABLES).toContain('privacy_requests');
    expect(OWNER_ONLY_SELECT_TABLES).toContain('privacy_requests');
    for (const table of GLOBAL_0007) {
      expect(GLOBAL_TABLES[table], table).toBe('service_role');
    }
  });

  it('global tables: no app-role grant, the worker reads only rules_overrides, a user select raises 42501', async () => {
    const grants = await sql<{ t: string; role: string; privs: string }[]>`select t, r.role,
        string_agg(p.priv, ',' order by p.priv) filter (where has_table_privilege(r.role, t, p.priv)) as privs
      from unnest(${[...GLOBAL_0007]}::text[]) as t
      cross join (values ('anon'), ('authenticated'), ('app_worker')) as r(role)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
      group by t, r.role order by t, r.role`;
    expect(grants.filter((g) => g.privs !== null)).toEqual([
      { t: 'rules_overrides', role: 'app_worker', privs: 'SELECT' },
    ]);
    for (const table of GLOBAL_0007) {
      expect(
        await code(asUser(OWNER, (tx) => tx`select 1 from ${tx(table)}`)),
        `${table} as owner`,
      ).toBe('42501');
    }
    await sql`insert into rules_overrides (rule_key, valid_from, value, reason, source, created_by)
      values ('test.vat.rates', '2026-01-01', '{"standard": 21}', 'TEST reason', 'TEST source', 'staff:test')`;
    await sql`insert into staff_users (user_id, role) values (${OWNER}, 'support')`;
    expect(
      await code(sql`insert into staff_users (user_id, role) values (${MEMBER}, 'root')`),
    ).toBe('23514');
  });

  it('audit_log: users select the rows of their orgs only; no user insert; the sequence works for the worker', async () => {
    const seen = await asUser(
      OWNER,
      (tx) => tx<{ org: string | null }[]>`select org_id::text as org from audit_log
        where action like 'test.%' order by 1`,
    );
    expect(seen.map((r) => r.org)).toEqual([ORG]);
    expect(
      await code(
        asUser(
          OWNER,
          (tx) => tx`insert into audit_log (org_id, actor_kind, entity, action)
            values (${ORG}, 'user', 'documents', 'test.user')`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        sql`insert into audit_log (org_id, actor_kind, entity, action) values (${ORG}, 'robot', 'x', 'test.bad')`,
      ),
    ).toBe('23514');
    const [seq] =
      await sql`select has_sequence_privilege('app_worker', 'audit_log_id_seq', 'usage') as ok`;
    expect(seq?.ok).toBe(true);
    const [idx] =
      await sql`select indexdef from pg_indexes where indexname = 'audit_log_org_id_at_idx'`;
    expect(idx?.indexdef).toContain('(org_id, at)');
  });

  it('llm_usage_daily: numeric(10,4) cost, select-only for users, the composite key', async () => {
    const [col] = await sql`select numeric_precision as p, numeric_scale as s, data_type as d
      from information_schema.columns
      where table_schema = 'public' and table_name = 'llm_usage_daily' and column_name = 'cost_usd'`;
    expect(col).toEqual({ p: 10, s: 4, d: 'numeric' });
    const floats = await sql`select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = any(${[...TENANT_0007, ...GLOBAL_0007]})
        and data_type in ('real', 'double precision')`;
    expect(floats).toHaveLength(0);
    const rows = await asUser(
      VIEWER,
      (tx) => tx`select cost_usd::text as cost from llm_usage_daily where org_id = ${ORG}`,
    );
    expect(rows.map((r) => r.cost)).toEqual(['0.0123']);
    const counts = await asUser(OWNER, async (tx) => ({
      updated: (await tx`update llm_usage_daily set calls = 9 where org_id = ${ORG} returning 1`)
        .length,
      deleted: (await tx`delete from llm_usage_daily where org_id = ${ORG} returning 1`).length,
    }));
    expect(counts).toEqual({ updated: 0, deleted: 0 });
    expect(
      await code(
        asUser(
          OWNER,
          (
            tx,
          ) => tx`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
            values (${ORG}, '2026-01-16', 'test-model', 1, 1, 1, '0.0001')`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
          values (${ORG}, '2026-01-15', 'test-model', 1, 1, 1, '0.0001')`,
      ),
    ).toBe('23505');
  });

  it('privacy_requests: owner selects and writes, nobody else sees a row; checks and updated_at', async () => {
    const inserted = await asUser(
      OWNER,
      (tx) => tx<
        { id: string; state: string }[]
      >`insert into privacy_requests (org_id, kind, requested_by)
        values (${ORG}, 'export', ${OWNER}) returning id, state`,
    );
    expect(inserted[0]?.state).toBe('pending');
    const [req] = await sql<
      { id: string }[]
    >`insert into privacy_requests (org_id, kind, requested_by)
      values (${ORG}, 'close_archive', ${OWNER}) returning id`;
    const id = req?.id ?? '';
    for (const uid of [MEMBER, ACCOUNTANT, VIEWER]) {
      expect(
        await asUser(uid, (tx) => tx`select 1 from privacy_requests where org_id = ${ORG}`),
        `sees as ${uid}`,
      ).toHaveLength(0);
      expect(
        await code(
          asUser(
            uid,
            (tx) => tx`insert into privacy_requests (org_id, kind, requested_by)
              values (${ORG}, 'export', ${uid})`,
          ),
        ),
        `inserts as ${uid}`,
      ).toBe('42501');
      expect(
        await asUser(
          uid,
          (tx) => tx`update privacy_requests set state = 'cancelled' where id = ${id} returning 1`,
        ),
        `updates as ${uid}`,
      ).toHaveLength(0);
    }
    const owner = await asUser(
      OWNER,
      (tx) => tx<
        { state: string; bumped: boolean }[]
      >`update privacy_requests set state = 'cancelled'
        where id = ${id} returning state, updated_at > created_at as bumped`,
    );
    expect(owner).toEqual([{ state: 'cancelled', bumped: true }]);
    expect(
      await code(
        sql`insert into privacy_requests (org_id, kind, requested_by) values (${ORG}, 'forget', ${OWNER})`,
      ),
    ).toBe('23514');
    expect(await code(sql`update privacy_requests set state = 'lost' where id = ${id}`)).toBe(
      '23514',
    );
  });

  it('cascades: deleting the org removes llm_usage_daily and privacy_requests; audit_log rows stay', async () => {
    await sql`insert into privacy_requests (org_id, kind, requested_by) values (${OTHER_ORG}, 'export', ${OWNER})`;
    await sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
      values (${OTHER_ORG}, '2026-01-15', 'test-model', 1, 1, 1, '0.0001')`;
    await sql`delete from organizations where id = ${OTHER_ORG}`;
    expect(await sql`select 1 from privacy_requests where org_id = ${OTHER_ORG}`).toHaveLength(0);
    expect(await sql`select 1 from llm_usage_daily where org_id = ${OTHER_ORG}`).toHaveLength(0);
    expect(await sql`select 1 from audit_log where org_id = ${OTHER_ORG}`).toHaveLength(1);
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  13 passed (13)` and `Tests  105 passed (105)`. Run it a second time: the same counts. Commit.

### Step 6: final checks

Command: `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors; `pnpm check:tenant-sql 2>&1 | tail -3` → exit 0; `python3 scripts/pii_guard.py --all packages/db/src/schema/platform.ts packages/db/src/rate-limit.ts packages/db/test/rate-limit.db.test.ts packages/db/test/migrations/platform.db.test.ts 2>&1 | tail -3` → `pii_guard: OK`; `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no database) → `28 passed | 77 skipped`. Nothing to commit. Write the report (§9). Owner merges the PR of `task/0033-db-platform` into `phase/0`. `bash packages/db/scripts/local-pg.sh stop` at the very end.

## 5. Do not touch

`packages/db/migrations/**` (0033a owns 0007), `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/rls-catalog.ts`, `packages/db/src/tenant.ts`, `packages/db/src/schema/enums.ts`, `documents.ts`, `document-details.ts`, `partners.ts`, `tenancy.ts`, `packages/db/test/rls/**`, `packages/db/test/migrations/tenancy.db.test.ts`, `partners.db.test.ts`, `documents-core.db.test.ts`, `documents-detail.db.test.ts`, `packages/db/test/with-tenant.db.test.ts`, `packages/testkit/**`, `scripts/**`, `.github/**`, `docs/v3/**`. Hard rules 1 (`cost_usd` is `numeric`, never `doublePrecision`/`real`), 3, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database. No `withServiceRole` reason is added for rate limiting.

## 6. Commands

```
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -30   # Tests 105 passed (13 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 77 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db 2>&1 | tail -30                                              # No fixes applied, no errors
pnpm check:tenant-sql 2>&1 | tail -30                                                       # exit 0
python3 scripts/pii_guard.py --all packages/db/src/schema/platform.ts packages/db/src/rate-limit.ts packages/db/test/rate-limit.db.test.ts packages/db/test/migrations/platform.db.test.ts 2>&1 | tail -3   # pii_guard: OK
```

## 7. Acceptance

- [ ] `rate-limit.db.test.ts`: 4 passed; `platform.db.test.ts`: 6 passed; the whole db suite 105 passed with `DATABASE_URL`, twice in a row; `psql "$DATABASE_URL" -tAc "select count(*) from organizations where id::text like 'ffffffff-%'"` → `0` and `select count(*) from rate_limit_counters where key like 'test:%'` → `0` after the run.
- [ ] `grep -c "pgTable(" packages/db/src/schema/platform.ts` → `6`; `grep -c "doublePrecision\|real(" packages/db/src/schema/platform.ts` → `0`; `grep -n "costUsd" packages/db/src/schema/platform.ts` shows `numeric('cost_usd', { precision: 10, scale: 4 })`.
- [ ] `grep -c "rateLimitHit" packages/db/src/index.ts` → `1`; typecheck exit 0; `biome ci` clean; `pnpm check:tenant-sql` exit 0.

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

Write `docs/tasks/0033b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`schema/platform.ts` against `0007_platform.sql` column by column (nullability, defaults, `bigserial`/`bigint` modes, `numeric(10,4)`, the four check lists, the composite primary keys, `on delete` modes: cascade on `llm_usage_daily.org_id`, `privacy_requests.org_id`, `staff_users.user_id`; none on `privacy_requests.requested_by`), `rate-limit.ts` (argument checks throw `TypeError` before any query; `max` 0 is allowed and refuses the first hit; the `::int` casts; `row?.allowed === true`), the window test (the `update … - interval '60 seconds'` must match `windowS` 60), the grant assertions (`service_role` and `app_worker` true, `authenticated` and `anon` false, `app_worker` no table privilege), the platform test's expectations (`privacy_requests` three policies, the other two tenant tables two; exactly one global grant row; `42501` for a user select on every global table; owner `bumped: true` through the trigger; `audit_log` row of the deleted org survives).

## Owner steps

1. Review the PR of `task/0033-db-platform` (0033a + 0033b) and merge it into `phase/0`.
