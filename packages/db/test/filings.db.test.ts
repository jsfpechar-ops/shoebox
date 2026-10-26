import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  completeObligation,
  insertFiling,
  ledgerHashOf,
  listFilings,
  markFilingFiled,
  type PeriodLedger,
  readFiling,
  readPeriodLedger,
  supersedeOpenFilings,
  upsertVatObligations,
} from '../src/filings';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'dddddddd-0000-4000-8000-000000000343';
const DOC = 'dddddddd-0000-4000-8000-0000000000d1';
const DOC2 = 'dddddddd-0000-4000-8000-0000000000d2';
const PERIOD = '2026-08-01';
const PERIOD_END = '2026-08-31';
const JULY = '2026-07-01';
const JULY_END = '2026-07-31';
const AT = new Date('2026-08-20T10:00:00Z');

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('filing I/O', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;
  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret) values (${ORG}, 'Org F', '12345678', 'CZ12345678', 'org-f-0343', 'FFFFFFFF')`;
    await sql`insert into taxpayer_profiles (org_id, valid_from, vat_status, vat_period, tax_regime, legal_name, ico, address) values (${ORG}, '2026-01-01', 'identifikovana_osoba', 'monthly', 'danova_evidence', 'Org F', '12345678', '{}'::jsonb)`;
    await sql`insert into documents (id, org_id, entry_mode, status, class, direction, currency, issue_date, duzp, total_gross, revision) values (${DOC}, ${ORG}, 'manual', 'ready', 'received_invoice', 'in', 'CZK', '2026-08-10', '2026-08-10', '121.00', 1), (${DOC2}, ${ORG}, 'manual', 'ready', 'received_invoice', 'in', 'CZK', '2026-08-12', '2026-08-12', '60.50', 1)`;
    await sql`insert into vat_ledger_entries (org_id, period_start, period_end, vat_point_date, vat_point_rule, document_id, vat_treatment, vat_rate_type, vat_rate_pct, base_czk, vat_czk, deduction_pct, currency, dphdp3_rows, build_version) values (${ORG}, ${PERIOD}, ${PERIOD_END}, '2026-08-10', 'duzp', ${DOC}, 'rcv_domestic_vat', 'standard', '21.00', '100.00', '21.00', '100.00', 'CZK', ARRAY['40'], 1), (${ORG}, ${PERIOD}, ${PERIOD_END}, '2026-08-12', 'duzp', ${DOC2}, 'rcv_domestic_vat', 'standard', '21.00', '50.00', '10.50', '100.00', 'CZK', ARRAY['40'], 2)`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);
  afterAll(async () => {
    if (sql) await sql`delete from organizations where id = ${ORG}`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('readPeriodLedger returns entries, documents, profiles and a stable hash', async () => {
    const read = () => db.withTenant(ORG, (tx) => readPeriodLedger(tx, ORG, PERIOD, PERIOD_END));
    const first: PeriodLedger = await read();
    const second = await read();
    expect(first.entries).toHaveLength(2);
    expect(first.documents.map((d) => d.id).sort()).toEqual([DOC, DOC2].sort());
    expect(first.profiles).toHaveLength(1);
    expect(second.ledgerHash).toBe(first.ledgerHash);
    expect(first.ledgerHash).toBe(ledgerHashOf(first.entries));
    await sql`update vat_ledger_entries set build_version = 3 where org_id = ${ORG} and document_id = ${DOC}`;
    const changed = await read();
    expect(changed.ledgerHash).not.toBe(first.ledgerHash);
  });

  it('insertFiling writes the three tables; supersedeOpenFilings frees the slot; readFiling/listFilings read back', async () => {
    const ledger = await db.withTenant(ORG, (tx) => readPeriodLedger(tx, ORG, PERIOD, PERIOD_END));
    const id = await db.withTenant(ORG, (tx) =>
      insertFiling(
        tx,
        {
          orgId: ORG,
          type: 'DPHDP3',
          kind: 'radne',
          periodStart: PERIOD,
          periodEnd: PERIOD_END,
          state: 'generated',
          totals: {},
          simpleCheck: {},
          generatedAt: AT,
        },
        [
          { documentId: DOC, revision: 1 },
          { documentId: DOC2, revision: 1 },
        ],
        ledger.entries,
      ),
    );
    const counts =
      await sql`select (select count(*)::int from filing_documents where filing_id = ${id}) as docs, (select count(*)::int from filing_entries where filing_id = ${id}) as entries`;
    expect(counts[0]).toEqual({ docs: 2, entries: 2 });

    const superseded = await db.withTenant(ORG, (tx) =>
      supersedeOpenFilings(tx, ORG, 'DPHDP3', PERIOD, 'radne'),
    );
    expect(superseded).toEqual([id]);
    const row = await db.withTenant(ORG, (tx) => readFiling(tx, ORG, id));
    expect(row).toMatchObject({ id, state: 'superseded', type: 'DPHDP3', periodStart: PERIOD });
    expect(row?.generatedAt).toBe(AT.toISOString());
    const listed = await db.withTenant(ORG, (tx) =>
      listFilings(tx, ORG, { periodStart: PERIOD, types: ['DPHDP3'] }),
    );
    expect(listed.map((f) => f.id)).toEqual([id]);

    const again = await db.withTenant(ORG, (tx) =>
      insertFiling(
        tx,
        {
          orgId: ORG,
          type: 'DPHDP3',
          kind: 'radne',
          periodStart: PERIOD,
          periodEnd: PERIOD_END,
          state: 'draft',
          totals: {},
          simpleCheck: {},
        },
        [],
        [],
      ),
    );
    expect(again).not.toBe(id);
  });

  it('markFilingFiled: draft → wrong_state; generated → ok; opravne supersedes the amended filing', async () => {
    const mk = (state: string, kind: string, amendsFilingId: string | null = null) =>
      db.withTenant(ORG, (tx) =>
        insertFiling(
          tx,
          {
            orgId: ORG,
            type: 'DPHDP3',
            kind,
            periodStart: JULY,
            periodEnd: JULY_END,
            state,
            amendsFilingId,
            totals: {},
            simpleCheck: {},
          },
          [],
          [],
        ),
      );
    const draft = await mk('draft', 'radne');
    const mark = (id: string) =>
      db.withTenant(ORG, (tx) =>
        markFilingFiled(tx, ORG, id, { filedOn: '2026-08-20', submissionRef: 'SUB-1', at: AT }),
      );
    expect(await mark(draft)).toBe('wrong_state');

    await db.withTenant(ORG, (tx) => supersedeOpenFilings(tx, ORG, 'DPHDP3', JULY, 'radne'));
    const generated = await mk('generated', 'radne');
    expect(await mark(generated)).toBe('ok');
    const filed = await db.withTenant(ORG, (tx) => readFiling(tx, ORG, generated));
    expect(filed).toMatchObject({
      state: 'marked_filed',
      filedOn: '2026-08-20',
      submissionRef: 'SUB-1',
    });

    const amendment = await mk('generated', 'opravne', generated);
    expect(await mark(amendment)).toBe('ok');
    const amended = await db.withTenant(ORG, (tx) => readFiling(tx, ORG, generated));
    expect(amended?.state).toBe('superseded');
    expect(await mark('dddddddd-0000-4000-8000-00000000ffff')).toBe('not_found');
  });

  it('upsertVatObligations inserts then updates; a user-done row is not reopened; completeObligation marks done by filing', async () => {
    const draft = (
      kind: 'vat_payment' | 'vat_return',
      dueDate: string,
      state: 'open' | 'done' = 'open',
    ) => ({
      kind,
      periodStart: PERIOD as never,
      periodEnd: PERIOD_END as never,
      legalDueDate: dueDate as never,
      dueDate: dueDate as never,
      amountEstimate: null,
      state,
      doneSource: null,
      sourceRule: 'm05.vat_obligations.v1',
    });
    const first = await db.withTenant(ORG, (tx) =>
      upsertVatObligations(
        tx,
        ORG,
        [draft('vat_payment', '2026-09-25'), draft('vat_return', '2026-09-25')],
        1,
      ),
    );
    expect(first).toBe(2);
    const second = await db.withTenant(ORG, (tx) =>
      upsertVatObligations(tx, ORG, [draft('vat_payment', '2026-09-28')], 2),
    );
    expect(second).toBe(1);
    const due =
      await sql`select due_date::text as d, generator_version as g from obligations where org_id = ${ORG} and kind = 'vat_payment' and period_start = ${PERIOD}`;
    expect(due[0]).toEqual({ d: '2026-09-28', g: 2 });

    await sql`update obligations set state = 'done', done_source = 'user', done_at = now() where org_id = ${ORG} and kind = 'vat_payment' and period_start = ${PERIOD}`;
    await db.withTenant(ORG, (tx) =>
      upsertVatObligations(tx, ORG, [draft('vat_payment', '2026-09-28')], 3),
    );
    const kept =
      await sql`select state from obligations where org_id = ${ORG} and kind = 'vat_payment' and period_start = ${PERIOD}`;
    expect(kept[0]).toEqual({ state: 'done' });

    const id = await db.withTenant(ORG, (tx) =>
      insertFiling(
        tx,
        {
          orgId: ORG,
          type: 'DPHDP3',
          kind: 'nasledne',
          periodStart: PERIOD,
          periodEnd: PERIOD_END,
          state: 'generated',
          totals: {},
          simpleCheck: {},
        },
        [],
        [],
      ),
    );
    expect(
      await db.withTenant(ORG, (tx) => completeObligation(tx, ORG, 'vat_return', PERIOD, id, AT)),
    ).toBe(true);
    const ret =
      await sql`select state, done_source as s from obligations where org_id = ${ORG} and kind = 'vat_return' and period_start = ${PERIOD}`;
    expect(ret[0]).toEqual({ state: 'done', s: 'filing' });
    expect(
      await db.withTenant(ORG, (tx) => completeObligation(tx, ORG, 'vat_payment', PERIOD, id, AT)),
    ).toBe(false);
  });
});
