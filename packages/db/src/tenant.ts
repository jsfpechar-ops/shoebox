// withTenant / withServiceRole (M12 §6, 05 §10.1). The worker connects as `app_worker` (no
// BYPASSRLS, migration 0003) and runs every tenant query inside withTenant(orgId, fn), which sets
// `app.org_id` for exactly one transaction; the <t>_worker policies then show that org only. A
// query outside withTenant sees zero rows. withServiceRole runs on the service connection
// (BYPASSRLS) and is allowed only for the four reasons of M12 §6.
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index';

export type DbSchema = typeof schema;
/** Drizzle database over postgres.js with the Shoebox schema. */
export type Db = PostgresJsDatabase<DbSchema>;
/** The transaction handle Drizzle passes to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

declare const TX_KIND: unique symbol;
/** A transaction on the worker connection with `app.org_id` set. Only withTenant creates one. */
export type TenantTx = Tx & { readonly [TX_KIND]: 'tenant' };
/** A transaction on the service connection (bypasses RLS). Only withServiceRole creates one. */
export type ServiceTx = Tx & { readonly [TX_KIND]: 'service' };

export const SERVICE_ROLE_REASONS = ['retention', 'export', 'admin', 'migration'] as const;
export type ServiceRoleReason = (typeof SERVICE_ROLE_REASONS)[number];

export interface DbConnections {
  /** Connection string of role `app_worker` (env `WORKER_DATABASE_URL`). */
  workerUrl: string;
  /** Connection string of the migrating/service role `postgres` (env `DATABASE_URL`). */
  serviceUrl: string;
}

export interface TenantDb {
  withTenant<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  withServiceRole<T>(reason: ServiceRoleReason, fn: (tx: ServiceTx) => Promise<T>): Promise<T>;
  /** Drizzle over the `app_worker` pool. Outside withTenant every tenant table reads as empty. */
  readonly worker: Db;
  /** Drizzle over the service pool. Migrations, retention, export and admin only. */
  readonly service: Db;
  /** Closes both pools. */
  close(): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isServiceRoleReason(reason: unknown): reason is ServiceRoleReason {
  return (SERVICE_ROLE_REASONS as readonly unknown[]).includes(reason);
}

/** Two pools (worker, service) and the two scoped transaction helpers over them. */
export function createTenantDb(conn: DbConnections, options: { max?: number } = {}): TenantDb {
  const poolOptions = { max: options.max ?? 4, onnotice: () => undefined };
  const workerSql: Sql = postgres(conn.workerUrl, poolOptions);
  const serviceSql: Sql = postgres(conn.serviceUrl, poolOptions);
  const worker: Db = drizzle(workerSql, { schema });
  const service: Db = drizzle(serviceSql, { schema });

  return {
    worker,
    service,
    withTenant(orgId, fn) {
      if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
        throw new TypeError('withTenant: orgId must be a UUID');
      }
      return worker.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
        return fn(tx as TenantTx);
      });
    },
    withServiceRole(reason, fn) {
      if (!isServiceRoleReason(reason)) {
        throw new TypeError(
          `withServiceRole: reason must be one of ${SERVICE_ROLE_REASONS.join('|')}`,
        );
      }
      return service.transaction((tx) => fn(tx as ServiceTx));
    },
    async close() {
      await Promise.all([workerSql.end(), serviceSql.end()]);
    },
  };
}

let defaultDb: TenantDb | undefined;

/** Sets the process-wide connections used by withTenant / withServiceRole. Call once at startup. */
export function configureDb(conn: DbConnections, options: { max?: number } = {}): TenantDb {
  defaultDb = createTenantDb(conn, options);
  return defaultDb;
}

function requireDb(): TenantDb {
  if (defaultDb === undefined) {
    throw new Error('packages/db: configureDb({ workerUrl, serviceUrl }) was not called');
  }
  return defaultDb;
}

/** Runs fn as `app_worker` inside one transaction scoped to orgId (05 §10.1). */
export function withTenant<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return requireDb().withTenant(orgId, fn);
}

/** Runs fn on the service connection; only for retention, export, admin or migration work. */
export function withServiceRole<T>(
  reason: ServiceRoleReason,
  fn: (tx: ServiceTx) => Promise<T>,
): Promise<T> {
  return requireDb().withServiceRole(reason, fn);
}

/** Closes the process-wide pools set by configureDb (no-op when not configured). */
export async function closeDb(): Promise<void> {
  const db = defaultDb;
  defaultDb = undefined;
  await db?.close();
}
