import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { READ_ONLY_FOR_USERS } from '../../src/rls-catalog';

// 0005_documents_core (05 §4, §10.2): the six tables, the semantic dedupe index, the entry_mode
// check, the document_status enum after the rename, ingest_items select-only for users, the
// named indexes and the updated_at triggers. Migrates forward only (tenancy.db.test.ts owns the
// from-scratch run); its org uses the prefix dddddddd so the RLS suite's cleanup never touches it.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'dddddddd-0000-4000-8000-000000000001';
const OWNER = 'dddddddd-0000-4000-8000-0000000000a1';
const TABLES_0005 = [
  'document_revisions',
  'documents',
  'expected_documents',
  'inbound_emails',
  'ingest_items',
  'source_files',
] as const;
const ROLLBACK = Symbol('rollback');

/** The first row of a result, which the test expects to exist. */
function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected one row');
  }
  return row;
}

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0005: ingestion and document core', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let partnerId: string;

  /** Runs fn as `authenticated` with the JWT subject of OWNER and rolls back. */
  async function asOwner<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        const claims = JSON.stringify({ sub: OWNER, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${OWNER}, true),
          set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        result = await fn(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return result as T;
  }

  function insertDoc(
    tx: Sql | TransactionSql,
    cols: Record<string, unknown>,
  ): Promise<{ id: string }[]> {
    return tx<{ id: string }[]>`insert into documents ${tx({ org_id: ORG, ...cols })} returning id`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Docs', 'org-docs-0005', 'DDDDDDDD')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    const [p] =
      await sql`insert into partners (org_id, name, ico) values (${ORG}, 'Dodavatel', '27074358') returning id`;
    partnerId = p?.id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id = ${OWNER}`;
      await sql.end();
    }
  });

  it('creates the six tables with RLS and the expected policies', async () => {
    const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables
      where schemaname = 'public' and tablename = any(${[...TABLES_0005]}) order by 1`;
    expect(rows.map((r) => r.t)).toEqual([...TABLES_0005]);
    for (const table of TABLES_0005) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      const expected = [
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ];
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual(table === 'ingest_items' ? expected.slice(0, 2) : expected);
    }
    expect(READ_ONLY_FOR_USERS).toContain('ingest_items');
  });

  it('documents_semantic_dedupe rejects a second active row with the same key', async () => {
    const key = { partner_id: partnerId, document_number: 'FV-2026-001', total_gross: '1210.00' };
    const first = one(await insertDoc(sql, { entry_mode: 'manual', ...key }));
    expect(await code(insertDoc(sql, { entry_mode: 'manual', ...key }))).toBe('23505');
    // Not active, or not keyed: supporting, duplicate, exempt, soft-deleted, no number.
    for (const extra of [
      { status: 'supporting' },
      { status: 'duplicate' },
      { semantic_dedupe_exempt: true },
      { deleted_at: new Date('2026-02-01T00:00:00Z') },
    ]) {
      expect(
        await code(insertDoc(sql, { entry_mode: 'manual', ...key, ...extra })),
        JSON.stringify(extra),
      ).toBeNull();
    }
    expect(
      await code(insertDoc(sql, { entry_mode: 'manual', ...key, document_number: null })),
    ).toBeNull();
    expect(
      await code(insertDoc(sql, { entry_mode: 'manual', ...key, total_gross: '1210.01' })),
    ).toBeNull();
    // Another org with the same key is a different document.
    await sql`delete from documents where id = ${first.id}`;
  });

  it('entry_mode: only captured requires source_file_id; a file page may hold several documents (0062)', async () => {
    expect(await code(insertDoc(sql, { entry_mode: 'captured' }))).toBe('23514');
    expect(await code(insertDoc(sql, { entry_mode: 'manual' }))).toBeNull();
    expect(await code(insertDoc(sql, { entry_mode: 'imported' }))).toBeNull();
    expect(await code(insertDoc(sql, { entry_mode: 'typed' }))).toBe('23514');
    const sf = one(
      await sql<
        { id: string }[]
      >`insert into source_files (org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${ORG}, ${'a'.repeat(64)}, 'x/y.pdf', 'application/pdf', 10, 'upload') returning id`,
    );
    expect(await code(insertDoc(sql, { source_file_id: sf?.id }))).toBeNull();
    expect(await code(insertDoc(sql, { source_file_id: sf?.id, page_from: 1 }))).toBeNull();
    expect(await code(insertDoc(sql, { source_file_id: sf?.id, page_from: 2 }))).toBeNull();
    expect(
      await code(
        sql`insert into source_files (org_id, sha256, storage_path, mime_type, byte_size, channel)
          values (${ORG}, ${'a'.repeat(64)}, 'x/z.pdf', 'application/pdf', 10, 'upload')`,
      ),
    ).toBe('23505');
  });

  it('documents.status accepts supporting and not rejected; updated_at is touched', async () => {
    expect(await code(insertDoc(sql, { entry_mode: 'manual', status: 'supporting' }))).toBeNull();
    expect(await code(insertDoc(sql, { entry_mode: 'manual', status: 'rejected' }))).toBe('22P02');
    const d = one(await insertDoc(sql, { entry_mode: 'manual' }));
    const [u] = await sql`update documents set summary_cs = 'x' where id = ${d.id}
      returning updated_at > created_at as touched, revision, rounding::text as rounding, class_rule_ids`;
    expect(u).toEqual({ touched: true, revision: 1, rounding: '0.00', class_rule_ids: [] });
  });

  it('ingest_items is select-only for users (05 §10.2): the owner reads, cannot write', async () => {
    const item = one(
      await sql<{ id: string }[]>`insert into ingest_items (org_id, origin, channel)
      values (${ORG}, 'upload', 'upload') returning id`,
    );
    const seen = await asOwner((tx) => tx`select id from ingest_items where org_id = ${ORG}`);
    expect(seen.map((r) => r.id)).toEqual([item?.id]);
    expect(
      await code(
        asOwner(
          (tx) =>
            tx`insert into ingest_items (org_id, origin, channel) values (${ORG}, 'upload', 'upload')`,
        ),
      ),
    ).toBe('42501');
    const updated = await asOwner(
      (tx) => tx`update ingest_items set state = 'uploaded' where id = ${item.id} returning id`,
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOwner(
      (tx) => tx`delete from ingest_items where id = ${item.id} returning id`,
    );
    expect(deleted).toHaveLength(0);
    // The owner writes documents and expected_documents as usual.
    const d = one(await insertDoc(sql, { entry_mode: 'manual' }));
    expect(
      await code(
        asOwner(
          (tx) => tx`insert into expected_documents (org_id, source_document_id, kind, expected_by)
            values (${ORG}, ${d.id}, 'invoice', '2026-03-01')`,
        ),
      ),
    ).toBeNull();
  });

  it('has the register and search indexes and the state check of ingest_items', async () => {
    const idx = await sql<{ name: string; def: string }[]>`select indexname as name, indexdef as def
      from pg_indexes where schemaname = 'public' and tablename = 'documents' order by indexname`;
    const names = idx.map((i) => i.name);
    for (const name of [
      'documents_semantic_dedupe',
      'documents_import_row',
      'documents_retention',
      'documents_register',
      'documents_search_trgm',
    ]) {
      expect(names).toContain(name);
    }
    expect(names).not.toContain('documents_source_page'); // dropped in 0062 (page sorting)
    expect(idx.find((i) => i.name === 'documents_search_trgm')?.def).toContain('USING gin');
    expect(idx.find((i) => i.name === 'documents_register')?.def).toContain(
      'COALESCE(duzp, issue_date, received_date) DESC',
    );
    expect(
      await code(
        sql`insert into ingest_items (org_id, origin, channel, state) values (${ORG}, 'upload', 'upload', 'done')`,
      ),
    ).toBe('23514');
    expect(
      await code(
        sql`insert into ingest_items (org_id, origin, channel, state) values (${ORG}, 'email_body', 'email', 'expired')`,
      ),
    ).toBeNull();
  });

  it('cascades: deleting a document removes its revisions and expected documents, keeps the source file', async () => {
    const sf = one(
      await sql<
        { id: string }[]
      >`insert into source_files (org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${ORG}, ${'b'.repeat(64)}, 'x/b.pdf', 'application/pdf', 10, 'upload') returning id`,
    );
    const d = one(await insertDoc(sql, { source_file_id: sf?.id }));
    await sql`insert into document_revisions (org_id, document_id, revision, snapshot) values (${ORG}, ${d.id}, 1, '{}')`;
    await sql`insert into expected_documents (org_id, source_document_id, kind, expected_by) values (${ORG}, ${d.id}, 'invoice', '2026-03-01')`;
    const item = one(
      await sql<
        { id: string }[]
      >`insert into ingest_items (org_id, origin, channel, duplicate_of_document_id)
      values (${ORG}, 'upload', 'upload', ${d.id}) returning id`,
    );
    await sql`delete from documents where id = ${d.id}`;
    expect(await sql`select 1 from document_revisions where document_id = ${d.id}`).toHaveLength(0);
    expect(
      await sql`select 1 from expected_documents where source_document_id = ${d.id}`,
    ).toHaveLength(0);
    const [left] =
      await sql`select duplicate_of_document_id as dup from ingest_items where id = ${item.id}`;
    expect(left?.dup).toBeNull();
    expect(await sql`select 1 from source_files where id = ${sf.id}`).toHaveLength(1);
  });
});
