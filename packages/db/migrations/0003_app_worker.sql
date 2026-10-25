-- 0003_app_worker: the worker role that respects RLS (05 §10.1, M12 §4.4 Worker isolation).
-- app_worker has no BYPASSRLS; withTenant(orgId, fn) (packages/db/src/tenant.ts) sets app.org_id
-- for one transaction and the <t>_worker policy lets it see exactly that org. Without the setting
-- the policy compares with null and the worker sees zero rows. Forward-only.
--
-- Roles are cluster-wide, so the role is created only when missing (a test database that is
-- migrated from scratch keeps the role). The password is set by the owner outside migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker login noinherit nobypassrls;
  end if;
end $$;

grant usage on schema public, app to app_worker;
grant select, insert, update, delete on all tables in schema public to app_worker;
grant usage, select on all sequences in schema public to app_worker;
grant execute on function app.user_org_ids() to app_worker;
grant execute on function app.user_has_role(uuid, member_role[]) to app_worker;

-- Org of the current transaction, as set by withTenant(). nullif: after a transaction-local
-- set_config ends, current_setting(.., true) returns '' (not null) on the same session, and
-- ''::uuid would raise instead of hiding the rows.
create function app.current_org_id() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
grant execute on function app.current_org_id() to anon, authenticated, service_role, app_worker;

-- Migration helper: adds the <t>_worker policy to a tenant table. p_org_column is 'id' for
-- organizations itself. Re-runnable (drops the policy first).
create function app.apply_worker_rls(p_table text, p_org_column text default 'org_id')
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_worker', p_table);
  execute format(
    'create policy %I on public.%I for all to app_worker '
    || 'using (%I = app.current_org_id()) with check (%I = app.current_org_id())',
    p_table || '_worker', p_table, p_org_column, p_org_column);
  execute format('grant select, insert, update, delete on public.%I to app_worker', p_table);
end
$$;

-- From now on app.apply_tenant_rls() creates all three policies (<t>_select, <t>_write, <t>_worker),
-- so every later migration keeps calling it once per tenant table.
create or replace function app.apply_tenant_rls(
  p_table text,
  p_write_roles member_role[] default '{owner,member}',
  p_org_column text default 'org_id'
) returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format(
    'create policy %I on public.%I for select using (%I in (select app.user_org_ids()))',
    p_table || '_select', p_table, p_org_column);
  execute format('drop policy if exists %I on public.%I', p_table || '_write', p_table);
  execute format(
    'create policy %I on public.%I for all using (app.user_has_role(%I, %L::member_role[])) '
    || 'with check (app.user_has_role(%I, %L::member_role[]))',
    p_table || '_write', p_table, p_org_column, p_write_roles, p_org_column, p_write_roles);
  -- Supabase grants these by default privileges; plain Postgres (local test cluster) does not.
  execute format('grant select, insert, update, delete on public.%I to authenticated', p_table);
  perform app.apply_worker_rls(p_table, p_org_column);
end
$$;

-- The three tenancy tables of 0002 get their worker policy now.
select app.apply_worker_rls('organizations', 'id');
select app.apply_worker_rls('memberships');
select app.apply_worker_rls('taxpayer_profiles');
