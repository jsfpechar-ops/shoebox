# 0110: Money tables migration (accounts, statements, transactions, links)

Status: todo
Ticket: P0-DB-08 | Depends on: none | Base commit: 7c2f2f5 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens | Risk: HIGH (migration, RLS)

## 1. Objective

Create the ten money tables of 05 §6 in one migration with row-level security, so bank statement import, matching and paying bills can be built without further tables. Each table gets a testkit factory so the RLS suite proves one firm never sees another firm's bank data.

## 2. Context

- Hard rules: every tenant table ships with RLS policies and an RLS test in the same PR; money columns are `numeric(15,2)`; never push to `main`.
- RLS helpers already exist: `select app.apply_tenant_rls('<table>');` (users owner/member write, accountant read, worker all) and `select app.apply_tenant_rls_read_only('<table>');` (users select only, worker writes). 05 §10.2: `statement_imports` and `match_suggestions` are read-only for users. `packages/db/src/rls-catalog.ts` already lists both in `READ_ONLY_FOR_USERS`, so it needs no change.
- Enums `money_account_type`, `tx_source`, `link_type`, `match_method` exist since 0001. `documents.import_id` (0005) and `review_questions.transaction_id` (0006) exist without foreign keys; this migration adds them.
- The migration journal is `packages/db/migrations/meta/_journal.json`. Its last entry today:
```json
    {
      "idx": 14,
      "version": "7",
      "when": 1792977600000,
      "tag": "0052_purge_trash",
      "breakpoints": true
    }
```
- Factories: `packages/testkit/src/factories/<area>.ts` exports `TenantFactory` functions and a `[table, factory]` array; `factories/index.ts` registers the array. A child row points its foreign key at a fresh `ctx.ids.next()`; the RLS suite creates that parent with the parent's factory. Excerpt of `packages/testkit/src/factories/index.ts`:
```ts
import { platformFactories } from './platform';
```
```ts
export { auditLogFactory, llmUsageDailyFactory, privacyRequestFactory } from './platform';
```
```ts
  ...documentDetailFactories,
  ...platformFactories,
]) {
```
- DB tests need `DATABASE_URL`; without it they skip. CI runs them against Supabase. Do not try to start Docker or Supabase.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0020_money.sql` | new | the DDL below, verbatim |
| `packages/db/migrations/meta/_journal.json` | edit | one entry |
| `packages/testkit/src/factories/money.ts` | new | ten factories, verbatim below |
| `packages/testkit/src/factories/index.ts` | edit | import, export, register |
| `packages/db/test/migrations/money.db.test.ts` | new | verbatim below |

No other file may change.

## 4. Steps

1. New `packages/db/migrations/0020_money.sql`, exactly this content:
```sql
-- 0020_money (05 §6): money accounts, statement imports, transactions, payment links, match
-- suggestions, counterparty aliases, payment orders. Phase 2 features; tables exist now so
-- no later slice needs new tables. Tenant RLS (05 §10.1); statement_imports and
-- match_suggestions are select-only for users (05 §10.2). Forward-only.
create table money_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type money_account_type not null,
  name text not null, currency char(3) not null default 'CZK',
  account_number text, bank_code text, iban text,
  platform text,                                                   -- airbnb|booking|comgate|gopay|paypal|zasilkovna|property_manager
  import_format text,                                              -- last detected format (M07 §4.2)
  notice_parser text,                                              -- last notice parser id
  opening_balance numeric(15,2), opening_date date,
  is_business boolean not null default true,
  settings jsonb not null default '{}'                             -- card_last4 list etc.
);

create table import_mappings (                                      -- saved column mappings: document lists (M01 §4.13) and bank CSVs (M07 §4.3.6)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('documents','bank_statement')),
  money_account_id uuid references money_accounts(id) on delete cascade,   -- bank_statement only
  header_signature char(64) not null,                              -- sha256 of the folded header row
  sheet_name text,
  mapping jsonb not null,                                          -- {target_field: column_index}; settings-like
  options jsonb not null default '{}',                             -- {direction_mode, direction_values, header_row, delimiter, encoding}
  created_by uuid references auth.users(id), last_used_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct (org_id, kind, money_account_id, header_signature)
);

create table spreadsheet_imports (                                  -- M01 §4.13 (Phase 2)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_file_id uuid not null references source_files(id),
  mapping_id uuid references import_mappings(id) on delete set null,
  state text not null default 'parsed' check (state in ('parsed','importing','done','failed','undone')),
  row_count integer not null default 0, imported_count integer not null default 0,
  skipped_count integer not null default 0, duplicate_count integer not null default 0,
  skipped_rows jsonb not null default '[]',                        -- [{row, reason}] for the report only
  created_by uuid references auth.users(id), finished_at timestamptz, undone_at timestamptz,
  created_at timestamptz not null default now()
);
alter table documents add constraint documents_import_fk foreign key (import_id) references spreadsheet_imports(id) on delete set null;

create table statement_imports (                                    -- M07 §4.2–4.5: coverage, balances, idempotent re-import
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  money_account_id uuid references money_accounts(id) on delete cascade,
  source_file_id uuid references source_files(id),
  inbound_email_id uuid references inbound_emails(id),
  channel tx_source not null check (channel in ('statement_file','email_notice','bank_api')),
  format text not null, parser_version integer not null,
  mapping_id uuid references import_mappings(id) on delete set null,
  period_from date, period_to date, statement_number text,
  opening_balance numeric(15,2), closing_balance numeric(15,2),
  balance_check text not null default 'not_available' check (balance_check in ('ok','mismatch','not_available')),
  tx_total integer not null default 0, tx_new integer not null default 0,
  tx_merged integer not null default 0, tx_duplicate integer not null default 0, tx_failed integer not null default 0,
  state text not null check (state in ('parsed','partially_parsed','failed','duplicate_file','needs_mapping','needs_account')),
  errors jsonb not null default '[]',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on statement_imports (org_id, money_account_id, period_from);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  money_account_id uuid not null references money_accounts(id) on delete cascade,
  source tx_source not null,
  statement_import_id uuid references statement_imports(id),
  external_id text,                                                -- bank tx id → dedupe; 'doc:{document_id}' for document evidence
  dedupe_hash char(64),                                            -- M07 §4.5
  booked_on date not null, value_date date,
  amount numeric(15,2) not null,                                   -- signed: + incoming, − outgoing (account currency)
  currency char(3) not null,
  amount_original numeric(15,2), currency_original char(3),
  counterparty_name text, counterparty_account text, counterparty_bank_code text, counterparty_iban text,
  counterparty_partner_id uuid references partners(id),
  variable_symbol text, constant_symbol text, specific_symbol text,
  message text, card_merchant text, card_last4 text,
  category_code text references categories(code),                  -- for non-document tx (transfers, taxes, fees)
  match_state text not null default 'unmatched' check (match_state in ('unmatched','partial','matched','ignored','no_document_needed')),
  is_pending boolean not null default false,                       -- card authorisation from a notice
  paired_transaction_id uuid references transactions(id),          -- own transfer / platform payout pair
  reversal_of_transaction_id uuid references transactions(id),
  matched_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, money_account_id, external_id)
);
create unique index transactions_dedupe_hash on transactions (org_id, money_account_id, dedupe_hash) where dedupe_hash is not null;
create index on transactions (org_id, match_state, booked_on);
create index on transactions (org_id, variable_symbol) where variable_symbol is not null;
create index on transactions (org_id, counterparty_account, counterparty_bank_code);
alter table review_questions add constraint review_questions_tx_fk foreign key (transaction_id) references transactions(id) on delete cascade;

create table payment_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  link_type link_type not null default 'payment',
  amount numeric(15,2) not null,                                   -- in document currency
  amount_account_currency numeric(15,2) not null,
  match_method match_method not null, confidence numeric(4,3),
  matcher_version integer,
  created_by text not null default 'system' check (created_by in ('system','user')),
  confirmed_by uuid references auth.users(id), confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payment_links (org_id, document_id);
create index on payment_links (org_id, transaction_id);

create table match_suggestions (                                    -- explainable; rejections are kept so they are never re-suggested
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  kind text not null check (kind in ('document','multi_document','transfer','category')),
  document_ids uuid[] not null default '{}', amounts numeric(15,2)[] not null default '{}',
  paired_transaction_id uuid references transactions(id), category_code text references categories(code),
  score numeric(4,3) not null, features jsonb not null,            -- display-only reasons
  state text not null default 'open' check (state in ('open','accepted','rejected','superseded')),
  matcher_version integer not null,
  decided_by uuid references auth.users(id), decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on match_suggestions (org_id, transaction_id, state);

create table counterparty_aliases (                                 -- learned counterparty identities (M07 §4.6)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  kind text not null check (kind in ('account','merchant','name')),
  value_normalized text not null,
  confirmations integer not null default 0, last_confirmed_at timestamptz,
  unique (org_id, kind, value_normalized, partner_id)
);

create table payment_orders (                                       -- QR shown / ABO exported (M07 §4.9)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('qr','abo')),
  money_account_id uuid references money_accounts(id),
  file_path text, total numeric(15,2) not null, item_count integer not null,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table payment_order_items (
  order_id uuid not null references payment_orders(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  amount numeric(15,2) not null, account text not null, variable_symbol text,
  checks jsonb not null,                                            -- snapshot of pre-payment checks
  risk_acknowledged_by uuid references auth.users(id),
  primary key (order_id, document_id)
);
create index on payment_order_items (org_id, document_id);

select app.apply_tenant_rls('money_accounts');
select app.apply_tenant_rls('import_mappings');
select app.apply_tenant_rls('spreadsheet_imports');
select app.apply_tenant_rls_read_only('statement_imports');
select app.apply_tenant_rls('transactions');
select app.apply_tenant_rls('payment_links');
select app.apply_tenant_rls_read_only('match_suggestions');
select app.apply_tenant_rls('counterparty_aliases');
select app.apply_tenant_rls('payment_orders');
select app.apply_tenant_rls('payment_order_items');
```
Commit `0110 step 1`.

2. `_journal.json`: after the `0052_purge_trash` entry (add a comma after its closing `}`), append
```json
    {
      "idx": 15,
      "version": "7",
      "when": <WHEN>,
      "tag": "0020_money",
      "breakpoints": true
    }
```
where `<WHEN>` is the output of `node -e 'console.log(Date.now())'` (it must be larger than every other `when` in the file). Check: `node -e 'JSON.parse(require("fs").readFileSync("packages/db/migrations/meta/_journal.json","utf8"))' && echo ok`. Commit `0110 step 2`.

3. New `packages/testkit/src/factories/money.ts`, exactly:
```ts
import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §6 money tables (migration 0020). Columns are snake_case as in SQL. A child
 * row points its foreign key at a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()`
 * creates that parent with the parent's factory.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

export const moneyAccountFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  type: 'bank',
  name: 'Business account',
  currency: 'CZK',
  ...overrides,
});

export const importMappingFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    kind: 'documents',
    header_signature: counterOf(id).toString(16).padStart(64, '0'),
    mapping: {},
    ...overrides,
  };
};

export const spreadsheetImportFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  source_file_id: ctx.ids.next(),
  ...overrides,
});

export const statementImportFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  channel: 'statement_file',
  format: 'gpc',
  parser_version: 1,
  state: 'parsed',
  ...overrides,
});

export const transactionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  money_account_id: ctx.ids.next(),
  source: 'statement_file',
  booked_on: '2026-01-15',
  amount: '-1210.00',
  currency: 'CZK',
  ...overrides,
});

export const paymentLinkFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  transaction_id: ctx.ids.next(),
  document_id: ctx.ids.next(),
  amount: '1210.00',
  amount_account_currency: '1210.00',
  match_method: 'vs_amount',
  ...overrides,
});

export const matchSuggestionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  transaction_id: ctx.ids.next(),
  kind: 'category',
  score: '0.900',
  features: {},
  matcher_version: 1,
  ...overrides,
});

export const counterpartyAliasFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    partner_id: ctx.ids.next(),
    kind: 'name',
    value_normalized: `supplier ${counterOf(id)}`,
    ...overrides,
  };
};

export const paymentOrderFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  kind: 'qr',
  total: '1210.00',
  item_count: 1,
  ...overrides,
});

/** `payment_order_items` has no `id`: its key is (order_id, document_id). */
export const paymentOrderItemFactory: TenantFactory = (ctx, overrides) => ({
  order_id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  amount: '1210.00',
  account: '2400123455/2010',
  checks: {},
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const moneyFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['money_accounts', moneyAccountFactory],
  ['import_mappings', importMappingFactory],
  ['spreadsheet_imports', spreadsheetImportFactory],
  ['statement_imports', statementImportFactory],
  ['transactions', transactionFactory],
  ['payment_links', paymentLinkFactory],
  ['match_suggestions', matchSuggestionFactory],
  ['counterparty_aliases', counterpartyAliasFactory],
  ['payment_orders', paymentOrderFactory],
  ['payment_order_items', paymentOrderItemFactory],
];
```
Commit `0110 step 3`.

4. `packages/testkit/src/factories/index.ts`, three edits:
   - below `import { documentFactories } from './documents';` add `import { moneyFactories } from './money';`
   - below the `export { ... } from './documents';` block add
```ts
export {
  counterpartyAliasFactory,
  importMappingFactory,
  matchSuggestionFactory,
  moneyAccountFactory,
  paymentLinkFactory,
  paymentOrderFactory,
  paymentOrderItemFactory,
  spreadsheetImportFactory,
  statementImportFactory,
  transactionFactory,
} from './money';
```
   - in the registration loop, after `  ...platformFactories,` add `  ...moneyFactories,`
   - in the doc comment sentence ending `platform.ts covers 0007.` append ` money.ts covers 0020.`

Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -10` → no errors. Commit `0110 step 4`.

5. New `packages/db/test/migrations/money.db.test.ts`, verbatim:
```ts
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
```
Run `pnpm --filter @shoebox/db exec vitest run test/migrations/money.db.test.ts 2>&1 | tail -10`. Expected without DATABASE_URL: the file is skipped. Commit `0110 step 5`.

## 5. Do not touch

Every other migration file, `packages/db/src/` (including `rls-catalog.ts` and `schema/`), apps. No Drizzle mirror in this brief (queries use raw SQL). Hard rules: RLS on every new table; never push to `main`.

## 6. Commands

- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.
- `pnpm biome check packages/testkit packages/db 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] `0020_money.sql` holds the DDL of §4 step 1 byte for byte (`diff` against the brief block is empty).
- [ ] Journal parses and has 16 entries; the new `when` is the largest.
- [ ] Ten factories registered; typecheck and biome clean.
- [ ] DB tests are left to CI (say so in the report).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0110-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
