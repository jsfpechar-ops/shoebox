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
