import { createDbPing, type DbPing } from '@shoebox/db/health';

let probe: DbPing | undefined;
let probeUrl: string | undefined;

/**
 * `select 1` on `DATABASE_URL`, one connection kept between health checks (module-level, so Cloud
 * Run probes reuse it). Returns undefined when the URL is not configured, which `checkHealth`
 * reports as `unconfigured`. The SQL itself lives in packages/db (lint rule no-raw-sql-outside-db).
 */
export function dbPing(url: string | undefined): (() => Promise<void>) | undefined {
  if (!url) return undefined;
  if (probe === undefined || probeUrl !== url) {
    probe = createDbPing(url);
    probeUrl = url;
  }
  const current = probe;
  return () => current.ping();
}
