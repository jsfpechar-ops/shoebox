import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0061: separate_document_pages and join_documents, run as the org's owner (RLS applies).
// Org prefix ffffffff so the RLS suite's cleanup never touches it.
const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'ffffffff-0000-4000-8000-000000000061';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a1';
const FILE_A = 'ffffffff-0000-4000-8000-0000000000f1';
const FILE_B = 'ffffffff-0000-4000-8000-0000000000f2';
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('0061: page fix functions', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

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
      if (e !== ROLLBACK) throw e;
    }
    return result as T;
  }

  async function doc(tx: TransactionSql, file: string, pages: number[]): Promise<string> {
    const [row] = await tx<{ id: string }[]>`insert into documents (org_id, source_file_id, status)
      values (${ORG}, ${file}, 'ready') returning id`;
    const id = row?.id ?? '';
    for (const [i, page] of pages.entries()) {
      await tx`insert into document_pages (org_id, document_id, position, source_file_id, file_page)
        values (${ORG}, ${id}, ${i + 1}, ${file}, ${page})`;
    }
    return id;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Pages', 'org-pages-0061', 'FFFFFFFF')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    for (const [id, pages] of [
      [FILE_A, 3],
      [FILE_B, 2],
    ] as const) {
      await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, page_count)
        values (${id}, ${ORG}, ${id.replace(/-/g, '').padEnd(64, '0')}, ${`org/${ORG}/files/${id}`},
          'application/pdf', 1, ${pages})`;
    }
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id = ${OWNER}`;
      await sql.end();
    }
  });

  it('separates a three-page document into three documents', async () => {
    const result = await asOwner(async (tx) => {
      const id = await doc(tx, FILE_A, [1, 2, 3]);
      const [row] = await tx<{ ids: string[] }[]>`select public.separate_document_pages(${id}) as ids`;
      const ids = row?.ids ?? [];
      const pages = await tx<{ n: number }[]>`select count(*)::int as n from document_pages
        where document_id = any(${ids})`;
      const statuses = await tx<{ status: string }[]>`select status from documents where id = any(${ids})`;
      return { first: ids[0] === id, count: ids.length, pages: pages[0]?.n, statuses };
    });
    expect(result).toMatchObject({ first: true, count: 3, pages: 3 });
    expect(result.statuses.every((s) => s.status === 'received')).toBe(true);
  });

  it('leaves a one-page document alone', async () => {
    const ids = await asOwner(async (tx) => {
      const id = await doc(tx, FILE_A, [1]);
      const [row] = await tx<{ ids: string[] }[]>`select public.separate_document_pages(${id}) as ids`;
      return row?.ids;
    });
    expect(ids).toEqual([]);
  });

  it('joins another document after this one and answers the question', async () => {
    const result = await asOwner(async (tx) => {
      const a = await doc(tx, FILE_A, [1]);
      const b = await doc(tx, FILE_B, [1, 2]);
      await tx`insert into review_questions (org_id, document_id, kind, payload)
        values (${ORG}, ${b}, 'same_invoice', ${tx.json({ other_document_id: a })})`;
      const [row] = await tx<{ ids: string[] }[]>`select public.join_documents(${a}, ${b}) as ids`;
      const pages = await tx<{ file_page: number; position: number }[]>`select position, file_page
        from document_pages where document_id = ${a} order by position`;
      const [other] = await tx<{ gone: boolean }[]>`select deleted_at is not null as gone
        from documents where id = ${b}`;
      const [question] = await tx<{ answered: boolean }[]>`select answered_at is not null as answered
        from review_questions where document_id = ${b}`;
      return { ids: row?.ids, a, pages, gone: other?.gone, answered: question?.answered };
    });
    expect(result.ids).toEqual([result.a]);
    expect(result.pages.map((p) => [p.position, p.file_page])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
    expect(result.gone).toBe(true);
    expect(result.answered).toBe(true);
  });

  it('joins documents from before page sorting using their page counts', async () => {
    const pages = await asOwner(async (tx) => {
      const a = await doc(tx, FILE_B, []);
      const b = await doc(tx, FILE_A, []);
      await tx`select public.join_documents(${a}, ${b})`;
      return tx<{ file: string; page: number }[]>`select source_file_id as file, file_page as page
        from document_pages where document_id = ${a} order by position`;
    });
    expect(pages.map((p) => `${p.file === FILE_B ? 'B' : 'A'}${p.page}`)).toEqual(['B1', 'B2', 'A1', 'A2', 'A3']);
  });

  it('refuses to join a document with itself', async () => {
    await expect(
      asOwner(async (tx) => {
        const a = await doc(tx, FILE_A, [1]);
        await tx`select public.join_documents(${a}, ${a})`;
      }),
    ).rejects.toMatchObject({ code: '22023' });
  });
});
