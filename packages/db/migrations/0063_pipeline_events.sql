-- 0063_pipeline_events (05 §4, brief 0520, owner 2026-10-26): one row per step of a document's life,
-- so we can count why documents did not go straight to ready. Codes, field keys and ids only, never
-- document content (rules: privacy). Reads and failed reads come from the worker; status changes from
-- a trigger; user actions from audit_document(). Users of the org may read (05 §10.2). Forward-only.
create table pipeline_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('status','read','read_failed','user_edit','user_trash',
                                     'user_restore','user_manual','user_answer')),
  code text,                -- status: new status; read: outcome status; read_failed: error code; user_edit: filled|changed
  detail text,              -- read: pre-check reason when skipped; read_failed: final|retry
  from_status text,         -- status: the status before (null on insert)
  field_key text,           -- user_edit: the field the user changed
  extraction_run_id uuid references extraction_runs(id) on delete set null,
  method text, model text, prompt_version text, attempt smallint,
  blocking text[] not null default '{}',   -- read: rule ids of blocking checks
  warnings text[] not null default '{}'    -- read: rule ids of warnings
);
create index on pipeline_events (org_id, at);
create index on pipeline_events (document_id, at);
create index on pipeline_events (kind, at);

select app.apply_tenant_rls_read_only('pipeline_events');
grant usage on sequence pipeline_events_id_seq to app_worker;

-- Every new document and every status change, whoever makes it (worker, user, job).
create function app.log_document_status() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into pipeline_events (org_id, document_id, kind, code)
    values (new.org_id, new.id, 'status', new.status::text);
  elsif new.status is distinct from old.status then
    insert into pipeline_events (org_id, document_id, kind, code, from_status)
    values (new.org_id, new.id, 'status', new.status::text, old.status::text);
  end if;
  return null;
end
$$;
revoke execute on function app.log_document_status() from public;
create trigger documents_log_status after insert or update of status on documents
  for each row execute function app.log_document_status();

-- audit_document v2: same checks and audit row as 0050, plus one pipeline_events row (no values).
create or replace function public.audit_document(p_document uuid, p_action text, p_diff jsonb)
  returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  if p_action not in ('edit_field', 'trash', 'restore', 'create_manual', 'answer_question') then
    raise exception 'bad_action' using errcode = '22023';
  end if;
  select org_id into v_org from documents where id = p_document;
  if v_org is null or not app.user_has_role(v_org, array['owner', 'member']::member_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into audit_log (org_id, actor_user_id, actor_kind, entity, entity_id, action, diff)
  values (v_org, auth.uid(), 'user', 'documents', p_document, p_action, p_diff);
  insert into pipeline_events (org_id, document_id, kind, code, field_key)
  values (
    v_org, p_document,
    case p_action when 'edit_field' then 'user_edit' when 'trash' then 'user_trash'
      when 'restore' then 'user_restore' when 'create_manual' then 'user_manual' else 'user_answer' end,
    case when p_action = 'edit_field' then
      case when coalesce(p_diff->>'old', '') = '' then 'filled' else 'changed' end end,
    case when p_action = 'edit_field' then left(p_diff->>'field', 64) end);
end
$$;
revoke execute on function public.audit_document(uuid, text, jsonb) from public, anon;
grant execute on function public.audit_document(uuid, text, jsonb) to authenticated;
