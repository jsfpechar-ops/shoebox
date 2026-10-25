// rateLimitHit (M12 §4.5, 05 §9): Postgres-backed fixed-window counters, no Redis. One call to
// app.rate_limit_hit(key, max, window_s) (migration 0007, security definer: the caller needs no
// privilege on rate_limit_counters; execute is granted to service_role and app_worker) counts one
// hit in the current window and says whether it is still within `max`. Keys follow M12 §4.5
// (`upload:{user}`, `api:{token}`, `ares:{user}`, …). Windows older than 2 days are deleted by the
// job ops.rate_limit_gc.
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './tenant';

/** A Drizzle handle that can run app.rate_limit_hit(): the service Db, the worker Db or a Tx. */
export type RateLimitDb = Pick<Db | Tx, 'execute'>;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Counts one hit of `key` in the fixed window of `windowS` seconds and returns true while the
 * window holds at most `max` hits (the call that reaches max + 1 returns false). A new window
 * starts counting from one again.
 */
export async function rateLimitHit(
  key: string,
  max: number,
  windowS: number,
  db: RateLimitDb,
): Promise<boolean> {
  if (typeof key !== 'string' || key === '') {
    throw new TypeError('rateLimitHit: key must be a non-empty string');
  }
  if (!isCount(max)) {
    throw new TypeError('rateLimitHit: max must be a non-negative integer');
  }
  if (!isCount(windowS) || windowS === 0) {
    throw new TypeError('rateLimitHit: windowS must be a positive integer');
  }
  const [row] = await db.execute<{ allowed: boolean }>(
    sql`select app.rate_limit_hit(${key}, ${max}::int, ${windowS}::int) as allowed`,
  );
  return row?.allowed === true;
}
