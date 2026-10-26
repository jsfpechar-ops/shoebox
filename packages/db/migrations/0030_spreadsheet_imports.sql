-- 0030_spreadsheet_imports (05 §6): saved column mappings and spreadsheet imports (M01 §4.13), and
-- the documents.import_id foreign key. Tenant RLS (05 §10.1).
create table import_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('documents','bank_statement')),
  money_account_id uuid,   -- bank_statement only; TODO(M07): FK to money_accounts (table does not exist yet)
  header_signature char(64) not null,
  sheet_name text,
  mapping jsonb not null,
  options jsonb not null default '{}',
  created_by uuid references auth.users(id),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (org_id, kind, money_account_id, header_signature)
);

create table spreadsheet_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_file_id uuid not null references source_files(id) on delete cascade,
  mapping_id uuid references import_mappings(id) on delete set null,
  state text not null default 'parsed' check (state in ('parsed','importing','done','failed','undone')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  duplicate_count integer not null default 0,
  skipped_rows jsonb not null default '[]',
  created_by uuid references auth.users(id),
  finished_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

alter table documents add constraint documents_import_fk foreign key (import_id) references spreadsheet_imports(id) on delete set null;

select app.apply_tenant_rls('import_mappings');
select app.apply_tenant_rls('spreadsheet_imports');
