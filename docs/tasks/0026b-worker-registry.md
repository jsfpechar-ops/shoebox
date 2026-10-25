# 0026b: pg-boss job registry in `apps/worker` (DLQ, retries, idempotent enqueue, `withTenant`)

Status: review
Ticket: P0-PLAT-04 (part b of a/b/c) | Depends on: 0026a (same branch) | Base commit: head of task/0026-worker-pgboss after 0026a | Branch: task/0026-worker-pgboss | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

> **Owner question (orchestrator: get the owner's line before this brief runs).** decisions.md approves pg-boss in the [stack] line but pins no version. Proposed line: `2026-10-18 [deps] pg-boss 12.35.1 (exact pin; 2026-09-30, Node >= 22.12, Postgres >= 13) for apps/worker. It brings node-postgres (pg ^8) as its own driver; Drizzle keeps postgres.js. (owner, phase run)`. 12.35.1 is the newest release older than two weeks; 12.38.0 (2026-10-13) is too fresh. If the owner picks another version, change only the `pg-boss` line in step 1.

## 1. Objective

`apps/worker/src/registry.ts` wraps pg-boss: each registered job gets a queue plus a dead-letter queue `<name>.dlq` with 5 attempts and exponential backoff, payloads are parsed with the definition's strict zod schema before anything is queued, a tenant job is sent with a job id derived from its idempotency key (enqueue twice → one job), and every tenant handler runs inside `withTenant(payload.orgId)` with the `app_worker` transaction. The database test proves the four acceptance cases of P0-PLAT-04 on real Postgres.

## 2. Context

Rules (AGENTS.md), pasted:

- Hard rule 3: every query is org-scoped. Tenant handlers get only a `TenantTx` (role `app_worker`, `app.org_id` set), never the service connection.
- Hard rule 4: no document content in logs. Log lines carry only allowlisted keys (`jobName`, `jobId`, `orgId`, `durationMs`, `errorCode`); an error is logged by its class name, never its message.
- Hard rule 7: no new dependency. `pg-boss` is in the [stack] line (pin: owner question above); `zod` 4.6.5 is approved; `@shoebox/db`, `@shoebox/pipeline`, `@shoebox/platform` are workspace packages.
- rules.md: "No raw SQL outside `packages/db`" (Biome plugin `no-raw-sql-outside-db` forbids `sql` template tags in `apps/`); the tests use the Drizzle query builder and pg-boss APIs only.

Spec, pasted verbatim:

- 03 ADR-003: "pg-boss for pipeline jobs, scheduled jobs (rates, deadlines, bank polling) and retries with exponential backoff, plus dead-letter queues. Idempotency key on every job (`{org_id}:{stage}:{document_id}:{version}`)."
- Backlog P0-PLAT-04 goal: "`apps/worker` starts pg-boss, registers jobs with zod payloads (ids only), idempotency keys `{org}:{stage}:{id}:{v}`, retries, dead-letter queues and Europe/Prague crons; every tenant job runs inside `withTenant`." Acceptance: "`apps/worker/test/registry.test.ts`: payload with a non-id field rejected; same key enqueued twice → one job; 5 failures → DLQ; handler receives a tenant transaction."
- M12 §4.4: "`withTenant(orgId, fn)` opens a transaction and runs `select set_config('app.org_id', $1, true)` … A query without `withTenant` sees zero rows instead of all rows."

From 0026a (`@shoebox/pipeline`): `defineTenantJob`, `defineSystemJob`, `documentStagePayload`, `jobKey`, `deadLetterName` (`<name>.dlq`), `DEFAULT_RETRY` (`retryLimit` 4, 30 s, backoff, max 3600 s), `CRON_TIME_ZONE` (`Europe/Prague`), `opsHeartbeatJob`. From 0022b (`@shoebox/db`): `createTenantDb`, `TenantDb`, `TenantTx`, `organizations`, `runMigrations`.

Design choices (brief writer, verified with pg-boss 12.35.1 on Postgres 16):

- **Idempotency:** on a `standard` queue pg-boss does **not** dedupe `singletonKey` (two sends gave two jobs). A fixed job `id` does: the second `send` returns `null`, also after the first job completed. So `enqueue` sends `id = jobIdFromKey(key)` (SHA-1 of the key in UUID v5 layout) and the key as `singletonKey` (searchable with `findJobs(name, { key })`).
- **Retries / DLQ:** `retryLimit: 4` gave exactly 5 handler calls, then the payload was copied to the `deadLetter` queue and the job is `failed`. pg-boss rejects `retryDelayMax` unless `retryBackoff` is true, so it is sent only then. The queue options are set when the queue is created (`createQueue` is a no-op for an existing queue).
- **Connections:** pg-boss uses the service connection (`DATABASE_URL`) and its own schema; tenant handlers use the `app_worker` pool of `TenantDb`. The test uses schema `pgboss_test`.
- **Tests:** the ticket names one file. Its DB cases go to `registry.db.test.ts` because the `unit` vitest project excludes `*.db.test.ts` (as 0022b did); this brief adds `apps/worker/test/**/*.db.test.ts` to the `db` project, and `fileParallelism: false` to the worker's own vitest config (two DB files from 0026c share one database). `registry.test.ts` covers the same rules with a fake pg-boss.

Anchors (edit steps):

`apps/worker/src/index.ts` (step 3), the whole current file:

```ts
export const packageName = '@shoebox/worker' as const;
```

`apps/worker/vitest.config.ts` (step 5), current line:

```ts
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
```

`vitest.workspace.ts` (step 6), current line (in the `db` project):

```ts
      include: ['packages/db/test/**/*.db.test.ts'],
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/package.json` | edit | dependencies pg-boss, zod, three workspace packages |
| `pnpm-lock.yaml` | generated | by `pnpm install`, never by hand |
| `apps/worker/src/registry.ts` | create | `createJobRegistry`, `jobIdFromKey`, types |
| `apps/worker/src/index.ts` | edit | export the registry |
| `apps/worker/test/registry.test.ts` | create | 11 unit tests, fake pg-boss |
| `apps/worker/vitest.config.ts` | edit | `fileParallelism: false` |
| `vitest.workspace.ts` | edit | `db` project includes `apps/worker/test/**/*.db.test.ts` |
| `apps/worker/test/registry.db.test.ts` | create | 4 tests on Postgres |

No other file may change.

## 4. Steps

Setup (once): `git checkout task/0026-worker-pgboss && git log --oneline -1` (expect the last 0026a commit) and `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`.

Rules for every step: write each new file with **one Write call**, contents exactly as given. Do not re-read a file you just wrote. Do not explore other files (not even `node_modules/pg-boss`). After the step's command shows the expected result, commit: `git add -A && git commit -qm "0026b step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: edit `apps/worker/package.json`, then install

Replace the whole file with:

```json
{
  "name": "@shoebox/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "pg-boss workers and schedulers.",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "dependencies": {
    "@shoebox/db": "workspace:*",
    "@shoebox/pipeline": "workspace:*",
    "@shoebox/platform": "workspace:*",
    "pg-boss": "12.35.1",
    "zod": "4.6.5"
  }
}
```

Command: `pnpm install 2>&1 | tail -3` → ends with `Done in …` (it downloads pg-boss 12.35.1 and its dependencies); `grep -c 'pg-boss@12.35.1' pnpm-lock.yaml` → `2` or more. Commit.

### Step 2: create `apps/worker/src/registry.ts`

```ts
// Job registry over pg-boss (03 ADR-003, 03 §3.1). Every job has a canonical name and a strict zod
// payload with ids only; a tenant job is enqueued with an id derived from its idempotency key
// `{org_id}:{stage}:{entity_id}:{version}` (a second enqueue with the same key is a no-op) and its
// handler always runs inside withTenant(payload.orgId). Failed jobs retry with exponential backoff
// and then land in `<name>.dlq`. Crons run in Europe/Prague.
import { createHash } from 'node:crypto';
import type { TenantDb, TenantTx } from '@shoebox/db';
import {
  CRON_TIME_ZONE,
  deadLetterName,
  type JobName,
  jobKey,
  type RetryPolicy,
  type SystemJobDefinition,
  type TenantJobDefinition,
} from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { Job, PgBoss } from 'pg-boss';

/** The part of PgBoss the registry uses (a fake in unit tests, PgBoss in the worker). */
export type Boss = Pick<PgBoss, 'createQueue' | 'send' | 'work' | 'schedule'>;

export interface JobContext {
  readonly jobId: string;
  /** 1 for the first attempt, 2 for the first retry, ... */
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface TenantJobContext extends JobContext {
  /** The withTenant transaction: `app_worker` with `app.org_id` = payload.orgId. */
  readonly tx: TenantTx;
}

export type TenantHandler<P> = (payload: P, ctx: TenantJobContext) => Promise<void>;
export type SystemHandler<P> = (payload: P, ctx: JobContext) => Promise<void>;

export interface RegistryOptions {
  readonly boss: Boss;
  readonly db: Pick<TenantDb, 'withTenant'>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  /** pg-boss polling interval per queue; default 2 s. */
  readonly pollingIntervalSeconds?: number;
}

export interface JobRegistry {
  registerTenant<P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    handler: TenantHandler<P>,
  ): void;
  registerSystem<P extends object>(def: SystemJobDefinition<P>, handler: SystemHandler<P>): void;
  /**
   * Validates the payload (throws a ZodError before touching the queue), then sends the job.
   * Tenant jobs: returns the job id, or null when a job with the same idempotency key exists.
   */
  enqueue<P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    payload: P,
  ): Promise<string | null>;
  enqueue<P extends object>(def: SystemJobDefinition<P>, payload: P): Promise<string | null>;
  /** Creates the queues and dead-letter queues, starts the workers and the crons. */
  start(): Promise<void>;
  /** The registered job names, in registration order. */
  readonly names: readonly JobName[];
}

type AnyDefinition = TenantJobDefinition<{ orgId: string }> | SystemJobDefinition<object>;

/** A UUID (version-5 layout) derived from an idempotency key: same key, same pg-boss job id. */
export function jobIdFromKey(key: string): string {
  const bytes = createHash('sha1').update(`shoebox.job:${key}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** pg-boss queue options; pg-boss accepts retryDelayMax only together with retryBackoff. */
function queueRetryOptions(retry: RetryPolicy) {
  const base = {
    retryLimit: retry.retryLimit,
    retryDelay: retry.retryDelaySeconds,
    retryBackoff: retry.retryBackoff,
  };
  return retry.retryBackoff ? { ...base, retryDelayMax: retry.retryDelayMaxSeconds } : base;
}

/** Error class name only: messages may carry document content and never reach the logs. */
function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export function createJobRegistry(options: RegistryOptions): JobRegistry {
  const { boss, db, logger } = options;
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 2;
  const definitions = new Map<JobName, AnyDefinition>();
  const handlers = new Map<JobName, (job: Job<unknown>) => Promise<void>>();
  const queues = new Map<string, Promise<void>>();

  function ensureQueue(def: AnyDefinition): Promise<void> {
    let ready = queues.get(def.name);
    if (ready === undefined) {
      const dlq = deadLetterName(def.name);
      ready = boss
        .createQueue(dlq)
        .then(() =>
          boss.createQueue(def.name, { deadLetter: dlq, ...queueRetryOptions(def.retry) }),
        );
      queues.set(def.name, ready);
    }
    return ready;
  }

  function claim(def: AnyDefinition): void {
    if (definitions.has(def.name)) {
      throw new Error(`registry: job ${def.name} is already registered`);
    }
    definitions.set(def.name, def);
  }

  async function timed(
    fields: { jobName: string; jobId: string; orgId?: string },
    run: () => Promise<void>,
  ): Promise<void> {
    const started = performance.now();
    try {
      await run();
      logger.info(
        { ...fields, durationMs: Math.round(performance.now() - started) },
        'job completed',
      );
    } catch (error) {
      logger.warn({ ...fields, errorCode: errorCode(error) }, 'job failed');
      throw error;
    }
  }

  const registry: JobRegistry = {
    get names() {
      return [...definitions.keys()];
    },

    registerTenant(def, handler) {
      claim(def as unknown as AnyDefinition);
      handlers.set(def.name, async (job) => {
        const payload = def.payload.parse(job.data);
        await timed({ jobName: def.name, jobId: job.id, orgId: payload.orgId }, () =>
          db.withTenant(payload.orgId, (tx) =>
            handler(payload, {
              tx,
              jobId: job.id,
              attempt: job.retryCount + 1,
              signal: job.signal,
            }),
          ),
        );
      });
    },

    registerSystem(def, handler) {
      claim(def as unknown as AnyDefinition);
      handlers.set(def.name, async (job) => {
        const payload = def.payload.parse(job.data ?? {});
        await timed({ jobName: def.name, jobId: job.id }, () =>
          handler(payload, { jobId: job.id, attempt: job.retryCount + 1, signal: job.signal }),
        );
      });
    },

    async enqueue(def: AnyDefinition, payload: object): Promise<string | null> {
      const data = def.payload.parse(payload);
      await ensureQueue(def);
      if (def.scope === 'tenant') {
        const key = jobKey(def, data as { orgId: string });
        return boss.send(def.name, data, { id: jobIdFromKey(key), singletonKey: key });
      }
      return boss.send(def.name, data);
    },

    async start() {
      for (const def of definitions.values()) {
        await ensureQueue(def);
        const handle = handlers.get(def.name);
        if (handle === undefined) continue;
        await boss.work<unknown>(
          def.name,
          { pollingIntervalSeconds, batchSize: 1 },
          async (jobs) => {
            for (const job of jobs) {
              await handle(job);
            }
          },
        );
        if (def.scope === 'system' && def.cron !== null) {
          await boss.schedule(def.name, def.cron, {}, { tz: CRON_TIME_ZONE });
        }
      }
    },
  };
  return registry;
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no `error TS`. Commit.

### Step 3: edit `apps/worker/src/index.ts`

Replace the whole file (anchor in §2) with:

```ts
export const packageName = '@shoebox/worker' as const;
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
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5` → no errors. Commit.

### Step 4: create `apps/worker/test/registry.test.ts`

Full file; do not edit it:

```ts
import type { TenantTx } from '@shoebox/db';
import {
  defineSystemJob,
  defineTenantJob,
  documentStagePayload,
  opsHeartbeatJob,
} from '@shoebox/pipeline';
import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { type Boss, createJobRegistry, jobIdFromKey, type RegistryOptions } from '../src/registry';

// Unit tests with a fake pg-boss and a fake withTenant. The real queue, retries and DLQ are
// covered by registry.db.test.ts against Postgres.
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC = 'bbbbbbbb-0000-4000-8000-000000000002';
const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const split = defineTenantJob({
  name: 'doc.split',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});

type WorkHandler = (jobs: Job<unknown>[]) => Promise<unknown>;

function fakes() {
  const workers = new Map<string, WorkHandler>();
  const sent: unknown[][] = [];
  const seenKeys = new Set<string>();
  const boss = {
    createQueue: vi.fn(async () => undefined),
    send: vi.fn(async (...args: unknown[]) => {
      sent.push(args);
      const options = args[2] as { id?: string } | undefined;
      if (options?.id !== undefined) {
        if (seenKeys.has(options.id)) return null;
        seenKeys.add(options.id);
        return options.id;
      }
      return 'system-job-id';
    }),
    work: vi.fn(async (name: string, _options: unknown, handler: WorkHandler) => {
      workers.set(name, handler);
      return `worker-${name}`;
    }),
    schedule: vi.fn(async () => undefined),
  };
  const tenantCalls: string[] = [];
  const tx = { fake: 'tx' } as unknown as TenantTx;
  const db: RegistryOptions['db'] = {
    withTenant: async (orgId, fn) => {
      tenantCalls.push(orgId);
      return fn(tx);
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const registry = createJobRegistry({
    boss: boss as unknown as Boss,
    db,
    logger: logger as unknown as RegistryOptions['logger'],
  });
  return { boss, workers, sent, tenantCalls, tx, logger, registry };
}

function job(data: unknown, retryCount = 0): Job<unknown> {
  return {
    id: 'job-1',
    name: 'doc.split',
    data,
    retryCount,
    expireInSeconds: 900,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

describe('jobIdFromKey', () => {
  it('is a deterministic version-5 UUID that differs per key', () => {
    const a = jobIdFromKey(`${ORG}:doc.split:${DOC}:1`);
    expect(a).toMatch(UUID_V5_RE);
    expect(jobIdFromKey(`${ORG}:doc.split:${DOC}:1`)).toBe(a);
    expect(jobIdFromKey(`${ORG}:doc.split:${DOC}:2`)).not.toBe(a);
  });
});

describe('enqueue', () => {
  it('rejects a payload with a non-id field before touching the queue', async () => {
    const { registry, boss } = fakes();
    await expect(
      registry.enqueue(split, {
        orgId: ORG,
        documentId: DOC,
        ocrText: 'Faktura 2026/001',
      } as never),
    ).rejects.toBeInstanceOf(ZodError);
    expect(boss.send).not.toHaveBeenCalled();
    expect(boss.createQueue).not.toHaveBeenCalled();
  });

  it('sends a tenant job with the key-derived id and the key as singletonKey', async () => {
    const { registry, sent } = fakes();
    const key = `${ORG}:doc.split:${DOC}:1`;
    const id = await registry.enqueue(split, { orgId: ORG, documentId: DOC });
    expect(id).toBe(jobIdFromKey(key));
    expect(sent[0]).toEqual([
      'doc.split',
      { orgId: ORG, documentId: DOC },
      { id: jobIdFromKey(key), singletonKey: key },
    ]);
  });

  it('the same key twice gives one job id and then null', async () => {
    const { registry, boss } = fakes();
    const first = await registry.enqueue(split, { orgId: ORG, documentId: DOC });
    const second = await registry.enqueue(split, { orgId: ORG, documentId: DOC });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(boss.send).toHaveBeenCalledTimes(2);
  });

  it('creates the dead-letter queue first, then the queue with retries and backoff', async () => {
    const { registry, boss } = fakes();
    await registry.enqueue(split, { orgId: ORG, documentId: DOC });
    await registry.enqueue(split, { orgId: ORG, documentId: DOC });
    expect(boss.createQueue.mock.calls).toEqual([
      ['doc.split.dlq'],
      [
        'doc.split',
        {
          deadLetter: 'doc.split.dlq',
          retryLimit: 4,
          retryDelay: 30,
          retryBackoff: true,
          retryDelayMax: 3600,
        },
      ],
    ]);
  });
});

describe('start and handlers', () => {
  it('a tenant handler runs inside withTenant(payload.orgId) and receives its tx', async () => {
    const { registry, workers, tenantCalls, tx, logger } = fakes();
    const handler = vi.fn(async () => undefined);
    registry.registerTenant(split, handler);
    await registry.start();
    const work = workers.get('doc.split');
    expect(work).toBeDefined();
    await work?.([job({ orgId: ORG, documentId: DOC }, 2)]);
    expect(tenantCalls).toEqual([ORG]);
    expect(handler).toHaveBeenCalledWith(
      { orgId: ORG, documentId: DOC },
      expect.objectContaining({ tx, jobId: 'job-1', attempt: 3 }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'doc.split', jobId: 'job-1', orgId: ORG }),
      'job completed',
    );
  });

  it('a stored payload that fails the schema throws and never reaches the handler', async () => {
    const { registry, workers, tenantCalls } = fakes();
    const handler = vi.fn(async () => undefined);
    registry.registerTenant(split, handler);
    await registry.start();
    await expect(
      workers.get('doc.split')?.([job({ orgId: ORG, documentId: DOC, text: 'x' })]),
    ).rejects.toBeInstanceOf(ZodError);
    expect(handler).not.toHaveBeenCalled();
    expect(tenantCalls).toEqual([]);
  });

  it('a failing handler is rethrown (pg-boss retries) and logged without its message', async () => {
    const { registry, workers, logger } = fakes();
    registry.registerTenant(split, async () => {
      throw new RangeError('secret document text');
    });
    await registry.start();
    await expect(
      workers.get('doc.split')?.([job({ orgId: ORG, documentId: DOC })]),
    ).rejects.toThrow(RangeError);
    expect(logger.warn).toHaveBeenCalledWith(
      { jobName: 'doc.split', jobId: 'job-1', orgId: ORG, errorCode: 'RangeError' },
      'job failed',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('a system cron is scheduled in Europe/Prague and its handler runs without a tenant', async () => {
    const { registry, boss, workers, tenantCalls } = fakes();
    const tick = vi.fn(async () => undefined);
    registry.registerSystem(opsHeartbeatJob, tick);
    await registry.start();
    expect(boss.schedule).toHaveBeenCalledWith(
      'ops.heartbeat',
      '* * * * *',
      {},
      {
        tz: 'Europe/Prague',
      },
    );
    await workers.get('ops.heartbeat')?.([job(null)]);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tenantCalls).toEqual([]);
  });

  it('a system job without cron is worked but not scheduled', async () => {
    const { registry, boss } = fakes();
    const gc = defineSystemJob({
      name: 'ops.rate_limit_gc',
      payload: z.strictObject({}),
    });
    registry.registerSystem(gc, async () => undefined);
    await registry.start();
    expect(boss.work).toHaveBeenCalledWith(
      'ops.rate_limit_gc',
      { pollingIntervalSeconds: 2, batchSize: 1 },
      expect.any(Function),
    );
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('registering the same job twice throws; names lists the registered jobs', () => {
    const { registry } = fakes();
    registry.registerTenant(split, async () => undefined);
    expect(() => registry.registerTenant(split, async () => undefined)).toThrow(/already/);
    registry.registerSystem(opsHeartbeatJob, async () => undefined);
    expect(registry.names).toEqual(['doc.split', 'ops.heartbeat']);
  });
});
```

Command: `pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  2 passed (2)`, `Tests  12 passed (12)`. Commit.

### Step 5: edit `apps/worker/vitest.config.ts`

After the anchor line (§2) insert:

```ts
    // The *.db.test.ts files share one DATABASE_URL and run migrations: never in parallel.
    fileParallelism: false,
```

Command: `pnpm --filter @shoebox/worker test 2>&1 | tail -6` → still `Tests  12 passed (12)`. Commit.

### Step 6: edit `vitest.workspace.ts`

Replace the anchor line (§2) with:

```ts
      include: ['packages/db/test/**/*.db.test.ts', 'apps/worker/test/**/*.db.test.ts'],
```

Command: `pnpm exec biome ci vitest.workspace.ts 2>&1 | tail -3` → no errors. Commit.

### Step 7: create `apps/worker/test/registry.db.test.ts`

Full file; do not edit it:

```ts
import { createTenantDb, organizations, runMigrations, type TenantDb } from '@shoebox/db';
import { defineTenantJob, documentStagePayload } from '@shoebox/pipeline';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobRegistry, type JobRegistry, jobIdFromKey } from '../src/registry';

// Runs in the `db` vitest project against DATABASE_URL (local-pg.sh or Supabase CLI). pg-boss
// uses the service connection and its own schema `pgboss_test`; handlers run as `app_worker`
// (WORKER_DATABASE_URL, or DATABASE_URL with the user replaced by app_worker on the trust-auth
// cluster). Skipped without DATABASE_URL. Cleans its own queues and rows.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_E = 'eeeeeeee-0000-4000-8000-000000000005';
const ORG_F = 'ffffffff-0000-4000-8000-000000000006';
const DOC_1 = '11111111-0000-4000-8000-0000000000d1';
const DOC_2 = '22222222-0000-4000-8000-0000000000d2';
const DOC_3 = '33333333-0000-4000-8000-0000000000d3';
const QUEUES = [
  'doc.classify',
  'doc.classify.dlq',
  'doc.extract',
  'doc.extract.dlq',
  'doc.split',
  'doc.split.dlq',
];

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const classify = defineTenantJob({
  name: 'doc.classify',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});
const extract = defineTenantJob({
  name: 'doc.extract',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
  // Same attempt count as production (retryLimit 4 = 5 attempts), no delay so the test is fast.
  retry: { retryDelaySeconds: 0, retryBackoff: false },
});
const split = defineTenantJob({
  name: 'doc.split',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});

describe.skipIf(DATABASE_URL === undefined)('worker registry on pg-boss', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let db: TenantDb;
  let boss: PgBoss;
  let registry: JobRegistry;
  let extractAttempts = 0;
  const seenBySplit: { orgId: string; orgs: string[] }[] = [];

  beforeAll(async () => {
    await runMigrations(serviceUrl);
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 2 },
    );
    await db.withServiceRole('admin', (tx) =>
      tx
        .insert(organizations)
        .values([
          { id: ORG_E, name: 'Org E', inboundEmailSlug: 'org-e', inboundEmailSecret: 'EEEEEEEE' },
          { id: ORG_F, name: 'Org F', inboundEmailSlug: 'org-f', inboundEmailSecret: 'FFFFFFFF' },
        ])
        .onConflictDoNothing(),
    );
    boss = new PgBoss({ connectionString: serviceUrl, schema: 'pgboss_test', max: 3 });
    boss.on('error', () => undefined);
    await boss.start();
    for (const name of QUEUES) await boss.deleteQueue(name);
    registry = createJobRegistry({
      boss,
      db,
      logger: { info: () => undefined, warn: () => undefined },
      pollingIntervalSeconds: 0.5,
    });
    registry.registerTenant(extract, async () => {
      extractAttempts += 1;
      throw new Error('always fails');
    });
    registry.registerTenant(split, async (payload, { tx }) => {
      const rows = await tx.select({ id: organizations.id }).from(organizations);
      seenBySplit.push({ orgId: payload.orgId, orgs: rows.map((r) => r.id) });
    });
    await registry.start();
  }, 30_000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    const cleanup = new PgBoss({ connectionString: serviceUrl, schema: 'pgboss_test', max: 1 });
    cleanup.on('error', () => undefined);
    await cleanup.start();
    for (const name of QUEUES) await cleanup.deleteQueue(name);
    await cleanup.stop({ graceful: false });
    // As app_worker inside withTenant a bare delete removes only that org's row.
    for (const orgId of [ORG_E, ORG_F]) {
      await db?.withTenant(orgId, (tx) => tx.delete(organizations));
    }
    await db?.close();
  }, 30_000);

  it('the same idempotency key enqueued twice gives one job', async () => {
    const payload = { orgId: ORG_E, documentId: DOC_1 };
    const first = await registry.enqueue(classify, payload);
    const second = await registry.enqueue(classify, payload);
    expect(first).toBe(jobIdFromKey(`${ORG_E}:doc.classify:${DOC_1}:1`));
    expect(second).toBeNull();
    const jobs = await boss.findJobs('doc.classify', { key: `${ORG_E}:doc.classify:${DOC_1}:1` });
    expect(jobs).toHaveLength(1);
    const other = await registry.enqueue(classify, { orgId: ORG_F, documentId: DOC_1 });
    expect(other).not.toBeNull();
    expect(await boss.findJobs('doc.classify')).toHaveLength(2);
  });

  it('a payload with a non-id field is rejected and nothing is queued', async () => {
    await expect(
      registry.enqueue(classify, { orgId: ORG_E, documentId: DOC_2, note: 'x' } as never),
    ).rejects.toThrow();
    expect(await boss.findJobs('doc.classify', { data: { documentId: DOC_2 } })).toHaveLength(0);
  });

  it('5 failed attempts move the job to doc.extract.dlq', async () => {
    const payload = { orgId: ORG_E, documentId: DOC_3 };
    const id = await registry.enqueue(extract, payload);
    expect(id).not.toBeNull();
    const dead = await waitFor(async () => {
      const jobs = await boss.findJobs('doc.extract.dlq');
      return jobs.length > 0 ? jobs : undefined;
    });
    expect(dead).toHaveLength(1);
    expect(dead[0]?.data).toEqual(payload);
    expect(extractAttempts).toBe(5);
    const [original] = await boss.findJobs('doc.extract', { id: id ?? '' });
    expect(original?.state).toBe('failed');
  }, 20_000);

  it('the handler receives a tenant transaction that sees only its own org', async () => {
    await registry.enqueue(split, { orgId: ORG_E, documentId: DOC_1 });
    await registry.enqueue(split, { orgId: ORG_F, documentId: DOC_1 });
    await waitFor(async () => (seenBySplit.length >= 2 ? true : undefined));
    const byOrg = Object.fromEntries(seenBySplit.map((s) => [s.orgId, s.orgs]));
    expect(byOrg[ORG_E]).toEqual([ORG_E]);
    expect(byOrg[ORG_F]).toEqual([ORG_F]);
  }, 20_000);
});
```

Commands:

- `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  3 passed (3)`, `Tests  16 passed (16)` (about 5 s; the DLQ case waits for 5 attempts).
- `pnpm --filter @shoebox/worker test 2>&1 | tail -6` → `Test Files  2 passed | 1 skipped (3)`, `Tests  12 passed | 4 skipped (16)`.
- If the local cluster is not available, say so in the report and give only the second result.

Commit. Then write the report (§9).

## 5. Do not touch

`packages/**` (0026a is done), `apps/worker/src/health.ts`, `apps/worker/src/worker.ts`, `apps/worker/src/main.ts` (0026c), `apps/web/**`, `apps/email-worker/**`, `packages/db/scripts/**`, `docs/v3/**`. Hard rules: 3 (tenant handlers only through `withTenant`), 4 (no payload or error message in logs), 7 (no dependency beyond step 1), 8 (never push to `main`). No `sql` template tag in `apps/`. Never put a connection string with a password in any file.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                                            # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/worker test 2>&1 | tail -30    # 3 files, Tests 16 passed
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm exec vitest run --project db 2>&1 | tail -30      # Test Files 3 passed, Tests 25 passed
pnpm --filter @shoebox/worker test 2>&1 | tail -30                                                                   # 12 passed, 4 skipped
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30                                                              # exit 0
pnpm exec biome ci apps/worker vitest.workspace.ts 2>&1 | tail -30                                                   # No fixes applied
pnpm depcruise 2>&1 | tail -30                                                                                       # no dependency violations found
```

Test-map row `apps/worker`: `pnpm --filter @shoebox/worker test -- <file>`; `DATABASE_URL` from `local-pg.sh` replaces `pnpm db:start` (no Docker here).

## 7. Acceptance

- [ ] `registry.test.ts` 11 passed; `registry.db.test.ts` 4 passed with `DATABASE_URL` (non-id field rejected, same key twice → one job, 5 failures → `doc.extract.dlq`, handler sees only its own org), 4 skipped without.
- [ ] `vitest run --project db` with `DATABASE_URL`: 25 passed (21 from `packages/db` + 4).
- [ ] `grep -n '"pg-boss": "12.35.1"' apps/worker/package.json` → 1 line (or the owner's version).
- [ ] `biome ci` clean also means no `sql` template tag in `apps/worker` (plugin `no-raw-sql-outside-db`).
- [ ] typecheck exit 0; `biome ci apps/worker vitest.workspace.ts` clean; depcruise clean.

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

Write `docs/tasks/0026b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`apps/worker/src/registry.ts`: payload `parse` runs before `ensureQueue`/`send`; tenant handlers only inside `db.withTenant(payload.orgId, …)`; `jobIdFromKey` deterministic; the queue options (`deadLetter`, `retryLimit` 4, backoff); log fields are allowlisted keys and `errorCode` is `error.name` only. `vitest.workspace.ts` (the `db` project now also runs the worker DB tests).

## Owner steps

1. Answer the owner question at the top (pg-boss version); the orchestrator adds the decisions line.
