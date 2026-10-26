import { EMPTY_ANSWERS } from '@shoebox/domain';
import { sql as sql_ } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import {
  insertPodkladyFiling,
  latestPodkladyFiling,
  type PodkladyRows,
  readPodkladyRows,
  readReserveEstimate,
  upsertReserveEstimate,
} from '../src/podklady';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const A = 'dddddddd-0000-4000-8000-000000000a63';
const B = 'dddddddd-0000-4000-8000-000000000b63';
const id = (n: number) => `dddddddd-0000-4000-8000-0000000063${String(n).padStart(2, '0')}`;
const D_ASSET = id(1);
const D_SMALL = id(2);
const D_OLD = id(3);
const D_PENDING = id(4);
const D_ISSUED = id(5);
const D_B = id(6);
const D_EUR = id(7);
const L_ASSET = id(11);
const L_SMALL = id(12);
const L_OLD = id(13);
const ACC_A = id(21);
const ACC_B = id(22);
const LEDGER_ALGO = 2n;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('podklady I/O', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;
  const read = (org: string, year = 2026) =>
    db.withTenant(org, (tx) => readPodkladyRows(tx, org, year, LEDGER_ALGO, 7));

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${A}, ${B})`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret) values (${A}, 'Org A', '12345678', 'CZ12345678', 'org-a-0363', 'AAAAAAAA'), (${B}, 'Org B', '87654321', 'CZ87654321', 'org-b-0363', 'BBBBBBBB')`;
    for (const org of [A, B]) {
      await sql`insert into taxpayer_profiles (org_id, valid_from, vat_status, tax_regime, legal_name, ico, address) values (${org}, '2025-01-01', 'platce', 'danova_evidence', ${`Name ${org === A ? 'A' : 'B'}`}, '12345678', '{}'::jsonb)`;
    }
    await sql`insert into documents (id, org_id, entry_mode, status, class, direction, currency, issue_date, paid_at, total_gross, business_flag, revision) values
      (${D_ASSET}, ${A}, 'manual', 'finalized', 'received_invoice', 'in', 'CZK', '2026-03-01', '2026-03-05', '12100.00', 'business', 2),
      (${D_SMALL}, ${A}, 'manual', 'ready', 'received_invoice', 'in', 'CZK', '2026-04-01', '2026-04-02', '3000.00', 'unknown', 1),
      (${D_OLD}, ${A}, 'manual', 'finalized', 'received_invoice', 'in', 'CZK', '2025-05-01', '2025-05-02', '9000.00', 'business', 1),
      (${D_PENDING}, ${A}, 'manual', 'needs_review', 'received_invoice', 'in', 'CZK', '2026-06-01', null, '100.00', 'business', 1),
      (${D_ISSUED}, ${A}, 'manual', 'finalized', 'issued_invoice', 'out', 'CZK', '2026-02-01', null, '500.00', 'business', 1),
      (${D_B}, ${B}, 'manual', 'finalized', 'received_invoice', 'in', 'CZK', '2026-03-01', '2026-03-05', '777.00', 'business', 1),
      (${D_EUR}, ${A}, 'manual', 'finalized', 'received_receipt', 'in', 'EUR', '2026-05-03', '2026-05-03', '100.00', 'personal', 1)`;
    await sql`update documents set fx_rate = '25.000000', fx_rate_date = '2026-05-03' where id = ${D_EUR}`;
    await sql`insert into document_lines (id, org_id, document_id, position, description, gross, category_code, business_share_pct) values
      (${L_ASSET}, ${A}, ${D_ASSET}, 1, 'Laptop', '12100.00', 'asset_long_term', '100'),
      (${L_SMALL}, ${A}, ${D_SMALL}, 1, 'Mouse', '3000.00', 'exp_small_assets', '60'),
      (${L_OLD}, ${A}, ${D_OLD}, 1, 'Old', '9000.00', 'asset_long_term', '100')`;
    await sql`insert into tax_ledger_entries (org_id, entry_date, tax_year, basis, document_id, line_id, category_code, tax_effect, amount_czk, business_share_pct, business_amount_czk, build_version) values
      (${A}, '2026-03-05', 2026, 'payment', ${D_ASSET}, ${L_ASSET}, 'asset_long_term', 'asset', '12100.00', '100', '12100.00', 10),
      (${A}, '2026-04-02', 2026, 'payment', ${D_SMALL}, ${L_SMALL}, 'exp_small_assets', 'deductible_expense', '3000.00', '60', '1800.00', 9),
      (${A}, '2027-01-02', 2027, 'payment', ${D_OLD}, ${L_OLD}, 'asset_long_term', 'asset', '1.00', '100', '1.00', 10),
      (${B}, '2026-03-05', 2026, 'payment', ${D_B}, null, 'exp_other_deductible', 'deductible_expense', '777.00', '100', '777.00', 10)`;
    // D_SMALL was built by ledger algo v1, so its entry counts as stale.
    await sql`update documents set stage_version = jsonb_build_object('ledger', jsonb_build_object('v', case when id = ${D_SMALL} then 1 else 2 end)) where org_id in (${A}, ${B})`;
    await sql`insert into money_accounts (id, org_id, type, name) values (${ACC_A}, ${A}, 'bank', 'A'), (${ACC_B}, ${B}, 'bank', 'B')`;
    await sql`insert into transactions (org_id, money_account_id, source, booked_on, amount, currency, category_code, match_state) values
      (${A}, ${ACC_A}, 'manual', '2026-05-01', '-1500.00', 'CZK', 'ins_social_own', 'no_document_needed'),
      (${A}, ${ACC_A}, 'manual', '2026-05-02', '-200.00', 'CZK', 'tax_vat_payment', 'no_document_needed'),
      (${A}, ${ACC_A}, 'manual', '2025-05-02', '-300.00', 'CZK', 'tax_vat_payment', 'no_document_needed'),
      (${A}, ${ACC_A}, 'manual', '2026-05-03', '-40.00', 'CZK', 'exp_other_deductible', 'unmatched'),
      (${A}, ${ACC_A}, 'manual', '2026-05-04', '100.00', 'CZK', null, 'unmatched'),
      (${B}, ${ACC_B}, 'manual', '2026-05-01', '-999.00', 'CZK', 'ins_social_own', 'unmatched')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 60_000);
  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${A}, ${B})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  describe('readPodkladyRows', () => {
    it("returns A's 2026 entries and profiles only; B's rows and 2027 entries are absent; ledgerHash stable across two reads", async () => {
      const first = await read(A);
      const second = await read(A);
      expect(first.entries.map((e) => e.documentId).sort()).toEqual([D_ASSET, D_SMALL].sort());
      expect(first.profiles).toHaveLength(1);
      expect(first.taxpayer).toEqual({ legalName: 'Name A', ico: '12345678' });
      expect(first.documents.find((d) => d.documentId === D_ASSET)?.revision).toBe(2);
      expect(second.ledgerHash).toBe(first.ledgerHash);
      const other = await read(B);
      expect(other.entries.map((e) => e.documentId)).toEqual([D_B]);
      expect(other.ledgerHash).not.toBe(first.ledgerHash);
      expect(first.readiness.ledger.staleEntries).toBe(1);
    });

    it('asset lines: an asset_long_term line paid in 2026 with its partner name and paidInYear; an exp_small_assets line; a 2025 line absent', async () => {
      const { assetLines } = await read(A);
      expect(assetLines.map((l) => l.lineId).sort()).toEqual([L_ASSET, L_SMALL].sort());
      const asset = assetLines.find((l) => l.lineId === L_ASSET);
      expect(asset?.categoryCode).toBe('asset_long_term');
      expect(asset?.paidInYear.toFixed2()).toBe('12100.00');
      expect(asset?.vatDeducted).toBe(true);
      expect(asset?.partnerName).toBeNull();
      const small = assetLines.find((l) => l.lineId === L_SMALL);
      expect(small?.businessSharePct).toBe('60.00');
    });

    it('readiness counts: one pending document, one unpaid issued invoice, one unmatched outgoing transaction with its sum', async () => {
      const { readiness, privateUse, privateUseFxMissing } = await read(A);
      expect(readiness.pendingDocuments).toBe(1);
      expect(readiness.unpaidIssued).toBe(1);
      expect(readiness.unexplainedTransactions.count).toBe(1);
      expect(readiness.unexplainedTransactions.sum.toFixed2()).toBe('40.00');
      expect(readiness.businessFlagUnknown.count).toBe(1);
      expect(readiness.businessFlagUnknown.sum.toFixed2()).toBe('3000.00');
      expect(privateUse.partialShareLines.map((l) => l.lineId)).toEqual([L_SMALL]);
      expect(privateUse.partialShareLines[0]?.totalCzk.toFixed2()).toBe('3000.00');
      expect(privateUse.personalDocuments.find((p) => p.documentId === D_EUR)?.amountCzk.toFixed2()).toBe(
        '2500.00',
      );
      expect(privateUseFxMissing).toEqual([]);
    });

    it('transactions: only the six tax/insurance categories of the year, signed as stored', async () => {
      const { transactions } = await read(A);
      expect(transactions.map((t) => [t.categoryCode, t.amount.toFixed2()]).sort()).toEqual([
        ['ins_social_own', '-1500.00'],
        ['tax_vat_payment', '-200.00'],
      ]);
    });
  });

  describe('insertPodkladyFiling', () => {
    const AT = new Date('2026-12-20T10:00:00Z');
    const insert = async (rows: PodkladyRows) =>
      db.withTenant(A, (tx) =>
        insertPodkladyFiling(
          tx,
          A,
          {
            year: 2026,
            totals: { headline: { income: '1.00' } },
            answers: EMPTY_ANSWERS,
            answersVersion: 1,
            pdfPath: null,
            xlsxPath: null,
            generatedBy: null as unknown as string,
            at: AT,
          },
          rows,
        ),
      );

    it('creates a generated PODKLADY_DPFO filing for 2026-01-01..2026-12-31 with filing_documents for every contributing document; a second insert supersedes the first', async () => {
      const rows = await read(A);
      const first = await insert(rows);
      expect(first.supersededIds).toEqual([]);
      const f =
        await sql`select type, state, period_start::text as ps, period_end::text as pe, totals, inputs from filings where id = ${first.filingId}`;
      expect(f[0]).toMatchObject({
        type: 'PODKLADY_DPFO',
        state: 'generated',
        ps: '2026-01-01',
        pe: '2026-12-31',
      });
      expect(f[0]?.totals).toMatchObject({ ledgerHash: rows.ledgerHash, answersVersion: 1 });
      const docs =
        await sql`select document_id from filing_documents where filing_id = ${first.filingId}`;
      expect(docs.map((d) => d.document_id).sort()).toEqual([D_ASSET, D_SMALL].sort());
      const second = await insert(rows);
      expect(second.supersededIds).toEqual([first.filingId]);
    });

    it('latestPodkladyFiling returns the newest non-superseded one', async () => {
      const latest = await db.withTenant(A, (tx) => latestPodkladyFiling(tx, A, 2026));
      const open =
        await sql`select id from filings where org_id = ${A} and type = 'PODKLADY_DPFO' and state = 'generated'`;
      expect(latest?.id).toBe(open[0]?.id);
      expect(await db.withTenant(B, (tx) => latestPodkladyFiling(tx, B, 2026))).toBeNull();
    });

    it('general 5: inputs containing rodneCislo / rod_c / rodne_cislo are rejected by filings_inputs_no_rc (raw insert through the tx)', async () => {
      for (const key of ['rodneCislo', 'rod_c', 'rodne_cislo']) {
        const attempt = db.withTenant(A, (tx) =>
          tx.execute(
            sql_`insert into filings (org_id, type, kind, period_start, period_end, state, inputs) values (${A}, 'PODKLADY_DPFO', 'radne', '2030-01-01', '2030-12-31', 'draft', ${JSON.stringify({ [key]: 'x' })}::jsonb)`,
          ),
        );
        await expect(attempt).rejects.toThrow();
      }
    });
  });

  describe('reserve cache', () => {
    it('upsert as the worker, read as A; B reads null; second upsert replaces the row', async () => {
      const row = {
        asOf: '2026-10-26',
        taxYear: 2026,
        kind: 'estimate' as const,
        payload: { v: 1 },
        ledgerHash: 'h1',
      };
      await db.withServiceRole('admin', (tx) => upsertReserveEstimate(tx, A, row));
      const got = await db.withTenant(A, (tx) => readReserveEstimate(tx, A));
      expect(got).toMatchObject({
        asOf: '2026-10-26',
        taxYear: 2026,
        kind: 'estimate',
        ledgerHash: 'h1',
        payload: { v: 1 },
      });
      expect(await db.withTenant(B, (tx) => readReserveEstimate(tx, B))).toBeNull();
      await db.withServiceRole('admin', (tx) =>
        upsertReserveEstimate(tx, A, {
          ...row,
          kind: 'pausalni_dan',
          payload: { v: 2 },
          ledgerHash: null,
        }),
      );
      const again = await db.withTenant(A, (tx) => readReserveEstimate(tx, A));
      expect(again).toMatchObject({ kind: 'pausalni_dan', payload: { v: 2 }, ledgerHash: null });
    });
  });
});
