-- 0051_backups_bucket: private bucket for the nightly encrypted dump (.github/workflows/backup.yml).
-- No storage policies: only the service role reads or writes it. Forward-only.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '0051_backups_bucket: storage.objects absent, bucket skipped';
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
    on conflict (id) do nothing;
end
$$;
