import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0045_tax_reserve (M06 §4.11, 05 §7): the cached tax-reserve estimate, one row per org. The worker
// writes it; users select only and see their own org's row. Forward only.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG_A = 'dddddddd-0000-4000-8000-000000000045';
const ORG_B = 'dddddddd-0000-4000-8000-000000000046';
const ORG_C = 'dddddddd-0000-4000-8000-000000000047';
const USER_A = 'dddddddd-0000-4000-8000-0000000000a5';
const USER_B = 'dddddddd-0000-4000-8000-0000000000b5';
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

describe.skipIf(DATABASE_URL === undefined)('0045: tax_reserve_estimates', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  // Rolls back every transaction: return what the check needs from inside fn.
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
    await sql`delete from organizations where id in (${ORG_A}, ${ORG_B}, ${ORG_C})`;
    await sql`insert into auth.users (id) values (${USER_A}) on conflict (id) do nothing`;
    await sql`insert into auth.users (id) values (${USER_B}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_A}, 'Org Reserve A', 'org-reserve-0045-a', 'DDDDDD45')`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_B}, 'Org Reserve B', 'org-reserve-0045-b', 'DDDDDD46')`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG_C}, 'Org Reserve C', 'org-reserve-0045-c', 'DDDDDD47')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG_A}, ${USER_A}, 'owner')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG_B}, ${USER_B}, 'owner')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id in (${ORG_A}, ${ORG_B}, ${ORG_C})`;
      await sql`delete from auth.users where id in (${USER_A}, ${USER_B})`;
      await sql.end();
    }
  });

  it('worker inserts; org A user reads its own row only; org B sees nothing', async () => {
    await sql`insert into tax_reserve_estimates (org_id, as_of, tax_year, kind, payload, ledger_hash)
      values (${ORG_A}, '2026-09-30', 2026, 'estimate', '{"reserve":"1234.50"}', 'hash-a')`;
    const seenByA = await asUser(
      USER_A,
      (tx) => tx<{ org_id: string }[]>`select org_id from tax_reserve_estimates`,
    );
    expect(seenByA.map((r) => r.org_id)).toEqual([ORG_A]);
    const seenByB = await asUser(
      USER_B,
      (tx) => tx<{ org_id: string }[]>`select org_id from tax_reserve_estimates`,
    );
    expect(seenByB).toHaveLength(0);
  });

  it('a user session cannot insert or update the row', async () => {
    expect(
      await asUser(USER_A, (tx) =>
        code(
          tx`insert into tax_reserve_estimates (org_id, as_of, tax_year, kind)
            values (${ORG_C}, '2026-09-30', 2026, 'estimate')`,
        ),
      ),
    ).toBe('42501');
    // The policy hides the row from UPDATE, so the change never reaches it: the value stays 2026.
    const taxYear = await asUser(USER_A, async (tx) => {
      await tx`update tax_reserve_estimates set tax_year = 2099 where org_id = ${ORG_A}`;
      return one(
        await tx<
          { y: number }[]
        >`select tax_year as y from tax_reserve_estimates where org_id = ${ORG_A}`,
      ).y;
    });
    expect(taxYear).toBe(2026);
  });

  it('kind outside (estimate, pausalni_dan) is rejected by the check', async () => {
    expect(
      await code(
        sql`insert into tax_reserve_estimates (org_id, as_of, tax_year, kind)
          values (${ORG_C}, '2026-09-30', 2026, 'bogus')`,
      ),
    ).toBe('23514');
  });

  it('deleting the organization cascades the row', async () => {
    await sql`insert into tax_reserve_estimates (org_id, as_of, tax_year, kind)
      values (${ORG_C}, '2026-09-30', 2026, 'pausalni_dan')`;
    await sql`delete from organizations where id = ${ORG_C}`;
    const left = one(
      await sql<
        { n: number }[]
      >`select count(*)::int as n from tax_reserve_estimates where org_id = ${ORG_C}`,
    ).n;
    expect(left).toBe(0);
  });
});
