import type { AddressInfo } from 'node:net';
import { runMigrations } from '@shoebox/db/migrate';
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
