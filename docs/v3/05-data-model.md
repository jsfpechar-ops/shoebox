# 05: Data model (PostgreSQL 16, Supabase)

Canonical schema. Drizzle definitions in `packages/db/src/schema/*.ts` must match it 1:1, and migrations are generated from Drizzle. Enum names and values come from `04-domain-model.md`. Module specs no longer carry "proposed schema changes": every proposal from M01–M12 was merged here on 2026-10-18 (consistency review). A later change is a new migration **plus** an edit of this file (AGENTS rule 5).

**Conventions**
- `id uuid primary key default gen_random_uuid()`.
- Every tenant table has `org_id uuid not null references organizations(id) on delete cascade`, an index that starts with `org_id`, **RLS enabled** and the policies of §10. Global tables (no `org_id`) are marked `-- GLOBAL` and listed in §10.3.
- Money: `numeric(15,2)`. Foreign amounts: `numeric(15,2)` + `currency char(3)`. FX: `numeric(12,6)`. Credit notes are stored with **negative** amounts (04 §3).
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger `app.touch_updated_at`) where the table has it.
- Soft delete: `deleted_at timestamptz`. Hard delete is done only by the retention jobs (M12 §4.6).
- JSONB only for raw or provider payloads, snapshots and settings, never for data we query or compute on.
- Status-like text columns use `check (… in (…))`; their values are canonical in 04 §9 when they cross modules.

**Migration order** (sections below are already in dependency order; create them top to bottom):
1. extensions + schema `app` → 2. enums (§1) → 3. tenancy and profile (§2) → 4. partners, registries and `categories` (§3) → 5. ingestion and documents (§4) → 6. `vendor_profiles` (§5) → 7. money (§6), which also adds the two deferred foreign keys `review_questions.transaction_id` and `documents.import_id` → 8. ledgers (§7) → 9. outputs (§8; `export_profiles` before `accountant_packages`) → 10. platform (§9) → 11. RLS (§10) last, generated for every table with `org_id`.
- Tables in §9.1 ("Later") are **not** migrated until their feature ships; their DDL is kept here so the shape is agreed.
- Phase 0 creates everything except §9.1. Tables used only by Phase 2+ features (statement imports, payment orders, packages…) are created empty in Phase 0 too: one schema, one RLS suite, no phase-dependent migrations.

```sql
create extension if not exists btree_gist;     -- taxpayer_profiles exclusion constraint
create extension if not exists pg_trgm;        -- register search (M11)
create extension if not exists citext;         -- case-insensitive e-mail (invitations)
create schema if not exists app;
```

## 1. Enums

```sql
create type vat_status         as enum ('neplatce','identifikovana_osoba','platce');
create type vat_period         as enum ('monthly','quarterly');
create type tax_regime         as enum ('danova_evidence','pausalni_vydaje','pausalni_dan','ucetnictvi');
create type member_role        as enum ('owner','member','accountant','viewer');
create type document_class     as enum ('received_invoice','received_receipt','received_credit_note','received_advance_tax_doc',
  'received_proforma','issued_invoice','issued_credit_note','platform_statement','settlement_statement','order_confirmation',
  'delivery_note','bank_statement','government_filing','contract','other_supporting','non_document','unknown');
create type document_status    as enum ('received','splitting','classifying','extracting','validating','categorizing',
  'needs_review','ready','finalized','supporting','duplicate','failed');
  -- 'supporting' = kept and linked, never booked (all non-bookable classes, 04 §2.4). Renamed from 'rejected' on 2026-10-18.
create type tax_doc_status     as enum ('full_tax_document','simplified_tax_document','not_tax_document','foreign_document','unknown');
create type direction          as enum ('in','out');             -- in = expense side (received), out = income side (issued)
create type line_type          as enum ('item','discount','shipping','fee','rounding','advance_deduction','deposit','text');
create type vat_rate_type      as enum ('standard','reduced','zero','none');
create type vat_treatment      as enum ('rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_domestic_reverse_charge','rcv_import_customs',
  'rcv_foreign_vat_charged','rcv_out_of_scope','iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service',
  'iss_export_goods','iss_domestic_reverse_charge','iss_exempt','iss_no_vat');
create type tax_effect         as enum ('taxable_income','non_taxable_income','deductible_expense','non_deductible_expense',
  'asset','pass_through','transfer','tax_or_insurance_payment','private');
create type field_source       as enum ('isdoc','qr','pdf_text','template','llm','llm_escalated','registry','rule','vendor_memory','user','derived');
  -- typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a)
create type severity           as enum ('blocking','warning','info');
create type validation_state   as enum ('open','resolved','dismissed');
create type money_account_type as enum ('bank','cash','card','platform');
create type tx_source          as enum ('statement_file','email_notice','bank_api','manual','document_evidence');
create type link_type          as enum ('payment','refund','fee','fx_difference','platform_payout','offset');
create type match_method       as enum ('vs_amount','vs_only','amount_date_counterparty','card_merchant_fuzzy',
  'platform_statement','manual','document_evidence');
create type doc_link_kind      as enum ('duplicate_of','corrects','settles','supports','fulfills','reported_in','same_period_reconciles');
create type filing_type        as enum ('DPHDP3','DPHKH1','DPHSHV','DPFDP7_PARTIAL','PODKLADY_DPFO','VAT_WORKBOOK');
create type filing_kind        as enum ('radne','opravne','dodatecne','nasledne');
create type filing_state       as enum ('draft','generated','downloaded','marked_filed','superseded');
create type filing_origin      as enum ('generated','imported');  -- imported = the user's own filed return (M05 §4.11)
create type package_state      as enum ('draft','ready','sent','acknowledged');
```

## 2. Tenancy and profile

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text, dic text,
  inbound_email_slug text unique not null,          -- local part of {slug}-{secret}@in.<domain>
  inbound_email_secret text not null,               -- 8 chars Crockford base32, rotatable (M01 §4.10)
  inbound_email_secret_prev text,                   -- still accepted until _prev_until (rotation grace, 7 days)
  inbound_email_secret_prev_until timestamptz,
  settings jsonb not null default '{}',             -- auto_finalize, alias_names, known_addresses, car, activity_keywords,
                                                    -- tourist_fee_municipality, dap_via_advisor, insurance_reminders,
                                                    -- insurance_advances, email_spoof_policy… (zod OrgSettings)
  closed_at timestamptz, archive_mode boolean not null default false,   -- account closure (M12 §4.6)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  invited_by uuid references auth.users(id),
  prefs jsonb not null default '{}',                -- per-user UI + notification prefs (zod MembershipPrefs, M09 §5.3, M11 §13.3)
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invitations (                           -- Phase 2: accountant seat and team invites (M10)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email citext not null,
  role member_role not null check (role in ('member','accountant','viewer')),
  token_hash char(64) not null unique,                -- sha256 of the one-time token sent by e-mail (SES) or copied as a link
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,                    -- 7 days
  accepted_at timestamptz, accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_one_open on invitations (org_id, email) where accepted_at is null and revoked_at is null;
-- RLS: owners of the org read/insert/revoke; acceptance runs server-side by token hash (withServiceRole('admin')).

create table taxpayer_profiles (                     -- effective-dated; no overlaps per org (exclusion constraint)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  valid_from date not null, valid_to date,           -- null = open-ended
  vat_status vat_status not null,
  vat_period vat_period,
  tax_regime tax_regime not null,
  pausal_rate smallint check (pausal_rate in (80,60,40,30)),
    -- pausalni_vydaje: the flat-rate %; pausalni_dan: the declared dominant activity class (≥ 75 % of income) for band ceilings (04 §1)
  pausal_dan_band smallint check (pausal_dan_band in (1,2,3)),
  entity_type text not null default 'osvc' check (entity_type in ('osvc','sro')),
  legal_name text not null, ico text not null, dic text,
  first_name text, last_name text, title text,       -- EPO VetaP (M05 §4.7, M06 §4.10)
  filing_email text, filing_phone text,
  address jsonb not null,                            -- {street, house_number, orientation_number, city, zip, country}
  fu_code text, ufo_code text, main_activity_nace text,
  insurer text check (insurer in ('vzp','vozp','cpzp','ozp','zpskoda','zpmv','rbp')),
  has_accountant boolean not null default false,
  foreign_service_dppd_policy text not null default 'service_period_end'
    check (foreign_service_dppd_policy in ('service_period_end','issue_date')),
  created_at timestamptz not null default now(),
  exclude using gist (org_id with =, daterange(valid_from, coalesce(valid_to,'infinity'::date), '[]') with &&)
);
```

**Creating a firm (0015).** A new user has no membership, so RLS cannot let them insert. `public.create_firm(p jsonb)` (security definer, `authenticated` only) creates `organizations`, the owner `memberships` row, the first `taxpayer_profiles` segment and an `audit_log` row in one transaction, and returns `{org_id, inbound_email_slug, inbound_email_secret}`. One firm per user: a caller who already has a membership gets `already_has_firm`. It checks the profile combination (payer needs `vat_period`, identified person gets `monthly`, `pausalni_vydaje` needs `pausal_rate`, `pausalni_dan` needs a band and a non-payer, no `ucetnictvi` for OSVČ) and raises `invalid_profile`. The slug comes from the name (made unique with a 4-char suffix); the secret is 8 Crockford base32 chars.

## 3. Partners and registries

```sql
create table partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  ico text, dic text, vat_id text,                   -- vat_id = foreign VAT (IE…, NL…)
  country char(2) not null default 'CZ',
  address jsonb,
  is_vat_payer boolean, is_unreliable_payer boolean,
  registry_checked_at timestamptz,
  email_domains text[] not null default '{}',        -- learned from inbound e-mails
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, ico), unique (org_id, vat_id)
);

create table partner_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  account_number text, bank_code text, iban text, bic text,
  published_in_crpdph boolean, checked_at timestamptz,
  unique (org_id, partner_id, iban)
);

create table registry_cache (                        -- GLOBAL, service role only
  source text not null check (source in ('ares','crpdph','vies')),
  key text not null,                                 -- IČO / DIČ / VAT ID
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source, key)
);
create table fx_rates (                              -- GLOBAL; ČNB daily fixing
  rate_date date not null, currency char(3) not null,
  amount integer not null, rate numeric(12,6) not null,
  published_at timestamptz not null,
  primary key (rate_date, currency)
);
create table bank_codes (                            -- GLOBAL; ČNB bank code list, monthly refresh (M03 ID_BANK_CODE_UNKNOWN, M07 BIC)
  code char(4) primary key, name text not null, bic text,
  valid_from date not null, valid_to date
);

create table categories (                            -- GLOBAL seed data (04 §3.1); here because document_lines references it
  code text primary key,
  direction direction not null,
  tax_effect tax_effect not null,
  label_cs text not null, label_en text not null, explanation_cs text not null,
  icon text, sort integer not null,
  replaced_by text references categories(code),     -- retired category → successor (M04 §8)
  valid_from date not null default '2000-01-01', valid_to date
);
```

## 4. Ingestion and documents

```sql
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
-- documents_source_page (source_file_id, page_from) dropped in 0062: page sorting makes several documents per file page; see document_pages.
create unique index documents_import_row on documents (import_id, import_row) where import_id is not null;
create index documents_retention on documents (retention_until) where finalized_at is not null;
create index documents_register on documents (org_id, coalesce(duzp, issue_date, received_date) desc, id)   -- = M09 doc_date; immutable expression
  where deleted_at is null;
create index documents_search_trgm on documents using gin
  ((coalesce(document_number,'') || ' ' || coalesce(variable_symbol,'') || ' ' || coalesce(partner_snapshot->>'name','')) gin_trgm_ops);

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

create table document_pages (                                       -- pages of a document across files (page sorting, 0060)
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  position smallint not null check (position >= 1),
  source_file_id uuid not null references source_files(id) on delete cascade,
  file_page smallint not null check (file_page >= 1),               -- 1 for an image
  region text not null default '',                                  -- '' whole page; else 'top','left',…
  supplier_key text not null default '', doc_number text not null default '',  -- page look-over hints
  label_n smallint, label_of smallint,                              -- printed "page n of m"
  has_totals boolean not null default false, starts_document boolean not null default true,
  primary key (document_id, position)
);                                                                  -- no rows = the whole source file
create index on document_pages (org_id, source_file_id);
-- Fixes (0061, security invoker): separate_document_pages(document_id) → uuid[]; join_documents(document_id, other_id) → uuid[].
-- documents.upload_batch_id uuid (0060): the files of one upload drop; indexed (org_id, upload_batch_id).

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
```

## 5. Classification support

`categories` is defined in §3 (it must exist before `document_lines`).

```sql
create table vendor_profiles (                                      -- per-tenant memory
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  default_category_code text references categories(code),
  default_vat_treatment vat_treatment,
  default_business_flag text check (default_business_flag in ('business','personal','mixed')),
  confirmations integer not null default 0,                        -- user-confirmed count
  last_confirmed_at timestamptz,
  pinned boolean not null default false,                           -- user rule "Vždy takto"
  multi_category boolean not null default false,                   -- Alza, IKEA: per-line decisions
  extraction_hints jsonb not null default '{}',                    -- field positions, number formats (M02 §4.8)
  unique (org_id, partner_id)
);
```
`global_vendor_priors` (cross-tenant priors) is **Later** (§9.1).

## 6. Money (Phase 2 features; tables exist from Phase 0)

```sql
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
  source_file_id uuid not null references source_files(id) on delete cascade,
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
  document_id uuid not null references documents(id) on delete cascade,
  amount numeric(15,2) not null, account text not null, variable_symbol text,
  checks jsonb not null,                                            -- snapshot of pre-payment checks
  risk_acknowledged_by uuid references auth.users(id),
  primary key (order_id, document_id)
);
create index on payment_order_items (org_id, document_id);
```

## 7. Ledgers (derived; rebuilt by jobs, never edited by users)

```sql
create sequence ledger_build_version_seq;                           -- monotonic, global (M04 §4.13)

create table tax_ledger_entries (                                    -- income tax, cash basis (M04 §4.11)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entry_date date not null,                                         -- payment date (or document date for basis document_evidence / provisional)
  tax_year smallint not null,
  basis text not null default 'payment' check (basis in ('payment','document_evidence','provisional')),
  document_id uuid references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,
  payment_link_id uuid references payment_links(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  category_code text not null references categories(code),
  tax_effect tax_effect not null,
  amount_czk numeric(15,2) not null,                                -- SIGNED: + increases the tax_effect bucket, − decreases
                                                                    -- (credit notes, refunds, remitted pass-through). Payers: net of deducted VAT;
                                                                    -- non-payers/IO: incl. VAT. Before business share.
  business_share_pct numeric(5,2) not null default 100,
  business_amount_czk numeric(15,2) not null default 0,             -- round2(amount_czk × share/100)
  build_version bigint not null
);
create index on tax_ledger_entries (org_id, tax_year, tax_effect);
create index on tax_ledger_entries (org_id, document_id);

create table vat_ledger_entries (                                    -- one entry per (document, vat_treatment, vat_rate_type) group (M05 §4.2)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null, period_end date not null,
  vat_point_date date not null,
  vat_point_rule text not null default 'duzp'
    check (vat_point_rule in ('duzp','max_duzp_received','issue_date','service_period_end','prepayment','eu_goods_15th','user_override')),
  document_id uuid not null references documents(id) on delete cascade,
  line_id uuid references document_lines(id) on delete cascade,     -- null for grouped entries (the default)
  vat_treatment vat_treatment not null,
  vat_rate_type vat_rate_type not null, vat_rate_pct numeric(5,2) not null,
  base_czk numeric(15,2) not null, vat_czk numeric(15,2) not null,
  deduction_pct numeric(5,2) not null default 100,
  currency char(3) not null default 'CZK', base_foreign numeric(15,2),
  fx_rate numeric(12,6), fx_amount integer, fx_rate_date date,      -- ČNB rate used (never the supplier's printed rate)
  dphdp3_rows text[] not null,                                      -- e.g. {'5'} or {'5','43'}
  kh_section text check (kh_section in ('A1','A2','A3','A4','A5','B1','B2','B3')),
  kh_document_total_czk numeric(15,2),                              -- the value the 10 000 Kč test used
  shv_code smallint check (shv_code in (0,1,2,3)),
  counterparty_vat_id text, evidence_number text,
  build_version bigint not null
);
create index on vat_ledger_entries (org_id, period_start);
create index on vat_ledger_entries (org_id, document_id);
```

Cached tax-reserve estimate (M06 §4.11, migration 0045): one row per org, rebuilt by `podklady.reserve.refresh`; users select only.

```sql
create table tax_reserve_estimates (                                -- M06 §4.11 cached reserve; rebuilt by the worker
  org_id uuid primary key references organizations(id) on delete cascade,
  as_of date not null,                                              -- Europe/Prague date the estimate is for
  tax_year smallint not null,
  kind text not null check (kind in ('estimate','pausalni_dan')),
  payload jsonb not null default '{}',                              -- TaxReserveEstimate | PausalniDanReserve, Money as decimal strings
  ledger_hash text,                                                 -- hash of the entries used (M04 build_version), for debouncing
  computed_at timestamptz not null default now()
);
```

## 8. Outputs

```sql
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

create table filing_documents (                                      -- snapshot of what went in
  filing_id uuid not null references filings(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id),
  document_revision integer not null,
  primary key (filing_id, document_id)
);
create index on filing_documents (org_id, document_id);

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

create table export_profiles (                                       -- accountant-owned export settings (M10 §4.7)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target text not null check (target in ('pohoda','money_s3','generic')),
  name text not null,
  file_naming_pattern text not null default 'date_partner_number',
  line_mode text not null default 'summary' check (line_mode in ('summary','lines')),
  settings jsonb not null default '{}',    -- receipts_as, export_bank, cashAccount, number_series, delta_export, keep_diacritics, isdoc_enabled
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, target, name)
);

create table export_mappings (                                       -- accountant's předkontace / členění DPH codes
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  export_profile_id uuid not null references export_profiles(id) on delete cascade,
  key_kind text not null check (key_kind in ('category','category_group','vat_treatment','document_class','kh_section','money_account','payment_method')),
  key text not null, vat_status vat_status,          -- null = any
  target_field text not null check (target_field in ('accounting','classificationVAT','classificationVATType','classificationKVDPH','agenda','account','cashAccount','paymentType')),
  value text not null check (length(value) <= 64),
  unique nulls not distinct (export_profile_id, key_kind, key, vat_status, target_field)
);
create index on export_mappings (org_id, export_profile_id);

create table accountant_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_start date not null, period_end date not null,
  period_kind text not null default 'month' check (period_kind in ('month','quarter','year')),
  version integer not null default 1,
  supersedes_package_id uuid references accountant_packages(id),
  state package_state not null default 'draft',
  completeness jsonb not null default '{}',                         -- {version, score, label, components, missing[], counts} (M10 §4.2)
  completeness_score smallint,                                      -- denormalised for listing / M09
  notes text,                                                       -- owner-only (column trigger)
  export_formats text[] not null default '{zip,xlsx}',              -- + pohoda, isdoc, money_s3
  export_profile_id uuid references export_profiles(id),
  content_hash char(64), manifest_path text, zip_path text,
  generated_at timestamptz, sent_to text[], sent_at timestamptz,
  acknowledged_at timestamptz, acknowledged_by uuid references auth.users(id),
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create unique index accountant_packages_period_version on accountant_packages (org_id, period_start, period_end, version);

create table accountant_package_items (                              -- frozen manifest of a ready package
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  package_id uuid not null references accountant_packages(id) on delete cascade,
  item_kind text not null check (item_kind in ('bookable','supporting','personal','substitute_pdf','statement_file','transaction')),
  document_id uuid references documents(id), document_revision integer,
  transaction_id uuid references transactions(id),
  register_seq text,                       -- 'P-2026-08-004', stable per document across versions
  internal_number text,                    -- 'ND-2026-003' for substitute documents, stable
  file_name text, sha256 char(64),
  has_file boolean not null default true,  -- false → "bez souboru"
  pohoda_item_id text,
  change_kind text not null default 'added' check (change_kind in ('added','changed','unchanged','removed')),
  late_from_period date,
  check (document_id is not null or transaction_id is not null or item_kind = 'statement_file')
);
create index on accountant_package_items (org_id, package_id);
create index on accountant_package_items (org_id, document_id);

create table package_shares (                                        -- e-mail link with expiry (M10 §4.11)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  package_id uuid not null references accountant_packages(id) on delete cascade,
  token_hash char(64) not null unique, recipient_email text,
  expires_at timestamptz not null, revoked_at timestamptz,
  open_count integer not null default 0, last_opened_at timestamptz,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index on package_shares (org_id, package_id);

create table comments (                                              -- accountant ↔ client threads
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  package_id uuid references accountant_packages(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null, resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on comments (org_id, document_id);

create table obligations (                                           -- deadlines & payables to authorities; single writer: M09 generator
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,                                               -- canonical list 04 §9.2
  period_start date, period_end date,
  legal_due_date date,                                              -- before weekend/holiday shift
  due_date date not null,
  amount_estimate numeric(15,2),
  is_optional boolean not null default false,
  state text not null default 'open' check (state in ('open','done','not_applicable','overdue')),
  done_at timestamptz,
  done_source text check (done_source in ('user','filing','evidence_document','bank_payment','profile_change')),
  evidence_document_id uuid references documents(id) on delete set null,
  source_rule text not null, generator_version integer not null default 1,
  filing_id uuid references filings(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint obligations_uniq unique nulls not distinct (org_id, kind, period_start)
);
create index obligations_open_due on obligations (org_id, due_date) where state in ('open','overdue');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  kind text not null,                                               -- snake_case, no dots (04 §9.3)
  payload jsonb not null,
  channel text not null default 'in_app' check (channel in ('in_app','email')),
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  dedupe_key text not null,
  scheduled_for timestamptz, digest_sent_at timestamptz,
  read_at timestamptz, sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_dedupe unique nulls not distinct (org_id, user_id, dedupe_key)
);
```

## 9. Platform

```sql
create table audit_log (                                             -- GLOBAL shape, but rows carry org_id; select via RLS on org_id
  id bigserial primary key,
  org_id uuid, actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user','system','accountant','api','staff')),
  entity text not null, entity_id uuid, action text not null,
  diff jsonb, at timestamptz not null default now()
);
create index on audit_log (org_id, at);

create table rules_overrides (                                       -- GLOBAL; admin hotfix of law data (audited, 06 §2)
  id uuid primary key default gen_random_uuid(),
  rule_key text not null, valid_from date not null, valid_to date,
  value jsonb not null, reason text not null, source text not null, created_by text not null,
  created_at timestamptz not null default now()
);

create table llm_usage_daily (                                       -- tenant-keyed counters; worker writes, owner may read
  org_id uuid not null references organizations(id) on delete cascade,
  day date not null, model text not null,
  calls integer not null, input_tokens bigint not null, output_tokens bigint not null, cost_usd numeric(10,4) not null,
  primary key (org_id, day, model)
);

create table staff_users (                                           -- GLOBAL, service role only (M12 §4.9)
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','support')),
  created_at timestamptz not null default now()
);

create table privacy_requests (                                      -- export / closure (M12 §4.6); RLS owner only
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('export','close_archive','close_delete')),
  requested_by uuid not null references auth.users(id),
  state text not null default 'pending' check (state in ('pending','running','ready','scheduled','done','cancelled','failed')),
  scheduled_for timestamptz, result_path text, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create unlogged table rate_limit_counters (                          -- GLOBAL; fixed-window counters, no Redis (M12 §4.5)
  key text not null, window_start timestamptz not null, hits integer not null,
  primary key (key, window_start)
);
create function app.rate_limit_hit(p_key text, p_max int, p_window_s int) returns boolean
  language sql volatile security definer as $$
  insert into rate_limit_counters as c (key, window_start, hits)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s), 1)
  on conflict (key, window_start) do update set hits = c.hits + 1
  returning hits <= p_max
$$;   -- job ops.rate_limit_gc deletes windows older than 2 days
```

### 9.1 Later (shape agreed; do not migrate until the feature ships)

```sql
-- M04 §4.7, Later: anonymous cross-tenant priors keyed by public company id (needs ≥ 5 agreeing orgs; pointless in the pilot)
create table global_vendor_priors (                                 -- GLOBAL, service role only
  ico_or_vat_id text primary key,
  category_code text references categories(code),
  vat_treatment vat_treatment,
  support integer not null,                                        -- distinct orgs agreeing (≥ 5 to use)
  agreement_share numeric(4,3) not null default 1,                 -- ≥ 0.8 to use
  updated_at timestamptz not null default now()
);

-- M02 §4.10, Later: Batch API re-processing
create table extraction_batches (                                   -- GLOBAL, service role only (spans tenants)
  id uuid primary key default gen_random_uuid(),
  provider text not null, provider_batch_id text not null unique,
  model text not null, prompt_version text not null,
  state text not null check (state in ('submitted','in_progress','ended','failed','cancelled')),
  request_count integer not null, succeeded integer not null default 0, errored integer not null default 0,
  cost_usd numeric(10,4), submitted_at timestamptz not null default now(), ended_at timestamptz
);
alter table extraction_runs add constraint extraction_runs_batch_fk foreign key (batch_id) references extraction_batches(id);

-- M07 §4.4.2, Later (flag features.bank_fio_api, after legal opinion L-01): token connections
create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  money_account_id uuid not null references money_accounts(id) on delete cascade,
  provider text not null check (provider in ('fio')),
  token_ciphertext bytea not null, token_key_id text not null, token_last4 char(4) not null,
  created_on date not null, expires_on date not null,
  last_call_at timestamptz, last_sync_at timestamptz, last_movement_id text,
  state text not null default 'active' check (state in ('active','expired','revoked','error')),
  last_error text
);   -- RLS: service role only for token_ciphertext; users read the view bank_connections_public (no token)

-- M12 §4.9, Later (after the pilot): consent-based support access
create table support_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  allow_write boolean not null default false,
  expires_at timestamptz not null,                                -- default now() + 72 h
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);   -- RLS: owner select/insert/update(revoked_at) on own org
```

## 10. Row-level security (applied to every tenant table)

### 10.1 Pattern

```sql
create function app.user_org_ids() returns setof uuid language sql stable security definer as $$
  select org_id from memberships where user_id = auth.uid()
$$;
create function app.user_has_role(p_org uuid, p_roles member_role[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles))
$$;

-- generated for every table with org_id by the migration helper app.apply_tenant_rls(table, write_roles, org_column):
-- <t>_select, <t>_write and (since 0003_app_worker) <t>_worker. org_column is 'id' for organizations itself.
alter table documents enable row level security;
create policy documents_select on documents for select using (org_id in (select app.user_org_ids()));
create policy documents_write  on documents for all
  using (app.user_has_role(org_id, '{owner,member}')) with check (app.user_has_role(org_id, '{owner,member}'));

-- worker role that respects RLS (M12 §4.4): no BYPASSRLS; withTenant() sets app.org_id per transaction.
-- Migration 0003_app_worker: the role is created only when missing (roles are cluster-wide); its password is set by the owner.
create role app_worker login noinherit nobypassrls;
grant usage on schema public, app to app_worker;
grant select, insert, update, delete on all tables in schema public to app_worker;
-- nullif: after a transaction-local set_config ends, current_setting(.., true) returns '' (not null) on that session.
create function app.current_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
-- generated by app.apply_worker_rls(table, org_column), the last step of app.apply_tenant_rls():
create policy documents_worker on documents for all to app_worker
  using (org_id = app.current_org_id())
  with check (org_id = app.current_org_id());
-- 05 §10.2 "users: select only" tables call app.apply_tenant_rls_read_only(table, org_column) instead (since 0005_documents_core):
-- <t>_select and <t>_worker, no <t>_write; grants unchanged, so a user insert raises 42501 and a user update/delete matches no row.
```

- The worker connects as `app_worker` (`WORKER_DATABASE_URL`; migrations and `withServiceRole` use `DATABASE_URL`) and runs every tenant query inside `withTenant(orgId, fn)`, which sets `app.org_id` for the transaction. A query outside `withTenant` sees zero rows. The service role is used only by migrations, retention/export jobs (which still iterate per org through `withTenant`) and the admin back-office. CI also runs the static check `check:tenant-sql`.
- **Default write roles** = `owner`, `member`. `accountant` and `viewer` read everything in the org.

### 10.2 Exceptions to the default (column-level rules use `with check` or a trigger)

| Table | Rule |
|---|---|
| `memberships`, `taxpayer_profiles`, `organizations` | write: owner only |
| `privacy_requests` | select and write: owner only (since 0007: `app.apply_tenant_rls('privacy_requests', '{owner}')`, then `privacy_requests_select` replaced by an owner-only policy of the same name) |
| `comments` | insert: owner, member, accountant (own `author_id`) |
| `review_questions` | accountant may update only `answer`, `answered_by`, `answered_at` (since 0006: policy `review_questions_accountant_update` plus the before-update trigger `review_questions_accountant_columns`, which raises 42501 on any other column) |
| `accountant_packages` | accountant may update only `state` (`sent → acknowledged`), `acknowledged_at/by`; `notes` owner/member only |
| `export_profiles`, `export_mappings` | insert/update: owner, member, accountant |
| `package_shares` | insert/revoke: owner, member; the service role reads it for `/p/{token}` |
| derived tables (`tax_ledger_entries`, `vat_ledger_entries`, `filing_entries`, `llm_usage_daily`, `extraction_runs`, `ingest_items`, `statement_imports`, `match_suggestions`) | users: select only; writes come from the worker (`app_worker`) |
| `obligations` | users may update only `state`, `done_at`, `done_source` (mark done / undo, owner and member) |

### 10.3 Global tables (no `org_id`, no tenant RLS)

`categories` (read: authenticated), `fx_rates`, `bank_codes` (read: authenticated), `registry_cache`, `rules_overrides`, `staff_users`, `rate_limit_counters` (service role only), plus the Later tables `global_vendor_priors`, `extraction_batches` (service role only). `audit_log` has a nullable `org_id`: users select rows of their orgs; inserts only through server code. `app_worker` (0003) is a server role, not an app role: the migration that creates a global table grants it explicitly (0003's blanket grant covered only the tables that existed then): select on `categories`, `fx_rates`, `bank_codes`; select, insert, update, delete on `registry_cache` (the pipeline caches registry lookups as the worker); since 0007 also select on `rules_overrides` (`rules.at(date)`, 06 §2), usage on `audit_log_id_seq`, and execute on `app.rate_limit_hit()` (with `service_role`; `authenticated` and `anon` may not call it, and nobody but the function touches `rate_limit_counters`). The RLS meta-test (M12 §4.4) holds this list as its allowlist; a new table without `org_id` that is not listed fails CI.

**Storage objects** (ADR-004; migration 0008): bucket `org-files` is private. `storage.objects` has four policies for `authenticated` on names `org/{org_id}/…`: `org_files_select` (every member of the org, through `app.user_org_ids()`) and `org_files_insert`, `org_files_update`, `org_files_delete` (owner or member, through `app.user_has_role`). `app.storage_org_id(name)` reads the org id out of an object name and is null for any other shape, so an object outside `org/{uuid}/` is invisible and unwritable to users. Server code and the worker reach storage through `BlobStore` (`packages/platform`) with the service key, never through these policies; `app_worker` has no grant on `storage.objects`. The RLS suite's `storage.db.test.ts` (M12 §4.4 item 5) pins this and skips where `storage.objects` does not exist.

## 11. Retention

| Data | Retention |
|---|---|
| Finalized bookable documents + files | `documents.retention_until` = 31 Dec of (year of `coalesce(duzp, issue_date)` + 10) + 1 year buffer (VAT §35; 11 years by default) |
| Supporting documents, non-documents | as the user wishes; trash after 30 days |
| Upload staging `incoming/` | 24 h; 90 days for `unsupported` / `too_large` items (downloadable) |
| Quarantine (infected files, spoofed e-mails) | 30 days |
| Raw `.eml` and `inbound_emails.body_text` | 90 days (metadata row kept) |
| `extraction_runs.raw_response_path` | 30 days |
| `package_shares` | 90 days after `expires_at` (audit log keeps the opens) |
| Audit log | 10 years |
| Rodné číslo (only for the Phase 4 partial XML) | never stored at rest; asked at generation time, used in memory, discarded |
