# 0032b: Drizzle mirror of 0006 and the documents-detail migration test

Status: review
Ticket: P0-DB-06 (part b of a/b) | Depends on: 0032a (same branch) | Base commit: head of task/0032-db-documents-detail after 0032a | Branch: task/0032-db-documents-detail | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/db/src/schema/document-details.ts` mirrors the seven tables of migration 0006 for typed queries (money, quantities and percentages as `numeric` strings, never floats), and `test/migrations/documents-detail.db.test.ts` pins the ticket's acceptance: the seven tables exist with the expected policies (`extraction_runs` without `_write`, `review_questions` with the accountant update policy), every money column is `numeric` with the 05 precision, the uniques, checks and enums reject what 05 forbids, `extraction_runs` is select-only for users, an accountant updates only the answer columns of `review_questions` while the owner and the service role update anything, and a document delete cascades into every detail table.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, quantities and unit prices `numeric(15,4)`, percentages `numeric(5,2)`, LLM cost `numeric(10,5)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory. `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`. The catalog already lists `extraction_runs` in `READ_ONLY_FOR_USERS` and `review_questions` in `ACCOUNTANT_WRITABLE` ("only on named columns, checked by their slice"): `roles.db.test.ts` skips `review_questions` in its accountant loop, so this slice adds the column case there (ticket acceptance).
- `packages/db` convention (`schema/documents.ts`, `schema/partners.ts`): "The SQL file is the source of truth for DDL; this file gives typed queries." Partial indexes, triggers, RLS and grants exist only in SQL; column checks, uniques and composite primary keys are mirrored. Index and constraint names in the mirror are the names Postgres generated for the unnamed lines of 05 (`<table>_<cols>_idx`, `<table>_<cols>_key`, `<table>_pkey`, `<table>_<col>_check`), so a future `drizzle-kit` diff stays quiet.
- Ticket acceptance (backlog P0-DB-06): "`roles.test.ts` case: accountant may update only `answer`, `answered_by`, `answered_at` on `review_questions`; `extraction_runs` select-only for users. RLS suite green for the seven tables." 0032a added the roles case; this brief's migration test pins the same behavior from a second angle (the owner, the accountant and the service role on one row) plus the structure of the seven tables. The file is `documents-detail.db.test.ts` so the `db` vitest project runs it and it skips without `DATABASE_URL` (as every db test).
- `numeric[]` (`document_fields.bbox`) is `numeric('bbox').array()`; `text[]` with default `'{}'` is `text(...).array().notNull().default([])` as in `schema/documents.ts`. `categories` (the FK target of `document_lines.category_code`) is exported from `schema/partners.ts`, `documents` from `schema/documents.ts`.
- **Default (confirm at gate):** the module is `schema/document-details.ts` (kebab-case file, camelCase exports `documentLinks`, `documentLines`, `documentVatSummary`, `documentFields`, `extractionRuns`, `validationResults`, `reviewQuestions`), next to `documents.ts`; both are re-exported from `schema/index.ts` and `src/index.ts`.
- Test data are placeholders (`TEST-0001`, `TEST-NOPE`, `Org Detail`); the test org prefix is `eeeeeeee` so neither the RLS suite's cleanup (`aaaaaaaa`/`bbbbbbbb`) nor `documents-core.db.test.ts` (`dddddddd`) touches it.

Anchors (branch `task/0032-db-documents-detail` after 0032a):

`packages/db/src/schema/index.ts` (step 2), line 3:

```ts
export * from './documents';
```

`packages/db/src/index.ts` (step 3), line 4:

```ts
export * from './schema/documents';
```

All code below was run by the brief writer on `origin/phase/0` at 363b48e (PR #56 merged: 0029a/b) against Postgres 16 (plain cluster + shim): migrations apply through `runMigrations`, `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned), `pii_guard` OK, `check:tenant-sql` exit 0.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/schema/document-details.ts` | create | Drizzle mirror of 0006 |
| `packages/db/src/schema/index.ts` | edit | export `./document-details` |
| `packages/db/src/index.ts` | edit | export `./schema/document-details` |
| `packages/db/test/migrations/documents-detail.db.test.ts` | create | 8 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 67–311
- Step 2 (no code block): lines 316–320
- Step 3 code: lines 327–332
- Step 4 code: lines 340–681

Setup: `git checkout task/0032-db-documents-detail && git log --oneline -1` → `0032a step 6`. `bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (already running is fine).

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0032b step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/src/schema/document-details.ts`

```ts
// Drizzle mirror of migrations/0006_documents_detail.sql (05 §4 Ingestion and documents, the seven
// detail tables). The SQL file is the source of truth for DDL; this file gives typed queries. The
// partial index, the accountant trigger, the RLS policies and the grants exist only in SQL. Money
// columns are numeric(15,2), quantities numeric(15,4), percentages numeric(5,2): strings in
// Drizzle, never floats.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import {
  docLinkKindEnum,
  fieldSourceEnum,
  lineTypeEnum,
  severityEnum,
  validationStateEnum,
  vatRateTypeEnum,
  vatTreatmentEnum,
} from './enums';
import { categories } from './partners';
import { authUsers, organizations } from './tenancy';

export const documentLinks = pgTable(
  'document_links',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fromDocumentId: uuid('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: uuid('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: docLinkKindEnum('kind').notNull(),
    note: text('note'),
    createdBy: text('created_by').notNull().default('system'),
  },
  (t) => [
    primaryKey({
      name: 'document_links_pkey',
      columns: [t.fromDocumentId, t.toDocumentId, t.kind],
    }),
    index('document_links_org_id_to_document_id_idx').on(t.orgId, t.toDocumentId),
  ],
);

export const documentLines = pgTable(
  'document_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    lineType: lineTypeEnum('line_type').notNull().default('item'),
    description: text('description'),
    code: text('code'),
    quantity: numeric('quantity', { precision: 15, scale: 4 }),
    unit: text('unit'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 4 }),
    net: numeric('net', { precision: 15, scale: 2 }),
    vat: numeric('vat', { precision: 15, scale: 2 }),
    gross: numeric('gross', { precision: 15, scale: 2 }),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull().default('none'),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }),
    vatTreatment: vatTreatmentEnum('vat_treatment'),
    categoryCode: text('category_code').references(() => categories.code),
    businessSharePct: numeric('business_share_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('100'),
    deductibility: text('deductibility'),
    coveredByDocumentId: uuid('covered_by_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    rcCommodityCode: text('rc_commodity_code'),
    classificationSource: fieldSourceEnum('classification_source'),
    classificationConfidence: numeric('classification_confidence', { precision: 4, scale: 3 }),
  },
  (t) => [
    unique('document_lines_document_id_position_key').on(t.documentId, t.position),
    index('document_lines_org_id_document_id_idx').on(t.orgId, t.documentId),
    check(
      'document_lines_deductibility_check',
      sql`${t.deductibility} in ('deductible','non_deductible','partially_deductible','not_applicable')`,
    ),
  ],
);

export const documentVatSummary = pgTable(
  'document_vat_summary',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    vatRateType: vatRateTypeEnum('vat_rate_type').notNull(),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }).notNull(),
    base: numeric('base', { precision: 15, scale: 2 }).notNull(),
    vat: numeric('vat', { precision: 15, scale: 2 }).notNull(),
    baseForeign: numeric('base_foreign', { precision: 15, scale: 2 }),
    vatForeign: numeric('vat_foreign', { precision: 15, scale: 2 }),
  },
  (t) => [
    primaryKey({
      name: 'document_vat_summary_pkey',
      columns: [t.documentId, t.vatRateType, t.vatRatePct],
    }),
  ],
);

export const documentFields = pgTable(
  'document_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    valueText: text('value_text'),
    valueJson: jsonb('value_json'),
    source: fieldSourceEnum('source').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    page: integer('page'),
    bbox: numeric('bbox').array(),
    extractionRunId: uuid('extraction_run_id'),
    isCurrent: boolean('is_current').notNull().default(true),
    setBy: uuid('set_by').references(() => authUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_fields_document_id_field_key_idx')
      .on(t.documentId, t.fieldKey)
      .where(sql`${t.isCurrent}`),
  ],
);

export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    method: fieldSourceEnum('method').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    attempt: smallint('attempt').notNull().default(1),
    inputMode: text('input_mode'),
    imageCount: smallint('image_count'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 5 }),
    escalationReasons: text('escalation_reasons').array().notNull().default([]),
    latencyMs: integer('latency_ms'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    rawResponsePath: text('raw_response_path'),
    batchId: uuid('batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('extraction_runs_org_id_document_id_idx').on(t.orgId, t.documentId),
    check(
      'extraction_runs_stage_check',
      sql`${t.stage} in ('split','classify','extract','categorize')`,
    ),
    check(
      'extraction_runs_input_mode_check',
      sql`${t.inputMode} in ('text+thumb','text+images','images','none')`,
    ),
  ],
);

export const validationResults = pgTable(
  'validation_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    severity: severityEnum('severity').notNull(),
    state: validationStateEnum('state').notNull().default('open'),
    fieldKeys: text('field_keys').array().notNull().default([]),
    params: jsonb('params').notNull().default({}),
    dismissReason: text('dismiss_reason'),
    resolvedBy: uuid('resolved_by').references(() => authUsers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('validation_results_document_id_rule_id_key').on(t.documentId, t.ruleId),
    index('validation_results_org_id_state_severity_idx').on(t.orgId, t.state, t.severity),
  ],
);

export const reviewQuestions = pgTable(
  'review_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    answer: jsonb('answer'),
    answeredBy: uuid('answered_by').references(() => authUsers.id),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_questions_org_id_answered_at_idx').on(t.orgId, t.answeredAt)],
);
```

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: edit `packages/db/src/schema/index.ts`

Before the `export * from './documents';` anchor line insert `export * from './document-details';`, so the file ends with five export lines: document-details, documents, enums, partners, tenancy.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 3: edit `packages/db/src/index.ts`

Before the `export * from './schema/documents';` anchor line insert `export * from './schema/document-details';`, so lines 3–8 read:

```ts
export * from './rls-catalog';
export * from './schema/document-details';
export * from './schema/documents';
export * from './schema/enums';
export * from './schema/partners';
export * from './schema/tenancy';
```

Command: `pnpm exec biome ci packages/db/src 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/db test 2>&1 | tail -4` (no database) → `28 passed | 59 skipped`. Commit.

### Step 4: create `packages/db/test/migrations/documents-detail.db.test.ts`

```ts
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { ACCOUNTANT_WRITABLE, READ_ONLY_FOR_USERS } from '../../src/rls-catalog';

// 0006_documents_detail (05 §4, §10.2): the seven detail tables, their policies (extraction_runs
// select-only for users; review_questions with the accountant update policy and the column
// trigger), the uniques and checks, the money columns as numeric, the partial index of
// document_fields and the cascades from documents. Migrates forward only (tenancy.db.test.ts owns
// the from-scratch run); its org uses the prefix eeeeeeee so the RLS suite's cleanup never touches it.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'eeeeeeee-0000-4000-8000-000000000001';
const OWNER = 'eeeeeeee-0000-4000-8000-0000000000a1';
const ACCOUNTANT = 'eeeeeeee-0000-4000-8000-0000000000a2';
const TABLES_0006 = [
  'document_fields',
  'document_lines',
  'document_links',
  'document_vat_summary',
  'extraction_runs',
  'review_questions',
  'validation_results',
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

describe.skipIf(DATABASE_URL === undefined)('0006: document detail tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let docId: string;

  /** Runs fn as `authenticated` with the JWT subject of uid and rolls back. */
  async function asUser<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true),
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

  function insertDoc(): Promise<{ id: string }[]> {
    return sql<
      { id: string }[]
    >`insert into documents (org_id, entry_mode) values (${ORG}, 'manual')
      returning id`;
  }

  function insertLine(cols: Record<string, unknown>): Promise<{ id: string }[]> {
    return sql<{ id: string }[]>`insert into document_lines ${sql({
      org_id: ORG,
      document_id: docId,
      position: 1,
      ...cols,
    })} returning id`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}), (${ACCOUNTANT}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Detail', 'org-detail-0006', 'EEEEEEEE')`;
    await sql`insert into memberships (org_id, user_id, role)
      values (${ORG}, ${OWNER}, 'owner'), (${ORG}, ${ACCOUNTANT}, 'accountant')`;
    docId = one(await insertDoc()).id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id in (${OWNER}, ${ACCOUNTANT})`;
      await sql.end();
    }
  });

  it('creates the seven tables with RLS and the expected policies', async () => {
    const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables
      where schemaname = 'public' and tablename = any(${[...TABLES_0006]}) order by 1`;
    expect(rows.map((r) => r.t)).toEqual([...TABLES_0006]);
    for (const table of TABLES_0006) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      const expected: string[][] = [
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ];
      if (table === 'extraction_runs') {
        expected.pop();
      }
      if (table === 'review_questions') {
        expected.splice(0, 0, ['review_questions_accountant_update', 'UPDATE']);
      }
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual(expected);
    }
    expect(READ_ONLY_FOR_USERS).toContain('extraction_runs');
    expect(ACCOUNTANT_WRITABLE).toContain('review_questions');
  });

  it('money and percentages are numeric, never floats (hard rule 1)', async () => {
    const cols = await sql<{ t: string; c: string; p: number; s: number }[]>`
      select table_name as t, column_name as c, numeric_precision as p, numeric_scale as s
      from information_schema.columns
      where table_schema = 'public' and table_name = any(${[...TABLES_0006]})
        and column_name in ('quantity','unit_price','net','vat','gross','vat_rate_pct',
          'business_share_pct','base','base_foreign','vat_foreign','cost_usd','confidence')
      order by 1, 2`;
    expect(cols.every((c) => c.p !== null)).toBe(true);
    const shape = (t: string, c: string) => {
      const col = cols.find((x) => x.t === t && x.c === c);
      return col === undefined ? null : `${col.p},${col.s}`;
    };
    expect(shape('document_lines', 'net')).toBe('15,2');
    expect(shape('document_lines', 'quantity')).toBe('15,4');
    expect(shape('document_lines', 'unit_price')).toBe('15,4');
    expect(shape('document_lines', 'business_share_pct')).toBe('5,2');
    expect(shape('document_vat_summary', 'base')).toBe('15,2');
    expect(shape('document_vat_summary', 'vat_rate_pct')).toBe('5,2');
    expect(shape('extraction_runs', 'cost_usd')).toBe('10,5');
    expect(shape('document_fields', 'confidence')).toBe('4,3');
    const floats = await sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = any(${[...TABLES_0006]})
        and data_type in ('real', 'double precision')`;
    expect(floats).toHaveLength(0);
  });

  it('document_lines: defaults, the position unique, the deductibility check, the categories FK', async () => {
    const line = one(await insertLine({ net: '100.00', vat: '21.00', gross: '121.00' }));
    const [d] = await sql`select line_type, vat_rate_type, business_share_pct::text as share,
      net::text as net from document_lines where id = ${line.id}`;
    expect(d).toEqual({ line_type: 'item', vat_rate_type: 'none', share: '100.00', net: '100.00' });
    expect(await code(insertLine({}))).toBe('23505');
    expect(await code(insertLine({ position: 2, deductibility: 'maybe' }))).toBe('23514');
    expect(await code(insertLine({ position: 2, deductibility: 'deductible' }))).toBeNull();
    expect(await code(insertLine({ position: 3, category_code: 'TEST-NOPE' }))).toBe('23503');
    expect(await code(insertLine({ position: 3, line_type: 'bonus' }))).toBe('22P02');
  });

  it('document_vat_summary and document_links: composite keys and the doc_link_kind enum', async () => {
    const recap = {
      org_id: ORG,
      document_id: docId,
      vat_rate_type: 'standard',
      vat_rate_pct: '21.00',
      base: '100.00',
      vat: '21.00',
    };
    expect(await code(sql`insert into document_vat_summary ${sql(recap)}`)).toBeNull();
    expect(await code(sql`insert into document_vat_summary ${sql(recap)}`)).toBe('23505');
    expect(
      await code(sql`insert into document_vat_summary ${sql({ ...recap, vat_rate_pct: '12.00' })}`),
    ).toBeNull();
    const other = one(await insertDoc()).id;
    const link = { org_id: ORG, from_document_id: docId, to_document_id: other, kind: 'supports' };
    expect(await code(sql`insert into document_links ${sql(link)}`)).toBeNull();
    expect(await code(sql`insert into document_links ${sql(link)}`)).toBe('23505');
    expect(
      await code(sql`insert into document_links ${sql({ ...link, kind: 'corrects' })}`),
    ).toBeNull();
    expect(await code(sql`insert into document_links ${sql({ ...link, kind: 'mentions' })}`)).toBe(
      '22P02',
    );
    const [l] = await sql`select created_by from document_links
      where from_document_id = ${docId} and to_document_id = ${other} and kind = 'supports'`;
    expect(l?.created_by).toBe('system');
  });

  it('document_fields: is_current default and the partial index; validation_results unique', async () => {
    const [f] =
      await sql`insert into document_fields (org_id, document_id, field_key, value_text, source, bbox)
      values (${ORG}, ${docId}, 'document_number', 'TEST-0001', 'rule', '{0.1,0.2,0.3,0.4}')
      returning is_current, bbox::text as bbox, extraction_run_id`;
    expect(f).toEqual({ is_current: true, bbox: '{0.1,0.2,0.3,0.4}', extraction_run_id: null });
    const [idx] = await sql`select indexdef as def from pg_indexes
      where schemaname = 'public' and indexname = 'document_fields_document_id_field_key_idx'`;
    expect(idx?.def).toContain('WHERE is_current');
    const vr = {
      org_id: ORG,
      document_id: docId,
      rule_id: 'MATH_VAT_RECAP',
      rule_version: 1,
      severity: 'warning',
    };
    const [v] =
      await sql`insert into validation_results ${sql(vr)} returning state, field_keys, params`;
    expect(v).toEqual({ state: 'open', field_keys: [], params: {} });
    expect(await code(sql`insert into validation_results ${sql(vr)}`)).toBe('23505');
    expect(
      await code(
        sql`insert into validation_results ${sql({ ...vr, rule_id: 'X', severity: 'fatal' })}`,
      ),
    ).toBe('22P02');
  });

  it('extraction_runs is select-only for users (05 §10.2); its stage and input_mode checks', async () => {
    const run = { org_id: ORG, document_id: docId, stage: 'extract', method: 'llm', ok: true };
    const r = one(
      await sql<{ id: string }[]>`insert into extraction_runs ${sql(run)} returning id`,
    );
    expect(await code(sql`insert into extraction_runs ${sql({ ...run, stage: 'ocr' })}`)).toBe(
      '23514',
    );
    expect(
      await code(sql`insert into extraction_runs ${sql({ ...run, input_mode: 'audio' })}`),
    ).toBe('23514');
    const seen = await asUser(
      OWNER,
      (tx) => tx`select id from extraction_runs where org_id = ${ORG}`,
    );
    expect(seen.map((x) => x.id)).toEqual([r.id]);
    expect(await code(asUser(OWNER, (tx) => tx`insert into extraction_runs ${tx(run)}`))).toBe(
      '42501',
    );
    const updated = await asUser(
      OWNER,
      (tx) => tx`update extraction_runs set ok = false where id = ${r.id} returning id`,
    );
    expect(updated).toHaveLength(0);
    const deleted = await asUser(
      OWNER,
      (tx) => tx`delete from extraction_runs where id = ${r.id} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('review_questions: the accountant answers, cannot change anything else; the service role can', async () => {
    const q = one(
      await sql<{ id: string }[]>`insert into review_questions (org_id, document_id, kind, payload)
        values (${ORG}, ${docId}, 'confirm_total', '{"field_key": "total_gross"}') returning id`,
    );
    const answered = await asUser(
      ACCOUNTANT,
      (
        tx,
      ) => tx`update review_questions set answer = '{"confirmed": true}', answered_by = ${ACCOUNTANT},
        answered_at = now() where id = ${q.id} returning answered_by`,
    );
    expect(answered.map((x) => x.answered_by)).toEqual([ACCOUNTANT]);
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) => tx`update review_questions set kind = 'other' where id = ${q.id}`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) => tx`update review_questions set payload = '{}' where id = ${q.id}`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) =>
            tx`insert into review_questions (org_id, kind, payload) values (${ORG}, 'x', '{}')`,
        ),
      ),
    ).toBe('42501');
    const deleted = await asUser(
      ACCOUNTANT,
      (tx) => tx`delete from review_questions where id = ${q.id} returning id`,
    );
    expect(deleted).toHaveLength(0);
    const owner = await asUser(
      OWNER,
      (tx) => tx`update review_questions set kind = 'other' where id = ${q.id} returning kind`,
    );
    expect(owner.map((x) => x.kind)).toEqual(['other']);
    const [svc] =
      await sql`update review_questions set kind = 'confirm_vat' where id = ${q.id} returning kind`;
    expect(svc?.kind).toBe('confirm_vat');
  });

  it('cascades: deleting a document removes its detail rows; covered_by is set null', async () => {
    const d = one(await insertDoc()).id;
    const fee = one(await insertDoc()).id;
    await sql`insert into document_lines (org_id, document_id, position) values (${ORG}, ${d}, 1)`;
    await sql`insert into document_lines (org_id, document_id, position, covered_by_document_id)
      values (${ORG}, ${fee}, 1, ${d})`;
    await sql`insert into document_vat_summary (org_id, document_id, vat_rate_type, vat_rate_pct, base, vat)
      values (${ORG}, ${d}, 'zero', '0.00', '50.00', '0.00')`;
    await sql`insert into document_fields (org_id, document_id, field_key, source) values (${ORG}, ${d}, 'duzp', 'llm')`;
    await sql`insert into extraction_runs (org_id, document_id, stage, method, ok) values (${ORG}, ${d}, 'classify', 'rule', true)`;
    await sql`insert into validation_results (org_id, document_id, rule_id, rule_version, severity)
      values (${ORG}, ${d}, 'DUP_PROBABLE', 1, 'blocking')`;
    await sql`insert into review_questions (org_id, document_id, kind, payload) values (${ORG}, ${d}, 'confirm_partner', '{}')`;
    await sql`insert into document_links (org_id, from_document_id, to_document_id, kind) values (${ORG}, ${fee}, ${d}, 'settles')`;
    await sql`delete from documents where id = ${d}`;
    for (const table of [
      'document_lines',
      'document_vat_summary',
      'document_fields',
      'extraction_runs',
      'validation_results',
      'review_questions',
    ]) {
      expect(await sql`select 1 from ${sql(table)} where document_id = ${d}`, table).toHaveLength(
        0,
      );
    }
    expect(await sql`select 1 from document_links where to_document_id = ${d}`).toHaveLength(0);
    const [left] =
      await sql`select covered_by_document_id as c from document_lines where document_id = ${fee}`;
    expect(left?.c).toBeNull();
  });
});
```

Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  11 passed (11)` and `Tests  95 passed (95)`. Then `pnpm exec biome ci packages/db 2>&1 | tail -3` → no errors, `pnpm check:tenant-sql 2>&1 | tail -3` → exit 0 and `python3 scripts/pii_guard.py --all packages/db/test/migrations/documents-detail.db.test.ts 2>&1 | tail -3` → `pii_guard: OK`. Commit. Write the report (§9). Owner merges the PR of `task/0032-db-documents-detail` into `phase/0`. `bash packages/db/scripts/local-pg.sh stop` at the very end.

## 5. Do not touch

`packages/db/migrations/**` (0032a owns 0006), `packages/db/scripts/**`, `packages/db/src/migrate.ts`, `packages/db/src/rls-catalog.ts`, `packages/db/src/tenant.ts`, `packages/db/src/schema/enums.ts`, `documents.ts`, `partners.ts`, `tenancy.ts`, `packages/db/test/rls/**`, `packages/db/test/migrations/tenancy.db.test.ts`, `partners.db.test.ts`, `documents-core.db.test.ts`, `packages/db/test/with-tenant.db.test.ts`, `packages/testkit/**`, `scripts/**`, `.github/**`, `docs/v3/**`. Hard rules 1 (every money column is `numeric`; `business_share_pct` default `'100'` is a string), 3, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database.

## 6. Commands

```
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 95 passed (11 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 67 skipped
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30                                         # exit 0
pnpm exec biome ci packages/db 2>&1 | tail -30                                              # No fixes applied, no errors
pnpm check:tenant-sql 2>&1 | tail -30                                                       # exit 0
python3 scripts/pii_guard.py --all packages/db/test/migrations/documents-detail.db.test.ts 2>&1 | tail -3   # pii_guard: OK
```

## 7. Acceptance

- [ ] `documents-detail.db.test.ts`: 8 passed with `DATABASE_URL`; the whole db suite 95 passed; `psql "$DATABASE_URL" -tAc "select count(*) from organizations where id::text like 'eeeeeeee-%'"` → `0` after the run.
- [ ] `grep -c "pgTable(" packages/db/src/schema/document-details.ts` → `7`; `grep -c "numeric(" packages/db/src/schema/document-details.ts` → `17`; `grep -c "doublePrecision\|real(" packages/db/src/schema/document-details.ts` → `0`.
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

Write `docs/tasks/0032b-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`schema/document-details.ts` against `0006_documents_detail.sql` column by column (nullability, defaults, `numeric` precision/scale, the enum columns `kind`, `line_type`, `vat_rate_type`, `vat_treatment`, `classification_source`, `source`, `method`, `severity`, `state`, the composite primary keys, the `on delete` modes), the accountant cases of `documents-detail.db.test.ts` (`answer`/`answered_by`/`answered_at` update returns the row; `kind` or `payload` update raises `42501`; insert `42501`; delete 0 rows; the owner and the service role change `kind`), the `extraction_runs` user case (`42501` on insert, 0 rows on update and delete, select works), the cascade list (six `document_id` tables plus `document_links.to_document_id`; `covered_by_document_id` set null).

## Owner steps

1. Review the PR of `task/0032-db-documents-detail` (0032a + 0032b) and merge it into `phase/0`.
