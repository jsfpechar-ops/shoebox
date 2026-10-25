import { defineConfig } from 'drizzle-kit';

// Hand-written SQL migrations in ./migrations with a hand-maintained meta/_journal.json
// (names from 05: NNNN_name.sql). `drizzle-kit migrate` applies them; `generate` is not used.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './migrations',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  strict: true,
  verbose: true,
});
