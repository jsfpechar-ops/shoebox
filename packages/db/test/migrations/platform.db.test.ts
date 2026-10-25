import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import {
  GLOBAL_TABLES,
  NULLABLE_ORG_ID,
  OWNER_ONLY_SELECT_TABLES,
  OWNER_ONLY_TABLES,
  READ_ONLY_FOR_USERS,
} from '../../src/rls-catalog';

// 0007_platform (05 §9, §10.2, §10.3): the six tables and their policies and grants, the global
// tables unreadable by users, privacy_requests owner-only, audit_log and llm_usage_daily
// select-only, cost_usd numeric, the checks, the updated_at trigger, the cascades, and the 05 §9.1
// Later tables absent. Migrates forward only (tenancy.db.test.ts owns the from-scratch run); its
// org uses the prefix ffffffff so no other file's cleanup touches it.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'ffffffff-0000-4000-8000-000000000001';
const OTHER_ORG = 'ffffffff-0000-4000-8000-000000000002';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a1';
const MEMBER = 'ffffffff-0000-4000-8000-0000000000a2';
const ACCOUNTANT = 'ffffffff-0000-4000-8000-0000000000a3';
const VIEWER = 'ffffffff-0000-4000-8000-0000000000a4';
const USERS = [OWNER, MEMBER, ACCOUNTANT, VIEWER];
const TENANT_0007 = ['audit_log', 'llm_usage_daily', 'privacy_requests'] as const;
const GLOBAL_0007 = ['rate_limit_counters', 'rules_overrides', 'staff_users'] as const;
const LATER_0007 = ['extraction_batches', 'global_vendor_priors', 'support_access_grants'];
const ROLLBACK = Symbol('rollback');

function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: { code?: string }) => e.code ?? 'unknown',
  );
}

describe.skipIf(DATABASE_URL === undefined)('0007: platform tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;

  /** Runs fn as `authenticated` with the JWT subject of uid and rolls back. */
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

  async function cleanup(): Promise<void> {
    await sql`delete from audit_log where org_id in (${ORG}, ${OTHER_ORG})`;
    await sql`delete from organizations where id in (${ORG}, ${OTHER_ORG})`;
    await sql`delete from rules_overrides where rule_key like 'test.%'`;
    await sql`delete from staff_users where user_id = any(${USERS})`;
    await sql`delete from auth.users where id::text like 'ffffffff-%'`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await cleanup();
    for (const uid of USERS) {
      await sql`insert into auth.users (id) values (${uid}) on conflict (id) do nothing`;
    }
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret) values
      (${ORG}, 'Org Platform', 'org-platform-0007', 'FFFFFFF1'),
      (${OTHER_ORG}, 'Org Platform B', 'org-platform-0007-b', 'FFFFFFF2')`;
    await sql`insert into memberships (org_id, user_id, role) values
      (${ORG}, ${OWNER}, 'owner'), (${ORG}, ${MEMBER}, 'member'),
      (${ORG}, ${ACCOUNTANT}, 'accountant'), (${ORG}, ${VIEWER}, 'viewer')`;
    await sql`insert into audit_log (org_id, actor_kind, entity, action) values
      (${ORG}, 'system', 'documents', 'test.a'), (${OTHER_ORG}, 'system', 'documents', 'test.b'),
      (null, 'staff', 'rules_overrides', 'test.global')`;
    await sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
      values (${ORG}, '2026-01-15', 'test-model', 3, 1200, 300, '0.0123')`;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from audit_log where org_id is null and action = 'test.global'`;
      await cleanup();
      await sql.end();
    }
  });

  it('creates the six tables with the expected policies; the 05 §9.1 Later tables do not exist', async () => {
    const tables = await sql<{ t: string; p: string }[]>`select relname as t, relpersistence as p
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relkind = 'r'
        and relname = any(${[...TENANT_0007, ...GLOBAL_0007, ...LATER_0007]}) order by 1`;
    expect(tables.map((r) => r.t)).toEqual([...TENANT_0007, ...GLOBAL_0007].sort());
    expect(tables.find((r) => r.t === 'rate_limit_counters')?.p, 'unlogged').toBe('u');
    for (const table of TENANT_0007) {
      const policies = await sql<{ policyname: string; cmd: string }[]>`select policyname, cmd
        from pg_policies where schemaname = 'public' and tablename = ${table} order by policyname`;
      const expected = [
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
      ];
      if (table === 'privacy_requests') {
        expected.push(['privacy_requests_write', 'ALL']);
      }
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual(expected);
    }
    const noRls =
      await sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and relname = any(${[...GLOBAL_0007]}) and relrowsecurity`;
    expect(noRls).toHaveLength(0);
    expect(READ_ONLY_FOR_USERS).toEqual(expect.arrayContaining(['audit_log', 'llm_usage_daily']));
    expect(NULLABLE_ORG_ID).toContain('audit_log');
    expect(OWNER_ONLY_TABLES).toContain('privacy_requests');
    expect(OWNER_ONLY_SELECT_TABLES).toContain('privacy_requests');
    for (const table of GLOBAL_0007) {
      expect(GLOBAL_TABLES[table], table).toBe('service_role');
    }
  });

  it('global tables: no app-role grant, the worker reads only rules_overrides, a user select raises 42501', async () => {
    const grants = await sql<{ t: string; role: string; privs: string }[]>`select t, r.role,
        string_agg(p.priv, ',' order by p.priv) filter (where has_table_privilege(r.role, t, p.priv)) as privs
      from unnest(${[...GLOBAL_0007]}::text[]) as t
      cross join (values ('anon'), ('authenticated'), ('app_worker')) as r(role)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
      group by t, r.role order by t, r.role`;
    expect(grants.filter((g) => g.privs !== null)).toEqual([
      { t: 'rules_overrides', role: 'app_worker', privs: 'SELECT' },
    ]);
    for (const table of GLOBAL_0007) {
      expect(
        await code(asUser(OWNER, (tx) => tx`select 1 from ${tx(table)}`)),
        `${table} as owner`,
      ).toBe('42501');
    }
    await sql`insert into rules_overrides (rule_key, valid_from, value, reason, source, created_by)
      values ('test.vat.rates', '2026-01-01', '{"standard": 21}', 'TEST reason', 'TEST source', 'staff:test')`;
    await sql`insert into staff_users (user_id, role) values (${OWNER}, 'support')`;
    expect(
      await code(sql`insert into staff_users (user_id, role) values (${MEMBER}, 'root')`),
    ).toBe('23514');
  });

  it('audit_log: users select the rows of their orgs only; no user insert; the sequence works for the worker', async () => {
    const seen = await asUser(
      OWNER,
      (tx) => tx<{ org: string | null }[]>`select org_id::text as org from audit_log
        where action like 'test.%' order by 1`,
    );
    expect(seen.map((r) => r.org)).toEqual([ORG]);
    expect(
      await code(
        asUser(
          OWNER,
          (tx) => tx`insert into audit_log (org_id, actor_kind, entity, action)
            values (${ORG}, 'user', 'documents', 'test.user')`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        sql`insert into audit_log (org_id, actor_kind, entity, action) values (${ORG}, 'robot', 'x', 'test.bad')`,
      ),
    ).toBe('23514');
    const [seq] =
      await sql`select has_sequence_privilege('app_worker', 'audit_log_id_seq', 'usage') as ok`;
    expect(seq?.ok).toBe(true);
    const [idx] =
      await sql`select indexdef from pg_indexes where indexname = 'audit_log_org_id_at_idx'`;
    expect(idx?.indexdef).toContain('(org_id, at)');
  });

  it('llm_usage_daily: numeric(10,4) cost, select-only for users, the composite key', async () => {
    const [col] = await sql`select numeric_precision as p, numeric_scale as s, data_type as d
      from information_schema.columns
      where table_schema = 'public' and table_name = 'llm_usage_daily' and column_name = 'cost_usd'`;
    expect(col).toEqual({ p: 10, s: 4, d: 'numeric' });
    const floats = await sql`select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = any(${[...TENANT_0007, ...GLOBAL_0007]})
        and data_type in ('real', 'double precision')`;
    expect(floats).toHaveLength(0);
    const rows = await asUser(
      VIEWER,
      (tx) => tx`select cost_usd::text as cost from llm_usage_daily where org_id = ${ORG}`,
    );
    expect(rows.map((r) => r.cost)).toEqual(['0.0123']);
    const counts = await asUser(OWNER, async (tx) => ({
      updated: (await tx`update llm_usage_daily set calls = 9 where org_id = ${ORG} returning 1`)
        .length,
      deleted: (await tx`delete from llm_usage_daily where org_id = ${ORG} returning 1`).length,
    }));
    expect(counts).toEqual({ updated: 0, deleted: 0 });
    expect(
      await code(
        asUser(
          OWNER,
          (
            tx,
          ) => tx`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
            values (${ORG}, '2026-01-16', 'test-model', 1, 1, 1, '0.0001')`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
          values (${ORG}, '2026-01-15', 'test-model', 1, 1, 1, '0.0001')`,
      ),
    ).toBe('23505');
  });

  it('privacy_requests: owner selects and writes, nobody else sees a row; checks and updated_at', async () => {
    const inserted = await asUser(
      OWNER,
      (tx) => tx<
        { id: string; state: string }[]
      >`insert into privacy_requests (org_id, kind, requested_by)
        values (${ORG}, 'export', ${OWNER}) returning id, state`,
    );
    expect(inserted[0]?.state).toBe('pending');
    const [req] = await sql<
      { id: string }[]
    >`insert into privacy_requests (org_id, kind, requested_by)
      values (${ORG}, 'close_archive', ${OWNER}) returning id`;
    const id = req?.id ?? '';
    for (const uid of [MEMBER, ACCOUNTANT, VIEWER]) {
      expect(
        await asUser(uid, (tx) => tx`select 1 from privacy_requests where org_id = ${ORG}`),
        `sees as ${uid}`,
      ).toHaveLength(0);
      expect(
        await code(
          asUser(
            uid,
            (tx) => tx`insert into privacy_requests (org_id, kind, requested_by)
              values (${ORG}, 'export', ${uid})`,
          ),
        ),
        `inserts as ${uid}`,
      ).toBe('42501');
      expect(
        await asUser(
          uid,
          (tx) => tx`update privacy_requests set state = 'cancelled' where id = ${id} returning 1`,
        ),
        `updates as ${uid}`,
      ).toHaveLength(0);
    }
    const owner = await asUser(
      OWNER,
      (tx) => tx<
        { state: string; bumped: boolean }[]
      >`update privacy_requests set state = 'cancelled'
        where id = ${id} returning state, updated_at > created_at as bumped`,
    );
    expect(owner).toEqual([{ state: 'cancelled', bumped: true }]);
    expect(
      await code(
        sql`insert into privacy_requests (org_id, kind, requested_by) values (${ORG}, 'forget', ${OWNER})`,
      ),
    ).toBe('23514');
    expect(await code(sql`update privacy_requests set state = 'lost' where id = ${id}`)).toBe(
      '23514',
    );
  });

  it('cascades: deleting the org removes llm_usage_daily and privacy_requests; audit_log rows stay', async () => {
    await sql`insert into privacy_requests (org_id, kind, requested_by) values (${OTHER_ORG}, 'export', ${OWNER})`;
    await sql`insert into llm_usage_daily (org_id, day, model, calls, input_tokens, output_tokens, cost_usd)
      values (${OTHER_ORG}, '2026-01-15', 'test-model', 1, 1, 1, '0.0001')`;
    await sql`delete from organizations where id = ${OTHER_ORG}`;
    expect(await sql`select 1 from privacy_requests where org_id = ${OTHER_ORG}`).toHaveLength(0);
    expect(await sql`select 1 from llm_usage_daily where org_id = ${OTHER_ORG}`).toHaveLength(0);
    expect(await sql`select 1 from audit_log where org_id = ${OTHER_ORG}`).toHaveLength(1);
  });
});
