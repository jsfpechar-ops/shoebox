/**
 * `GET /api/health` (M12 §4.2: web = DB ping ≤ 200 ms). Pure: the ping is injected, so the unit test
 * runs without a database and the route (app/api/health/route.ts) only wires `dbPing` in.
 */

/** M12 §4.2 budget for the DB ping, in milliseconds. Reported, not enforced: a slow DB is not a dead instance. */
export const DB_PING_BUDGET_MS = 200;

/** A ping that takes longer than this is reported as unreachable. */
export const DB_PING_TIMEOUT_MS = 2_000;

export type DbHealth =
  | { ok: true; ms: number; withinBudget: boolean }
  | { ok: false; reason: 'unconfigured' | 'unreachable' | 'timeout' };

export interface HealthReport {
  status: 'ok' | 'error';
  db: DbHealth;
}

export interface HealthResult {
  /** HTTP status: 200 when the database answered, 503 otherwise. */
  status: 200 | 503;
  body: HealthReport;
}

export interface HealthDeps {
  /** Resolves when the database answered `select 1`; undefined when no `DATABASE_URL` is configured. */
  ping: (() => Promise<void>) | undefined;
  /** Monotonic clock in ms (default `performance.now`). */
  now?: () => number;
  timeoutMs?: number;
}

/** Never includes an error message or a connection string in the body (no secrets in responses, M12 §4.13). */
export async function checkHealth(deps: HealthDeps): Promise<HealthResult> {
  const now = deps.now ?? (() => performance.now());
  const timeoutMs = deps.timeoutMs ?? DB_PING_TIMEOUT_MS;
  if (deps.ping === undefined) {
    return { status: 503, body: { status: 'error', db: { ok: false, reason: 'unconfigured' } } };
  }

  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([deps.ping().then(() => 'ok' as const), timeout]);
    if (outcome === 'timeout') {
      return { status: 503, body: { status: 'error', db: { ok: false, reason: 'timeout' } } };
    }
    const ms = Math.max(0, Math.round(now() - started));
    return {
      status: 200,
      body: { status: 'ok', db: { ok: true, ms, withinBudget: ms <= DB_PING_BUDGET_MS } },
    };
  } catch {
    return { status: 503, body: { status: 'error', db: { ok: false, reason: 'unreachable' } } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
