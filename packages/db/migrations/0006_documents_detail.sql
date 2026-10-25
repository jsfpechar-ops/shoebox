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
