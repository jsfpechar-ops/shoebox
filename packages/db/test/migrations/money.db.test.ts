import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0020_money: the ten 05 §6 tables exist with RLS on, users cannot write statement_imports or
// match_suggestions, and the deferred foreign keys of 0005/0006 are in place.
const DATABASE_URL = process.env.DATABASE_URL;

const TABLES = [
  'money_accounts',
  'import_mappings',
  'spreadsheet_imports',
  'statement_imports',
  'transactions',
  'payment_links',
  'match_suggestions',
  'counterparty_aliases',
  'payment_orders',
  'payment_order_items',
];

describe.skipIf(DATABASE_URL === undefined)('0020: money tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await runMigrations(url);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('creates every table with RLS enabled', async () => {
    const rows = await sql<{ name: string; on: boolean }[]>`
      select relname as name, relrowsecurity as on from pg_class
      where relnamespace = 'public'::regnamespace and relname in ${sql(TABLES)}`;
    expect(rows.map((r) => r.name).sort()).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.on)).toBe(true);
  });

  it('gives users no write policy on statement_imports and match_suggestions', async () => {
    const rows = await sql<{ table: string }[]>`
      select tablename as table from pg_policies
      where schemaname = 'public' and tablename in ('statement_imports', 'match_suggestions')
        and policyname like '%\_write'`;
    expect(rows).toEqual([]);
  });

  it('keeps transactions unique per account and external id, and dedupe hash', async () => {
    const [unique] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_constraint
      where conrelid = 'public.transactions'::regclass and contype = 'u'`;
    expect(unique?.n).toBe(1);
    const idx = await sql`
      select 1 from pg_indexes where schemaname = 'public' and indexname = 'transactions_dedupe_hash'`;
    expect(idx).toHaveLength(1);
  });

  it('adds the foreign keys deferred by 0005 and 0006', async () => {
    const rows = await sql<{ name: string }[]>`
      select conname as name from pg_constraint
      where conname in ('documents_import_fk', 'review_questions_tx_fk') order by conname`;
    expect(rows.map((r) => r.name)).toEqual(['documents_import_fk', 'review_questions_tx_fk']);
  });
});
