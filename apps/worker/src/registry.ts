// Job registry over pg-boss (03 ADR-003, 03 §3.1). Every job has a canonical name and a strict zod
// payload with ids only; a tenant job is enqueued with an id derived from its idempotency key
// `{org_id}:{stage}:{entity_id}:{version}` (a second enqueue with the same key is a no-op) and its
// handler always runs inside withTenant(payload.orgId). Failed jobs retry with exponential backoff
// and then land in `<name>.dlq`. Crons run in Europe/Prague.
import type { TenantDb, TenantTx } from '@shoebox/db';
import {
  CRON_TIME_ZONE,
  deadLetterName,
  type JobName,
  jobIdFromKey,
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
    options?: { readonly startAfterSeconds?: number },
  ): Promise<string | null>;
  enqueue<P extends object>(
    def: SystemJobDefinition<P>,
    payload: P,
    options?: { readonly startAfterSeconds?: number },
  ): Promise<string | null>;
  /** Creates the queues and dead-letter queues, starts the workers and the crons. */
  start(): Promise<void>;
  /** The registered job names, in registration order. */
  readonly names: readonly JobName[];
}

export { jobIdFromKey };

type AnyDefinition = TenantJobDefinition<{ orgId: string }> | SystemJobDefinition<object>;

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

/** HTTP status and reason code of a provider error (never content), so a failed call can be diagnosed. */
function errorStatus(error: unknown): { httpStatus?: number; errorReason?: string } {
  const source = (error as { status?: unknown; reason?: unknown } | null) ?? {};
  return {
    ...(typeof source.status === 'number' ? { httpStatus: source.status } : {}),
    ...(typeof source.reason === 'string' ? { errorReason: source.reason } : {}),
  };
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
      logger.warn({ ...fields, errorCode: errorCode(error), ...errorStatus(error) }, 'job failed');
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

    async enqueue(
      def: AnyDefinition,
      payload: object,
      options?: { readonly startAfterSeconds?: number },
    ): Promise<string | null> {
      const data = def.payload.parse(payload);
      await ensureQueue(def);
      if (def.scope === 'tenant') {
        const key = jobKey(def, data as { orgId: string });
        const base = { id: jobIdFromKey(key), singletonKey: key };
        return boss.send(
          def.name,
          data,
          options?.startAfterSeconds === undefined
            ? base
            : { ...base, startAfter: options.startAfterSeconds },
        );
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
