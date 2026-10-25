import postgres, { type Sql } from 'postgres';

/** A reusable `select 1` for health endpoints (M12 §4.2: web `/api/health`, worker `/healthz`). */
export interface DbPing {
  /** Resolves when the database answered; rejects on connection or query failure. */
  ping(): Promise<void>;
  /** Closes the single pooled connection. */
  close(): Promise<void>;
}

/**
 * One connection, kept between probes (Cloud Run probes every few seconds). Touches no tenant
 * table, so it needs no org scope; it only proves the database answers.
 */
export function createDbPing(url: string, options: { connectTimeoutS?: number } = {}): DbPing {
  const sql: Sql = postgres(url, {
    max: 1,
    connect_timeout: options.connectTimeoutS ?? 2,
    idle_timeout: 30,
    onnotice: () => undefined,
  });
  return {
    async ping() {
      await sql`select 1`;
    },
    close() {
      return sql.end();
    },
  };
}
