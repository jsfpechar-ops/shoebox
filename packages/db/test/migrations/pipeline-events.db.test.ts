import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0063_pipeline_events: status trigger, audit_document() v2 events, read-only for users. Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER = '0f0f0f0f-0000-4000-8000-000000000631';
const OUTSIDER = '0f0f0f0f-0000-4000-8000-000000000632';
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('0063 pipeline_events', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let orgId = '';
  let docId = '';

  async function as<T>(uid: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claim.sub', ${uid}, true)`;
        await tx`set local role authenticated`;
        result = await fn(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    return result as T;
  }

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${OWNER}), (${OUTSIDER}) on conflict (id) do nothing`;
    const [org] = await sql<{ id: string }[]>`insert into organizations
      (name, inbound_email_slug, inbound_email_secret) values ('Events test', ${`events-${Date.now()}`}, 'ABCDEFGH')
      returning id`;
    orgId = org?.id ?? '';
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${OWNER}, 'owner')`;
    const [doc] = await sql<{ id: string }[]>`insert into documents (org_id, entry_mode)
      values (${orgId}, 'manual') returning id`;
    docId = doc?.id ?? '';
  });

  afterAll(async () => {
    if (orgId) await sql`delete from organizations where id = ${orgId}`;
    await sql?.end();
  });

  it('logs the new document and each status change, not a same-status update', async () => {
    await sql`update documents set status = 'needs_review' where id = ${docId}`;
    await sql`update documents set status = 'needs_review' where id = ${docId}`;
    await sql`update documents set status = 'ready' where id = ${docId}`;
    const rows = await sql`select code, from_status from pipeline_events
      where document_id = ${docId} and kind = 'status' order by id`;
    expect(rows.map((r) => [r.code, r.from_status])).toEqual([
      ['received', null],
      ['needs_review', 'received'],
      ['ready', 'needs_review'],
    ]);
  });

  it('audit_document logs the user action as codes, never the values', async () => {
    await as(OWNER, async (tx) => {
      await tx`select public.audit_document(${docId}, 'edit_field',
        ${tx.json({ field: 'total_gross', old: '100.00', new: '121.00' })})`;
      await tx`select public.audit_document(${docId}, 'edit_field',
        ${tx.json({ field: 'due_date', old: null, new: '2026-11-30' })})`;
      await tx`select public.audit_document(${docId}, 'trash', ${tx.json({})})`;
      const rows = await tx`select kind, code, field_key from pipeline_events
        where document_id = ${docId} and kind like 'user_%' order by id`;
      expect(rows.map((r) => [r.kind, r.code, r.field_key])).toEqual([
        ['user_edit', 'changed', 'total_gross'],
        ['user_edit', 'filled', 'due_date'],
        ['user_trash', null, null],
      ]);
      const text = JSON.stringify(
        await tx`select * from pipeline_events where document_id = ${docId}`,
      );
      expect(text).not.toContain('121.00');
      expect(text).not.toContain('2026-11-30');
    });
  });

  it('a user cannot write events, and another org sees none', async () => {
    let code: string | null = null;
    try {
      await as(
        OWNER,
        (tx) => tx`insert into pipeline_events (org_id, document_id, kind)
        values (${orgId}, ${docId}, 'status')`,
      );
    } catch (e) {
      code = (e as { code?: string }).code ?? 'unknown';
    }
    expect(code).toBe('42501');
    const seen = await as(
      OUTSIDER,
      (tx) => tx`select count(*)::int as n from pipeline_events
      where document_id = ${docId}`,
    );
    expect(seen[0]?.n).toBe(0);
  });
});
