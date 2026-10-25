# 0061: create_firm() database function

Status: todo
Ticket: P1-ONB-01 (onboarding from IČO) | Depends on: none | Base commit: 37d843b | Branch: claude/project-thread-e840r7 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add migration `0015_onboarding` with one security-definer function `public.create_firm(p jsonb)` that a signed-in user with no firm calls once: it creates the organization, the owner membership and the first taxpayer profile in one transaction. RLS cannot do this (05 §10.2: only an owner may insert, and a new user is not an owner of anything yet; `rls-catalog.ts` `NO_USER_INSERT` says organizations are created by server code).

## 2. Context

- Tables (from `packages/db/migrations/0002_tenancy.sql`): `organizations(name, ico, dic, inbound_email_slug unique, inbound_email_secret …)`, `memberships(org_id, user_id, role member_role)`, `taxpayer_profiles(org_id, valid_from, vat_status, vat_period, tax_regime, pausal_rate in (80,60,40,30), pausal_dan_band in (1,2,3), entity_type default 'osvc', legal_name, ico, dic, address jsonb, fu_code, main_activity_nace …)`. `audit_log(org_id, actor_user_id, actor_kind, entity, entity_id, action, diff)` from 0007.
- Enums: `vat_status ('neplatce','identifikovana_osoba','platce')`, `vat_period ('monthly','quarterly')`, `tax_regime ('danova_evidence','pausalni_vydaje','pausalni_dan','ucetnictvi')`.
- One firm per user (owner decision 2026-10-25). Inbound address is `{slug}-{secret}@in.<domain>`, secret 8 chars Crockford base32 (M01 §4.10).
- Style model: `app.rate_limit_hit` in `0007_platform.sql` (security definer, `set search_path = public, pg_temp`, explicit revoke/grant).
- Migrations: SQL file in `packages/db/migrations/` plus an entry in `packages/db/migrations/meta/_journal.json`. Another thread may add 0009–0014; if the journal already has more entries when you start, append after the last one (idx = last idx + 1, `when` = last `when` + 1).
- Hard rules 3 and 5: RLS test in the same PR; schema change = migration + 05 edit.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0015_onboarding.sql` | new | the function |
| `packages/db/migrations/meta/_journal.json` | edit | one entry, tag `0015_onboarding` |
| `packages/db/test/migrations/onboarding.db.test.ts` | new | tests |
| `docs/v3/05-data-model.md` | edit | one paragraph at the end of §2 (before `## 3.`) |

No other file may change.

## 4. Steps

1. Start Postgres: `packages/db/scripts/local-pg.sh start 2>&1 | tail -3` and `export DATABASE_URL=<printed url>` in every later command (prefix it, the shell does not keep exports).

2. Create `0015_onboarding.sql` with exactly this content:

```sql
-- 0015_onboarding: public.create_firm(p jsonb), the one way a new user gets an organization
-- (M11 §5.5). RLS cannot do it: organizations/memberships/taxpayer_profiles are owner-write only
-- (05 §10.2) and a new user owns nothing yet. One firm per user (owner decision 2026-10-25).
-- Errors (message text, errcode P0001 unless noted): not_authenticated (42501), already_has_firm,
-- invalid_profile.

create function app.crockford8() returns text
  language sql volatile set search_path = public, pg_temp as $$
  -- 8 random chars from the uuid's random bytes (0-5, 10, 11; 6 and 8 carry version/variant bits)
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) s, unnest(array[0,1,2,3,4,5,10,11]) as i
$$;
revoke execute on function app.crockford8() from public, anon, authenticated;

create function public.create_firm(p jsonb) returns jsonb
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
```

3. Journal entry (copy the shape of the `0008_storage` entry): `"tag": "0015_onboarding"`.
   Run `DATABASE_URL=… pnpm --filter @shoebox/db test -- migrations 2>&1 | tail -30` → existing tests pass.

4. `test/migrations/onboarding.db.test.ts`. Copy the `describe.skipIf(DATABASE_URL === undefined)`, `sql` setup and the `as(uid, fn)` rollback helper from `test/migrations/tenancy.db.test.ts` (lines 1–60), but in `beforeAll` only call `runMigrations(url)` (do NOT drop tables) and insert three users into `auth.users` with fresh uuids starting `0f0f0f0f-0000-4000-8000-…` (`on conflict do nothing`). Every test runs inside `as(...)` so it rolls back. A helper `firm(overrides)` builds the input:
   `{ name: 'Test OSVČ', ico: '27082440', dic: 'CZ27082440', vat_status: 'neplatce', tax_regime: 'pausalni_vydaje', pausal_rate: 60, valid_from: '2026-01-01', address: { street: 'Jankovcova', house_number: '1522', orientation_number: '53', city: 'Praha', zip: '17000', country: 'CZ' }, slug_base: 'test-osvc', ...overrides }`, called as ``tx`select public.create_firm(${tx.json(input)}) as r` ``.
   Tests:
   - creates the firm: returns `org_id`, slug `test-osvc`, secret matching `/^[0-9A-HJKMNP-TV-Z]{8}$/`; in the same transaction the user selects exactly 1 row from `organizations`, 1 `memberships` row with role `owner`, 1 `taxpayer_profiles` row with `pausal_rate` 60 and `entity_type` `osvc`, and 1 `audit_log` row with action `create_firm`.
   - a second call by the same user fails with message `already_has_firm`.
   - anonymous (`as(null, …)`) fails with code `42501`.
   - `vat_status: 'platce'` without `vat_period` fails `invalid_profile`; `tax_regime: 'pausalni_dan', pausal_dan_band: 1, pausal_rate: undefined, vat_status: 'platce', vat_period: 'monthly'` fails `invalid_profile`; `ico: '1234'` fails `invalid_profile`.
   - `vat_status: 'identifikovana_osoba'` stores `vat_period = 'monthly'`.
   - slug collision: user 1 and user 2 both with `slug_base: 'test-osvc'` inside one `sql.begin` block (set `request.jwt.claim.sub` before each call, `set local role authenticated`, roll back at the end) get different slugs, the second matching `/^test-osvc-[0-9a-z]{4}$/`.
   - a bad `slug_base` (`'Bad Slug!'`) gives slug `firma` (or `firma-xxxx`).
   - the user still cannot `insert into organizations` directly (code `42501`).
   Run `DATABASE_URL=… pnpm --filter @shoebox/db test -- onboarding 2>&1 | tail -30` → all pass.

5. `05-data-model.md`, end of §2, add:

```md
**Creating a firm (0015).** A new user has no membership, so RLS cannot let them insert. `public.create_firm(p jsonb)` (security definer, `authenticated` only) creates `organizations`, the owner `memberships` row, the first `taxpayer_profiles` segment and an `audit_log` row in one transaction, and returns `{org_id, inbound_email_slug, inbound_email_secret}`. One firm per user: a caller who already has a membership gets `already_has_firm`. It checks the profile combination (payer needs `vat_period`, identified person gets `monthly`, `pausalni_vydaje` needs `pausal_rate`, `pausalni_dan` needs a band and a non-payer, no `ucetnictvi` for OSVČ) and raises `invalid_profile`. The slug comes from the name (made unique with a 4-char suffix); the secret is 8 Crockford base32 chars.
```
Run `python3 scripts/context_lint.py 2>&1 | tail -5`.

## 5. Do not touch

Every other migration, `rls-catalog.ts`, `apps/`. Never edit an existing migration (forward-only).

## 6. Commands

- `DATABASE_URL=… pnpm --filter @shoebox/db test -- migrations rls 2>&1 | tail -30` → all pass.
- `pnpm exec tsx scripts/migration-lint.ts packages/db/migrations/0015_onboarding.sql 2>&1 | tail -10` (if the script takes other args, read its `main` usage line and run it the way CI does) → clean.
- `pnpm exec biome ci packages/db 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] §6 commands pass; the new test file has ≥ 8 passing tests.
- [ ] `git diff --stat` lists only §3 files plus the report.

## 8. Stop and ask

Stop and write the report if: the SQL in step 2 fails to apply (paste the error, do not redesign it); migration-lint rejects it; a test fails twice; 25 tool calls or about 50k tokens; a file outside §3 needs a change.

## 9. Report

Write `docs/tasks/0061-report.md` (600 tokens at most) and set `Status: review`.

## Risk list (for the reviewer)

`0015_onboarding.sql` (security definer: search_path pinned, uid check, grants, advisory lock).

## Owner steps

None.
