-- 0002_tenancy: organizations, memberships, taxpayer_profiles (05 §2), the RLS helpers
-- app.user_org_ids(), app.user_has_role(), app.apply_tenant_rls() (05 §10.1) and the owner-only
-- write rule for these three tables (05 §10.2). Forward-only. invitations (05 §2) is a later ticket.

-- updated_at trigger (05 conventions)
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text, dic text,
  inbound_email_slug text unique not null,          -- local part of {slug}-{secret}@in.<domain>
  inbound_email_secret text not null,               -- 8 chars Crockford base32, rotatable (M01 §4.10)
  inbound_email_secret_prev text,                   -- still accepted until _prev_until (rotation grace, 7 days)
  inbound_email_secret_prev_until timestamptz,
  settings jsonb not null default '{}',             -- zod OrgSettings
  closed_at timestamptz, archive_mode boolean not null default false,   -- account closure (M12 §4.6)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create trigger organizations_touch_updated_at before update on organizations
  for each row execute function app.touch_updated_at();

create table memberships (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  invited_by uuid references auth.users(id),
  prefs jsonb not null default '{}',                -- per-user UI + notification prefs (zod MembershipPrefs)
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_id on memberships (user_id);

create table taxpayer_profiles (                     -- effective-dated; no overlaps per org (exclusion constraint)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  valid_from date not null, valid_to date,           -- null = open-ended
  vat_status vat_status not null,
  vat_period vat_period,
  tax_regime tax_regime not null,
  pausal_rate smallint check (pausal_rate in (80,60,40,30)),
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
create index taxpayer_profiles_org_id_valid_from on taxpayer_profiles (org_id, valid_from);

-- RLS helpers (05 §10.1). security definer: the owner (postgres) bypasses RLS on memberships,
-- so the lookup cannot recurse into the memberships policies.
create function app.user_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid()
$$;
create function app.user_has_role(p_org uuid, p_roles member_role[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)
  )
$$;

-- Migration helper: enables RLS on a tenant table and creates <t>_select / <t>_write (05 §10.1).
-- p_org_column is 'id' for organizations itself. Re-runnable (drops the two policies first).
create function app.apply_tenant_rls(
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
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
grant execute on function app.user_org_ids() to anon, authenticated, service_role;
grant execute on function app.user_has_role(uuid, member_role[]) to anon, authenticated, service_role;

-- 05 §10.2: memberships, taxpayer_profiles, organizations are written by owners only.
select app.apply_tenant_rls('organizations', '{owner}', 'id');
select app.apply_tenant_rls('memberships', '{owner}');
select app.apply_tenant_rls('taxpayer_profiles', '{owner}');
