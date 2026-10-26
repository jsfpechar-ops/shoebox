-- 0050_audit_document: one audited entry point for user changes to a document (M11 §13.1).
-- audit_log is select-only for users (0007), so inserts go through this security definer function.
-- Owner or member of the document's org only. Forward-only.
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
end
$$;
revoke execute on function public.audit_document(uuid, text, jsonb) from public, anon;
grant execute on function public.audit_document(uuid, text, jsonb) to authenticated;
