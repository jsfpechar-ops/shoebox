import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { rateLimitHit } from '../src/rate-limit';
import { workerUrlFrom } from './rls/helpers';

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
    // app_worker connects with its own login (Supabase's postgres user may not `set role` to it).
    const worker = postgres(process.env.WORKER_DATABASE_URL ?? workerUrlFrom(url), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      const asWorker = await worker`select app.rate_limit_hit('test:ares:w1', 30, 60) as allowed`;
      expect(asWorker[0]?.allowed).toBe(true);
    } finally {
      await worker.end();
    }
    expect(
      await code(
        asRole('authenticated', (tx) => tx`select app.rate_limit_hit('test:ares:w1', 30, 60)`),
      ),
    ).toBe('42501');
  });
});
