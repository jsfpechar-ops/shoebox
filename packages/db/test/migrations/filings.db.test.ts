import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0043_filings (05 §8, §10.2): filings, filing_documents, filing_entries.
// filings and filing_documents are tenant tables (members read, owners and members write);
// filing_entries is read-only for users (the worker writes). Forward only; org prefix dddddddd
// is never touched by the RLS suite's cleanup.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'dddddddd-0000-4000-8000-000000000043';
const OWNER = 'dddddddd-0000-4000-8000-0000000000a3';
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

describe.skipIf(DATABASE_URL === undefined)('0043: filings tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let docId: string;

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

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Filings', 'org-filings-0043', 'DDDDDDDD')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    docId = one(
      await sql<
        { id: string }[]
      >`insert into documents (org_id, entry_mode) values (${ORG}, 'manual') returning id`,
    ).id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id = ${OWNER}`;
      await sql.end();
    }
  });

  it('creates the tables with RLS and the expected policies', async () => {
    const rows = await sql<{ t: string; rls: boolean }[]>`select tablename as t, rowsecurity as rls
      from pg_tables where schemaname = 'public'
        and tablename in ('filings','filing_documents','filing_entries') order by 1`;
    expect(rows).toEqual([
      { t: 'filing_documents', rls: true },
      { t: 'filing_entries', rls: true },
      { t: 'filings', rls: true },
    ]);
    const entriesPolicies = await sql<{ cmd: string }[]>`select cmd from pg_policies
      where tablename = 'filing_entries'`;
    // users: select only; the worker gets ALL
    expect(entriesPolicies.map((p) => p.cmd).filter((c) => c !== 'SELECT' && c !== 'ALL')).toEqual(
      [],
    );
  });

  it('owner inserts a filing; only one open filing per (type, period, kind); superseded frees the slot', async () => {
    const id = await asUser(OWNER, async (tx) => {
      const row = one(
        await tx<{ id: string }[]>`insert into filings (org_id, type, period_start, period_end)
          values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31') returning id`,
      );
      return row.id;
    });
    expect(id).toBeTruthy();
    const dup = await sql
      .begin(async (tx) => {
        await tx`insert into filings (org_id, type, period_start, period_end)
        values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31')`;
        return code(tx`insert into filings (org_id, type, period_start, period_end, state)
        values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'generated')`);
      })
      .catch((e: { code?: string }) => e.code ?? 'unknown');
    expect(dup).toBe('23505');
    const two = await sql.begin(async (tx) => {
      await tx`insert into filings (org_id, type, period_start, period_end, state)
        values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'superseded')`;
      await tx`insert into filings (org_id, type, period_start, period_end, state)
        values (${ORG}, 'DPHDP3', '2026-08-01', '2026-08-31', 'generated')`;
      return one(
        await tx<{ n: number }[]>`select count(*)::int as n from filings where org_id = ${ORG}`,
      ).n;
    });
    expect(two).toBe(2);
    await sql`delete from filings where org_id = ${ORG}`;
  });

  it('rodne cislo never enters inputs', async () => {
    expect(
      await code(sql`insert into filings (org_id, type, period_start, period_end, inputs)
        values (${ORG}, 'PODKLADY_DPFO', '2026-01-01', '2026-12-31', '{"rodneCislo":"x"}')`),
    ).toBe('23514');
  });

  it('filing_entries: users read but cannot write; worker inserts', async () => {
    const filingId = one(
      await sql<{ id: string }[]>`insert into filings (org_id, type, period_start, period_end)
        values (${ORG}, 'DPHDP3', '2026-09-01', '2026-09-30') returning id`,
    ).id;
    await sql`insert into filing_entries (filing_id, org_id, document_id, document_revision,
      vat_treatment, vat_rate_type, dphdp3_rows, vat_point_date, base_czk, vat_czk)
      values (${filingId}, ${ORG}, ${docId}, 1, 'rcv_eu_service_reverse_charge', 'standard',
        '{5}', '2026-09-03', '11549.94', '2425.49')`;
    const seen = await asUser(
      OWNER,
      async (tx) =>
        one(
          await tx<{ n: number }[]>`select count(*)::int as n from filing_entries
          where filing_id = ${filingId}`,
        ).n,
    );
    expect(seen).toBe(1);
    const denied = await asUser(OWNER, (tx) =>
      code(tx`insert into filing_entries (filing_id, org_id, document_id, document_revision,
        vat_treatment, vat_rate_type, dphdp3_rows, vat_point_date, base_czk, vat_czk)
        values (${filingId}, ${ORG}, ${docId}, 1, 'rcv_eu_service_reverse_charge', 'standard',
          '{5}', '2026-09-03', '1.00', '0.21')`),
    );
    expect(denied).toBe('42501');
    await sql`delete from filings where id = ${filingId}`;
  });

  it('another org sees nothing', async () => {
    const OTHER = 'dddddddd-0000-4000-8000-0000000000b2';
    await sql`insert into auth.users (id) values (${OTHER}) on conflict (id) do nothing`;
    await sql`insert into filings (org_id, type, period_start, period_end)
      values (${ORG}, 'DPHDP3', '2026-10-01', '2026-10-31')`;
    expect(
      await asUser(
        OTHER,
        async (tx) => one(await tx<{ n: number }[]>`select count(*)::int as n from filings`).n,
      ),
    ).toBe(0);
    await sql`delete from filings where org_id = ${ORG}`;
    await sql`delete from auth.users where id = ${OTHER}`;
  });
});
