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

  it('can delay a tenant job', async () => {
    const { registry, sent } = fakes();
    const key = `${ORG}:doc.split:${DOC}:1`;
    await registry.enqueue(split, { orgId: ORG, documentId: DOC }, { startAfterSeconds: 5 });
    expect(sent[0]).toEqual([
      'doc.split',
      { orgId: ORG, documentId: DOC },
      { id: jobIdFromKey(key), singletonKey: key, startAfter: 5 },
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

  it('a failing provider call also logs its HTTP status', async () => {
    const { registry, workers, logger } = fakes();
    class AnthropicHttpError extends Error {
      readonly status = 401;
      readonly reason = 'credit_balance';
      constructor() {
        super('secret detail');
        this.name = 'AnthropicHttpError';
      }
    }
    registry.registerTenant(split, async () => {
      throw new AnthropicHttpError();
    });
    await registry.start();
    await expect(
      workers.get('doc.split')?.([job({ orgId: ORG, documentId: DOC })]),
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        jobName: 'doc.split',
        jobId: 'job-1',
        orgId: ORG,
        errorCode: 'AnthropicHttpError',
        httpStatus: 401,
        errorReason: 'credit_balance',
      },
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
