import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { GLOBAL_TABLES } from '../../src/rls-catalog';

// 0004_partners_registries (05 §3, §5, §10.3): the seven tables, the grants of the four global
// tables for the app roles and app_worker, the unique keys, the categories self-reference and the
// numeric scales. Migrates forward only (tenancy.db.test.ts owns the from-scratch run); its two
// orgs use the prefix cccccccc so the RLS suite's cleanup never touches them.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_C = 'cccccccc-0000-4000-8000-000000000001';
const ORG_D = 'cccccccc-0000-4000-8000-000000000002';
const TABLES_0004 = [
  'bank_codes',
  'categories',
  'fx_rates',
  'partner_bank_accounts',
  'partners',
  'registry_cache',
  'vendor_profiles',
] as const;
const GLOBAL_0004 = ['bank_codes', 'categories', 'fx_rates', 'registry_cache'] as const;

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0004: partners, registries, categories', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  async function privileges(role: string, table: string): Promise<string[]> {
    const rows = await sql<{ p: string }[]>`
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p
      where has_table_privilege(${role}, ${`public.${table}`}, p)`;
    return rows.map((r) => r.p);
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
    await sql`delete from categories where code in ('test_old', 'test_new')`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_C}, 'Org C', 'org-c-0004', 'CCCCCCCC'), (${ORG_D}, 'Org D', 'org-d-0004', 'DDDDDDDD')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id in (${ORG_C}, ${ORG_D})`;
      await sql`delete from categories where code in ('test_old', 'test_new')`;
      await sql.end();
    }
  });

  it('creates the seven tables of 05 §3 and §5 and not global_vendor_priors (05 §9.1 Later)', async () => {
    const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables
      where schemaname = 'public' and tablename = any(${[...TABLES_0004, 'global_vendor_priors']})
      order by 1`;
    expect(rows.map((r) => r.t)).toEqual([...TABLES_0004]);
  });

  it('the global tables have no org_id, no RLS and are listed in GLOBAL_TABLES', async () => {
    for (const table of GLOBAL_0004) {
      expect(GLOBAL_TABLES[table], table).toBeDefined();
      const cols = await sql`select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name = 'org_id'`;
      expect(cols, table).toHaveLength(0);
      const rel = await sql`select relrowsecurity as rls from pg_class c
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${table}`;
      expect(rel[0]?.rls, table).toBe(false);
    }
  });

  it('grants of 05 §10.3: authenticated reads categories, fx_rates, bank_codes only; anon nothing', async () => {
    for (const table of ['categories', 'fx_rates', 'bank_codes']) {
      expect(await privileges('authenticated', table), table).toEqual(['SELECT']);
      expect(await privileges('app_worker', table), table).toEqual(['SELECT']);
    }
    expect(await privileges('authenticated', 'registry_cache')).toEqual([]);
    expect(await privileges('app_worker', 'registry_cache')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
    ]);
    for (const table of GLOBAL_0004) {
      expect(await privileges('anon', table), table).toEqual([]);
    }
  });

  it('the three tenant tables have _select, _worker and _write policies', async () => {
    for (const table of ['partners', 'partner_bank_accounts', 'vendor_profiles']) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ]);
    }
  });

  it('partners: (org_id, ico) is unique per org, the same IČO is fine in another org; updated_at is touched', async () => {
    const [p] =
      await sql`insert into partners (org_id, name, ico) values (${ORG_C}, 'Alfa', '12345678')
      returning id, created_at, updated_at`;
    expect(p?.updated_at).toEqual(p?.created_at);
    expect(
      await code(
        sql`insert into partners (org_id, name, ico) values (${ORG_C}, 'Alfa 2', '12345678')`,
      ),
    ).toBe('23505');
    expect(
      await code(
        sql`insert into partners (org_id, name, ico) values (${ORG_D}, 'Alfa D', '12345678')`,
      ),
    ).toBeNull();
    const [u] = await sql`update partners set name = 'Alfa s.r.o.' where id = ${p?.id}
      returning updated_at > created_at as touched, email_domains`;
    expect(u?.touched).toBe(true);
    expect(u?.email_domains).toEqual([]);
  });

  it('partner_bank_accounts and vendor_profiles follow their partner (cascade) and keys', async () => {
    const [p] =
      await sql`insert into partners (org_id, name) values (${ORG_C}, 'Beta') returning id`;
    await sql`insert into partner_bank_accounts (org_id, partner_id, iban) values (${ORG_C}, ${p?.id}, 'TEST-IBAN-PARTNER-0001')`;
    expect(
      await code(
        sql`insert into partner_bank_accounts (org_id, partner_id, iban) values (${ORG_C}, ${p?.id}, 'TEST-IBAN-PARTNER-0001')`,
      ),
    ).toBe('23505');
    await sql`insert into vendor_profiles (org_id, partner_id) values (${ORG_C}, ${p?.id})`;
    expect(
      await code(sql`insert into vendor_profiles (org_id, partner_id) values (${ORG_C}, ${p?.id})`),
    ).toBe('23505');
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_business_flag) values (${ORG_C}, gen_random_uuid(), 'company')`,
      ),
    ).toBe('23514');
    await sql`delete from partners where id = ${p?.id}`;
    const left = await sql`select 1 from partner_bank_accounts where partner_id = ${p?.id}
      union all select 1 from vendor_profiles where partner_id = ${p?.id}`;
    expect(left).toHaveLength(0);
  });

  it('categories: replaced_by points at a category; vendor_profiles.default_category_code must exist', async () => {
    expect(
      await code(
        sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort, replaced_by)
          values ('test_old', 'in', 'deductible_expense', 'Stará', 'Old', 'x', 1, 'test_missing')`,
      ),
    ).toBe('23503');
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort)
      values ('test_new', 'in', 'deductible_expense', 'Nová', 'New', 'x', 2)`;
    await sql`insert into categories (code, direction, tax_effect, label_cs, label_en, explanation_cs, sort, replaced_by, valid_to)
      values ('test_old', 'in', 'deductible_expense', 'Stará', 'Old', 'x', 1, 'test_new', '2025-12-31')`;
    const [old] = await sql`select valid_from::text as f from categories where code = 'test_old'`;
    expect(old?.f).toBe('2000-01-01');
    const [p] =
      await sql`insert into partners (org_id, name) values (${ORG_C}, 'Gama') returning id`;
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_category_code) values (${ORG_C}, ${p?.id}, 'nope')`,
      ),
    ).toBe('23503');
    expect(
      await code(
        sql`insert into vendor_profiles (org_id, partner_id, default_category_code) values (${ORG_C}, ${p?.id}, 'test_new')`,
      ),
    ).toBeNull();
  });

  it('fx_rates.rate is numeric(12,6) and the registry cache keys by (source, key)', async () => {
    const [col] = await sql`select numeric_precision as p, numeric_scale as s
      from information_schema.columns where table_name = 'fx_rates' and column_name = 'rate'`;
    expect([col?.p, col?.s]).toEqual([12, 6]);
    await sql`insert into fx_rates (rate_date, currency, amount, rate, published_at)
      values ('2026-01-02', 'EUR', 1, 25.1234565, '2026-01-02T13:30:00Z')
      on conflict (rate_date, currency) do update set rate = excluded.rate`;
    const [fx] =
      await sql`select rate::text as r from fx_rates where rate_date = '2026-01-02' and currency = 'EUR'`;
    expect(fx?.r).toBe('25.123457');
    await sql`delete from fx_rates where rate_date = '2026-01-02' and currency = 'EUR'`;
    expect(
      await code(sql`insert into registry_cache (source, key, payload) values ('xyz', '1', '{}')`),
    ).toBe('23514');
    await sql`insert into registry_cache (source, key, payload) values ('ares', '00000000', '{"test": true}')
      on conflict (source, key) do update set payload = excluded.payload, fetched_at = now()`;
    await sql`delete from registry_cache where source = 'ares' and key = '00000000'`;
  });
});
