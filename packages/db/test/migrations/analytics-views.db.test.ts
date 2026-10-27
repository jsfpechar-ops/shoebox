import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAnalyticsView } from '../../src/analytics';
import { runMigrations } from '../../src/migrate';

// 0064_analytics_views on known rows; staff-only. Skipped without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const USER = '0f0f0f0f-0000-4000-8000-000000000641';
const MODEL = 'test-model-0521';

describe.skipIf(DATABASE_URL === undefined)('0064 analytics views', () => {
  const url = DATABASE_URL ?? '';
  let sql: Sql;
  let orgId = '';
  let docId = '';

  beforeAll(async () => {
    await runMigrations(url);
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql`insert into auth.users (id) values (${USER}) on conflict (id) do nothing`;
    const [org] = await sql<{ id: string }[]>`insert into organizations
      (name, inbound_email_slug, inbound_email_secret) values ('Analytics test', ${`analytics-${Date.now()}`}, 'ABCDEFGH')
      returning id`;
    orgId = org?.id ?? '';
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${USER}, 'owner')`;
    const [doc] = await sql<
      { id: string }[]
    >`insert into documents (org_id, entry_mode, partner_snapshot)
      values (${orgId}, 'manual', ${sql.json({ ico: '27082440' })}) returning id`;
    docId = doc?.id ?? '';
    await sql`insert into extraction_runs (org_id, document_id, stage, method, ok, model, prompt_version,
        input_tokens, output_tokens, cost_usd)
      values (${orgId}, ${docId}, 'extract', 'llm', true, ${MODEL}, 'p-0521', 1000, 200, 0.0012)`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, model, prompt_version, method, blocking)
      values (${orgId}, ${docId}, 'read', 'needs_review', ${MODEL}, 'p-0521', 'llm', '{MATH_SUM}')`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, detail, model)
      values (${orgId}, ${docId}, 'read_failed', 'http_529', 'retry', ${MODEL})`;
    await sql`insert into pipeline_events (org_id, document_id, kind, code, field_key)
      values (${orgId}, ${docId}, 'user_edit', 'changed', 'total_gross')`;
    await sql`update documents set status = 'ready' where id = ${docId}`;
  });

  afterAll(async () => {
    if (orgId) await sql`delete from organizations where id = ${orgId}`;
    await sql?.end();
  });

  it('counts failure reasons and the checks that fired', async () => {
    const rows = (await readAnalyticsView(sql, 'failure_reasons_weekly')).filter(
      (r) => r.model === MODEL,
    );
    const pick = (kind: string) => rows.find((r) => r.kind === kind);
    expect(pick('check_blocking')?.code).toBe('MATH_SUM');
    expect(pick('read')?.code).toBe('needs_review');
    expect(pick('read_failed')?.code).toBe('http_529');
  });

  it('ties a user fix to the model of the read before it', async () => {
    const rows = await readAnalyticsView(sql, 'field_corrections');
    const row = rows.find((r) => r.field_key === 'total_gross' && r.model === MODEL);
    expect(row?.changed).toBe(1);
    expect(row?.prompt_version).toBe('p-0521');
  });

  it('shows the document journey, cost and supplier', async () => {
    const [j] = await sql`select * from analytics.document_journey where document_id = ${docId}`;
    expect(j?.reads).toBe(1);
    expect(j?.failed_reads).toBe(1);
    expect(j?.user_edits).toBe(1);
    expect(j?.first_outcome).toBe('needs_review');
    expect(j?.straight_through).toBe(false);
    expect(j?.ai_calls).toBe(1);
    expect(j?.ready_at).not.toBeNull();
    const [s] = await sql`select * from analytics.supplier_trouble where org_id = ${orgId}`;
    expect(s?.supplier_ico).toBe('27082440');
    expect(s?.user_edits).toBe(1);
    const cost = (await readAnalyticsView(sql, 'ai_cost_weekly')).find((r) => r.model === MODEL);
    expect(cost?.calls).toBe(1);
  });

  it('app roles cannot read the analytics schema', async () => {
    for (const role of ['authenticated', 'anon', 'app_worker']) {
      let code: string | null = null;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select count(*) from analytics.document_journey`;
        });
      } catch (e) {
        code = (e as { code?: string }).code ?? 'unknown';
      }
      expect(code, role).toBe('42501');
    }
  });
});
