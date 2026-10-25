-- 0008_storage: ADR-004 bucket org-files (private) and its storage.objects policies (M12 §4.4 RLS
-- suite item 5, §4.5 V4.2). A user reads only objects named org/{org_id}/... of an org they belong
-- to and inserts, updates or deletes them only as owner or member (M12 §4.4 role matrix: upload,
-- delete documents). app.storage_org_id(name) reads the org id out of an object name and is null
-- for every other shape, so an object outside org/{uuid}/ is invisible and unwritable to users.
-- Server code and the worker reach storage through BlobStore with the service key, never through
-- these policies; app_worker gets nothing on storage.objects. The storage block runs only where
-- storage.objects exists (Supabase; the local shim): on a bare Postgres it is a no-op and
-- test/rls/storage.db.test.ts skips. Forward-only (the policies are re-creatable: drop if exists).

create function app.storage_org_id(p_name text) returns uuid
  language sql immutable strict parallel safe as $$
  select case
    when p_name ~ '^org/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      then split_part(p_name, '/', 2)::uuid
    else null
  end
$$;
grant execute on function app.storage_org_id(text) to anon, authenticated, service_role, app_worker;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '0008_storage: storage.objects absent, bucket and policies skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('org-files', 'org-files', false)
    on conflict (id) do nothing;

  drop policy if exists org_files_select on storage.objects;
  create policy org_files_select on storage.objects for select to authenticated
    using (bucket_id = 'org-files' and app.storage_org_id(name) in (select app.user_org_ids()));

  drop policy if exists org_files_insert on storage.objects;
  create policy org_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));

  drop policy if exists org_files_update on storage.objects;
  create policy org_files_update on storage.objects for update to authenticated
    using (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]))
    with check (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));

  drop policy if exists org_files_delete on storage.objects;
  create policy org_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'org-files'
      and app.user_has_role(app.storage_org_id(name), '{owner,member}'::member_role[]));
end $$;
