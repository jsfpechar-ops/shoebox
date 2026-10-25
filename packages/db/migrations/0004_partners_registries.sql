-- 0004_partners_registries: 05 §3 Partners and registries (partners, partner_bank_accounts and the
-- global tables registry_cache, fx_rates, bank_codes, categories) and 05 §5 Classification support
-- (vendor_profiles). Tenant tables get their three policies through app.apply_tenant_rls()
-- (05 §10.1). Global tables have no org_id and no RLS (05 §10.3): app roles only read them, and
-- only where 05 says so. global_vendor_priors is Later (05 §9.1) and is not created. Forward-only.

create table partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  ico text, dic text, vat_id text,                   -- vat_id = foreign VAT (IE…, NL…)
  country char(2) not null default 'CZ',
  address jsonb,
  is_vat_payer boolean, is_unreliable_payer boolean,
  registry_checked_at timestamptz,
  email_domains text[] not null default '{}',        -- learned from inbound e-mails
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, ico), unique (org_id, vat_id)
);
create trigger partners_touch_updated_at before update on partners
  for each row execute function app.touch_updated_at();

create table partner_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  account_number text, bank_code text, iban text, bic text,
  published_in_crpdph boolean, checked_at timestamptz,
  unique (org_id, partner_id, iban)
);

create table registry_cache (                        -- GLOBAL, service role only
  source text not null check (source in ('ares','crpdph','vies')),
  key text not null,                                 -- IČO / DIČ / VAT ID
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source, key)
);
create table fx_rates (                              -- GLOBAL; ČNB daily fixing
  rate_date date not null, currency char(3) not null,
  amount integer not null, rate numeric(12,6) not null,
  published_at timestamptz not null,
  primary key (rate_date, currency)
);
create table bank_codes (                            -- GLOBAL; ČNB bank code list, monthly refresh (M03 ID_BANK_CODE_UNKNOWN, M07 BIC)
  code char(4) primary key, name text not null, bic text,
  valid_from date not null, valid_to date
);

create table categories (                            -- GLOBAL seed data (04 §3.1); here because document_lines references it
  code text primary key,
  direction direction not null,
  tax_effect tax_effect not null,
  label_cs text not null, label_en text not null, explanation_cs text not null,
  icon text, sort integer not null,
  replaced_by text references categories(code),     -- retired category → successor (M04 §8)
  valid_from date not null default '2000-01-01', valid_to date
);

-- 05 §5 Classification support
create table vendor_profiles (                                      -- per-tenant memory
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  default_category_code text references categories(code),
  default_vat_treatment vat_treatment,
  default_business_flag text check (default_business_flag in ('business','personal','mixed')),
  confirmations integer not null default 0,                        -- user-confirmed count
  last_confirmed_at timestamptz,
  pinned boolean not null default false,                           -- user rule "Vždy takto"
  multi_category boolean not null default false,                   -- Alza, IKEA: per-line decisions
  extraction_hints jsonb not null default '{}',                    -- field positions, number formats (M02 §4.8)
  unique (org_id, partner_id)
);

-- Tenant tables: default write roles owner, member (05 §10.1); _select, _write, _worker policies.
select app.apply_tenant_rls('partners');
select app.apply_tenant_rls('partner_bank_accounts');
select app.apply_tenant_rls('vendor_profiles');

-- Global tables (05 §10.3). Supabase's default privileges grant everything on a new table to anon,
-- authenticated and service_role, so the app-role grants are revoked first and re-granted exactly
-- (plain Postgres: the revokes are no-ops). The worker (app_worker, 0003) reads what the pipeline
-- needs and maintains registry_cache; the 0003 "grant on all tables" covered only existing tables.
revoke all on registry_cache, fx_rates, bank_codes, categories from anon, authenticated;
grant select on categories, fx_rates, bank_codes to authenticated;
grant select on categories, fx_rates, bank_codes to app_worker;
grant select, insert, update, delete on registry_cache to app_worker;
