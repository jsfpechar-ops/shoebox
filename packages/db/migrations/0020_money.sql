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
