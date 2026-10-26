-- 0052_purge_trash: hard-deletes trashed documents older than the cutoff (M12 §4.6 retention.trash_purge).
-- Retained documents (finalized, retention_until not passed) are never deleted. A source file goes
-- only when no other document or page uses it. Returns what the worker must remove from Storage.
-- Service role only (the worker's retention job). Forward-only.
create or replace function app.purge_trash(p_cutoff timestamptz, p_today date, p_limit int)
  returns table (org_id uuid, kind text, path text)
  language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_docs uuid[];
  v_files uuid[];
begin
  select coalesce(array_agg(t.id), '{}') into v_docs from (
    select d.id from documents d
    where d.deleted_at < p_cutoff
      and not (d.finalized_at is not null and (d.retention_until is null or d.retention_until >= p_today))
    order by d.deleted_at
    limit p_limit
    for update skip locked
  ) t;
  if cardinality(v_docs) = 0 then
    return;
  end if;

  return query select d.org_id, 'document'::text, null::text from documents d where d.id = any(v_docs);
  return query select r.org_id, 'raw'::text, r.raw_response_path from extraction_runs r
    where r.document_id = any(v_docs) and r.raw_response_path is not null;
  insert into audit_log (org_id, actor_kind, entity, action, diff)
    select d.org_id, 'system', 'documents', 'trash_purge', jsonb_build_object('documents', count(*))
    from documents d where d.id = any(v_docs) group by d.org_id;

  select coalesce(array_agg(distinct d.source_file_id), '{}') into v_files
    from documents d where d.id = any(v_docs) and d.source_file_id is not null;
  delete from documents d where d.id = any(v_docs);

  v_files := array(
    select f from unnest(v_files) f
    where not exists (select 1 from documents o where o.source_file_id = f)
      and not exists (select 1 from document_pages p where p.source_file_id = f)
  );
  update ingest_items i set source_file_id = null where i.source_file_id = any(v_files);
  return query
    with gone as (delete from source_files s where s.id = any(v_files) returning s.org_id, s.storage_path)
    select gone.org_id, 'file'::text, gone.storage_path from gone;
end
$$;
revoke execute on function app.purge_trash(timestamptz, date, int) from public, anon, authenticated, app_worker;
