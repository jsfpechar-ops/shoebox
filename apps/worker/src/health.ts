// Worker health (M12 §4.2): `GET /healthz` is 200 while pg-boss is started and the last cron tick
// (ops.heartbeat, every minute) is younger than 2 minutes, else 503. Until the first tick the age
// counts from the start, so a fresh instance is healthy for its first 2 minutes.
import { createServer, type Server } from 'node:http';

export const CRON_TICK_MAX_AGE_MS = 120_000;

export interface HealthReport {
  readonly ok: boolean;
  readonly pgBoss: 'started' | 'stopped';
  /** ISO instant of the last ops.heartbeat run, null before the first one. */
  readonly lastCronTickAt: string | null;
  /** Milliseconds since the last tick (or since the start before the first tick). */
  readonly cronTickAgeMs: number | null;
}

export interface WorkerHealth {
  markStarted(): void;
  markStopped(): void;
  recordCronTick(): void;
  report(): HealthReport;
}

export function createWorkerHealth(now: () => number = Date.now): WorkerHealth {
  let startedAt: number | null = null;
  let lastTickAt: number | null = null;
  return {
    markStarted() {
      startedAt = now();
    },
    markStopped() {
      startedAt = null;
    },
    recordCronTick() {
      lastTickAt = now();
    },
    report() {
      const since = lastTickAt ?? startedAt;
      const cronTickAgeMs = since === null ? null : now() - since;
      const started = startedAt !== null;
      return {
        ok: started && cronTickAgeMs !== null && cronTickAgeMs < CRON_TICK_MAX_AGE_MS,
        pgBoss: started ? 'started' : 'stopped',
        lastCronTickAt: lastTickAt === null ? null : new Date(lastTickAt).toISOString(),
        cronTickAgeMs,
      };
    },
  };
}

/** Serves `GET /healthz` as JSON; every other path is 404. Port 0 picks a free port. */
export function startHealthServer(health: WorkerHealth, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      const report = health.report();
      res.writeHead(report.ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(report));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found"}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
