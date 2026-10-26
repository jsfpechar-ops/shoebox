-- 0044_obligations: 05 §8 deadlines and payables to authorities (VAT return, KH, SH, VAT payment).
-- Single writer: the worker (M09 generator, M05 lifecycle). Forward only.

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

-- 05 §10.2: "obligations | users may update only state, done_at, done_source (mark done / undo,
-- owner and member)". Users select (no insert or delete policy: the worker writes those rows).
select app.apply_tenant_rls_read_only('obligations');

create policy obligations_user_update on obligations for update to authenticated
  using (app.user_has_role(org_id, '{owner,member}'::member_role[]))
  with check (app.user_has_role(org_id, '{owner,member}'::member_role[]));

-- A policy cannot compare old and new columns, so a before-update trigger raises 42501
-- (insufficient_privilege) when a signed-in user changes any column but state, done_at and
-- done_source. The worker has auth.uid() null and passes. Security definer (as app.user_has_role):
-- app_worker has no privilege on schema auth, and the trigger runs for its updates too.
create function app.obligations_user_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (
    (old.id, old.org_id, old.kind, old.period_start, old.period_end, old.legal_due_date, old.due_date,
     old.amount_estimate, old.is_optional, old.evidence_document_id, old.source_rule,
     old.generator_version, old.filing_id, old.created_at, old.updated_at)
    is distinct from
    (new.id, new.org_id, new.kind, new.period_start, new.period_end, new.legal_due_date, new.due_date,
     new.amount_estimate, new.is_optional, new.evidence_document_id, new.source_rule,
     new.generator_version, new.filing_id, new.created_at, new.updated_at)
  ) then
    raise insufficient_privilege using
      message = 'obligations: a user may update only state, done_at, done_source (05 §10.2)';
  end if;
  return new;
end
$$;
create trigger obligations_user_columns before update on obligations
  for each row execute function app.obligations_user_columns();
