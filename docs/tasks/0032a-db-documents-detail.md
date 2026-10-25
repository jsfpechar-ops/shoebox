# 0032a: migration 0006 (document detail tables), factories, accountant column case, RLS suite green

Status: review
Ticket: P0-DB-06 (part a of a/b) | Depends on: 0029a/b merged (PR #56) | Base commit: head of phase/0 after the 0029 PR | Branch: task/0032-db-documents-detail | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Migration `0006_documents_detail` creates the seven detail tables of 05 §4 (`document_links`, `document_lines`, `document_vat_summary`, `document_fields`, `extraction_runs`, `validation_results`, `review_questions`) with their indexes and RLS; `extraction_runs` is select-only for users (05 §10.2, `app.apply_tenant_rls_read_only()`); `review_questions` gets the accountant's column-level update right (an update policy plus a before-update trigger). The testkit gets the seven factories, `roles.db.test.ts` gets the ticket's accountant case, and 05 §10.2 names the mechanism. 0032b adds the Drizzle mirror and the migration test on the same branch.

## 2. Context

Rules (AGENTS.md, rules.md Database), pasted:

- Hard rule 1: money is never a float; money columns are `numeric(15,2)`, quantities and unit prices `numeric(15,4)`, percentages `numeric(5,2)`, LLM cost `numeric(10,5)`, timestamps `timestamptz`, legal dates `date`.
- Hard rule 3: "Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR." rules.md: "Every tenant table has `org_id`, RLS enabled and policies through `app.user_org_ids()`, and a case in the RLS test suite in the same PR. Global tables (listed in 05) have no `org_id` and are read-only to app roles." Drizzle migrations in `packages/db/migrations/NNNN_name.sql`, forward-only, names exactly as in 05.
- Hard rule 5: "A schema change is a new migration plus a 05 edit." Hard rule 7: no new dependency. Hard rule 8: never push to `main`.
- The RLS suite (0025a/b, merged) is catalog-driven: `packages/db/test/rls/meta.db.test.ts` fails for any public table with `org_id` that lacks RLS, `<t>_select`, `<t>_worker`, a user write policy (unless the table is in `READ_ONLY_FOR_USERS` of `packages/db/src/rls-catalog.ts`) or a testkit factory. `isolation.db.test.ts`, `roles.db.test.ts` and `worker.db.test.ts` build one factory row per tenant table and org and check every role. So every new tenant table needs a factory in `packages/testkit/src/factories/` registered in `factories/index.ts`. The catalog already lists `extraction_runs` in `READ_ONLY_FOR_USERS` and `review_questions` in `ACCOUNTANT_WRITABLE` ("only on named columns, checked by their slice"): `roles.db.test.ts` skips `review_questions` in its accountant loop, so this slice adds the column case there (ticket acceptance).
- 05 §4 DDL of the seven tables: pasted verbatim into the migration of step 1 (only additions: the accountant trigger and the RLS calls). `document_lines.category_code` references `categories` (global, 0004). `document_fields.extraction_run_id` and `review_questions.transaction_id` have no FK yet (05: "FK to transactions added in §6"). `document_links` and `document_vat_summary` have no `id`: composite primary keys, as in 05.
- 05 §10.2: `extraction_runs` is a derived table, "users: select only; writes come from the worker": `app.apply_tenant_rls_read_only()` (0005). `review_questions`: "accountant may update only `answer`, `answered_by`, `answered_at`" and "column-level rules use `with check` or a trigger". **Default (confirm at gate):** an extra permissive policy `review_questions_accountant_update` (for update, `app.user_has_role(org_id, '{accountant}')`) plus a before-update trigger `review_questions_accountant_columns` that raises `insufficient_privilege` (SQLSTATE `42501`, the code the suite expects for a refused write) when an accountant of the row's org changes any column other than those three. A policy cannot compare old and new values, so the trigger is the only RLS-compatible way; owners, members, the worker and the service role pass it (`app.user_has_role` is false when `auth.uid()` is null). The accountant has no insert or delete right (the `_write` policy stays owner, member), so an accountant insert raises `42501` and a delete matches no row.
- **Default (confirm at gate):** the 05 edit is one row of §10.2 naming the policy and the trigger (step 6); the seven tables themselves are unchanged in 05.
- Factories (same design as 0029a): every `document_id` (and both ends of a `document_links` row) gets a fresh `ctx.ids.next()`; `ensureParentRows()` creates that document with `documentFactory` (`entry_mode = 'manual'`). `category_code`, `covered_by_document_id`, `set_by`, `resolved_by`, `answered_by` stay null so the roles test's owner `delete` of parents is never blocked. Money is a string (`'100.00'`). Test values are placeholders (`TEST-0001`, `TEST line`); no real names, IBANs or ICOs.
- `roles.db.test.ts` `updateCount()` runs `update <t> set org_id = org_id`, which changes nothing, so the generic owner/member loop passes the trigger; the accountant loop filters `review_questions` out, which is why step 5 adds the explicit case.

Anchors (`origin/phase/0` after the 0029 PR, #56):

`packages/db/migrations/meta/_journal.json` (step 2), the last entry:

```json
      "tag": "0005_documents_core",
      "breakpoints": true
    }
  ]
```

`packages/testkit/src/factories/index.ts` (step 4), three anchors:

```ts
import { documentFactories } from './documents';
```

```ts
export {
  documentFactory,
```

```ts
 * partners.ts covers 0004, documents.ts covers 0005.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [...tenancyFactories, ...partnerFactories, ...documentFactories]) {
```

`packages/db/test/rls/roles.db.test.ts` (step 5), the one-line anchor (line 107):

```ts
    it('a member cannot write organizations, memberships or taxpayer_profiles (05 §10.2)', async () => {
```

`docs/v3/05-data-model.md` §10.2 (step 6), the one-line anchor (the table row):

```
| `review_questions` | accountant may update only `answer`, `answered_by`, `answered_at` |
```

All code below was run by the brief writer on `origin/phase/0` at 363b48e (PR #56 merged: 0029a/b) against Postgres 16 (plain cluster + shim): migrations apply through `runMigrations`, `tsc` clean for db and testkit, `biome ci` clean, the db suite green twice in a row on one database (fixtures cleaned), `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0006_documents_detail.sql` | create | 7 tables, indexes, accountant trigger, RLS |
| `packages/db/migrations/meta/_journal.json` | edit | entry 5 |
| `packages/testkit/src/factories/document-details.ts` | create | 7 factories |
| `packages/testkit/src/factories/index.ts` | edit | register them |
| `packages/db/test/rls/roles.db.test.ts` | edit | the accountant column case |
| `docs/v3/05-data-model.md` | edit | §10.2 row of `review_questions` (rule 5) |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 98–241
- Step 2 code: lines 251–261
- Step 3 code: lines 269–365
- Step 4 code: lines 377–399
- Step 5 code: lines 411–441
- Step 6 code: lines 453–453

Setup (once): `git fetch origin phase/0 && git checkout -b task/0032-db-documents-detail origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expect `packages/db/migrations/0005_documents_core.sql` and `packages/db/src/schema/documents.ts` to exist: `ls packages/db/migrations packages/db/src/schema`; if not, STOP: 0029 is not merged). Then `chmod +x packages/db/scripts/local-pg.sh && bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1` → `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test` (NOTICE lines above it are fine). If it fails with `initdb: error: cannot be run as root` or `runuser: user postgres does not exist`, write that in the report; steps still typecheck, only the database runs are blocked.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0032a step k" && git log --oneline -1`. All commands run from the repo root. Code ranges: the line map above says where each step's code is; read only that range.

### Step 1: create `packages/db/migrations/0006_documents_detail.sql`

```sql
-- 0006_documents_detail: 05 §4 Ingestion and documents, the seven detail tables: document_links,
-- document_lines, document_vat_summary, document_fields, extraction_runs, validation_results,
-- review_questions, with their indexes. Tenant RLS through app.apply_tenant_rls() (05 §10.1);
-- extraction_runs is select-only for users (05 §10.2) through app.apply_tenant_rls_read_only()
-- (0005); review_questions gets the 05 §10.2 column rule for accountants (an extra update policy
-- plus a before-update trigger, since RLS cannot see which columns changed). document_lines
-- references categories (0004). review_questions.transaction_id gets its FK in the §6 slice.
-- Forward-only.

create table document_links (
  org_id uuid not null references organizations(id) on delete cascade,
  from_document_id uuid not null references documents(id) on delete cascade,
  to_document_id uuid not null references documents(id) on delete cascade,
  kind doc_link_kind not null,
  note text, created_by text not null default 'system',
  primary key (from_document_id, to_document_id, kind)
);
create index on document_links (org_id, to_document_id);

create table document_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  position integer not null,
  line_type line_type not null default 'item',
  description text, code text,
  quantity numeric(15,4), unit text, unit_price numeric(15,4),
  net numeric(15,2), vat numeric(15,2), gross numeric(15,2),
  vat_rate_type vat_rate_type not null default 'none',
  vat_rate_pct numeric(5,2),                                       -- resolved at vat_point_date
  vat_treatment vat_treatment,
  category_code text references categories(code),
  business_share_pct numeric(5,2) not null default 100,
  deductibility text check (deductibility in ('deductible','non_deductible','partially_deductible','not_applicable')),
  covered_by_document_id uuid references documents(id) on delete set null,   -- statement fee evidenced by an invoice (M04 §4.11.4)
  rc_commodity_code text,                                          -- §92a code if any
  classification_source field_source, classification_confidence numeric(4,3),
  unique (document_id, position)
);
create index on document_lines (org_id, document_id);

create table document_vat_summary (                                 -- the VAT recap as printed / derived
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  vat_rate_type vat_rate_type not null, vat_rate_pct numeric(5,2) not null,
  base numeric(15,2) not null, vat numeric(15,2) not null,
  base_foreign numeric(15,2), vat_foreign numeric(15,2),
  primary key (document_id, vat_rate_type, vat_rate_pct)
);

create table document_fields (                                      -- every extracted value with provenance
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  field_key text not null,                                         -- grammar M02 §5.2; filing keys 04 §9.4
  value_text text, value_json jsonb,
  source field_source not null, confidence numeric(4,3),
  page integer, bbox numeric[],                                    -- [x0,y0,x1,y1] normalized 0..1
  extraction_run_id uuid,
  is_current boolean not null default true,
  set_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on document_fields (document_id, field_key) where is_current;

create table extraction_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  stage text not null check (stage in ('split','classify','extract','categorize')),
  method field_source not null, model text, prompt_version text,
  attempt smallint not null default 1,
  input_mode text check (input_mode in ('text+thumb','text+images','images','none')),
  image_count smallint,
  input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_write_tokens integer,
  cost_usd numeric(10,5),
  escalation_reasons text[] not null default '{}',
  latency_ms integer, ok boolean not null, error text,
  raw_response_path text,                                          -- deleted after 30 days
  batch_id uuid,                                                   -- Later: FK to extraction_batches (§9.1)
  created_at timestamptz not null default now()
);
create index on extraction_runs (org_id, document_id);

create table validation_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  rule_id text not null,                                           -- e.g. 'MATH_VAT_RECAP' (catalog in M03)
  rule_version integer not null,
  severity severity not null, state validation_state not null default 'open',
  field_keys text[] not null default '{}',
  params jsonb not null default '{}',                              -- for i18n message interpolation
  dismiss_reason text,                                             -- shown in the accountant package ("Klient potvrdil: …")
  resolved_by uuid references auth.users(id), resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, rule_id)
);
create index on validation_results (org_id, state, severity);

create table review_questions (                                     -- plain-language questions to the user
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  transaction_id uuid,                                             -- FK to transactions added in §6
  kind text not null,                                              -- canonical list 04 §9.1
  payload jsonb not null, answer jsonb,
  answered_by uuid references auth.users(id), answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on review_questions (org_id, answered_at);

-- 05 §10.2: "review_questions | accountant may update only answer, answered_by, answered_at".
-- A policy cannot compare old and new columns, so a before-update trigger raises 42501
-- (insufficient_privilege, the code the RLS suite expects) when an accountant of the row's org
-- changes any other column. Owners and members (and the worker, whose auth.uid() is null) pass.
create function app.review_questions_accountant_columns() returns trigger language plpgsql as $$
begin
  if app.user_has_role(old.org_id, '{accountant}'::member_role[]) and (
    (old.id, old.org_id, old.document_id, old.transaction_id, old.kind, old.payload, old.created_at)
    is distinct from
    (new.id, new.org_id, new.document_id, new.transaction_id, new.kind, new.payload, new.created_at)
  ) then
    raise insufficient_privilege using
      message = 'review_questions: an accountant may update only answer, answered_by, answered_at (05 §10.2)';
  end if;
  return new;
end
$$;
create trigger review_questions_accountant_columns before update on review_questions
  for each row execute function app.review_questions_accountant_columns();

-- RLS (05 §10.1 default write roles owner, member; 05 §10.2 extraction_runs users: select only).
select app.apply_tenant_rls('document_links');
select app.apply_tenant_rls('document_lines');
select app.apply_tenant_rls('document_vat_summary');
select app.apply_tenant_rls('document_fields');
select app.apply_tenant_rls_read_only('extraction_runs');
select app.apply_tenant_rls('validation_results');
select app.apply_tenant_rls('review_questions');
-- The accountant's update right on review_questions (the trigger above limits the columns).
create policy review_questions_accountant_update on review_questions for update
  using (app.user_has_role(org_id, '{accountant}'::member_role[]))
  with check (app.user_has_role(org_id, '{accountant}'::member_role[]));
```

Command: `grep -c "^select app.apply_tenant_rls" packages/db/migrations/0006_documents_detail.sql` → `7`; `grep -c "^create table" packages/db/migrations/0006_documents_detail.sql` → `7`. Commit.

### Step 2: edit `packages/db/migrations/meta/_journal.json`

Replace the anchor (§2) with:

```json
      "tag": "0005_documents_core",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1760745600005,
      "tag": "0006_documents_detail",
      "breakpoints": true
    }
  ]
```

Command: `python3 -c 'import json; print(len(json.load(open("packages/db/migrations/meta/_journal.json"))["entries"]))'` → `6`. Commit.

### Step 3: create `packages/testkit/src/factories/document-details.ts`

```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §4 detail tables (migration 0006): document_links, document_lines,
 * document_vat_summary, document_fields, extraction_runs, validation_results, review_questions.
 * Columns are snake_case as in SQL; money and percentages are numeric strings (never floats).
 * Every `document_id` is a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()` creates
 * that document with `documentFactory`. `category_code` stays null (categories is a global table
 * without a factory). Array columns stay at their SQL default.
 */

/** `document_links` has no `id`: its key is (from_document_id, to_document_id, kind). */
export const documentLinkFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  from_document_id: ctx.ids.next(),
  to_document_id: ctx.ids.next(),
  kind: 'supports',
  ...overrides,
});

export const documentLineFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  position: 1,
  description: 'TEST line',
  quantity: '1.0000',
  unit_price: '100.0000',
  net: '100.00',
  vat: '21.00',
  gross: '121.00',
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  ...overrides,
});

/** `document_vat_summary` has no `id`: its key is (document_id, vat_rate_type, vat_rate_pct). */
export const documentVatSummaryFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  base: '100.00',
  vat: '21.00',
  ...overrides,
});

export const documentFieldFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  field_key: 'document_number',
  value_text: 'TEST-0001',
  source: 'rule',
  confidence: '0.900',
  ...overrides,
});

export const extractionRunFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  stage: 'extract',
  method: 'llm',
  ok: true,
  ...overrides,
});

export const validationResultFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  rule_id: 'MATH_VAT_RECAP',
  rule_version: 1,
  severity: 'warning',
  ...overrides,
});

export const reviewQuestionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  kind: 'confirm_total',
  payload: { field_key: 'total_gross', value: '121.00' },
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const documentDetailFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['document_links', documentLinkFactory],
  ['document_lines', documentLineFactory],
  ['document_vat_summary', documentVatSummaryFactory],
  ['document_fields', documentFieldFactory],
  ['extraction_runs', extractionRunFactory],
  ['validation_results', validationResultFactory],
  ['review_questions', reviewQuestionFactory],
];
```

Command: `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: edit `packages/testkit/src/factories/index.ts` (three replacements, anchors in §2)

(a) Before the `import { documentFactories } from './documents';` anchor insert `import { documentDetailFactories } from './document-details';` (first line of the file).

(b) Before the 2-line anchor `export {` / `  documentFactory,` insert:

```ts
export {
  documentFieldFactory,
  documentLineFactory,
  documentLinkFactory,
  documentVatSummaryFactory,
  extractionRunFactory,
  reviewQuestionFactory,
  validationResultFactory,
} from './document-details';
```

(c) The 4-line anchor becomes:

```ts
 * partners.ts covers 0004, documents.ts covers 0005, document-details.ts covers 0006.
 */
export const tenantFactories: FactoryRegistry = createFactoryRegistry();
for (const [table, factory] of [
  ...tenancyFactories,
  ...partnerFactories,
  ...documentFactories,
  ...documentDetailFactories,
]) {
```

The file is then 48 lines (`wc -l`).

Command: `pnpm --filter @shoebox/testkit test 2>&1 | tail -4` → `Tests  85 passed (85)`; `pnpm exec biome ci packages/testkit 2>&1 | tail -3` → no errors; then `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test 2>&1 | tail -8` → `Test Files  10 passed (10)` and `Tests  86 passed (86)` (the suite now covers 19 tenant tables). Commit.

### Step 5: edit `packages/db/test/rls/roles.db.test.ts`

Before the one-line anchor (§2, the `it('a member cannot write …` line) insert this block followed by one blank line:

```ts
    it('an accountant updates only answer, answered_by, answered_at of review_questions (05 §10.2)', async () => {
      expect(tenants.tables).toContain('review_questions');
      expect(mayWrite('extraction_runs', 'owner')).toBe(false);
      const uid = USERS.A.accountant;
      const answered = await asUser(
        sql,
        uid,
        (tx) => tx`update review_questions set answer = '{"confirmed": true}',
          answered_by = ${uid}, answered_at = now() where org_id = ${ORG_A} returning id`,
      );
      expect(answered.length, 'accountant answers').toBeGreaterThanOrEqual(1);
      for (const change of ["kind = 'other'", "payload = '{}'", 'document_id = null']) {
        expect(
          await errorCodeAs(sql, uid, (tx) =>
            tx.unsafe(`update review_questions set ${change} where org_id = '${ORG_A}'`),
          ),
          `accountant sets ${change}`,
        ).toBe('42501');
      }
      const row = await buildRow(sql, 'review_questions', tenants.ctx.A);
      expect(await errorCodeAs(sql, uid, (tx) => insertRow(tx, 'review_questions', row))).toBe(
        '42501',
      );
      expect(await asUser(sql, uid, (tx) => deleteCount(tx, 'review_questions', ORG_A))).toBe(0);
      const owner = await asUser(
        sql,
        USERS.A.owner,
        (tx) => tx`update review_questions set kind = 'other' where org_id = ${ORG_A} returning id`,
      );
      expect(owner.length, 'owner changes kind').toBeGreaterThanOrEqual(1);
    });
```

The file is then 182 lines (`wc -l`).

Command: `pnpm exec biome ci packages/db/test/rls 2>&1 | tail -3` → no errors; `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- rls 2>&1 | tail -8` → `Tests  87 passed (87)`. Commit.

### Step 6: edit `docs/v3/05-data-model.md` §10.2

Replace the one-line anchor (§2, the `review_questions` row) with:

```
| `review_questions` | accountant may update only `answer`, `answered_by`, `answered_at` (since 0006: policy `review_questions_accountant_update` plus the before-update trigger `review_questions_accountant_columns`, which raises 42501 on any other column) |
```

Command: `grep -c "review_questions_accountant_columns" docs/v3/05-data-model.md` → `1`; `python3 scripts/context_lint.py 2>&1 | tail -3` → OK. Commit. Write the report (§9) and continue with 0032b on the same branch (leave the cluster running).

## 5. Do not touch

`packages/db/migrations/0001_*.sql` to `0005_*.sql`, `packages/db/scripts/**`, `packages/db/src/**` (0032b adds the Drizzle mirror; `rls-catalog.ts` already lists `extraction_runs` and `review_questions`), `packages/db/test/**` except the one insertion in `roles.db.test.ts` (0032b adds the migration test), `packages/testkit/src/factories/registry.ts`, `tenancy.ts`, `partners.ts`, `documents.ts`, `packages/testkit/test/**`, `scripts/**`, `.github/**`, `docs/v3/**` except the one §10.2 row. Hard rules 1, 3, 5, 7, 8. Never write a connection string with a password. Never run `supabase-shim.sql` against a Supabase database. No table of 05 §5–§9 is created here.

## 6. Commands

```
bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1                                   # DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test
DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30   # Tests 87 passed (10 files)
pnpm --filter @shoebox/db test 2>&1 | tail -30                                              # without DATABASE_URL: 28 passed, 59 skipped
pnpm --filter @shoebox/testkit test 2>&1 | tail -30                                         # 85 passed
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30                                    # exit 0
pnpm exec biome ci packages/db packages/testkit 2>&1 | tail -30                             # No fixes applied, no errors
python3 scripts/pii_guard.py --all packages/testkit/src/factories/document-details.ts packages/db/test/rls/roles.db.test.ts 2>&1 | tail -3   # pii_guard: OK
python3 scripts/context_lint.py 2>&1 | tail -30                                             # OK
```

## 7. Acceptance

- [ ] `psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations"` → `6`; `select count(*) from pg_tables where schemaname='public'` → `23`.
- [ ] `psql "$DATABASE_URL" -tAc "select policyname from pg_policies where tablename='extraction_runs' order by 1"` → `extraction_runs_select`, `extraction_runs_worker` (no `_write`); `… tablename='review_questions'` → `review_questions_accountant_update`, `review_questions_select`, `review_questions_worker`, `review_questions_write`; the other five tables have `_select`, `_worker`, `_write`.
- [ ] `psql "$DATABASE_URL" -tAc "select tgname from pg_trigger where tgname='review_questions_accountant_columns'"` → one row.
- [ ] `meta`, `isolation`, `roles` (with the new accountant case), `worker` tests green with 19 tenant tables; `tenancy.db.test.ts` green after a from-scratch run.
- [ ] `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts` → `1`; `grep -c "review_questions_accountant_columns" docs/v3/05-data-model.md` → `1`.

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

Write `docs/tasks/0032a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`0006_documents_detail.sql` column by column against 05 §4 (money `numeric(15,2)`, `quantity`/`unit_price` `numeric(15,4)`, `vat_rate_pct`/`business_share_pct` `numeric(5,2)`, `cost_usd numeric(10,5)`, the composite primary keys of `document_links` and `document_vat_summary`, the `deductibility`, `stage` and `input_mode` check lists, the `on delete` modes, the partial index `where is_current`), the trigger `app.review_questions_accountant_columns()` (compares exactly the seven columns an accountant may not change: `id`, `org_id`, `document_id`, `transaction_id`, `kind`, `payload`, `created_at`; raises `insufficient_privilege`; passes when `auth.uid()` is null), the policy `review_questions_accountant_update` (for update only, accountant role, `with check` on the same role), the seven RLS calls at the end (`extraction_runs` must be the read-only one).

## Owner steps

None.
