# 0510: Database functions to separate and join pages

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0501 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When the automatic sorting got it wrong, the user fixes it with one click: "These are separate invoices" splits a document back into one document per page, and "Add a missing page" / "Yes, one invoice" joins two documents. The web app has no transactions, so both are Postgres functions (one transaction each, `security invoker` so RLS decides who may write). They return the documents to read again.

## 2. Context

- Tables: `documents` (`id, org_id, source_file_id, status, received_date, upload_batch_id, deleted_at`), `document_pages` (0060: `org_id, document_id, position, source_file_id, file_page, region, supplier_key, doc_number, label_n, label_of, has_totals, starts_document`), `source_files.page_count` (may be null), `review_questions` (`kind 'same_invoice'`, `document_id`, `answer jsonb`, `answered_by`, `answered_at`).
- RLS lets owner and member write tenant rows; a `security invoker` function runs with the caller's rights (pattern of `0015_onboarding.sql`: `language plpgsql volatile ... set search_path = public, pg_temp`, `revoke execute ... from public, anon` then `grant execute ... to authenticated`).
- This lane's migrations are 0060-0064. `packages/db/migrations/meta/_journal.json` ends with the `0060_document_pages` entry (`"idx": 9`) unless another lane added one after it: use the next idx and `"when"` = the output of `date +%s%3N`.
- Rule 5: a schema change also edits 05: add the two function names under the `document_pages` block in `docs/v3/05-data-model.md` (one comment line).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0061_document_page_actions.sql` | new | given below |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/db/test/migrations/document-page-actions.db.test.ts` | new | given below |
| `docs/v3/05-data-model.md` | edit | one comment line |

No other file may change.

## 4. Steps

1. New `packages/db/migrations/0061_document_page_actions.sql`:

```sql
-- 0061_document_page_actions: the user's fixes after page sorting (briefs 0510-0512). security
-- invoker: RLS decides (owner and member may write). Each returns the documents to read again.

-- "These are separate invoices": every page after the first becomes its own document.
create or replace function public.separate_document_pages(p_document_id uuid) returns uuid[]
  language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_doc documents%rowtype;
  v_page document_pages%rowtype;
  v_new uuid;
  v_ids uuid[];
begin
  select * into v_doc from documents
    where id = p_document_id and deleted_at is null and status <> 'finalized';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from document_pages where document_id = v_doc.id) < 2 then
    return '{}'::uuid[];
  end if;
  v_ids := array[v_doc.id];
  for v_page in
    select * from document_pages where document_id = v_doc.id and position > 1 order by position
  loop
    insert into documents (org_id, source_file_id, status, received_date, upload_batch_id)
      values (v_doc.org_id, v_page.source_file_id, 'received', v_doc.received_date, v_doc.upload_batch_id)
      returning id into v_new;
    insert into document_pages (org_id, document_id, position, source_file_id, file_page, region,
        supplier_key, doc_number, label_n, label_of, has_totals, starts_document)
      values (v_doc.org_id, v_new, 1, v_page.source_file_id, v_page.file_page, v_page.region,
        v_page.supplier_key, v_page.doc_number, v_page.label_n, v_page.label_of, v_page.has_totals,
        v_page.starts_document);
    v_ids := v_ids || v_new;
  end loop;
  delete from document_pages where document_id = v_doc.id and position > 1;
  update documents set status = 'received' where id = v_doc.id;
  return v_ids;
end $$;

-- "Add a missing page" / "Yes, one invoice": p_other's pages go after p_document_id's; p_other is
-- removed (soft delete) and open same_invoice questions of both are answered.
create or replace function public.join_documents(p_document_id uuid, p_other_id uuid) returns uuid[]
  language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_doc documents%rowtype;
  v_other documents%rowtype;
  v_max smallint;
begin
  if p_document_id = p_other_id then
    raise exception 'same_document' using errcode = '22023';
  end if;
  select * into v_doc from documents
    where id = p_document_id and deleted_at is null and status <> 'finalized';
  select * into v_other from documents
    where id = p_other_id and deleted_at is null and status <> 'finalized';
  if v_doc.id is null or v_other.id is null or v_doc.org_id <> v_other.org_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A document from before page sorting has no page rows: its whole file is its pages.
  if not exists (select 1 from document_pages where document_id = v_doc.id) then
    insert into document_pages (org_id, document_id, position, source_file_id, file_page)
      select v_doc.org_id, v_doc.id, g, v_doc.source_file_id, g
      from generate_series(1, coalesce((select page_count from source_files where id = v_doc.source_file_id), 1)) g;
  end if;
  select max(position) into v_max from document_pages where document_id = v_doc.id;
  if exists (select 1 from document_pages where document_id = v_other.id) then
    insert into document_pages (org_id, document_id, position, source_file_id, file_page, region,
        supplier_key, doc_number, label_n, label_of, has_totals, starts_document)
      select org_id, v_doc.id, v_max + position, source_file_id, file_page, region, supplier_key,
        doc_number, label_n, label_of, has_totals, starts_document
      from document_pages where document_id = v_other.id;
    delete from document_pages where document_id = v_other.id;
  else
    insert into document_pages (org_id, document_id, position, source_file_id, file_page)
      select v_doc.org_id, v_doc.id, v_max + g, v_other.source_file_id, g
      from generate_series(1, coalesce((select page_count from source_files where id = v_other.source_file_id), 1)) g;
  end if;
  update documents set deleted_at = now() where id = v_other.id;
  update documents set status = 'received' where id = v_doc.id;
  update review_questions
    set answer = '{"same": true}'::jsonb, answered_by = auth.uid(), answered_at = now()
    where kind = 'same_invoice' and answered_at is null and document_id in (v_doc.id, v_other.id);
  return array[v_doc.id];
end $$;

revoke execute on function public.separate_document_pages(uuid) from public, anon;
revoke execute on function public.join_documents(uuid, uuid) from public, anon;
grant execute on function public.separate_document_pages(uuid) to authenticated;
grant execute on function public.join_documents(uuid, uuid) to authenticated;
```

2. `_journal.json`: append the entry `{ "idx": <next>, "version": "7", "when": <date +%s%3N>, "tag": "0061_document_page_actions", "breakpoints": true }` after the last one (comma after the previous `}`). Check it parses: `node -e "JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8'))" 2>&1 | tail -3`.

3. New `packages/db/test/migrations/document-page-actions.db.test.ts` (do not edit it; `biome format --write` allowed):

```ts
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
```

4. `05-data-model.md`: below the line `create index on document_pages (org_id, source_file_id);` add `-- Fixes (0061, security invoker): separate_document_pages(document_id) → uuid[]; join_documents(document_id, other_id) → uuid[].`

5. Run the DB tests if possible: `pnpm db:start 2>&1 | tail -3` then `pnpm --filter @shoebox/db test -- document-page-actions 2>&1 | tail -30`. Without Docker, say so in the report (CI runs them).

## 5. Do not touch

Earlier migrations (forward-only), `apps/`. Rule 3 (RLS decides: never `security definer` here).

## 6. Commands

- `node -e "JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8'))" 2>&1 | tail -3`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- document-page-actions 2>&1 | tail -30` (needs `pnpm db:start`)
- `pnpm exec biome check packages/db 2>&1 | tail -30`
- `python3 scripts/context_lint.py 2>&1 | tail -5`

## 7. Acceptance

- [ ] The commands in §6 pass (DB test in CI if no Docker). `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0510-report.md` (600 tokens at most) and set `Status: review`.
