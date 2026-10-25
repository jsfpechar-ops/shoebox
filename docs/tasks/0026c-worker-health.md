# 0026c: Worker start-up, `ops.heartbeat` cron and `/healthz`

Status: review
Ticket: P0-PLAT-04 (part c of a/b/c) | Depends on: 0026b (same branch) | Base commit: head of task/0026-worker-pgboss after 0026b | Branch: task/0026-worker-pgboss | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

> **Owner question (default used, answer in the review).** The "last cron tick" of M12 §4.2 needs a cron job. 03 §3.1 owns `ops.*` for M12 but M12 §6 lists no heartbeat job. Default: `ops.heartbeat`, every minute in Europe/Prague, no retry (defined in 0026a). If the owner agrees, the orchestrator adds the row `ops.heartbeat | {} | every minute (/healthz)` to the M12 §6 jobs table; if not, rename it in `packages/pipeline/src/jobs.ts` in a later brief.

## 1. Objective

`startWorker(config)` connects `withTenant` to `app_worker`, starts pg-boss on the service connection, registers `ops.heartbeat`, starts the registry and serves `GET /healthz`, which is 200 only while pg-boss is started and the last cron tick is younger than 2 minutes. `src/main.ts` is the container entry point that the deploy ticket (P0-CI-03) will run; with this brief P0-PLAT-04 is complete and the PR for 0026a–c is opened.

## 2. Context

Rules (AGENTS.md), pasted:

- Hard rule 3: tenant queries only on `WORKER_DATABASE_URL` (`app_worker`); `loadWorkerConfig` refuses to start without it (no fallback to the service role).
- Hard rule 4: logs carry only allowlisted keys; pg-boss errors are logged by `error.name`.
- Hard rule 7: no new dependency (all are in `apps/worker/package.json` since 0026b). `node:http` serves `/healthz`.

Spec, pasted verbatim:

- M12 §4.2: "`worker` min 1 / max 5, **instance-based billing ("CPU always allocated")** so pg-boss polling and crons run, 2 vCPU / 2 GiB (sharp, pdfium), no public ingress (internal + health only). Health: `GET /api/health` (web: DB ping ≤ 200 ms), worker `/healthz` (pg-boss started, last cron tick < 2 min)."
- Backlog P0-PLAT-04 acceptance: "`/healthz` reports pg-boss started and last cron tick < 2 min."
- 05 §10.1: "The worker connects as `app_worker` (`WORKER_DATABASE_URL`; migrations and `withServiceRole` use `DATABASE_URL`)."
- Logger env names (decisions 2026-10-18): `K_SERVICE`, `APP_ENV`, `RELEASE` are read by `@shoebox/platform`'s `logger`; `main.ts` uses that logger.

Design choices (brief writer, verified):

- Until the first tick the age counts from the start, so a fresh instance is healthy for its first 2 minutes (pg-boss runs a minute cron at the next full minute). `report()` returns `{ ok, pgBoss, lastCronTickAt, cronTickAgeMs }`; `/healthz` answers 200 when `ok`, else 503; other paths 404.
- Env: `DATABASE_URL`, `WORKER_DATABASE_URL` (required), `PORT` (default 8080), `PGBOSS_SCHEMA` (default `pgboss`, `[a-z_][a-z0-9_]*`).
- `stop()`: health off, HTTP server closed, `boss.stop({ graceful: true, timeout: 30_000 })`, `closeDb()`. `main.ts` calls it on SIGTERM/SIGINT.
- `main.ts` is not run or tested here (running TypeScript in the container is P0-CI-03); `typecheck` covers it. The DB test starts the whole worker on port 0 with schema `pgboss_worker_test` and enqueues one `ops.heartbeat` instead of waiting a minute for the cron; it checks that the schedule is stored with `Europe/Prague`.

Anchor, `apps/worker/src/index.ts` (step 4), current first line (the file is 12 lines after 0026b):

```ts
export const packageName = '@shoebox/worker' as const;
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/health.ts` | create | `createWorkerHealth`, `startHealthServer` |
| `apps/worker/src/worker.ts` | create | `loadWorkerConfig`, `startWorker` |
| `apps/worker/src/main.ts` | create | entry point |
| `apps/worker/src/index.ts` | edit | export health and worker |
| `apps/worker/test/health.test.ts` | create | 8 unit tests |
| `apps/worker/test/worker.db.test.ts` | create | 3 tests on Postgres |

No other file may change.

## 4. Steps

Setup (once): `git checkout task/0026-worker-pgboss && git log --oneline -1` (expect the last 0026b commit) and `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0026c step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: create `apps/worker/src/health.ts`

```ts
// Worker health (M12 §4.2): `GET /healthz` is 200 while pg-boss is started and the last cron tick
// (ops.heartbeat, every minute) is younger than 2 minutes, else 503. Until the first tick the age
// counts from the start, so a fresh instance is healthy for its first 2 minutes.
import { createServer, type Server } from 'node:http';

export const CRON_TICK_MAX_AGE_MS = 120_000;

export interface HealthReport {
  readonly ok: boolean;
  readonly pgBoss: 'started' | 'stopped';
  /** ISO instant of the last ops.heartbeat run, null before the first one. */
  readonly lastCronTickAt: string | null;
  /** Milliseconds since the last tick (or since the start before the first tick). */
  readonly cronTickAgeMs: number | null;
}

export interface WorkerHealth {
  markStarted(): void;
  markStopped(): void;
  recordCronTick(): void;
  report(): HealthReport;
}

export function createWorkerHealth(now: () => number = Date.now): WorkerHealth {
  let startedAt: number | null = null;
  let lastTickAt: number | null = null;
  return {
    markStarted() {
      startedAt = now();
    },
    markStopped() {
      startedAt = null;
    },
    recordCronTick() {
      lastTickAt = now();
    },
    report() {
      const since = lastTickAt ?? startedAt;
      const cronTickAgeMs = since === null ? null : now() - since;
      const started = startedAt !== null;
      return {
        ok: started && cronTickAgeMs !== null && cronTickAgeMs < CRON_TICK_MAX_AGE_MS,
        pgBoss: started ? 'started' : 'stopped',
        lastCronTickAt: lastTickAt === null ? null : new Date(lastTickAt).toISOString(),
        cronTickAgeMs,
      };
    },
  };
}

/** Serves `GET /healthz` as JSON; every other path is 404. Port 0 picks a free port. */
export function startHealthServer(health: WorkerHealth, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      const report = health.report();
      res.writeHead(report.ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(report));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found"}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no `error TS`. Commit.

### Step 2: create `apps/worker/src/worker.ts`

```ts
// Worker wiring: env → connections, pg-boss on the service connection (schema `pgboss`), tenant
// handlers on `app_worker` through withTenant, the ops.heartbeat cron and `/healthz` (M12 §4.2).

import type { Server } from 'node:http';
import { closeDb, configureDb } from '@shoebox/db';
import { opsHeartbeatJob } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { createWorkerHealth, startHealthServer, type WorkerHealth } from './health';
import { createJobRegistry, type JobRegistry } from './registry';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  PGBOSS_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default('pgboss'),
});

export interface WorkerConfig {
  /** Service connection (`DATABASE_URL`): pg-boss and withServiceRole. */
  readonly serviceUrl: string;
  /** `app_worker` connection (`WORKER_DATABASE_URL`): every tenant query. */
  readonly workerUrl: string;
  readonly port: number;
  readonly bossSchema: string;
}

/** Reads the worker settings; throws a ZodError naming the missing variables. */
export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = envSchema.parse(env);
  return {
    serviceUrl: parsed.DATABASE_URL,
    workerUrl: parsed.WORKER_DATABASE_URL,
    port: parsed.PORT,
    bossSchema: parsed.PGBOSS_SCHEMA,
  };
}

export interface StartOptions {
  readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Registers the module jobs before the queues start. */
  readonly register?: (registry: JobRegistry) => void;
  readonly pollingIntervalSeconds?: number;
}

export interface RunningWorker {
  readonly boss: PgBoss;
  readonly registry: JobRegistry;
  readonly health: WorkerHealth;
  readonly server: Server;
  /** Stops the health server, pg-boss (graceful, 30 s) and the database pools. */
  stop(): Promise<void>;
}

export async function startWorker(
  config: WorkerConfig,
  options: StartOptions,
): Promise<RunningWorker> {
  const { logger } = options;
  const db = configureDb({ workerUrl: config.workerUrl, serviceUrl: config.serviceUrl });
  const boss = new PgBoss({ connectionString: config.serviceUrl, schema: config.bossSchema });
  boss.on('error', (error) => logger.error({ errorCode: error.name }, 'pg-boss error'));
  await boss.start();

  const health = createWorkerHealth();
  health.markStarted();
  const registry = createJobRegistry({
    boss,
    db,
    logger,
    ...(options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
  });
  registry.registerSystem(opsHeartbeatJob, async () => {
    health.recordCronTick();
  });
  options.register?.(registry);
  await registry.start();
  const server = await startHealthServer(health, config.port);
  logger.info('worker started');

  return {
    boss,
    registry,
    health,
    server,
    async stop() {
      health.markStopped();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await boss.stop({ graceful: true, timeout: 30_000 });
      await closeDb();
    },
  };
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 3: create `apps/worker/src/main.ts`

```ts
// Entry point of the worker container (Cloud Run worker pool, M12 §4.2). Not imported by index.ts.
import { logger } from '@shoebox/platform';
import { loadWorkerConfig, startWorker } from './worker';

const worker = await startWorker(loadWorkerConfig(process.env), { logger });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void worker.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no errors. Do not run it. Commit.

### Step 4: edit `apps/worker/src/index.ts`

Replace the whole file (first line in §2) with:

```ts
export const packageName = '@shoebox/worker' as const;
export {
  CRON_TICK_MAX_AGE_MS,
  createWorkerHealth,
  type HealthReport,
  type WorkerHealth,
} from './health';
export {
  type Boss,
  createJobRegistry,
  type JobContext,
  type JobRegistry,
  jobIdFromKey,
  type RegistryOptions,
  type SystemHandler,
  type TenantHandler,
  type TenantJobContext,
} from './registry';
export { loadWorkerConfig, type RunningWorker, startWorker, type WorkerConfig } from './worker';
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no errors; `pnpm exec biome ci apps/worker 2>&1 | tail -3` → no errors. Commit.

### Step 5: create `apps/worker/test/health.test.ts`

Full file; do not edit it:

```ts
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { CRON_TICK_MAX_AGE_MS, createWorkerHealth, startHealthServer } from '../src/health';
import { loadWorkerConfig } from '../src/worker';

function clock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const T0 = Date.parse('2026-10-18T08:00:00Z');

describe('worker health (M12 §4.2)', () => {
  it('is not ok before pg-boss started', () => {
    const health = createWorkerHealth(clock(T0).now);
    expect(health.report()).toEqual({
      ok: false,
      pgBoss: 'stopped',
      lastCronTickAt: null,
      cronTickAgeMs: null,
    });
  });

  it('a fresh start is ok for 2 minutes without a tick, then not', () => {
    const c = clock(T0);
    const health = createWorkerHealth(c.now);
    health.markStarted();
    expect(health.report().ok).toBe(true);
    c.advance(CRON_TICK_MAX_AGE_MS - 1);
    expect(health.report().ok).toBe(true);
    c.advance(1);
    expect(health.report()).toMatchObject({ ok: false, pgBoss: 'started', cronTickAgeMs: 120_000 });
  });

  it('a cron tick younger than 2 minutes keeps it ok and is reported', () => {
    const c = clock(T0);
    const health = createWorkerHealth(c.now);
    health.markStarted();
    c.advance(150_000);
    health.recordCronTick();
    c.advance(60_000);
    expect(health.report()).toEqual({
      ok: true,
      pgBoss: 'started',
      lastCronTickAt: '2026-10-18T08:02:30.000Z',
      cronTickAgeMs: 60_000,
    });
    c.advance(60_000);
    expect(health.report().ok).toBe(false);
  });

  it('markStopped makes it not ok even with a fresh tick', () => {
    const health = createWorkerHealth(clock(T0).now);
    health.markStarted();
    health.recordCronTick();
    health.markStopped();
    expect(health.report()).toMatchObject({ ok: false, pgBoss: 'stopped' });
  });

  it('GET /healthz answers 200 or 503 with the report; other paths 404', async () => {
    const c = clock(T0);
    const health = createWorkerHealth(c.now);
    const server = await startHealthServer(health, 0);
    try {
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;
      const down = await fetch(`${base}/healthz`);
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({ ok: false, pgBoss: 'stopped' });
      health.markStarted();
      const up = await fetch(`${base}/healthz`);
      expect(up.status).toBe(200);
      expect(up.headers.get('content-type')).toBe('application/json');
      expect(await up.json()).toMatchObject({ ok: true, pgBoss: 'started' });
      expect((await fetch(`${base}/`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('loadWorkerConfig', () => {
  it('reads both connection strings, PORT and the pg-boss schema with defaults', () => {
    expect(
      loadWorkerConfig({
        DATABASE_URL: 'postgresql://postgres@db/shoebox',
        WORKER_DATABASE_URL: 'postgresql://app_worker@db/shoebox',
      }),
    ).toEqual({
      serviceUrl: 'postgresql://postgres@db/shoebox',
      workerUrl: 'postgresql://app_worker@db/shoebox',
      port: 8080,
      bossSchema: 'pgboss',
    });
    expect(
      loadWorkerConfig({
        DATABASE_URL: 'postgresql://postgres@db/shoebox',
        WORKER_DATABASE_URL: 'postgresql://app_worker@db/shoebox',
        PORT: '9000',
        PGBOSS_SCHEMA: 'pgboss_test',
      }),
    ).toMatchObject({ port: 9000, bossSchema: 'pgboss_test' });
  });

  it('throws without WORKER_DATABASE_URL (never falls back to the service role)', () => {
    expect(() => loadWorkerConfig({ DATABASE_URL: 'postgresql://postgres@db/shoebox' })).toThrow(
      ZodError,
    );
  });

  it('rejects a bad PORT and an unsafe schema name', () => {
    const base = {
      DATABASE_URL: 'postgresql://postgres@db/shoebox',
      WORKER_DATABASE_URL: 'postgresql://app_worker@db/shoebox',
    };
    expect(() => loadWorkerConfig({ ...base, PORT: 'http' })).toThrow(ZodError);
    expect(() => loadWorkerConfig({ ...base, PGBOSS_SCHEMA: 'pgboss; drop' })).toThrow(ZodError);
  });
});
```

Command: `pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  3 passed | 1 skipped (4)`, `Tests  20 passed | 4 skipped (24)`. Commit.

### Step 6: create `apps/worker/test/worker.db.test.ts`

Full file; do not edit it:

```ts
import type { AddressInfo } from 'node:net';
import { runMigrations } from '@shoebox/db';
import { opsHeartbeatJob } from '@shoebox/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningWorker, startWorker } from '../src/worker';

// Starts the whole worker against DATABASE_URL (pg-boss schema `pgboss_worker_test`) and checks
// `/healthz` and the ops.heartbeat cron. Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe.skipIf(DATABASE_URL === undefined)('startWorker', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let worker: RunningWorker;
  let base = '';

  beforeAll(async () => {
    await runMigrations(serviceUrl);
    worker = await startWorker(
      {
        serviceUrl,
        workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl),
        port: 0,
        bossSchema: 'pgboss_worker_test',
      },
      { logger: silent, pollingIntervalSeconds: 0.5 },
    );
    const { port } = worker.server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
  }, 40_000);

  it('/healthz reports pg-boss started', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pgBoss: 'started' });
  });

  it('schedules ops.heartbeat every minute in Europe/Prague', async () => {
    const [schedule] = await worker.boss.getSchedules('ops.heartbeat');
    expect(schedule).toMatchObject({ cron: '* * * * *', timezone: 'Europe/Prague' });
  });

  it('an ops.heartbeat run records the cron tick that /healthz reports', async () => {
    await worker.registry.enqueue(opsHeartbeatJob, {});
    const deadline = Date.now() + 15_000;
    while (worker.health.report().lastCronTickAt === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const body = (await (await fetch(`${base}/healthz`)).json()) as {
      ok: boolean;
      lastCronTickAt: string | null;
      cronTickAgeMs: number;
    };
    expect(body.ok).toBe(true);
    expect(body.lastCronTickAt).not.toBeNull();
    expect(body.cronTickAgeMs).toBeLessThan(120_000);
  }, 20_000);
});
```

Commands:

- `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  5 passed (5)`, `Tests  27 passed (27)`.
- `pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  3 passed | 2 skipped (5)`, `Tests  20 passed | 7 skipped (27)`.
- If the local cluster is not available, say so in the report and give only the second result.

Commit. Then run §6, write the report (§9), push the branch and open the PR `task/0026-worker-pgboss` → `phase/0`, title `0026: worker with pg-boss job registry (P0-PLAT-04)`, body linking `docs/tasks/0026a-report.md`, `0026b-report.md`, `0026c-report.md`.

## 5. Do not touch

`packages/**`, `apps/worker/src/registry.ts`, `apps/worker/test/registry*.ts`, `apps/worker/package.json`, `pnpm-lock.yaml`, `vitest.workspace.ts`, `apps/web/**`, `docs/v3/**`. Hard rules: 3 (no fallback from `WORKER_DATABASE_URL` to the service role in `src/`), 4, 7, 8 (never push to `main`). Never put a connection string with a password in any file.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                                            # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/worker test 2>&1 | tail -30    # Test Files 5 passed, Tests 27 passed
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30      # Test Files 4 passed, Tests 28 passed
pnpm exec vitest run --project unit apps/worker packages/pipeline 2>&1 | tail -30                                    # Test Files 5 passed, Tests 34 passed
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30                                                              # exit 0
pnpm exec biome ci apps/worker packages/pipeline vitest.workspace.ts 2>&1 | tail -30                                 # No fixes applied
pnpm depcruise 2>&1 | tail -30                                                                                       # no dependency violations found
bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1                                                             # stopped
```

## 7. Acceptance

- [ ] `health.test.ts` 8 passed; `worker.db.test.ts` 3 passed with `DATABASE_URL` (`/healthz` 200 with `pgBoss: "started"`; `ops.heartbeat` scheduled `* * * * *` in `Europe/Prague`; a heartbeat run sets `lastCronTickAt`, age < 120000 ms), 3 skipped without.
- [ ] `grep -n 'WORKER_DATABASE_URL: z.string().min(1)' apps/worker/src/worker.ts` → 1 line.
- [ ] `grep -n 'CRON_TICK_MAX_AGE_MS = 120_000' apps/worker/src/health.ts` → 1 line.
- [ ] typecheck exit 0; `biome ci` clean; depcruise clean.
- [ ] PR `task/0026-worker-pgboss` → `phase/0` opened with the three reports linked.

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

Write `docs/tasks/0026c-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`apps/worker/src/worker.ts` (pg-boss on `serviceUrl`, `configureDb` with both URLs never swapped, `WORKER_DATABASE_URL` required), `apps/worker/src/health.ts` (503 when stopped or tick ≥ 2 min; start-up grace), `apps/worker/src/main.ts` (graceful stop on SIGTERM).

## Owner steps

1. Answer the owner question at the top (`ops.heartbeat`).
2. Nothing to deploy yet. The deploy ticket (P0-CI-03) sets `WORKER_DATABASE_URL` and `DATABASE_URL` as worker secrets and points the Cloud Run health check at `/healthz` on `PORT`.
