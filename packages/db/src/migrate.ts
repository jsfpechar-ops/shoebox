import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Absolute path of `packages/db/migrations` (SQL files + `meta/_journal.json`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Schema that holds Drizzle's migration ledger (`drizzle.__drizzle_migrations`). */
export const MIGRATIONS_SCHEMA = 'drizzle';

/**
 * Applies every migration listed in `migrations/meta/_journal.json` that is not yet recorded,
 * in journal order, each in its own transaction. Forward-only. Safe to call twice.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
  } finally {
    await sql.end();
  }
}
