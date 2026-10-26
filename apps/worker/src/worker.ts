// Worker wiring: env → connections, pg-boss on the service connection (schema `pgboss`), tenant
// handlers on `app_worker` through withTenant, the ops.heartbeat cron and `/healthz` (M12 §4.2).

import type { Server } from 'node:http';
import { closeDb, configureDb, type TenantDb } from '@shoebox/db';
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
  readonly register?: (registry: JobRegistry, db: TenantDb) => void;
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
  options.register?.(registry, db);
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
