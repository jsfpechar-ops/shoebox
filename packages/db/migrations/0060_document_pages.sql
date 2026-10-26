-- 0060_document_pages (05 §4): the pages of a document, in order, when a document is made of
-- pages from several files or of part of one file (page sorting, briefs 0500-0509). No rows = the
-- whole source_file is the document (every document before 0060). Tenant RLS (05 §10.1).
create table document_pages (
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  position smallint not null check (position >= 1),
  source_file_id uuid not null references source_files(id) on delete cascade,
  file_page smallint not null check (file_page >= 1),       -- 1-based page in the file; 1 for an image
  region text not null default '',                           -- '' = the whole page; else where ('top', 'left')
  supplier_key text not null default '',                     -- page look-over: IČO, or casefolded supplier name
  doc_number text not null default '',
  label_n smallint check (label_n >= 1),                     -- printed "page n of m"
  label_of smallint check (label_of >= 1),
  has_totals boolean not null default false,
  starts_document boolean not null default true,
  primary key (document_id, position)
);
create index on document_pages (org_id, source_file_id);

alter table documents add column upload_batch_id uuid;      -- one upload drop (all files of one POST)
create index documents_org_id_upload_batch_id_idx on documents (org_id, upload_batch_id);

select app.apply_tenant_rls('document_pages');
