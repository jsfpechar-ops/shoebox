import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/migrate';

// 0050_audit_document: public.audit_document(). Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER = '0f0f0f0f-0000-4000-8000-000000000501';
const OUTSIDER = '0f0f0f0f-0000-4000-8000-000000000502';
const VIEWER = '0f0f0f0f-0000-4000-8000-000000000503';
const ROLLBACK = Symbol('rollback');

describe.skipIf(DATABASE_URL === undefined)('0050 audit_document()', () => {
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

  async function codeAs(uid: string, fn: (tx: TransactionSql) => Promise<unknown>) {
    try {
      await as(uid, fn);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${OWNER}), (${OUTSIDER}), (${VIEWER})
      on conflict (id) do nothing`;
    const [org] = await sql<{ id: string }[]>`insert into organizations
      (name, inbound_email_slug, inbound_email_secret) values ('Audit test', ${`audit-${Date.now()}`}, 'ABCDEFGH')
      returning id`;
    orgId = org?.id ?? '';
    await sql`insert into memberships (org_id, user_id, role) values
      (${orgId}, ${OWNER}, 'owner'), (${orgId}, ${VIEWER}, 'viewer')`;
    const [doc] = await sql<{ id: string }[]>`insert into documents (org_id, entry_mode)
      values (${orgId}, 'manual') returning id`;
    docId = doc?.id ?? '';
  });

  afterAll(async () => {
    if (orgId) await sql`delete from organizations where id = ${orgId}`;
    await sql?.end();
  });

  it('an owner writes one row with the diff, and can read it back', async () => {
    const rows = await as(OWNER, async (tx) => {
      await tx`select public.audit_document(${docId}, 'edit_field',
        ${tx.json({ field: 'total_gross', old: '100.00', new: '121.00' })})`;
      return tx`select action, actor_user_id, diff from audit_log where entity_id = ${docId}`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('edit_field');
    expect(rows[0]?.actor_user_id).toBe(OWNER);
    expect(rows[0]?.diff).toEqual({ field: 'total_gross', old: '100.00', new: '121.00' });
  });

  it('refuses a user outside the org and a viewer', async () => {
    const call = (tx: TransactionSql) =>
      tx`select public.audit_document(${docId}, 'edit_field', ${tx.json({})})`;
    expect(await codeAs(OUTSIDER, call)).toBe('42501');
    expect(await codeAs(VIEWER, call)).toBe('42501');
  });

  it('refuses an unknown action', async () => {
    expect(
      await codeAs(
        OWNER,
        (tx) => tx`select public.audit_document(${docId}, 'drop', ${tx.json({})})`,
      ),
    ).toBe('22023');
  });

  it('a user cannot insert into audit_log directly', async () => {
    expect(
      await codeAs(
        OWNER,
        (tx) => tx`insert into audit_log (org_id, actor_kind, entity, action)
        values (${orgId}, 'user', 'documents', 'edit_field')`,
      ),
    ).toBe('42501');
  });
});
