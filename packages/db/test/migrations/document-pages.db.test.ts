import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0060_document_pages: the table, its key, RLS on, and documents.upload_batch_id.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined)('0060: document_pages', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await runMigrations(url);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('has its columns, RLS enabled and the primary key (document_id, position)', async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'document_pages' order by ordinal_position`;
    expect(columns.map((c) => c.column_name)).toEqual([
      'org_id',
      'document_id',
      'position',
      'source_file_id',
      'file_page',
      'region',
      'supplier_key',
      'doc_number',
      'label_n',
      'label_of',
      'has_totals',
      'starts_document',
    ]);
    const [rls] = await sql<{ on: boolean }[]>`
      select relrowsecurity as on from pg_class where oid = 'public.document_pages'::regclass`;
    expect(rls?.on).toBe(true);
    const [pk] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.document_pages'::regclass and contype = 'p'`;
    expect(pk?.def).toBe('PRIMARY KEY (document_id, "position")');
  });

  it('adds documents.upload_batch_id', async () => {
    const rows = await sql`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'documents' and column_name = 'upload_batch_id'`;
    expect(rows).toHaveLength(1);
  });
});
