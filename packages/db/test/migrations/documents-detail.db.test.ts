import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { ACCOUNTANT_WRITABLE, READ_ONLY_FOR_USERS } from '../../src/rls-catalog';

// 0006_documents_detail (05 §4, §10.2): the seven detail tables, their policies (extraction_runs
// select-only for users; review_questions with the accountant update policy and the column
// trigger), the uniques and checks, the money columns as numeric, the partial index of
// document_fields and the cascades from documents. Migrates forward only (tenancy.db.test.ts owns
// the from-scratch run); its org uses the prefix eeeeeeee so the RLS suite's cleanup never touches it.
const DATABASE_URL = process.env.DATABASE_URL;

const ORG = 'eeeeeeee-0000-4000-8000-000000000001';
const OWNER = 'eeeeeeee-0000-4000-8000-0000000000a1';
const ACCOUNTANT = 'eeeeeeee-0000-4000-8000-0000000000a2';
const TABLES_0006 = [
  'document_fields',
  'document_lines',
  'document_links',
  'document_vat_summary',
  'extraction_runs',
  'review_questions',
  'validation_results',
] as const;
const ROLLBACK = Symbol('rollback');

/** The first row of a result, which the test expects to exist. */
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

describe.skipIf(DATABASE_URL === undefined)('0006: document detail tables', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let docId: string;

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

  function insertDoc(): Promise<{ id: string }[]> {
    return sql<
      { id: string }[]
    >`insert into documents (org_id, entry_mode) values (${ORG}, 'manual')
      returning id`;
  }

  function insertLine(cols: Record<string, unknown>): Promise<{ id: string }[]> {
    return sql<{ id: string }[]>`insert into document_lines ${sql({
      org_id: ORG,
      document_id: docId,
      position: 1,
      ...cols,
    })} returning id`;
  }

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await runMigrations(url);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${OWNER}), (${ACCOUNTANT}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org Detail', 'org-detail-0006', 'EEEEEEEE')`;
    await sql`insert into memberships (org_id, user_id, role)
      values (${ORG}, ${OWNER}, 'owner'), (${ORG}, ${ACCOUNTANT}, 'accountant')`;
    docId = one(await insertDoc()).id;
  });

  afterAll(async () => {
    if (sql !== undefined) {
      await sql`delete from organizations where id = ${ORG}`;
      await sql`delete from auth.users where id in (${OWNER}, ${ACCOUNTANT})`;
      await sql.end();
    }
  });

  it('creates the seven tables with RLS and the expected policies', async () => {
    const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables
      where schemaname = 'public' and tablename = any(${[...TABLES_0006]}) order by 1`;
    expect(rows.map((r) => r.t)).toEqual([...TABLES_0006]);
    for (const table of TABLES_0006) {
      const policies = await sql`select policyname, cmd from pg_policies
        where schemaname = 'public' and tablename = ${table} order by policyname`;
      const expected: string[][] = [
        [`${table}_select`, 'SELECT'],
        [`${table}_worker`, 'ALL'],
        [`${table}_write`, 'ALL'],
      ];
      if (table === 'extraction_runs') {
        expected.pop();
      }
      if (table === 'review_questions') {
        expected.splice(0, 0, ['review_questions_accountant_update', 'UPDATE']);
      }
      expect(
        policies.map((p) => [p.policyname, p.cmd]),
        table,
      ).toEqual(expected);
    }
    expect(READ_ONLY_FOR_USERS).toContain('extraction_runs');
    expect(ACCOUNTANT_WRITABLE).toContain('review_questions');
  });

  it('money and percentages are numeric, never floats (hard rule 1)', async () => {
    const cols = await sql<{ t: string; c: string; p: number; s: number }[]>`
      select table_name as t, column_name as c, numeric_precision as p, numeric_scale as s
      from information_schema.columns
      where table_schema = 'public' and table_name = any(${[...TABLES_0006]})
        and column_name in ('quantity','unit_price','net','vat','gross','vat_rate_pct',
          'business_share_pct','base','base_foreign','vat_foreign','cost_usd','confidence')
      order by 1, 2`;
    expect(cols.every((c) => c.p !== null)).toBe(true);
    const shape = (t: string, c: string) => {
      const col = cols.find((x) => x.t === t && x.c === c);
      return col === undefined ? null : `${col.p},${col.s}`;
    };
    expect(shape('document_lines', 'net')).toBe('15,2');
    expect(shape('document_lines', 'quantity')).toBe('15,4');
    expect(shape('document_lines', 'unit_price')).toBe('15,4');
    expect(shape('document_lines', 'business_share_pct')).toBe('5,2');
    expect(shape('document_vat_summary', 'base')).toBe('15,2');
    expect(shape('document_vat_summary', 'vat_rate_pct')).toBe('5,2');
    expect(shape('extraction_runs', 'cost_usd')).toBe('10,5');
    expect(shape('document_fields', 'confidence')).toBe('4,3');
    const floats = await sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = any(${[...TABLES_0006]})
        and data_type in ('real', 'double precision')`;
    expect(floats).toHaveLength(0);
  });

  it('document_lines: defaults, the position unique, the deductibility check, the categories FK', async () => {
    const line = one(await insertLine({ net: '100.00', vat: '21.00', gross: '121.00' }));
    const [d] = await sql`select line_type, vat_rate_type, business_share_pct::text as share,
      net::text as net from document_lines where id = ${line.id}`;
    expect(d).toEqual({ line_type: 'item', vat_rate_type: 'none', share: '100.00', net: '100.00' });
    expect(await code(insertLine({}))).toBe('23505');
    expect(await code(insertLine({ position: 2, deductibility: 'maybe' }))).toBe('23514');
    expect(await code(insertLine({ position: 2, deductibility: 'deductible' }))).toBeNull();
    expect(await code(insertLine({ position: 3, category_code: 'TEST-NOPE' }))).toBe('23503');
    expect(await code(insertLine({ position: 3, line_type: 'bonus' }))).toBe('22P02');
  });

  it('document_vat_summary and document_links: composite keys and the doc_link_kind enum', async () => {
    const recap = {
      org_id: ORG,
      document_id: docId,
      vat_rate_type: 'standard',
      vat_rate_pct: '21.00',
      base: '100.00',
      vat: '21.00',
    };
    expect(await code(sql`insert into document_vat_summary ${sql(recap)}`)).toBeNull();
    expect(await code(sql`insert into document_vat_summary ${sql(recap)}`)).toBe('23505');
    expect(
      await code(sql`insert into document_vat_summary ${sql({ ...recap, vat_rate_pct: '12.00' })}`),
    ).toBeNull();
    const other = one(await insertDoc()).id;
    const link = { org_id: ORG, from_document_id: docId, to_document_id: other, kind: 'supports' };
    expect(await code(sql`insert into document_links ${sql(link)}`)).toBeNull();
    expect(await code(sql`insert into document_links ${sql(link)}`)).toBe('23505');
    expect(
      await code(sql`insert into document_links ${sql({ ...link, kind: 'corrects' })}`),
    ).toBeNull();
    expect(await code(sql`insert into document_links ${sql({ ...link, kind: 'mentions' })}`)).toBe(
      '22P02',
    );
    const [l] = await sql`select created_by from document_links
      where from_document_id = ${docId} and to_document_id = ${other} and kind = 'supports'`;
    expect(l?.created_by).toBe('system');
  });

  it('document_fields: is_current default and the partial index; validation_results unique', async () => {
    const [f] =
      await sql`insert into document_fields (org_id, document_id, field_key, value_text, source, bbox)
      values (${ORG}, ${docId}, 'document_number', 'TEST-0001', 'rule', '{0.1,0.2,0.3,0.4}')
      returning is_current, bbox::text as bbox, extraction_run_id`;
    expect(f).toEqual({ is_current: true, bbox: '{0.1,0.2,0.3,0.4}', extraction_run_id: null });
    const [idx] = await sql`select indexdef as def from pg_indexes
      where schemaname = 'public' and indexname = 'document_fields_document_id_field_key_idx'`;
    expect(idx?.def).toContain('WHERE is_current');
    const vr = {
      org_id: ORG,
      document_id: docId,
      rule_id: 'MATH_VAT_RECAP',
      rule_version: 1,
      severity: 'warning',
    };
    const [v] =
      await sql`insert into validation_results ${sql(vr)} returning state, field_keys, params`;
    expect(v).toEqual({ state: 'open', field_keys: [], params: {} });
    expect(await code(sql`insert into validation_results ${sql(vr)}`)).toBe('23505');
    expect(
      await code(
        sql`insert into validation_results ${sql({ ...vr, rule_id: 'X', severity: 'fatal' })}`,
      ),
    ).toBe('22P02');
  });

  it('extraction_runs is select-only for users (05 §10.2); its stage and input_mode checks', async () => {
    const run = { org_id: ORG, document_id: docId, stage: 'extract', method: 'llm', ok: true };
    const r = one(
      await sql<{ id: string }[]>`insert into extraction_runs ${sql(run)} returning id`,
    );
    expect(await code(sql`insert into extraction_runs ${sql({ ...run, stage: 'ocr' })}`)).toBe(
      '23514',
    );
    expect(
      await code(sql`insert into extraction_runs ${sql({ ...run, input_mode: 'audio' })}`),
    ).toBe('23514');
    const seen = await asUser(
      OWNER,
      (tx) => tx`select id from extraction_runs where org_id = ${ORG}`,
    );
    expect(seen.map((x) => x.id)).toEqual([r.id]);
    expect(await code(asUser(OWNER, (tx) => tx`insert into extraction_runs ${tx(run)}`))).toBe(
      '42501',
    );
    const updated = await asUser(
      OWNER,
      (tx) => tx`update extraction_runs set ok = false where id = ${r.id} returning id`,
    );
    expect(updated).toHaveLength(0);
    const deleted = await asUser(
      OWNER,
      (tx) => tx`delete from extraction_runs where id = ${r.id} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('review_questions: the accountant answers, cannot change anything else; the service role can', async () => {
    const q = one(
      await sql<{ id: string }[]>`insert into review_questions (org_id, document_id, kind, payload)
        values (${ORG}, ${docId}, 'confirm_total', '{"field_key": "total_gross"}') returning id`,
    );
    const answered = await asUser(
      ACCOUNTANT,
      (
        tx,
      ) => tx`update review_questions set answer = '{"confirmed": true}', answered_by = ${ACCOUNTANT},
        answered_at = now() where id = ${q.id} returning answered_by`,
    );
    expect(answered.map((x) => x.answered_by)).toEqual([ACCOUNTANT]);
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) => tx`update review_questions set kind = 'other' where id = ${q.id}`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) => tx`update review_questions set payload = '{}' where id = ${q.id}`,
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        asUser(
          ACCOUNTANT,
          (tx) =>
            tx`insert into review_questions (org_id, kind, payload) values (${ORG}, 'x', '{}')`,
        ),
      ),
    ).toBe('42501');
    const deleted = await asUser(
      ACCOUNTANT,
      (tx) => tx`delete from review_questions where id = ${q.id} returning id`,
    );
    expect(deleted).toHaveLength(0);
    const owner = await asUser(
      OWNER,
      (tx) => tx`update review_questions set kind = 'other' where id = ${q.id} returning kind`,
    );
    expect(owner.map((x) => x.kind)).toEqual(['other']);
    const [svc] =
      await sql`update review_questions set kind = 'confirm_vat' where id = ${q.id} returning kind`;
    expect(svc?.kind).toBe('confirm_vat');
  });

  it('cascades: deleting a document removes its detail rows; covered_by is set null', async () => {
    const d = one(await insertDoc()).id;
    const fee = one(await insertDoc()).id;
    await sql`insert into document_lines (org_id, document_id, position) values (${ORG}, ${d}, 1)`;
    await sql`insert into document_lines (org_id, document_id, position, covered_by_document_id)
      values (${ORG}, ${fee}, 1, ${d})`;
    await sql`insert into document_vat_summary (org_id, document_id, vat_rate_type, vat_rate_pct, base, vat)
      values (${ORG}, ${d}, 'zero', '0.00', '50.00', '0.00')`;
    await sql`insert into document_fields (org_id, document_id, field_key, source) values (${ORG}, ${d}, 'duzp', 'llm')`;
    await sql`insert into extraction_runs (org_id, document_id, stage, method, ok) values (${ORG}, ${d}, 'classify', 'rule', true)`;
    await sql`insert into validation_results (org_id, document_id, rule_id, rule_version, severity)
      values (${ORG}, ${d}, 'DUP_PROBABLE', 1, 'blocking')`;
    await sql`insert into review_questions (org_id, document_id, kind, payload) values (${ORG}, ${d}, 'confirm_partner', '{}')`;
    await sql`insert into document_links (org_id, from_document_id, to_document_id, kind) values (${ORG}, ${fee}, ${d}, 'settles')`;
    await sql`delete from documents where id = ${d}`;
    for (const table of [
      'document_lines',
      'document_vat_summary',
      'document_fields',
      'extraction_runs',
      'validation_results',
      'review_questions',
    ]) {
      expect(await sql`select 1 from ${sql(table)} where document_id = ${d}`, table).toHaveLength(
        0,
      );
    }
    expect(await sql`select 1 from document_links where to_document_id = ${d}`).toHaveLength(0);
    const [left] =
      await sql`select covered_by_document_id as c from document_lines where document_id = ${fee}`;
    expect(left?.c).toBeNull();
  });
});
