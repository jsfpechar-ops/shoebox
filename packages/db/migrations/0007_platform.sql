-- 0007_platform: 05 §9 Platform: audit_log, rules_overrides, llm_usage_daily, staff_users,
-- privacy_requests, rate_limit_counters and app.rate_limit_hit(). Three tenant tables: audit_log
-- (nullable org_id, users select rows of their orgs, inserts only through server code) and
-- llm_usage_daily are select-only for users (05 §10.2, app.apply_tenant_rls_read_only(), 0005);
-- privacy_requests is select and write owner-only (05 §10.2: an owner-only <t>_select replaces the
-- default one). Three global tables (05 §10.3, service role only): rules_overrides (the worker
-- reads it: M02 §9), staff_users, rate_limit_counters (reached only through the security definer
-- function). The 05 §9.1 Later tables are not created. Forward-only.

create table audit_log (                                             -- GLOBAL shape, but rows carry org_id; select via RLS on org_id
  id bigserial primary key,
  org_id uuid, actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user','system','accountant','api','staff')),
  entity text not null, entity_id uuid, action text not null,
  diff jsonb, at timestamptz not null default now()
);
create index on audit_log (org_id, at);
-- 0003's "grant on all sequences" covered only the sequences that existed then; without this the
-- worker's insert (bigserial default) fails with 42501.
grant usage, select on sequence audit_log_id_seq to app_worker;

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
create trigger privacy_requests_touch_updated_at before update on privacy_requests
  for each row execute function app.touch_updated_at();

create unlogged table rate_limit_counters (                          -- GLOBAL; fixed-window counters, no Redis (M12 §4.5)
  key text not null, window_start timestamptz not null, hits integer not null,
  primary key (key, window_start)
);
-- security definer: the caller needs no privilege on rate_limit_counters; search_path is pinned
-- so the body always resolves public.rate_limit_counters (job ops.rate_limit_gc deletes windows
-- older than 2 days).
create function app.rate_limit_hit(p_key text, p_max int, p_window_s int) returns boolean
  language sql volatile security definer set search_path = public, pg_temp as $$
  insert into rate_limit_counters as c (key, window_start, hits)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s), 1)
  on conflict (key, window_start) do update set hits = c.hits + 1
  returning hits <= p_max
$$;
revoke execute on function app.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, int, int) to service_role, app_worker;

-- Tenant RLS (05 §10.1, §10.2).
select app.apply_tenant_rls_read_only('audit_log');
select app.apply_tenant_rls_read_only('llm_usage_daily');
select app.apply_tenant_rls('privacy_requests', '{owner}');
-- 05 §10.2 "privacy_requests | select and write: owner only": the generated <t>_select lets every
-- member of the org read, so it is replaced by an owner-only one (same name, the meta-test's).
drop policy privacy_requests_select on privacy_requests;
create policy privacy_requests_select on privacy_requests for select
  using (app.user_has_role(org_id, '{owner}'::member_role[]));

-- Global tables (05 §10.3): service role only. Supabase's default privileges grant everything on
-- a new table to anon, authenticated and service_role, so the app-role grants are revoked (plain
-- Postgres: no-ops). The worker (app_worker, 0003) reads rules_overrides (rules.at(date), 06 §2;
-- M02 §9) and gets nothing on staff_users or rate_limit_counters (it calls app.rate_limit_hit()).
revoke all on rules_overrides, staff_users, rate_limit_counters from anon, authenticated;
grant select on rules_overrides to app_worker;
