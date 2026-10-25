-- 0015_onboarding: public.create_firm(p jsonb), the one way a new user gets an organization
-- (M11 §5.5). RLS cannot do it: organizations/memberships/taxpayer_profiles are owner-write only
-- (05 §10.2) and a new user owns nothing yet. One firm per user (owner decision 2026-10-25).
-- Errors (message text, errcode P0001 unless noted): not_authenticated (42501), already_has_firm,
-- invalid_profile.

-- or replace: tenancy.db.test.ts resets tables and schema app but not public functions
create or replace function app.crockford8() returns text
  language sql volatile set search_path = public, pg_temp as $$
  -- 8 random chars from the uuid's random bytes (0-5, 10, 11; 6 and 8 carry version/variant bits)
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) s, unnest(array[0,1,2,3,4,5,10,11]) as i
$$;
revoke execute on function app.crockford8() from public, anon, authenticated;

create or replace function public.create_firm(p jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_ico text := p->>'ico';
  v_vat vat_status := (p->>'vat_status')::vat_status;
  v_period vat_period := (p->>'vat_period')::vat_period;
  v_regime tax_regime := (p->>'tax_regime')::tax_regime;
  v_rate smallint := (p->>'pausal_rate')::smallint;
  v_band smallint := (p->>'pausal_dan_band')::smallint;
  v_base text := coalesce(p->>'slug_base', '');
  v_slug text;
  v_secret text := app.crockford8();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- serialize per user so two tabs cannot create two firms
  perform pg_advisory_xact_lock(hashtext('create_firm:' || v_uid::text));
  if exists (select 1 from memberships where user_id = v_uid) then
    raise exception 'already_has_firm';
  end if;

  if v_name = '' or length(v_name) > 200 or v_ico is null or v_ico !~ '^\d{8}$'
     or (p->>'valid_from') is null or jsonb_typeof(p->'address') is distinct from 'object'
     or (v_vat = 'platce' and v_period is null)
     or (v_vat = 'neplatce' and v_period is not null)
     or (v_regime = 'pausalni_vydaje') <> (v_rate is not null)
     or (v_regime = 'pausalni_dan') <> (v_band is not null)
     or (v_regime = 'pausalni_dan' and v_vat = 'platce')
     or v_regime = 'ucetnictvi' then
    raise exception 'invalid_profile';
  end if;
  if v_vat = 'identifikovana_osoba' then
    v_period := 'monthly';                               -- M11 §5.5: IO files monthly
  end if;

  if v_base !~ '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$' then
    v_base := 'firma';
  end if;
  v_slug := v_base;
  while exists (select 1 from organizations where inbound_email_slug = v_slug) loop
    v_slug := v_base || '-' || lower(substr(app.crockford8(), 1, 4));
  end loop;

  insert into organizations (name, ico, dic, inbound_email_slug, inbound_email_secret)
  values (v_name, v_ico, nullif(p->>'dic', ''), v_slug, v_secret)
  returning id into v_org;

  insert into memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');

  insert into taxpayer_profiles (org_id, valid_from, vat_status, vat_period, tax_regime,
    pausal_rate, pausal_dan_band, legal_name, ico, dic, address, fu_code, main_activity_nace)
  values (v_org, (p->>'valid_from')::date, v_vat, v_period, v_regime, v_rate, v_band,
    v_name, v_ico, nullif(p->>'dic', ''), p->'address', nullif(p->>'fu_code', ''),
    nullif(p->>'main_activity_nace', ''));

  insert into audit_log (org_id, actor_user_id, actor_kind, entity, entity_id, action)
  values (v_org, v_uid, 'user', 'organizations', v_org, 'create_firm');

  return jsonb_build_object('org_id', v_org, 'inbound_email_slug', v_slug,
    'inbound_email_secret', v_secret);
end
$$;
revoke execute on function public.create_firm(jsonb) from public, anon;
grant execute on function public.create_firm(jsonb) to authenticated;
