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
