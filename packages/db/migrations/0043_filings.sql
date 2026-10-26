-- 0043_filings: 05 §8 output tables of Phase 3 (filings, filing_documents, filing_entries), forward-only.
create table filings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type filing_type not null, kind filing_kind not null default 'radne',
  origin filing_origin not null default 'generated',
  source_document_id uuid references documents(id),                 -- imported own return (government_filing)
  period_start date not null, period_end date not null,
  state filing_state not null default 'draft',
  amends_filing_id uuid references filings(id),
  bundle_id uuid,                                                   -- DPHDP3 + DPHKH1 + DPHSHV generated together
  form_version text,                                                -- e.g. 'DPHDP3 03.01.04'
  totals jsonb not null default '{}',                               -- row → value snapshot
  inputs jsonb not null default '{}',                               -- podklady wizard answers (M06 §4.8); NEVER rodné číslo
  xml_path text, pdf_path text, xlsx_path text,                     -- DPFDP7_PARTIAL: xml_path always null (not stored)
  xsd_valid boolean, xsd_errors jsonb,
  simple_check jsonb not null default '{}',                         -- why simple / why not (M05 §4.3)
  generated_at timestamptz, generated_by uuid references auth.users(id),
  marked_filed_at timestamptz, filed_on date, submission_ref text,  -- podací číslo (optional)
  discovered_on date,                                               -- d_zjist for dodatečné / následné
  constraint filings_inputs_no_rc check (not (inputs ?| array['rodneCislo','rod_c','rodne_cislo']))
);
create unique index filings_one_open_per_kind on filings (org_id, type, period_start, kind)
  where state in ('draft','generated','downloaded');
create index on filings (org_id, period_start);

create table filing_documents (                                      -- snapshot of what went in
  filing_id uuid not null references filings(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_revision integer not null,
  primary key (filing_id, document_id)
);
create index on filing_documents (org_id, document_id);
create index on filing_documents (org_id, filing_id);

create table filing_entries (                                        -- entry-level snapshot for amendment diffs; immutable after insert
  filing_id uuid not null references filings(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_revision integer not null,
  vat_treatment vat_treatment not null, vat_rate_type vat_rate_type not null,
  dphdp3_rows text[] not null, kh_section text, shv_code smallint,
  counterparty_vat_id text, evidence_number text, vat_point_date date not null,
  base_czk numeric(15,2) not null, vat_czk numeric(15,2) not null
);
create index on filing_entries (org_id, filing_id);
-- immutability enforced by the worker (no update path): app.reject_update does not exist (0002..0062)

select app.apply_tenant_rls('filings');
select app.apply_tenant_rls('filing_documents');
select app.apply_tenant_rls_read_only('filing_entries');
