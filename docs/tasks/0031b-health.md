# 0031b: Health endpoint `GET /api/health` with a DB ping

Status: review
Ticket: P0-AUTH-03 (part b of 2) | Depends on: 0031a merged into phase/0 | Base commit: head of phase/0 | Branch: task/0031b-health | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (security ticket; the route is public). Every file is given in full; the tests are the spec.

## 1. Objective

`GET /api/health` answers 200 with `{ status: 'ok', db: { ok: true, ms } }` when Postgres answers `select 1`, and 503 with a reason otherwise, never leaking a connection string or an error text. Cloud Run and the M12 availability SLO probe this route; the DB ping is the one shared piece in `packages/db` so the worker's `/healthz` can reuse it.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0031b step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. Test filter: `pnpm --filter @shoebox/<pkg> test <name>` (no `--`). Never run `playwright install`; run only `--project desktop-chromium --project mobile-chromium`.

**Already in phase/0 (do not change):** 0031a (`apps/web/middleware.ts` with the CSP and headers, `apps/web/e2e/headers.spec.ts`, `apps/web/e2e/fixtures.ts`), `packages/db` with `src/index.ts`, `src/tenant.ts`, `migrations/`, `scripts/local-pg.sh` (a plain Postgres 16 for this sandbox: `bash packages/db/scripts/local-pg.sh start` prints `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`). If `apps/web/middleware.ts` is missing: STOP (0031a not merged).

**Spec M12 §4.2 (pasted):** Health: `GET /api/health` (web: DB ping ≤ 200 ms), worker `/healthz` (pg-boss started, last cron tick < 2 min). **M12 §4.7:** SLO "Web availability (non-5xx on `/api/health` + pages) 99.5 %". **M12 §4.13:** `DATABASE_URL` (app role) comes from Secret Manager → Cloud Run env; nothing secret in responses or logs. **M12 §4.5 V8.3:** `Cache-Control: no-store` on file responses (the middleware of 0031a already sets it on every route; the route sets it again on its own response).

**Rules:** 3 (every query is org-scoped: the ping touches no tenant table, only `select 1`), 4 (no secrets in logs or responses), 7 (no new dependency: `postgres` 3.4.9 is already the approved driver in `packages/db`; `apps/web` gains only the workspace dependency `@shoebox/db`). The Biome plugin `no-raw-sql-outside-db` forbids a `sql\`\`` tag outside `packages/db`, which is why the ping lives there and is exported as the subpath `@shoebox/db/health` (the package index pulls `migrate.ts`, whose `new URL('../migrations', import.meta.url)` webpack cannot bundle; verified).

**Choices made by the brief writer (verified in a scratch copy with a local Postgres 16; do not change):**
- `checkHealth(deps)` in `apps/web/src/health/check.ts` is pure (the ping is injected), so the unit test covers 200/503 and the timeout without a database. `dbPing(url)` keeps one `postgres` connection (`max: 1`) between probes at module level; Cloud Run probes every few seconds.
- 200 whenever the database answered; `withinBudget` reports the 200 ms budget instead of failing the probe (a slow database is not a dead instance; the SLO alerts separately). 503 with `reason` `unconfigured` (no `DATABASE_URL`), `unreachable` (connection or query error) or `timeout` (2 s).
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`: the Postgres driver needs Node and the route is never prerendered.
- The Playwright web server has no database unless `DATABASE_URL` is exported before `playwright test`; the E2E accepts 200 (and asserts `ms ≤ 200`) or 503 with a reason. Step 10 runs it with the local Postgres so the 200 path is exercised here.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/health.ts` | new | `createDbPing(url, options?)` → `{ ping, close }` |
| `packages/db/src/index.ts` | edit | export `createDbPing`, `DbPing` |
| `packages/db/package.json` | edit | subpath export `./health` |
| `packages/db/test/health.db.test.ts` | new | unreachable port rejects fast; reachable DB ≤ 200 ms (needs `DATABASE_URL`) |
| `apps/web/package.json` + `pnpm-lock.yaml` | edit (by `pnpm add`) | dependency `@shoebox/db: workspace:*` |
| `apps/web/next.config.ts` | edit | `@shoebox/db` in `transpilePackages` |
| `apps/web/src/health/check.ts` | new | `checkHealth`, `DB_PING_BUDGET_MS`, types |
| `apps/web/src/health/db-ping.ts` | new | module-level `dbPing(url)` |
| `apps/web/test/health.test.ts` | new | unit tests for `checkHealth` |
| `apps/web/app/api/health/route.ts` | new | `GET` |
| `apps/web/e2e/health.spec.ts` | new | JSON shape, headers, no connection string |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 65–94
Step 2 code: lines 102–103
Step 3 code: lines 119–123
Step 4 code: lines 145–172
Step 6 code: lines 182–182
Step 7 code: lines 190–252
Step 8 code: lines 260–278
Step 9 code: lines 286–350
Step 10 code: lines 358–373
Step 11 code: lines 381–416

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0031b-health origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/middleware.ts packages/db/scripts/local-pg.sh`. Expected: both paths listed. Otherwise STOP.

**Step 1: `packages/db/src/health.ts` (new).**

```ts
import postgres, { type Sql } from 'postgres';

/** A reusable `select 1` for health endpoints (M12 §4.2: web `/api/health`, worker `/healthz`). */
export interface DbPing {
  /** Resolves when the database answered; rejects on connection or query failure. */
  ping(): Promise<void>;
  /** Closes the single pooled connection. */
  close(): Promise<void>;
}

/**
 * One connection, kept between probes (Cloud Run probes every few seconds). Touches no tenant
 * table, so it needs no org scope; it only proves the database answers.
 */
export function createDbPing(url: string, options: { connectTimeoutS?: number } = {}): DbPing {
  const sql: Sql = postgres(url, {
    max: 1,
    connect_timeout: options.connectTimeoutS ?? 2,
    idle_timeout: 30,
    onnotice: () => undefined,
  });
  return {
    async ping() {
      await sql`select 1`;
    },
    close() {
      return sql.end();
    },
  };
}
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 2: `packages/db/src/index.ts` (edit).** Anchor (verbatim, two lines):

```ts
export const packageName = '@shoebox/db' as const;
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
```

Replace with:

```ts
export const packageName = '@shoebox/db' as const;
export { createDbPing, type DbPing } from './health';
export { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, runMigrations } from './migrate';
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 3: `packages/db/package.json` (edit).** Anchor (verbatim):

```json
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
```

Replace with:

```json
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./health": {
      "types": "./src/health.ts",
      "default": "./src/health.ts"
    }
  },
```

Command: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('packages/db/package.json','utf8')).exports))"`. Expected: `[ '.', './health' ]`. Commit.

**Step 4: `packages/db/test/health.db.test.ts` (new).** Do not edit the test file.

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createDbPing } from '../src/health';

// The reachable case needs DATABASE_URL (local-pg.sh or Supabase CLI); the unreachable case needs nothing.
const DATABASE_URL = process.env.DATABASE_URL;

describe('createDbPing: unreachable database', () => {
  it('rejects quickly on a closed port instead of hanging', async () => {
    const probe = createDbPing('postgresql://postgres@127.0.0.1:1/nothing', { connectTimeoutS: 1 });
    const started = performance.now();
    await expect(probe.ping()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(3_000);
    await probe.close();
  });
});

describe.skipIf(DATABASE_URL === undefined)('createDbPing: reachable database', () => {
  const probe = createDbPing(DATABASE_URL ?? '');
  afterAll(() => probe.close());

  it('answers select 1 and reuses the connection on the second probe', async () => {
    await probe.ping();
    const started = performance.now();
    await probe.ping();
    // M12 §4.2 budget: 200 ms. The second probe has a warm connection.
    expect(performance.now() - started).toBeLessThanOrEqual(200);
  });
});
```

Command: `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` (prints `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`), then `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test health 2>&1 | tail -6`. Expected: `Tests  2 passed`. If `local-pg.sh` cannot start Postgres (no `postgres` OS user or binaries): run the test without `DATABASE_URL` (expected `1 passed | 1 skipped`) and say so in the report. Commit.

**Step 5: `apps/web/package.json` (edit by pnpm).** Command: `pnpm --filter @shoebox/web add '@shoebox/db@workspace:*' 2>&1 | tail -3 && grep -n '"@shoebox/db"' apps/web/package.json`. Expected: `Done in …` and the line `"@shoebox/db": "workspace:*",` under `dependencies`. Commit (includes `pnpm-lock.yaml`).

**Step 6: `apps/web/next.config.ts` (edit).** Anchor (verbatim): `  transpilePackages: ['@shoebox/domain', '@shoebox/i18n', '@shoebox/ui'],`. Replace with:

```ts
  transpilePackages: ['@shoebox/db', '@shoebox/domain', '@shoebox/i18n', '@shoebox/ui'],
```

Command: `grep -n transpilePackages apps/web/next.config.ts`. Expected: the new line. Commit.

**Step 7: `apps/web/src/health/check.ts` (new).** Exported names exactly as below.

```ts
/**
 * `GET /api/health` (M12 §4.2: web = DB ping ≤ 200 ms). Pure: the ping is injected, so the unit test
 * runs without a database and the route (app/api/health/route.ts) only wires `dbPing` in.
 */

/** M12 §4.2 budget for the DB ping, in milliseconds. Reported, not enforced: a slow DB is not a dead instance. */
export const DB_PING_BUDGET_MS = 200;

/** A ping that takes longer than this is reported as unreachable. */
export const DB_PING_TIMEOUT_MS = 2_000;

export type DbHealth =
  | { ok: true; ms: number; withinBudget: boolean }
  | { ok: false; reason: 'unconfigured' | 'unreachable' | 'timeout' };

export interface HealthReport {
  status: 'ok' | 'error';
  db: DbHealth;
}

export interface HealthResult {
  /** HTTP status: 200 when the database answered, 503 otherwise. */
  status: 200 | 503;
  body: HealthReport;
}

export interface HealthDeps {
  /** Resolves when the database answered `select 1`; undefined when no `DATABASE_URL` is configured. */
  ping: (() => Promise<void>) | undefined;
  /** Monotonic clock in ms (default `performance.now`). */
  now?: () => number;
  timeoutMs?: number;
}

/** Never includes an error message or a connection string in the body (no secrets in responses, M12 §4.13). */
export async function checkHealth(deps: HealthDeps): Promise<HealthResult> {
  const now = deps.now ?? (() => performance.now());
  const timeoutMs = deps.timeoutMs ?? DB_PING_TIMEOUT_MS;
  if (deps.ping === undefined) {
    return { status: 503, body: { status: 'error', db: { ok: false, reason: 'unconfigured' } } };
  }

  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([deps.ping().then(() => 'ok' as const), timeout]);
    if (outcome === 'timeout') {
      return { status: 503, body: { status: 'error', db: { ok: false, reason: 'timeout' } } };
    }
    const ms = Math.max(0, Math.round(now() - started));
    return {
      status: 200,
      body: { status: 'ok', db: { ok: true, ms, withinBudget: ms <= DB_PING_BUDGET_MS } },
    };
  } catch {
    return { status: 503, body: { status: 'error', db: { ok: false, reason: 'unreachable' } } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 8: `apps/web/src/health/db-ping.ts` (new).**

```ts
import { createDbPing, type DbPing } from '@shoebox/db/health';

let probe: DbPing | undefined;
let probeUrl: string | undefined;

/**
 * `select 1` on `DATABASE_URL`, one connection kept between health checks (module-level, so Cloud
 * Run probes reuse it). Returns undefined when the URL is not configured, which `checkHealth`
 * reports as `unconfigured`. The SQL itself lives in packages/db (lint rule no-raw-sql-outside-db).
 */
export function dbPing(url: string | undefined): (() => Promise<void>) | undefined {
  if (!url) return undefined;
  if (probe === undefined || probeUrl !== url) {
    probe = createDbPing(url);
    probeUrl = url;
  }
  const current = probe;
  return () => current.ping();
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 9: `apps/web/test/health.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import { checkHealth, DB_PING_BUDGET_MS, DB_PING_TIMEOUT_MS } from '../src/health/check';

/** A clock that advances by `step` ms on every read. */
function clock(step: number): () => number {
  let t = 1_000;
  return () => {
    t += step;
    return t;
  };
}

describe('checkHealth (M12 §4.2: DB ping ≤ 200 ms)', () => {
  it('has the M12 budget and a timeout above it', () => {
    expect(DB_PING_BUDGET_MS).toBe(200);
    expect(DB_PING_TIMEOUT_MS).toBeGreaterThan(DB_PING_BUDGET_MS);
  });

  it('503 unconfigured without a DATABASE_URL', async () => {
    const result = await checkHealth({ ping: undefined });
    expect(result).toEqual({
      status: 503,
      body: { status: 'error', db: { ok: false, reason: 'unconfigured' } },
    });
  });

  it('200 with the measured ms when the ping answers', async () => {
    const result = await checkHealth({ ping: async () => undefined, now: clock(12) });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      db: { ok: true, ms: 12, withinBudget: true },
    });
  });

  it('reports a ping over the budget as ok but not within budget', async () => {
    const result = await checkHealth({ ping: async () => undefined, now: clock(350) });
    expect(result.status).toBe(200);
    expect(result.body.db).toEqual({ ok: true, ms: 350, withinBudget: false });
  });

  it('503 unreachable when the ping throws, and never leaks the error text', async () => {
    const result = await checkHealth({
      ping: async () => {
        throw new Error('password authentication failed for user "postgres"');
      },
    });
    expect(result).toEqual({
      status: 503,
      body: { status: 'error', db: { ok: false, reason: 'unreachable' } },
    });
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('503 timeout when the ping hangs longer than timeoutMs', async () => {
    const result = await checkHealth({
      ping: () => new Promise<void>(() => undefined),
      timeoutMs: 20,
    });
    expect(result).toEqual({
      status: 503,
      body: { status: 'error', db: { ok: false, reason: 'timeout' } },
    });
  });
});
```

Command: `pnpm --filter @shoebox/web test health 2>&1 | tail -6`. Expected: `Tests  6 passed`. Commit.

**Step 10: `apps/web/app/api/health/route.ts` (new).**

```ts
import { NextResponse } from 'next/server';
import { checkHealth } from '../../../src/health/check';
import { dbPing } from '../../../src/health/db-ping';

/** Postgres driver needs Node; never prerender a health check. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** M12 §4.2: `GET /api/health` → 200 `{ status: 'ok', db: { ok: true, ms } }`, 503 otherwise. */
export async function GET(): Promise<NextResponse> {
  const result = await checkHealth({ ping: dbPing(process.env.DATABASE_URL) });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5 && pnpm exec biome ci apps/web packages/db 2>&1 | tail -4`. Expected: no `error TS`; Biome without errors (the `sql` tag is only in `packages/db`). Commit.

**Step 11: `apps/web/e2e/health.spec.ts` (new).** Do not edit the test file.

```ts
import { expect, test } from './fixtures';

/** M12 §4.2: `GET /api/health` (web: DB ping ≤ 200 ms). The route is public and carries the M12 §4.5 headers. */

test('/api/health: JSON report, 200 with a DB ping ≤ 200 ms or 503 with a reason', async ({
  request,
}) => {
  const response = await request.get('/api/health');
  const body = (await response.json()) as {
    status: string;
    db: { ok: boolean; ms?: number; withinBudget?: boolean; reason?: string };
  };
  expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
    expect(body.db.ms).toBeLessThanOrEqual(200);
    expect(body.db.withinBudget).toBe(true);
  } else {
    // No DATABASE_URL in this environment (the owner/CI run has one, see the brief's §7).
    expect(body).toEqual({
      status: 'error',
      db: { ok: false, reason: expect.stringMatching(/^(unconfigured|unreachable|timeout)$/) },
    });
  }
  expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
});

test('/api/health carries the security headers and is never cached', async ({ request }) => {
  const response = await request.get('/api/health');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['content-type']).toContain('application/json');
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: `36 passed` (24 shell + 8 headers + 4 health), 0 failed, 0 skipped; the health test took the 200 branch. Then `curl -s -i http://localhost:3100/api/health | head -20` is NOT possible after the run (Playwright stops the server); instead run `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec playwright test health --project desktop-chromium --reporter=line 2>&1 | tail -5` once more and quote the result in the report. Commit.

**Step 12: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web packages/db 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -14 && git status --short | tail -5`. Expected: lint without errors (including `check:tenant-sql`), `no dependency violations found`, the route table lists `ƒ /api/health`, `git status` lists nothing. Commit if anything changed. Stop the local Postgres: `bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1`.

## 5. Do not touch

`apps/web/middleware.ts`, `apps/web/src/security/**`, `apps/web/e2e/headers.spec.ts`, `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/fixtures.ts`, `playwright.config.ts`, `packages/db/src/tenant.ts`, `packages/db/migrations/**`, `packages/db/test/rls/**`, `.github/**`. No dependency beyond `@shoebox/db` (workspace). Hard rules 3, 4, 7. Never `playwright install`.

## 6. Commands

- `DATABASE_URL=… pnpm --filter @shoebox/db test health 2>&1 | tail -30` → 2 passed.
- `pnpm --filter @shoebox/web test health 2>&1 | tail -30` → 6 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no `error TS`.
- `DATABASE_URL=… pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 36 passed.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.

## 7. Acceptance

- [ ] `GET /api/health` with `DATABASE_URL` set → 200, body `{ status: 'ok', db: { ok: true, ms, withinBudget: true } }`, `ms ≤ 200` locally (health.spec, 200 branch, quoted in the report).
- [ ] Without `DATABASE_URL` → 503 `{ status: 'error', db: { ok: false, reason: 'unconfigured' } }`; a wrong URL → `unreachable`; a hanging ping → `timeout` (health.test.ts).
- [ ] The body never contains `postgres://`, `postgresql://` or an error message (health.test.ts + health.spec).
- [ ] The route carries the 0031a headers and `Cache-Control: no-store`.
- [ ] `apps/web` imports only `@shoebox/db/health`; `pnpm check:tenant-sql` and Biome's `no-raw-sql-outside-db` pass.
- [ ] `pnpm-lock.yaml` changes only for the workspace link.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0031a is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `next build` fails with `Module not found: Can't resolve '../migrations'` (then a file imports `@shoebox/db` instead of `@shoebox/db/health`: check `db-ping.ts`, do not change `next.config.ts` further);
- `next build` fails to download Inter from Google: STOP;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency beyond `@shoebox/db` seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0031b-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; the health.spec line showing the 200 branch; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0031b report" && git push -u origin task/0031b-health 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `route.ts` / `check.ts`: the response body is built only from `checkHealth`'s typed result; no error object or URL reaches it.
- `packages/db/src/health.ts`: `select 1` only, no tenant table, `max: 1`.
- `db-ping.ts`: the module-level client is recreated only when `DATABASE_URL` changes.
- `pnpm-lock.yaml`: only the workspace link `@shoebox/db` under `apps/web`.

## Owner steps

1. Cloud Run (P0-CI-03 / deploy ticket): set the health check of the `web` service to `GET /api/health` and make sure `DATABASE_URL` (app role) is mounted from Secret Manager; without it the service reports 503 and never becomes healthy.
2. Nothing to do locally: `pnpm dev` (Supabase CLI) provides `DATABASE_URL`.
