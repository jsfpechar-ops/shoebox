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
