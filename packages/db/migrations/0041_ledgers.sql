-- 0041_ledgers: 05 §7 derived ledgers, users select only (05 §10.2), forward-only.
create sequence if not exists ledger_build_version_seq;                         -- monotonic, global (M04 §4.13)

create table tax_ledger_entries (                                    -- income tax, cash basis (M04 §4.11)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entry_date date not null,
  tax_year smallint not null,
  basis text not null default 'payment' check (basis in ('payment','document_evidence','provisional')),
  document_id uuid references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,
  payment_link_id uuid,                                             -- TODO(P0-DB-08): references payment_links(id) on delete cascade
  transaction_id uuid,                                              -- TODO(P0-DB-08): references transactions(id) on delete cascade
  category_code text not null references categories(code),
  tax_effect tax_effect not null,
  amount_czk numeric(15,2) not null,
  business_share_pct numeric(5,2) not null default 100,
  business_amount_czk numeric(15,2) not null default 0,
  build_version bigint not null
);
create index on tax_ledger_entries (org_id, tax_year, tax_effect);
create index on tax_ledger_entries (org_id, document_id);

create table vat_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null, period_end date not null,
  vat_point_date date not null,
  vat_point_rule text not null default 'duzp'
    check (vat_point_rule in ('duzp','max_duzp_received','issue_date','service_period_end','prepayment','eu_goods_15th','user_override')),
  document_id uuid not null references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,
  vat_treatment vat_treatment not null,
  vat_rate_type vat_rate_type not null, vat_rate_pct numeric(5,2) not null,
  base_czk numeric(15,2) not null, vat_czk numeric(15,2) not null,
  deduction_pct numeric(5,2) not null default 100,
  currency char(3) not null default 'CZK', base_foreign numeric(15,2),
  fx_rate numeric(12,6), fx_amount integer, fx_rate_date date,
  dphdp3_rows text[] not null,
  kh_section text check (kh_section in ('A1','A2','A3','A4','A5','B1','B2','B3')),
  kh_document_total_czk numeric(15,2),
  shv_code smallint check (shv_code in (0,1,2,3)),
  counterparty_vat_id text, evidence_number text,
  build_version bigint not null
);
create index on vat_ledger_entries (org_id, period_start);
create index on vat_ledger_entries (org_id, document_id);

-- 0003's "grant on all sequences" covered only the sequences that existed then.
grant usage, select on sequence ledger_build_version_seq to app_worker;

select app.apply_tenant_rls_read_only('tax_ledger_entries');
select app.apply_tenant_rls_read_only('vat_ledger_entries');
