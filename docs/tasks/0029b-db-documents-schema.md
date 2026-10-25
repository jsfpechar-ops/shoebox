# 0029b: Drizzle mirror of 0005 and the documents-core migration test

Status: todo
Ticket: P0-DB-05 (part b of a/b) | Depends on: 0029a (same branch) | Base commit: head of task/0029-db-documents-core after 0029a | Branch: task/0029-db-documents-core | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/db/src/schema/documents.ts` mirrors the six tables of migration 0005 for typed queries (money and FX as `numeric` strings, never floats), and `test/migrations/documents-core.db.test.ts` pins the ticket's acceptance: the semantic dedupe index rejects a second active row with the same key and lets `supporting`, `duplicate`, exempt and soft-deleted rows through; only `entry_mode = 'captured'` requires `source_file_id`; `documents.status` accepts `supporting` and not `rejected`; `ingest_items` is select-only for users; the named indexes exist; cascades behave as 05 says.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, FX `numeric(12,6)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory, and for any table without `org_id` that is not in `GLOBAL_TABLES` (whose grants it checks: `authenticated` has exactly `[SELECT]` or nothing, `anon` nothing). `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`.
- `packages/db` convention (`schema/tenancy.ts`, `schema/partners.ts`): "The SQL file is the source of truth for DDL; this file gives typed queries." Partial and expression indexes, triggers, RLS and grants exist only in SQL; column checks and uniques are mirrored. Index names in the mirror are the names Postgres generated for the unnamed `create index` lines of 05 (`<table>_<cols>_idx`, `<table>_<cols>_key`), so a future `drizzle-kit` diff stays quiet.
- Ticket acceptance (backlog P0-DB-05): "`packages/db/test/migrations/documents-core.test.ts`: semantic dedupe unique index rejects a second active row with the same key; `entry_mode` check (only `captured` requires `source_file_id`); `documents.status` accepts `supporting`, not `rejected`. `ingest_items` is select-only for users (05 §10.2); RLS suite green for the six tables." The file is `documents-core.db.test.ts` so the `db` vitest project runs it and it skips without `DATABASE_URL` (as every db test).
- Self-references (`ingest_items.parent_item_id`, `companion_of_item_id`) use `.references((): AnyPgColumn => ingestItems.id)`.
- `bit(64)` is `bit('phash', { dimensions: 64 })` from `drizzle-orm/pg-core` (same column type as 05; the `vector_extension` module name is Drizzle's, no extension is needed).

Anchors (branch `task/0029-db-documents-core` after 0029a):

`packages/db/src/schema/index.ts` (step 2), lines 3–4:

```ts
export * from './enums';
export * from './partners';
```

`packages/db/src/index.ts` (step 3), lines 3–4:

```ts
export * from './rls-catalog';
export * from './schema/enums';
```

All code below was run by the brief writer on `origin/phase/0` at cb71a1f (PR #49 merged: 0025a/b RLS suite, 0023c, 0027, 0026b) against Postgres 16 (plain cluster + shim): migrations apply from scratch through `runMigrations` and twice through `drizzle-kit migrate` (second run a no-op), `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/documents.ts` | create | Drizzle mirror of 0005 |
| `packages/db/src/schema/index.ts` | edit | export `./documents` |
| `packages/db/src/index.ts` | edit | export `./schema/documents` |
| `packages/db/test/migrations/documents-core.db.test.ts` | create | 7 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1: lines 65–398
- Step 2: lines 402–407
- Step 3: lines 408–418
- Step 4: lines 422–688

Setup: `git checkout task/0029-db-documents-core && git log --oneline -1` → `0029a step 5`. `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (already running is fine).

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0029b step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/src/schema/documents.ts`

```ts
// Drizzle mirror of migrations/0005_documents_core.sql (05 §4 Ingestion and documents, the core
// six tables). The SQL file is the source of truth for DDL; this file gives typed queries. The
// partial and expression indexes, the updated_at triggers, the RLS policies and the grants exist
// only in SQL. Money columns are numeric(15,2), FX numeric(12,6): strings in Drizzle, never floats.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bit,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  directionEnum,
  documentClassEnum,
  documentStatusEnum,
  fieldSourceEnum,
  taxDocStatusEnum,
} from './enums';
import { partners } from './partners';
import { authUsers, organizations } from './tenancy';

export const inboundEmails = pgTable(
  'inbound_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    fromAddress: text('from_address'),
    toAddress: text('to_address'),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    purpose: text('purpose').notNull().default('documents'),
    emlPath: text('eml_path').notNull(),
    bodyText: text('body_text'),
    bodyHtmlPath: text('body_html_path'),
    spamVerdict: text('spam_verdict'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    unique('inbound_emails_org_id_message_id_key').on(t.orgId, t.messageId),
    index('inbound_emails_org_id_received_at_idx').on(t.orgId, t.receivedAt),
    index('inbound_emails_org_id_from_address_received_at_idx').on(
      t.orgId,
      t.fromAddress,
      t.receivedAt,
    ),
    check('inbound_emails_purpose_check', sql`${t.purpose} in ('documents','bank_notice')`),
    check(
      'inbound_emails_spam_verdict_check',
      sql`${t.spamVerdict} in ('pass','spoof_fail','unknown')`,
    ),
  ],
);

export const sourceFiles = pgTable(
  'source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sha256: char('sha256', { length: 64 }).notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    originalFilename: text('original_filename'),
    filenameNfc: text('filename_nfc'),
    pageCount: integer('page_count'),
    hasTextLayer: boolean('has_text_layer'),
    hasEmbeddedIsdoc: boolean('has_embedded_isdoc'),
    textQuality: numeric('text_quality', { precision: 4, scale: 3 }),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    phash: bit('phash', { dimensions: 64 }),
    isEncrypted: boolean('is_encrypted').notNull().default(false),
    pdfActiveContent: boolean('pdf_active_content').notNull().default(false),
    scanStatus: text('scan_status').notNull().default('pending'),
    origin: text('origin').notNull().default('original'),
    inboundEmailId: uuid('inbound_email_id').references(() => inboundEmails.id),
    uploadedBy: uuid('uploaded_by').references(() => authUsers.id),
    channel: text('channel').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('source_files_org_id_sha256_key').on(t.orgId, t.sha256),
    index('source_files_org_id_idx').on(t.orgId).where(sql`${t.phash} is not null`),
    check(
      'source_files_scan_status_check',
      sql`${t.scanStatus} in ('pending','clean','infected','error')`,
    ),
    check(
      'source_files_origin_check',
      sql`${t.origin} in ('original','email_body_render','camera_bundle')`,
    ),
    check(
      'source_files_channel_check',
      sql`${t.channel} in ('upload','email','camera','api','import')`,
    ),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    entryMode: text('entry_mode').notNull().default('captured'),
    substituteReason: text('substitute_reason'),
    importId: uuid('import_id'),
    importRow: integer('import_row'),
    pageFrom: integer('page_from').notNull().default(1),
    pageTo: integer('page_to'),
    status: documentStatusEnum('status').notNull().default('received'),
    stageVersion: jsonb('stage_version').notNull().default({}),
    class: documentClassEnum('class').notNull().default('unknown'),
    classConfidence: numeric('class_confidence', { precision: 4, scale: 3 }),
    classSource: fieldSourceEnum('class_source'),
    classRuleIds: text('class_rule_ids').array().notNull().default([]),
    direction: directionEnum('direction'),
    taxDocStatus: taxDocStatusEnum('tax_doc_status').notNull().default('unknown'),
    partnerId: uuid('partner_id').references(() => partners.id),
    partnerSnapshot: jsonb('partner_snapshot'),
    buyerSnapshot: jsonb('buyer_snapshot'),
    documentNumber: text('document_number'),
    variableSymbol: text('variable_symbol'),
    constantSymbol: text('constant_symbol'),
    specificSymbol: text('specific_symbol'),
    orderNumber: text('order_number'),
    issueDate: date('issue_date'),
    duzp: date('duzp'),
    receivedDate: date('received_date'),
    dueDate: date('due_date'),
    servicePeriodFrom: date('service_period_from'),
    servicePeriodTo: date('service_period_to'),
    vatPointDate: date('vat_point_date'),
    currency: char('currency', { length: 3 }).notNull().default('CZK'),
    fxRate: numeric('fx_rate', { precision: 12, scale: 6 }),
    fxRateDate: date('fx_rate_date'),
    totalNet: numeric('total_net', { precision: 15, scale: 2 }),
    totalVat: numeric('total_vat', { precision: 15, scale: 2 }),
    totalGross: numeric('total_gross', { precision: 15, scale: 2 }),
    printedTotal: numeric('printed_total', { precision: 15, scale: 2 }),
    rounding: numeric('rounding', { precision: 15, scale: 2 }).notNull().default('0'),
    amountDue: numeric('amount_due', { precision: 15, scale: 2 }),
    paymentMethod: text('payment_method'),
    payToAccount: jsonb('pay_to_account'),
    isPaidPerDocument: boolean('is_paid_per_document'),
    paidAt: date('paid_at'),
    businessFlag: text('business_flag').notNull().default('business'),
    summaryCs: text('summary_cs'),
    semanticDedupeExempt: boolean('semantic_dedupe_exempt').notNull().default(false),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedBy: uuid('finalized_by').references(() => authUsers.id),
    revision: integer('revision').notNull().default(1),
    retentionUntil: date('retention_until'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_org_id_status_idx').on(t.orgId, t.status),
    index('documents_org_id_issue_date_idx').on(t.orgId, t.issueDate),
    check('documents_entry_mode_check', sql`${t.entryMode} in ('captured','manual','imported')`),
    check(
      'documents_substitute_reason_check',
      sql`${t.substituteReason} in ('lost','damaged','never_issued','other')`,
    ),
    check(
      'documents_payment_method_check',
      sql`${t.paymentMethod} in ('bank_transfer','card','cash','cod','platform_offset','other')`,
    ),
    check(
      'documents_business_flag_check',
      sql`${t.businessFlag} in ('business','personal','mixed','unknown')`,
    ),
    check(
      'documents_source_required',
      sql`${t.entryMode} <> 'captured' or ${t.sourceFileId} is not null`,
    ),
  ],
);

export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changedBy: uuid('changed_by').references(() => authUsers.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('document_revisions_document_id_revision_key').on(t.documentId, t.revision),
    index('document_revisions_org_id_document_id_idx').on(t.orgId, t.documentId),
  ],
);

/** Users only read it (05 §10.2); the worker writes it. */
export const ingestItems = pgTable(
  'ingest_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id'),
    origin: text('origin').notNull(),
    channel: text('channel').notNull(),
    parentItemId: uuid('parent_item_id').references((): AnyPgColumn => ingestItems.id, {
      onDelete: 'cascade',
    }),
    bundleId: uuid('bundle_id'),
    bundleIndex: smallint('bundle_index'),
    companionOfItemId: uuid('companion_of_item_id').references((): AnyPgColumn => ingestItems.id),
    inboundEmailId: uuid('inbound_email_id').references(() => inboundEmails.id, {
      onDelete: 'cascade',
    }),
    uploadedBy: uuid('uploaded_by').references(() => authUsers.id),
    originalFilename: text('original_filename'),
    filenameNfc: text('filename_nfc'),
    declaredMime: text('declared_mime'),
    sniffedFormat: text('sniffed_format'),
    sniffMismatch: boolean('sniff_mismatch').notNull().default(false),
    byteSize: bigint('byte_size', { mode: 'number' }),
    sha256: char('sha256', { length: 64 }),
    bodySha256: char('body_sha256', { length: 64 }),
    emailDisposition: text('email_disposition'),
    emailContentId: text('email_content_id'),
    stagingPath: text('staging_path'),
    state: text('state').notNull().default('pending_upload'),
    stateReason: text('state_reason'),
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    duplicateOfDocumentId: uuid('duplicate_of_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    duplicateInTrash: boolean('duplicate_in_trash').notNull().default(false),
    nearDuplicateCandidateId: uuid('near_duplicate_candidate_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingest_items_org_id_batch_id_idx').on(t.orgId, t.batchId),
    index('ingest_items_org_id_state_idx')
      .on(t.orgId, t.state)
      .where(sql`${t.state} in ('pending_upload','uploaded','processing')`),
    index('ingest_items_org_id_body_sha256_idx')
      .on(t.orgId, t.bodySha256)
      .where(sql`${t.bodySha256} is not null`),
    index('ingest_items_org_id_inbound_email_id_idx').on(t.orgId, t.inboundEmailId),
    check(
      'ingest_items_origin_check',
      sql`${t.origin} in ('upload','email_attachment','email_body','archive_member','camera_bundle','spreadsheet_import')`,
    ),
    check(
      'ingest_items_channel_check',
      sql`${t.channel} in ('upload','email','camera','api','import')`,
    ),
    check(
      'ingest_items_email_disposition_check',
      sql`${t.emailDisposition} in ('attachment','inline')`,
    ),
    check(
      'ingest_items_state_check',
      sql`${t.state} in ('pending_upload','uploaded','processing','accepted','exact_duplicate','companion','expanded','bundled','ignored','unsupported','too_large','infected','encrypted','quarantined','failed','expired')`,
    ),
  ],
);

export const expectedDocuments = pgTable(
  'expected_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id),
    expectedAmount: numeric('expected_amount', { precision: 15, scale: 2 }),
    currency: char('currency', { length: 3 }).notNull().default('CZK'),
    expectedBy: date('expected_by').notNull(),
    state: text('state').notNull().default('open'),
    fulfilledByDocumentId: uuid('fulfilled_by_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('expected_documents_source_document_id_kind_key').on(t.sourceDocumentId, t.kind),
    index('expected_documents_org_id_state_expected_by_idx').on(t.orgId, t.state, t.expectedBy),
    check('expected_documents_kind_check', sql`${t.kind} in ('invoice','final_invoice')`),
    check(
      'expected_documents_state_check',
      sql`${t.state} in ('open','fulfilled','dismissed','expired')`,
    ),
  ],
);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: edit `packages/db/src/schema/index.ts`

Before the `export * from './enums';` anchor line insert `export * from './documents';`, so the file ends with four export lines: documents, enums, partners, tenancy.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 3: edit `packages/db/src/index.ts`

Between the two anchor lines insert `export * from './schema/documents';`, so lines 3–7 read:

```ts
export * from './rls-catalog';
export * from './schema/documents';
export * from './schema/enums';
export * from './schema/partners';
export * from './schema/tenancy';
```

Command: `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no database) → `28 passed | 51 skipped`. Commit.

### Step 4: create `packages/db/test/migrations/documents-core.db.test.ts`

Full file; do not edit it:

```ts
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

  it('entry_mode: only captured requires source_file_id; a source file page is unique', async () => {
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
    expect(await code(insertDoc(sql, { source_file_id: sf?.id, page_from: 1 }))).toBe('23505');
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
      'documents_source_page',
      'documents_import_row',
      'documents_retention',
      'documents_register',
      'documents_search_trgm',
    ]) {
      expect(names).toContain(name);
    }
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
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  10 passed (10)` and `Tests  86 passed (86)`. Then `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors and `pnpm check:tenant-sql 2>&1 | tail -3` → exit 0. Commit. Write the report (§9). Owner merges the PR of `task/0029-db-documents-core` into `phase/0`. `bash packages/db/scripts/local-pg.sh stop` at the very end.

## 5. Do not touch

`packages/db/migrations/**` (0029a owns 0005), `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/rls-catalog.ts`, `packages/db/src/tenant.ts`, `packages/db/src/schema/enums.ts`, `partners.ts`, `tenancy.ts`, `packages/db/test/rls/**`, `packages/db/test/migrations/tenancy.db.test.ts`, `partners.db.test.ts`, `packages/db/test/with-tenant.db.test.ts`, `packages/testkit/**`, `scripts/**`, `.github/**`, `docs/v3/**`. Hard rules 1 (every money column is `numeric`, `rounding` default `'0'` is a string), 3, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database.

## 6. Commands

```
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 86 passed (10 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 58 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db 2>&1 | tail -30                                              # No fixes applied, no errors
pnpm check:tenant-sql 2>&1 | tail -30                                                       # exit 0
```

## 7. Acceptance

- [ ] `documents-core.db.test.ts`: 7 passed with `DATABASE_URL`; the whole db suite 86 passed; `psql "$DATABASE_URL" -tAc "select count(*) from organizations where id::text like 'dddddddd-%'"` → `0` after the run.
- [ ] `grep -c "pgTable(" packages/db/src/schema/documents.ts` → `6`; `grep -c "numeric(" packages/db/src/schema/documents.ts` → `11` (no `real`, `doublePrecision` or `number` mode on a money column: `grep -c "doublePrecision\|real(" packages/db/src/schema/documents.ts` → `0`).
- [ ] typecheck exit 0; `biome ci` clean; `pnpm check:tenant-sql` exit 0.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0029b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`schema/documents.ts` against `0005_documents_core.sql` column by column (nullability, defaults, `numeric` precision/scale, the enum columns `status`, `class`, `class_source`, `direction`, `tax_doc_status`, the `on delete` modes), the dedupe cases of `documents-core.db.test.ts` (a `supporting`/`duplicate`/exempt/soft-deleted duplicate must insert; an active one must not), the `ingest_items` user case (`42501` on insert, 0 rows on update and delete, select works).

## Owner steps

1. Review the PR of `task/0029-db-documents-core` (0029a + 0029b) and merge it into `phase/0`.
