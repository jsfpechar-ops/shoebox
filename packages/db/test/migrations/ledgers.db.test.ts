import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { READ_ONLY_FOR_USERS } from '../../src/rls-catalog';

// 0041_ledgers (05 §7, §10.2): tax_ledger_entries, vat_ledger_entries, ledger_build_version_seq.
// Users select only; the worker writes. Migrates forward only; org prefix dddddddd is never
// touched by the RLS suite's cleanup.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'dddddddd-0000-4000-8000-000000000001';
const OWNER = 'dddddddd-0000-4000-8000-0000000000a1';
const TABLES = ['tax_ledger_entries', 'vat_ledger_entries'] as const;
const ROLLBACK = Symbol('rollback');

function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected one row');
  }
  return row;
}

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0041: ledger tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let docId: string;
  let lineId: string;

  async function asUser<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true),
          set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        result = await fn(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return result as T;
  }

  function taxRow(cols: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      org_id: ORG,
      entry_date: '2026-09-15',
      tax_year: 2026,
      document_id: docId,
      line_id: lineId,
      category_code: 'exp_other_deductible',
      tax_effect: 'deductible_expense',
      amount_czk: '12960.84',
      business_share_pct: '100.00',
      business_amount_czk: '12960.84',
      build_version: 1,
      ...cols,
    };
  }

  function vatRow(cols: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      org_id: ORG,
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      vat_point_date: '2026-08-03',
      vat_point_rule: 'issue_date',
      document_id: docId,
      vat_treatment: 'rcv_eu_service_reverse_charge',
      vat_rate_type: 'standard',
      vat_rate_pct: '21.00',
      base_czk: '13699.77',
      vat_czk: '2876.95',
      dphdp3_rows: '{5}',
      build_version: 1,
      ...cols,
    };
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Ledgers', 'org-ledgers-0041', 'DDDDDDDD')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    docId = one(
      await sql<
        { id: string }[]
      >`insert into documents (org_id, entry_mode) values (${ORG}, 'manual') returning id`,
    ).id;
    lineId = one(
      await sql<
        { id: string }[]
      >`insert into document_lines (org_id, document_id, position) values (${ORG}, ${docId}, 1) returning id`,
    ).id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id = ${OWNER}`;
      await sql.end();
    }
  });

  it('creates both tables with RLS, select and worker policies only', async () => {
    const rows = await sql<{ t: string; rls: boolean }[]>`select tablename as t, rowsecurity as rls
      from pg_tables where schemaname = 'public' and tablename = any(${[...TABLES]}) order by 1`;
    expect(rows).toEqual([
      { t: 'tax_ledger_entries', rls: true },
      { t: 'vat_ledger_entries', rls: true },
    ]);
    for (const table of TABLES) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual([
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
      ]);
      expect(READ_ONLY_FOR_USERS).toContain(table);
    }
  });

  it('the sequence exists and app_worker may use it', async () => {
    const [seq] = await sql<
      { ok: boolean }[]
    >`select has_sequence_privilege('app_worker', 'ledger_build_version_seq', 'usage') as ok`;
    expect(seq?.ok).toBe(true);
    const [v] = await sql<{ n: string }[]>`select nextval('ledger_build_version_seq')::text as n`;
    expect(v?.n).toMatch(/^\d+$/);
  });

  it('money columns are numeric(15,2); fx_rate numeric(12,6); percentages numeric(5,2)', async () => {
    const cols = await sql<{ t: string; c: string; p: number; s: number }[]>`
      select table_name as t, column_name as c, numeric_precision as p, numeric_scale as s
      from information_schema.columns where table_schema = 'public'
        and table_name = any(${[...TABLES]}) and data_type = 'numeric' order by 1, 2`;
    const byName = Object.fromEntries(cols.map((x) => [`${x.t}.${x.c}`, [x.p, x.s]]));
    expect(byName['tax_ledger_entries.amount_czk']).toEqual([15, 2]);
    expect(byName['tax_ledger_entries.business_amount_czk']).toEqual([15, 2]);
    expect(byName['tax_ledger_entries.business_share_pct']).toEqual([5, 2]);
    expect(byName['vat_ledger_entries.base_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.vat_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.base_foreign']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.kh_document_total_czk']).toEqual([15, 2]);
    expect(byName['vat_ledger_entries.fx_rate']).toEqual([12, 6]);
    expect(byName['vat_ledger_entries.deduction_pct']).toEqual([5, 2]);
    expect(byName['vat_ledger_entries.vat_rate_pct']).toEqual([5, 2]);
  });

  it('service role inserts valid rows; defaults apply', async () => {
    const [t] = await sql<{ basis: string; share: string }[]>`insert into tax_ledger_entries ${sql(
      taxRow(),
      'org_id',
      'entry_date',
      'tax_year',
      'document_id',
      'line_id',
      'category_code',
      'tax_effect',
      'amount_czk',
      'build_version',
    )} returning basis, business_share_pct::text as share`;
    expect(t).toEqual({ basis: 'payment', share: '100.00' });
    const [v] = await sql<
      { rows: string[]; cur: string; ded: string }[]
    >`insert into vat_ledger_entries ${sql(
      vatRow(),
    )} returning dphdp3_rows as rows, currency as cur, deduction_pct::text as ded`;
    expect(v).toEqual({ rows: ['5'], cur: 'CZK', ded: '100.00' });
    const [v2] = await sql<{ rows: string[] }[]>`insert into vat_ledger_entries ${sql(
      vatRow({ dphdp3_rows: '{5,43}', kh_section: 'A2', kh_document_total_czk: '13699.77' }),
    )} returning dphdp3_rows as rows`;
    expect(v2?.rows).toEqual(['5', '43']);
    await sql`delete from tax_ledger_entries where org_id = ${ORG}`;
    await sql`delete from vat_ledger_entries where org_id = ${ORG}`;
  });

  it('checks: basis, vat_point_rule, kh_section, shv_code; FK to categories', async () => {
    expect(await code(sql`insert into tax_ledger_entries ${sql(taxRow({ basis: 'guess' }))}`)).toBe(
      '23514',
    );
    expect(
      await code(sql`insert into tax_ledger_entries ${sql(taxRow({ category_code: 'nope' }))}`),
    ).toBe('23503');
    expect(
      await code(
        sql`insert into vat_ledger_entries ${sql(vatRow({ vat_point_rule: 'tomorrow' }))}`,
      ),
    ).toBe('23514');
    expect(
      await code(sql`insert into vat_ledger_entries ${sql(vatRow({ kh_section: 'C1' }))}`),
    ).toBe('23514');
    expect(await code(sql`insert into vat_ledger_entries ${sql(vatRow({ shv_code: 4 }))}`)).toBe(
      '23514',
    );
    expect(
      await code(
        sql`insert into vat_ledger_entries ${sql(vatRow({ vat_treatment: 'rcv_magic' }))}`,
      ),
    ).toBe('22P02');
  });

  it('users read their org and cannot insert, update or delete (42501 / no row)', async () => {
    await sql`insert into tax_ledger_entries ${sql(taxRow())}`;
    await sql`insert into vat_ledger_entries ${sql(vatRow())}`;
    const seen = await asUser(OWNER, async (tx) => {
      const [a] = await tx<
        { n: number }[]
      >`select count(*)::int as n from tax_ledger_entries where org_id = ${ORG}`;
      const [b] = await tx<
        { n: number }[]
      >`select count(*)::int as n from vat_ledger_entries where org_id = ${ORG}`;
      return [a?.n, b?.n];
    });
    expect(seen).toEqual([1, 1]);
    expect(
      await code(asUser(OWNER, (tx) => tx`insert into tax_ledger_entries ${tx(taxRow())}`)),
    ).toBe('42501');
    expect(
      await code(asUser(OWNER, (tx) => tx`insert into vat_ledger_entries ${tx(vatRow())}`)),
    ).toBe('42501');
    const touched = await asUser(OWNER, async (tx) => {
      const u = await tx`update vat_ledger_entries set vat_czk = 0 where org_id = ${ORG}`;
      const d = await tx`delete from tax_ledger_entries where org_id = ${ORG}`;
      return [u.count, d.count];
    });
    expect(touched).toEqual([0, 0]);
  });

  it('deleting the document cascades to both ledgers', async () => {
    const d = one(
      await sql<
        { id: string }[]
      >`insert into documents (org_id, entry_mode) values (${ORG}, 'manual') returning id`,
    ).id;
    await sql`insert into tax_ledger_entries ${sql(taxRow({ document_id: d, line_id: null }))}`;
    await sql`insert into vat_ledger_entries ${sql(vatRow({ document_id: d }))}`;
    await sql`delete from documents where id = ${d}`;
    const [n] = await sql<
      { n: number }[]
    >`select (select count(*) from tax_ledger_entries where document_id = ${d})::int
      + (select count(*) from vat_ledger_entries where document_id = ${d})::int as n`;
    expect(n?.n).toBe(0);
  });
});
