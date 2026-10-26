import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LedgerReplaceWrite,
  listDocumentsForRebuild,
  loadLedgerInputs,
  readLedgerEntries,
  replaceLedgerEntries,
} from '../src/ledger-rebuild';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'cccccccc-0000-4000-8000-000000000051';
const ORG_S = 'cccccccc-0000-4000-8000-000000000052';
const PARTNER = 'cccccccc-0000-4000-8000-0000000000a1';
const DOC = 'cccccccc-0000-4000-8000-0000000000d1';
const DOC2 = 'cccccccc-0000-4000-8000-0000000000d2';
const LINE = 'cccccccc-0000-4000-8000-0000000000e1';

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(over: Partial<LedgerReplaceWrite> = {}): LedgerReplaceWrite {
  return {
    orgId: ORG,
    documentId: DOC,
    algoVersion: 1,
    inputHash: 'h1',
    tax: [
      {
        entryDate: '2026-09-12',
        taxYear: 2026,
        basis: 'document_evidence',
        lineId: LINE,
        paymentLinkId: null,
        transactionId: null,
        categoryCode: 'exp_other_deductible',
        taxEffect: 'deductible_expense',
        amountCzk: '249.00',
        businessSharePct: '100.00',
        businessAmountCzk: '249.00',
      },
    ],
    vat: [
      {
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        vatPointDate: '2026-09-12',
        vatPointRule: 'duzp',
        lineId: null,
        vatTreatment: 'rcv_domestic_vat',
        vatRateType: 'standard',
        vatRatePct: '21.00',
        baseCzk: '205.79',
        vatCzk: '43.21',
        deductionPct: '100.00',
        currency: 'CZK',
        baseForeign: null,
        fxRate: null,
        fxAmount: null,
        fxRateDate: null,
        dphdp3Rows: ['40'],
        khSection: 'B3',
        khDocumentTotalCzk: '249.00',
        shvCode: null,
        counterpartyVatId: 'CZ26151006',
        evidenceNumber: 'R-1',
      },
    ],
    ...over,
  };
}

describe.skipIf(DATABASE_URL === undefined)('ledger rebuild I/O', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG}, ${ORG_S})`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret) values (${ORG}, 'Org L', '12345678', 'CZ12345678', 'org-l-0324', 'LLLLLLLL'), (${ORG_S}, 'Org M', null, null, 'org-m-0324', 'MMMMMMMM')`;
    await sql`insert into taxpayer_profiles (org_id, valid_from, vat_status, vat_period, tax_regime, legal_name, ico, address) values (${ORG}, '2026-01-01', 'identifikovana_osoba', 'monthly', 'danova_evidence', 'Org L', '12345678', '{}'::jsonb)`;
    await sql`insert into partners (id, org_id, name, ico, dic, country) values (${PARTNER}, ${ORG}, 'Decathlon', '26151006', 'CZ26151006', 'CZ')`;
    await sql`insert into documents (id, org_id, entry_mode, status, class, direction, currency, issue_date, duzp, total_gross, partner_id, revision) values (${DOC}, ${ORG}, 'manual', 'ready', 'received_receipt', 'in', 'CZK', '2026-09-12', '2026-09-12', '249.00', ${PARTNER}, 1), (${DOC2}, ${ORG}, 'manual', 'ready', 'received_invoice', 'in', 'CZK', '2026-08-01', null, '10.00', null, 1)`;
    await sql`insert into document_lines (id, org_id, document_id, position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct, category_code, business_share_pct, vat_treatment) values (${LINE}, ${ORG}, ${DOC}, 1, 'item', '205.79', '43.21', '249.00', 'standard', '21', 'exp_other_deductible', '100', 'rcv_domestic_vat')`;
    await sql`insert into document_vat_summary (org_id, document_id, vat_rate_type, vat_rate_pct, base, vat) values (${ORG}, ${DOC}, 'standard', '21', '205.79', '43.21')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG}, ${ORG_S})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('loads the inputs with lines, recap, partner, profiles and no current hash', async () => {
    const inputs = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(inputs?.doc).toMatchObject({
      id: DOC,
      orgId: ORG,
      class: 'received_receipt',
      status: 'ready',
      deleted: false,
      currency: 'CZK',
      issueDate: '2026-09-12',
      totalGross: '249.00',
      revision: 1,
    });
    expect(inputs?.lines).toEqual([
      expect.objectContaining({
        id: LINE,
        position: 1,
        net: '205.79',
        vat: '43.21',
        gross: '249.00',
        categoryCode: 'exp_other_deductible',
        vatTreatment: 'rcv_domestic_vat',
        vatRateType: 'standard',
      }),
    ]);
    expect(inputs?.recap).toEqual([
      { vatRateType: 'standard', vatRatePct: '21.00', base: '205.79', vat: '43.21' },
    ]);
    expect(inputs?.partner).toEqual({ country: 'CZ', dic: 'CZ26151006', vatId: null });
    expect(inputs?.profiles).toEqual([
      expect.objectContaining({
        validFrom: '2026-01-01',
        vatStatus: 'identifikovana_osoba',
        vatPeriod: 'monthly',
      }),
    ]);
    expect(inputs?.fxRates).toEqual([]);
    expect(inputs?.current).toBeNull();
    expect(await db.withTenant(ORG_S, (tx) => loadLedgerInputs(tx, DOC))).toBeNull();
  });

  it('replaces rows under one build_version and stamps stage_version.ledger; a second replace is identical except id/build_version (AC-5)', async () => {
    const bv1 = await db.withTenant(ORG, (tx) => replaceLedgerEntries(tx, write()));
    const first = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(first.buildVersion).toBe(bv1);
    expect(first.tax).toEqual(write().tax);
    expect(first.vat).toEqual(write().vat);
    const after = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(after?.current).toEqual({ v: 1, h: 'h1', buildVersion: bv1 });

    const bv2 = await db.withTenant(ORG, (tx) =>
      replaceLedgerEntries(tx, write({ inputHash: 'h2' })),
    );
    expect(BigInt(bv2) > BigInt(bv1)).toBe(true);
    const second = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(second.tax).toEqual(first.tax);
    expect(second.vat).toEqual(first.vat);
    const count = await sql<
      { n: string }[]
    >`select count(*)::text as n from tax_ledger_entries where document_id = ${DOC}`;
    expect(count[0]?.n).toBe('1');
    const vatCount = await sql<
      { n: string }[]
    >`select count(*)::text as n from vat_ledger_entries where document_id = ${DOC}`;
    expect(vatCount[0]?.n).toBe('1');
  });

  it('an empty write removes every row and still stamps the hash', async () => {
    await db.withTenant(ORG, (tx) =>
      replaceLedgerEntries(tx, write({ inputHash: 'h3', tax: [], vat: [] })),
    );
    const rows = await db.withTenant(ORG, (tx) => readLedgerEntries(tx, DOC));
    expect(rows).toEqual({ tax: [], vat: [], buildVersion: null });
    const after = await db.withTenant(ORG, (tx) => loadLedgerInputs(tx, DOC));
    expect(after?.current?.h).toBe('h3');
  });

  it('lists documents for a full rebuild in issue_date order with from/offset/limit', async () => {
    expect(await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, null, 0, 10))).toEqual(
      [DOC2, DOC],
    );
    expect(
      await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, '2026-09-01', 0, 10)),
    ).toEqual([DOC]);
    expect(await db.withTenant(ORG, (tx) => listDocumentsForRebuild(tx, ORG, null, 1, 10))).toEqual(
      [DOC],
    );
    expect(
      await db.withTenant(ORG_S, (tx) => listDocumentsForRebuild(tx, ORG_S, null, 0, 10)),
    ).toEqual([]);
  });
});
