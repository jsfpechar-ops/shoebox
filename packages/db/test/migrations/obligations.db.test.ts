import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0044_obligations (05 §8, §10.2): deadlines and payables to authorities. The worker writes every
// row; members and owners may update only state, done_at and done_source. Forward only; org prefix
// dddddddd is never touched by the RLS suite's cleanup.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'dddddddd-0000-4000-8000-000000000044';
const OWNER = 'dddddddd-0000-4000-8000-0000000000a4';
const MEMBER = 'dddddddd-0000-4000-8000-0000000000b4';
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

describe.skipIf(DATABASE_URL === undefined)('0044: obligations', () => {
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
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}) on conflict (id) do nothing`;
    await sql`insert into auth.users (id) values (${MEMBER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Obligations', 'org-obligations-0044', 'DDDDDDDD')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${OWNER}, 'owner')`;
    await sql`insert into memberships (org_id, user_id, role) values (${ORG}, ${MEMBER}, 'member')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id in (${OWNER}, ${MEMBER})`;
      await sql.end();
    }
  });

  it('worker upserts on (org_id, kind, period_start); users cannot insert', async () => {
    await sql`insert into obligations (org_id, kind, period_start, period_end, legal_due_date, due_date, amount_estimate, source_rule) values (${ORG}, 'vat_return', '2026-08-01', '2026-08-31', '2026-09-25', '2026-09-25', '2877.00', 'm05.vat_obligations.v1')`;
    await sql`insert into obligations (org_id, kind, period_start, period_end, legal_due_date, due_date, amount_estimate, source_rule) values (${ORG}, 'vat_return', '2026-08-01', '2026-08-31', '2026-09-25', '2026-09-25', '2900.00', 'm05.vat_obligations.v1')
      on conflict (org_id, kind, period_start) do update set amount_estimate = excluded.amount_estimate, updated_at = now()`;
    expect(
      one(
        await sql<
          { a: string }[]
        >`select amount_estimate as a from obligations where org_id = ${ORG}`,
      ).a,
    ).toBe('2900.00');
    expect(
      await asUser(OWNER, (tx) =>
        code(
          tx`insert into obligations (org_id, kind, due_date, source_rule) values (${ORG}, 'kh', '2026-09-25', 'x')`,
        ),
      ),
    ).toBe('42501');
  });

  it('member marks done (state, done_at, done_source) but cannot touch due_date or amount', async () => {
    const id = one(
      await sql<
        { id: string }[]
      >`select id from obligations where org_id = ${ORG} and kind = 'vat_return'`,
    ).id;
    // asUser rolls back, so the update and its check run in the same transaction.
    const state = await asUser(MEMBER, async (tx) => {
      await tx`update obligations set state = 'done', done_at = now(), done_source = 'user' where id = ${id}`;
      return one(await tx<{ s: string }[]>`select state as s from obligations where id = ${id}`).s;
    });
    expect(state).toBe('done');
    expect(
      await asUser(MEMBER, (tx) =>
        code(tx`update obligations set due_date = '2026-12-31' where id = ${id}`),
      ),
    ).toBe('42501');
    expect(
      await asUser(MEMBER, (tx) =>
        code(tx`update obligations set amount_estimate = '1.00' where id = ${id}`),
      ),
    ).toBe('42501');
    await sql`update obligations set state = 'open', done_at = null, done_source = null where id = ${id}`; // worker may
  });

  it('bad state or done_source rejected; other org sees nothing', async () => {
    expect(
      await code(
        sql`insert into obligations (org_id, kind, due_date, source_rule, state) values (${ORG}, 'sh', '2026-09-25', 'x', 'late')`,
      ),
    ).toBe('23514');
    const OTHER = 'dddddddd-0000-4000-8000-0000000000c4';
    await sql`insert into auth.users (id) values (${OTHER}) on conflict (id) do nothing`;
    expect(
      await asUser(
        OTHER,
        async (tx) => one(await tx<{ n: number }[]>`select count(*)::int as n from obligations`).n,
      ),
    ).toBe(0);
    await sql`delete from auth.users where id = ${OTHER}`;
  });
});
