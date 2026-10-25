# 0029a: migration 0005 (ingestion and document core), factories, read-only RLS helper, RLS suite green

Status: todo
Ticket: P0-DB-05 (part a of a/b) | Depends on: 0028a/b merged | Base commit: head of phase/0 after the 0028 PR | Branch: task/0029-db-documents-core | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0005_documents_core` creates the six core tables of 05 §4 (`inbound_emails`, `source_files`, `documents`, `document_revisions`, `ingest_items`, `expected_documents`) with all their indexes (semantic dedupe, register, trigram search, the partial uniques) and RLS; `ingest_items` is select-only for users (05 §10.2) through a new helper `app.apply_tenant_rls_read_only()`, which later slices reuse for the other derived tables. The testkit gets the six factories, so the catalog-driven RLS suite is green; 05 §10.1 documents the helper. 0029b adds the Drizzle mirror and the migration test on the same branch.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, FX `numeric(12,6)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory, and for any table without `org_id` that is not in `GLOBAL_TABLES` (whose grants it checks: `authenticated` has exactly `[SELECT]` or nothing, `anon` nothing). `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`.
- 05 §4 DDL of the six tables: pasted verbatim into the migration of step 1 (differences from 05: the `updated_at` triggers on `documents`, `ingest_items`, `expected_documents`; the helper and the RLS calls). `document_links`, `document_lines`, `document_vat_summary`, `document_fields`, `extraction_runs`, `validation_results`, `review_questions` are P0-DB-06, not here. `documents.import_id` has no FK yet (05: "FK to spreadsheet_imports added in §6").
- 05 §10.2: "derived tables (`tax_ledger_entries`, `vat_ledger_entries`, `filing_entries`, `llm_usage_daily`, `extraction_runs`, `ingest_items`, `statement_imports`, `match_suggestions`) | users: select only; writes come from the worker (`app_worker`)". `rls-catalog.ts` lists `ingest_items` in `READ_ONLY_FOR_USERS` already: the meta-test requires that **no** user policy allows insert/update/delete on it, and `roles.db.test.ts` expects an owner insert to raise `42501` and owner update/delete to touch 0 rows. So the helper keeps the grants of a tenant table (RLS is the gate, not the grant: a revoked grant would raise `42501` on update instead of matching no row, which the suite does not expect; verified) and creates only `<t>_select` and `<t>_worker`.
- 05 §1 / 0001: `document_status` has `supporting`, not `rejected` (renamed 2026-10-18); `documents.status` is that enum, so `'rejected'` fails with `22P02`.
- 0001 already has `create extension if not exists pg_trgm` (needed by `documents_search_trgm`) and `btree_gist`.
- Factories (same design as 0028a): `document_revisions.document_id` and `expected_documents.source_document_id` get a fresh `ctx.ids.next()`; `ensureParentRows()` creates that document with `documentFactory` (`entry_mode = 'manual'`, so no `source_files` row is needed and nothing keys the dedupe index). `source_files.sha256` is derived from the id counter (unique per org), `inbound_emails.message_id` likewise. `documents.partner_id`, `source_file_id`, `inbound_email_id` stay null so the roles test's owner `delete` of parents is not blocked by a FK without cascade. Array columns (`class_rule_ids`) stay at their default.

Anchors (`origin/phase/0` after the 0028 PR):

`packages/db/migrations/meta/_journal.json` (step 2), the last entry:

```json
      "tag": "0004_partners_registries",
      "breakpoints": true
    }
  ]
```

`packages/testkit/src/factories/index.ts` (step 4), three anchors:

```ts
import { partnerFactories } from './partners';
```

```ts
export { partnerBankAccountFactory, partnerFactory, vendorProfileFactory } from './partners';
```

```ts
 * partners.ts covers 0004.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [...tenancyFactories, ...partnerFactories]) {
```

`docs/v3/05-data-model.md` §10.1 (step 5), the 3-line anchor inside the SQL block:

```sql
create policy documents_worker on documents for all to app_worker
  using (org_id = app.current_org_id())
  with check (org_id = app.current_org_id());
```

All code below was run by the brief writer on `origin/phase/0` at cb71a1f (PR #49 merged: 0025a/b RLS suite, 0023c, 0027, 0026b) against Postgres 16 (plain cluster + shim): migrations apply from scratch through `runMigrations` and twice through `drizzle-kit migrate` (second run a no-op), `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0005_documents_core.sql` | create | helper, 6 tables, indexes, triggers, RLS |
| `packages/db/migrations/meta/_journal.json` | edit | entry 4 |
| `packages/testkit/src/factories/documents.ts` | create | 6 factories |
| `packages/testkit/src/factories/index.ts` | edit | register them |
| `docs/v3/05-data-model.md` | edit | §10.1: the read-only helper (rule 5) |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1: lines 88–281
- Step 2: lines 285–301
- Step 3: lines 305–403
- Step 4: lines 407–431
- Step 5: lines 437–444

Setup (once): `git fetch origin phase/0 && git checkout -b task/0029-db-documents-core origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0004_partners_registries.sql` and `packages/db/src/schema/partners.ts` to exist: `ls packages/db/migrations packages/db/src/schema`; if not, STOP: 0028 is not merged). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0029a step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/migrations/0005_documents_core.sql`

```sql
-- 0005_documents_core: 05 §4 Ingestion and documents, the core six: inbound_emails, source_files,
-- documents, document_revisions, ingest_items, expected_documents, with their indexes (semantic
-- dedupe, register, search). The detail tables (document_links, document_lines, …) are the next
-- slice. Tenant RLS through app.apply_tenant_rls() (05 §10.1); ingest_items is select-only for
-- users (05 §10.2: writes come from the worker) through the new app.apply_tenant_rls_read_only().
-- documents.import_id gets its FK to spreadsheet_imports in the §6 slice. Forward-only.

-- Migration helper for the 05 §10.2 "users: select only" tables: RLS, <t>_select and <t>_worker,
-- no <t>_write. The grants stay as for every tenant table (RLS is the gate, not the grant): without
-- a write policy a user insert raises 42501 and a user update or delete matches no row. Re-runnable.
create function app.apply_tenant_rls_read_only(p_table text, p_org_column text default 'org_id')
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format(
    'create policy %I on public.%I for select using (%I in (select app.user_org_ids()))',
    p_table || '_select', p_table, p_org_column);
  execute format('drop policy if exists %I on public.%I', p_table || '_write', p_table);
  execute format('grant select, insert, update, delete on public.%I to authenticated', p_table);
  perform app.apply_worker_rls(p_table, p_org_column);
end
$$;

create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  message_id text not null, from_address text, to_address text, subject text,
  received_at timestamptz not null,
  purpose text not null default 'documents' check (purpose in ('documents','bank_notice')),
  eml_path text not null, body_text text, body_html_path text,
  spam_verdict text check (spam_verdict in ('pass','spoof_fail','unknown')),   -- spoof_fail → quarantined (ADR-005)
  processed_at timestamptz,
  unique (org_id, message_id)
);
create index on inbound_emails (org_id, received_at);
create index on inbound_emails (org_id, from_address, received_at);

create table source_files (                          -- content-addressed blobs
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sha256 char(64) not null,
  storage_path text not null, mime_type text not null, byte_size bigint not null,
  original_filename text, filename_nfc text,         -- original bytes kept; NFC for display (never a dedupe key)
  page_count integer, has_text_layer boolean, has_embedded_isdoc boolean,
  text_quality numeric(4,3),                         -- text-layer quality 0..1 (M01 §4.4; also read by M02)
  image_width integer, image_height integer,
  phash bit(64),                                     -- dHash for raster sources (M01 §4.6.2): bit_count(phash # $1) <= 6
  is_encrypted boolean not null default false,
  pdf_active_content boolean not null default false,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','error')),
  origin text not null default 'original' check (origin in ('original','email_body_render','camera_bundle')),
  inbound_email_id uuid references inbound_emails(id),
  uploaded_by uuid references auth.users(id),
  channel text not null check (channel in ('upload','email','camera','api','import')),
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);
create index on source_files (org_id) where phash is not null;

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_file_id uuid references source_files(id),                 -- null only for entry_mode manual (no photo) / imported
  entry_mode text not null default 'captured' check (entry_mode in ('captured','manual','imported')),   -- 04 §2.2a
  substitute_reason text check (substitute_reason in ('lost','damaged','never_issued','other')),       -- náhradní doklad
  import_id uuid,                                                  -- FK to spreadsheet_imports added in §6
  import_row integer,
  page_from integer not null default 1, page_to integer,          -- for split multi-document PDFs
  status document_status not null default 'received',
  stage_version jsonb not null default '{}',                       -- {split:1, classify:3, extract:5, validate:'<hash>', ledger:{v,h,build_version}}
  class document_class not null default 'unknown',
  class_confidence numeric(4,3),
  class_source field_source,                                       -- rule | llm | llm_escalated | user
  class_rule_ids text[] not null default '{}',                     -- e.g. {R07,F_NOT_TAX_PHRASE}
  direction direction,
  tax_doc_status tax_doc_status not null default 'unknown',
  partner_id uuid references partners(id),
  partner_snapshot jsonb,                                          -- name/ico/dic/address as printed
  buyer_snapshot jsonb,                                            -- buyer as printed (entity match)
  document_number text,                                            -- supplier's number (evidence no.)
  variable_symbol text, constant_symbol text, specific_symbol text, order_number text,
  issue_date date, duzp date, received_date date, due_date date,
  service_period_from date, service_period_to date,
  vat_point_date date,                                             -- derived (04 §3.3)
  currency char(3) not null default 'CZK',
  fx_rate numeric(12,6), fx_rate_date date,
  total_net numeric(15,2), total_vat numeric(15,2), total_gross numeric(15,2),
  printed_total numeric(15,2), rounding numeric(15,2) not null default 0,
  amount_due numeric(15,2),                                        -- platform/settlement statements: net payout (M02 §3)
  payment_method text check (payment_method in ('bank_transfer','card','cash','cod','platform_offset','other')),
  pay_to_account jsonb,                                            -- {account, bank_code, iban, bic}
  is_paid_per_document boolean,                                    -- "zaplaceno kartou", "Nehraďte"
  paid_at date,                                                    -- derived from payment links (M07) or document evidence
  business_flag text not null default 'business' check (business_flag in ('business','personal','mixed','unknown')),
  summary_cs text,                                                 -- one-sentence plain-language summary (M04 §4.4)
  semantic_dedupe_exempt boolean not null default false,           -- user said "Není duplicitní" (M01 §4.6.3)
  finalized_at timestamptz, finalized_by uuid references auth.users(id),
  revision integer not null default 1,
  retention_until date,                                            -- set on finalize (M12 §4.6)
  deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint documents_source_required check (entry_mode <> 'captured' or source_file_id is not null)
);
create index on documents (org_id, status);
create index on documents (org_id, issue_date);
create unique index documents_semantic_dedupe on documents (org_id, partner_id, document_number, total_gross)
  where deleted_at is null and status not in ('duplicate','supporting') and document_number is not null
    and not semantic_dedupe_exempt;
create unique index documents_source_page on documents (source_file_id, page_from) where deleted_at is null;
create unique index documents_import_row on documents (import_id, import_row) where import_id is not null;
create index documents_retention on documents (retention_until) where finalized_at is not null;
create index documents_register on documents (org_id, coalesce(duzp, issue_date, received_date) desc, id)   -- = M09 doc_date; immutable expression
  where deleted_at is null;
create index documents_search_trgm on documents using gin
  ((coalesce(document_number,'') || ' ' || coalesce(variable_symbol,'') || ' ' || coalesce(partner_snapshot->>'name','')) gin_trgm_ops);
create trigger documents_touch_updated_at before update on documents
  for each row execute function app.touch_updated_at();

create table document_revisions (                                   -- snapshot of a finalized document before an edit (03 §3, M04 §4.14)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  revision integer not null,
  snapshot jsonb not null,                                          -- header + lines + classification at that revision (archival)
  changed_by uuid references auth.users(id), reason text,
  created_at timestamptz not null default now(),
  unique (document_id, revision)
);
create index on document_revisions (org_id, document_id);

create table ingest_items (                                         -- every arrival, "nothing lost" (M01 §1)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  batch_id uuid,                                                    -- upload batch; null for e-mail
  origin text not null check (origin in ('upload','email_attachment','email_body','archive_member','camera_bundle','spreadsheet_import')),
  channel text not null check (channel in ('upload','email','camera','api','import')),
  parent_item_id uuid references ingest_items(id) on delete cascade,
  bundle_id uuid, bundle_index smallint,
  companion_of_item_id uuid references ingest_items(id),
  inbound_email_id uuid references inbound_emails(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  original_filename text, filename_nfc text,
  declared_mime text, sniffed_format text, sniff_mismatch boolean not null default false,
  byte_size bigint, sha256 char(64), body_sha256 char(64),
  email_disposition text check (email_disposition in ('attachment','inline')), email_content_id text,
  staging_path text,
  state text not null default 'pending_upload' check (state in ('pending_upload','uploaded','processing','accepted',
    'exact_duplicate','companion','expanded','bundled','ignored','unsupported','too_large','infected','encrypted',
    'quarantined','failed','expired')),
  state_reason text,                                                -- i18n key suffix, e.g. 'decoration','inline_image'
  source_file_id uuid references source_files(id),
  duplicate_of_document_id uuid references documents(id) on delete set null,
  duplicate_in_trash boolean not null default false,
  near_duplicate_candidate_id uuid references documents(id) on delete set null,   -- read by M03 DUP_PROBABLE
  attempts smallint not null default 0, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on ingest_items (org_id, batch_id);
create index on ingest_items (org_id, state) where state in ('pending_upload','uploaded','processing');
create index on ingest_items (org_id, body_sha256) where body_sha256 is not null;
create index on ingest_items (org_id, inbound_email_id);
create trigger ingest_items_touch_updated_at before update on ingest_items
  for each row execute function app.touch_updated_at();

create table expected_documents (                                   -- expected-invoice reminders (M01 §4.9; read by M07 radar, M10)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_document_id uuid not null references documents(id) on delete cascade,  -- order confirmation / proforma
  kind text not null check (kind in ('invoice','final_invoice')),
  partner_id uuid references partners(id),
  expected_amount numeric(15,2), currency char(3) not null default 'CZK',
  expected_by date not null,
  state text not null default 'open' check (state in ('open','fulfilled','dismissed','expired')),
  fulfilled_by_document_id uuid references documents(id) on delete set null,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (source_document_id, kind)
);
create index on expected_documents (org_id, state, expected_by);
create trigger expected_documents_touch_updated_at before update on expected_documents
  for each row execute function app.touch_updated_at();

-- RLS (05 §10.1 default write roles owner, member; 05 §10.2 ingest_items users: select only).
select app.apply_tenant_rls('inbound_emails');
select app.apply_tenant_rls('source_files');
select app.apply_tenant_rls('documents');
select app.apply_tenant_rls('document_revisions');
select app.apply_tenant_rls_read_only('ingest_items');
select app.apply_tenant_rls('expected_documents');
```

Command: `grep -c "^select app.apply_tenant_rls" packages/db/migrations/0005_documents_core.sql` → `6`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor (§2) with:

```json
      "tag": "0004_partners_registries",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1760745600004,
      "tag": "0005_documents_core",
      "breakpoints": true
    }
  ]
```

Command: `python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))'` → `5`. Commit.

### Step 3: create `packages/testkit/src/factories/documents.ts`

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §4 core tables (migration 0005): inbound_emails, source_files, documents,
 * document_revisions, ingest_items, expected_documents. Columns are snake_case as in SQL. A child
 * row points its foreign key at a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()`
 * creates that parent with the parent's factory. Array columns stay at their SQL default.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** 64 hex digits derived from the id, so (org_id, sha256) stays unique per build. */
function sha256Of(id: string): string {
  return counterOf(id).toString(16).padStart(64, '0');
}

export const inboundEmailFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    message_id: `<${counterOf(id)}@example.test>`,
    from_address: 'faktury@example.test',
    received_at: new Date(ctx.clock.now()).toISOString(),
    eml_path: `${ctx.orgId}/emails/${id}.eml`,
    ...overrides,
  };
};

export const sourceFileFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    sha256: sha256Of(id),
    storage_path: `${ctx.orgId}/files/${id}.pdf`,
    mime_type: 'application/pdf',
    byte_size: 1024,
    channel: 'upload',
    ...overrides,
  };
};

/** `documents`: a manual entry (no source file), nothing that the dedupe index would key on. */
export const documentFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  entry_mode: 'manual',
  issue_date: '2026-01-15',
  currency: 'CZK',
  ...overrides,
});

export const documentRevisionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  revision: 1,
  snapshot: {},
  ...overrides,
});

export const ingestItemFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    origin: 'upload',
    channel: 'upload',
    original_filename: `scan-${counterOf(id)}.pdf`,
    ...overrides,
  };
};

export const expectedDocumentFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  source_document_id: ctx.ids.next(),
  kind: 'invoice',
  expected_by: '2026-02-28',
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const documentFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['inbound_emails', inboundEmailFactory],
  ['source_files', sourceFileFactory],
  ['documents', documentFactory],
  ['document_revisions', documentRevisionFactory],
  ['ingest_items', ingestItemFactory],
  ['expected_documents', expectedDocumentFactory],
];
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/testkit/src/factories/index.ts` (three replacements, anchors in §2)

(a) Before the `import { partnerFactories } from './partners';` anchor insert `import { documentFactories } from './documents';` (first line of the file).

(b) Before the `export { partnerBankAccountFactory, … } from './partners';` anchor insert:

```ts
export {
  documentFactory,
  documentRevisionFactory,
  expectedDocumentFactory,
  inboundEmailFactory,
  ingestItemFactory,
  sourceFileFactory,
} from './documents';
```

(c) The 4-line anchor becomes:

```ts
 * partners.ts covers 0004, documents.ts covers 0005.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [...tenancyFactories, ...partnerFactories, ...documentFactories]) {
```

The file is then 33 lines (`wc -l`).

Command: `pnpm --filter @shoebox/testkit test 2>&1 | tail -4` → `Tests  85 passed (85)`; `pnpm exec biome ci packages/testkit 2>&1 | tail -3` → no errors; then `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  9 passed (9)` and `Tests  79 passed (79)` (the suite now covers 12 tenant tables). Commit.

### Step 5: edit `docs/v3/05-data-model.md` §10.1

After the 3-line anchor (the `documents_worker` policy, still inside the ```sql block) add two comment lines:

```
-- 05 §10.2 "users: select only" tables call app.apply_tenant_rls_read_only(table, org_column) instead (since 0005_documents_core):
-- <t>_select and <t>_worker, no <t>_write; grants unchanged, so a user insert raises 42501 and a user update/delete matches no row.
```

Command: `python3 scripts/context_lint.py 2>&1 | tail -3` → OK. Commit. Write the report (§9) and continue with 0029b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/0001_*.sql` to `0004_*.sql`, `packages/db/scripts/**`, `packages/db/src/**` (0029b adds the Drizzle mirror), `packages/db/test/**` (the suite is catalog-driven; 0029b adds the migration test), `packages/testkit/src/factories/registry.ts`, `tenancy.ts`, `partners.ts`, `packages/testkit/test/**`, `scripts/**`, `.github/**`, `docs/v3/**` except the two §10.1 lines. Hard rules 1, 3, 5, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database. The seven P0-DB-06 tables are not created here.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                   # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 79 passed (9 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 51 skipped
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                         # 85 passed
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                    # exit 0
pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -30                             # No fixes applied, no errors
python3 scripts/context_lint.py 2>&1 | tail -30                                             # OK
```

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"` → `5`; `select count(*) from pg_tables where schemaname='public'` → `16`.
- [ ] `psql "$DATABASE_URL" -tAc "select policyname from pg_policies where tablename='ingest_items' order by 1"` → `ingest_items_select`, `ingest_items_worker` (no `_write`); the other five tables have all three.
- [ ] `psql "$DATABASE_URL" -tAc "select indexname from pg_indexes where tablename='documents' order by 1"` contains `documents_semantic_dedupe`, `documents_source_page`, `documents_import_row`, `documents_retention`, `documents_register`, `documents_search_trgm`.
- [ ] `meta`, `isolation`, `roles`, `worker` tests green with 12 tenant tables; `tenancy.db.test.ts` green after a from-scratch run.
- [ ] `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts` → `1`; `grep -c "apply_tenant_rls_read_only" docs/v3/05-data-model.md` → `1`.

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

Write `docs/tasks/0029a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`0005_documents_core.sql` column by column against 05 §4 (money `numeric(15,2)`, `fx_rate numeric(12,6)`, legal dates `date`, the four check lists of `ingest_items`, the `documents_source_required` check, the predicates of `documents_semantic_dedupe` and `documents_source_page`), `app.apply_tenant_rls_read_only()` (no `_write` policy; same grants as `apply_tenant_rls`), the six RLS calls at the end (`ingest_items` must be the read-only one).

## Owner steps

None.
