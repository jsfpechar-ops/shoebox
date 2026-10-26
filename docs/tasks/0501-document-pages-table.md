# 0501: `document_pages` table and the upload batch id

Status: in-progress
Ticket: Page sorting (owner 2026-10-26) | Depends on: none | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A document can now be made of pages from several files (one invoice photographed as 3 pictures) or of a few pages of one big PDF. `document_pages` lists them in order, with the hints the page look-over found. `documents.upload_batch_id` groups the files of one upload drop.

## 2. Context

- Rule 3: a new table ships with RLS and its RLS test in the same PR. Tenant RLS is `select app.apply_tenant_rls('<table>');` (see `0006_documents_detail.sql`). The generic RLS suites (`packages/db/test/rls/*`) cover every tenant table that has a factory in `packages/testkit/src/factories/`, so registering a factory is the RLS test, plus the small migration test below.
- Rule 5: a schema change is a new migration plus a 05 edit (the orchestrator already edited 05 §4 in this branch).
- This lane's migration numbers are 0060-0064. `packages/db/migrations/meta/_journal.json` ends:

```json
    {
      "idx": 8,
      "version": "7",
      "when": 1760745600008,
      "tag": "0015_onboarding",
      "breakpoints": true
    }
  ]
}
```

- Factories: `packages/testkit/src/factories/document-details.ts` ends with `documentDetailFactories` whose last entry is `  ['review_questions', reviewQuestionFactory],\n];`. Factory style (from the same file):

```ts
/** `document_links` has no `id`: its key is (from_document_id, to_document_id, kind). */
export const documentLinkFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  from_document_id: ctx.ids.next(),
  to_document_id: ctx.ids.next(),
  kind: 'supports',
  ...overrides,
});
```

- Drizzle mirror: `packages/db/src/schema/documents.ts`, table `documents`, has the line `    pageTo: integer('page_to'),` and the index line `    index('documents_org_id_status_idx').on(t.orgId, t.status),`. `packages/db/src/schema/index.ts` has `export * from './documents';`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0060_document_pages.sql` | new | given below |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/db/src/schema/document-pages.ts` | new | Drizzle mirror |
| `packages/db/src/schema/index.ts` | edit | export it |
| `packages/db/src/schema/documents.ts` | edit | `uploadBatchId` column + index |
| `packages/testkit/src/factories/document-details.ts` | edit | `documentPageFactory` |
| `packages/db/test/migrations/document-pages.db.test.ts` | new | given below |

No other file may change.

## 4. Steps

1. New `packages/db/migrations/0060_document_pages.sql`:

```sql
-- 0060_document_pages (05 §4): the pages of a document, in order, when a document is made of
-- pages from several files or of part of one file (page sorting, briefs 0500-0509). No rows = the
-- whole source_file is the document (every document before 0060). Tenant RLS (05 §10.1).
create table document_pages (
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  position smallint not null check (position >= 1),
  source_file_id uuid not null references source_files(id),
  file_page smallint not null check (file_page >= 1),       -- 1-based page in the file; 1 for an image
  region text not null default '',                           -- '' = the whole page; else where ('top', 'left')
  supplier_key text not null default '',                     -- page look-over: IČO, or casefolded supplier name
  doc_number text not null default '',
  label_n smallint check (label_n >= 1),                     -- printed "page n of m"
  label_of smallint check (label_of >= 1),
  has_totals boolean not null default false,
  starts_document boolean not null default true,
  primary key (document_id, position)
);
create index on document_pages (org_id, source_file_id);

alter table documents add column upload_batch_id uuid;      -- one upload drop (all files of one POST)
create index documents_org_id_upload_batch_id_idx on documents (org_id, upload_batch_id);

select app.apply_tenant_rls('document_pages');
```

2. `_journal.json`: after the `0015_onboarding` entry add (comma after its `}`):

```json
    {
      "idx": 9,
      "version": "7",
      "when": 1760745600060,
      "tag": "0060_document_pages",
      "breakpoints": true
    }
```

Run `node -e "JSON.parse(require('fs').readFileSync('packages/db/migrations/meta/_journal.json','utf8'))" 2>&1 | tail -3` (expect no output).

3. New `packages/db/src/schema/document-pages.ts`:

```ts
// Drizzle mirror of migrations/0060_document_pages.sql. The SQL file is the source of truth.
import { boolean, index, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { documents, sourceFiles } from './documents';
import { organizations } from './tenancy';

export const documentPages = pgTable(
  'document_pages',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    sourceFileId: uuid('source_file_id')
      .notNull()
      .references(() => sourceFiles.id),
    filePage: smallint('file_page').notNull(),
    region: text('region').notNull().default(''),
    supplierKey: text('supplier_key').notNull().default(''),
    docNumber: text('doc_number').notNull().default(''),
    labelN: smallint('label_n'),
    labelOf: smallint('label_of'),
    hasTotals: boolean('has_totals').notNull().default(false),
    startsDocument: boolean('starts_document').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.position] }),
    index('document_pages_org_id_source_file_id_idx').on(t.orgId, t.sourceFileId),
  ],
);
```

If `organizations` is not exported from `./tenancy`, find its file with `grep -n "export const organizations" packages/db/src/schema/*.ts` and import from there.

4. `schema/index.ts`: add `export * from './document-pages';` after `export * from './documents';`.

5. `schema/documents.ts`: after `    pageTo: integer('page_to'),` add `    uploadBatchId: uuid('upload_batch_id'),`; after the `documents_org_id_status_idx` index line add `    index('documents_org_id_upload_batch_id_idx').on(t.orgId, t.uploadBatchId),`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` (expect no errors).

6. `document-details.ts`: add before `documentDetailFactories`:

```ts
/** `document_pages` has no `id`: its key is (document_id, position). */
export const documentPageFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  position: 1,
  source_file_id: ctx.ids.next(),
  file_page: 1,
  ...overrides,
});
```

and append `  ['document_pages', documentPageFactory],` as the last entry of `documentDetailFactories`. Run `pnpm --filter @shoebox/testkit test 2>&1 | tail -30` (expect passed).

7. New `packages/db/test/migrations/document-pages.db.test.ts` (do not edit it):

```ts
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
```

8. Run the DB tests if a database is available: `pnpm db:start 2>&1 | tail -5`, then `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30`. If `db:start` fails (no Docker), say so in the report: CI runs them.

## 5. Do not touch

Earlier migrations, `apps/`, other schema files. Rules 3, 5.

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/testkit test 2>&1 | tail -30`
- `pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` (needs `pnpm db:start`)
- `pnpm exec biome check packages/db packages/testkit 2>&1 | tail -30`

## 7. Acceptance

- [ ] Typecheck, testkit tests and biome clean; DB tests pass (or the report says the DB could not start).
- [ ] `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0501-report.md` (600 tokens at most) and set `Status: review`.
