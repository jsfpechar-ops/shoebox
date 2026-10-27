import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadDocumentForRead,
  type ReadingWrite,
  recordFailedRead,
  saveDocumentReading,
  setDocumentStatus,
} from '../src/document-reading';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG_R = 'eeeeeeee-0000-4000-8000-000000000045';
const ORG_S = 'eeeeeeee-0000-4000-8000-000000000046';
const SF = 'eeeeeeee-0000-4000-8000-0000000000f1';
const DOC = 'eeeeeeee-0000-4000-8000-0000000000d1';
const SHA = 'a'.repeat(64);

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(overrides: Partial<ReadingWrite> = {}): ReadingWrite {
  return {
    orgId: ORG_R,
    documentId: DOC,
    status: 'ready',
    patch: {
      class: 'received_invoice',
      classSource: 'llm',
      direction: 'in',
      taxDocStatus: 'full_tax_document',
      partnerSnapshot: {
        name: 'Dodavatel s.r.o.',
        ico: '27082440',
        dic: 'CZ27082440',
        vat_id: null,
        country: 'CZ',
      },
      buyerSnapshot: null,
      documentNumber: 'FV1',
      variableSymbol: '1',
      issueDate: '2026-10-01',
      duzp: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'CZK',
      totalNet: '1000',
      totalVat: '210',
      totalGross: '1210',
      paymentMethod: 'bank_transfer',
      payToAccount: { account: '123456789', bank_code: '0100', iban: null },
      isPaidPerDocument: null,
    },
    vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '1000', vat: '210' }],
    fields: [
      { fieldKey: 'supplier.ico', valueText: '27082440', source: 'llm' },
      { fieldKey: 'totals.gross', valueText: '1210', source: 'llm' },
    ],
    validations: [
      { ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: { a: 1 } },
    ],
    run: {
      model: 'claude-haiku-5-5',
      promptVersion: 'm02-proto-v3',
      attempt: 1,
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 1500,
    },
    ...overrides,
  };
}

describe.skipIf(DATABASE_URL === undefined)('document reading store', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG_R}, ${ORG_S})`;
    await sql`insert into organizations (id, name, ico, dic, inbound_email_slug, inbound_email_secret)
      values (${ORG_R}, 'Org R', '12345678', 'CZ12345678', 'org-r-0048', 'RRRRRRRR'),
             (${ORG_S}, 'Org S', null, null, 'org-s-0048', 'SSSSSSSS')`;
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${SF}, ${ORG_R}, ${SHA}, ${`org/${ORG_R}/files/${SHA}`}, 'application/pdf', 10, 'upload')`;
    await sql`insert into documents (id, org_id, source_file_id, status) values (${DOC}, ${ORG_R}, ${SF}, 'received')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG_R}, ${ORG_S})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('loads the document with its file and the org identity', async () => {
    const doc = await db.withTenant(ORG_R, (tx) => loadDocumentForRead(tx, DOC));
    expect(doc).toEqual({
      id: DOC,
      orgId: ORG_R,
      status: 'received',
      revision: 1,
      storagePath: `org/${ORG_R}/files/${SHA}`,
      mimeType: 'application/pdf',
      orgIco: '12345678',
      orgDic: 'CZ12345678',
    });
  });

  it('another org cannot see it', async () => {
    expect(await db.withTenant(ORG_S, (tx) => loadDocumentForRead(tx, DOC))).toBeNull();
  });

  it('saves a reading, and a re-read replaces it cleanly', async () => {
    await db.withTenant(ORG_R, (tx) => setDocumentStatus(tx, DOC, 'extracting'));
    const runId = await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    await sql`update validation_results set state = 'dismissed' where document_id = ${DOC}`;
    await db.withTenant(ORG_R, (tx) =>
      saveDocumentReading(
        tx,
        write({
          status: 'needs_review',
          validations: [
            { ruleId: 'PROTO_DIC_FORMAT', ruleVersion: 1, severity: 'warning', params: {} },
            { ruleId: 'PROTO_VAT_SUM', ruleVersion: 1, severity: 'blocking', params: {} },
          ],
        }),
      ),
    );

    const [doc] =
      await sql`select status, total_gross, class, partner_snapshot->>'ico' as ico from documents where id = ${DOC}`;
    expect(doc).toEqual({
      status: 'needs_review',
      total_gross: '1210.00',
      class: 'received_invoice',
      ico: '27082440',
    });
    const vat =
      await sql`select vat_rate_type, base, vat from document_vat_summary where document_id = ${DOC}`;
    expect(vat).toEqual([{ vat_rate_type: 'standard', base: '1000.00', vat: '210.00' }]);
    const lines =
      await sql`select position, line_type, net, vat, gross, vat_rate_type, vat_rate_pct from document_lines where document_id = ${DOC} order by position`;
    expect(lines).toEqual([
      {
        position: 1,
        line_type: 'item',
        net: '1000.00',
        vat: '210.00',
        gross: '1210.00',
        vat_rate_type: 'standard',
        vat_rate_pct: '21.00',
      },
    ]);
    const [fields] =
      await sql`select count(*) filter (where is_current)::int as current, count(*)::int as total
      from document_fields where document_id = ${DOC}`;
    expect(fields).toEqual({ current: 2, total: 4 });
    const checks =
      await sql`select rule_id, state from validation_results where document_id = ${DOC} order by rule_id`;
    expect(checks).toEqual([
      { rule_id: 'PROTO_DIC_FORMAT', state: 'dismissed' },
      { rule_id: 'PROTO_VAT_SUM', state: 'open' },
    ]);
    const [runs] =
      await sql`select count(*)::int as n from extraction_runs where document_id = ${DOC} and ok`;
    expect(runs).toEqual({ n: 2 });
  });
  it('a re-read keeps the category the user set on a line with the same position and gross', async () => {
    await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    await sql`update document_lines set category_code = (select code from categories limit 1), classification_source = 'user'
      where document_id = ${DOC} and position = 1`;
    await db.withTenant(ORG_R, (tx) =>
      saveDocumentReading(
        tx,
        write({
          // needs_review: the next test expects the document to still be in review.
          status: 'needs_review',
          vatSummary: [
            { vatRateType: 'standard', vatRatePct: '21', base: '1000', vat: '210' },
            { vatRateType: 'reduced', vatRatePct: '12', base: '100', vat: '12' },
          ],
        }),
      ),
    );
    const lines =
      await sql`select position, gross, classification_source, category_code is not null as has_category from document_lines where document_id = ${DOC} order by position`;
    expect(lines).toEqual([
      { position: 1, gross: '1210.00', classification_source: 'user', has_category: true },
      { position: 2, gross: '112.00', classification_source: null, has_category: false },
    ]);
  });

  it('records a failed read and fails the document on the last attempt', async () => {
    const failure = {
      orgId: ORG_R,
      documentId: DOC,
      model: 'claude-haiku-5-5',
      promptVersion: 'm02-proto-v3',
      error: 'http_529',
    };
    await db.withTenant(ORG_R, (tx) =>
      recordFailedRead(tx, { ...failure, attempt: 1, final: false }),
    );
    const [mid] = await sql`select status from documents where id = ${DOC}`;
    expect(mid?.status).toBe('needs_review');
    await db.withTenant(ORG_R, (tx) =>
      recordFailedRead(tx, { ...failure, attempt: 3, final: true }),
    );
    const [end] = await sql`select status from documents where id = ${DOC}`;
    expect(end?.status).toBe('failed');
    const [runs] =
      await sql`select count(*)::int as n from extraction_runs where document_id = ${DOC} and not ok and error = 'http_529'`;
    expect(runs).toEqual({ n: 2 });
  });
  it('logs a read and each failed read in pipeline_events', async () => {
    await db.withTenant(ORG_R, (tx) => saveDocumentReading(tx, write()));
    await db.withTenant(ORG_R, (tx) =>
      recordFailedRead(tx, {
        orgId: ORG_R,
        documentId: DOC,
        model: 'claude-haiku-5-5',
        promptVersion: 'm02-proto-v3',
        error: 'http_529',
        attempt: 1,
        final: false,
      }),
    );
    const rows =
      await sql`select kind, code, detail, warnings, extraction_run_id is not null as has_run
      from pipeline_events where document_id = ${DOC} and kind in ('read', 'read_failed') order by id desc limit 2`;
    expect(rows.map((r) => [r.kind, r.code, r.detail, r.has_run])).toEqual([
      ['read_failed', 'http_529', 'retry', true],
      ['read', 'ready', null, true],
    ]);
    expect(rows[1]?.warnings).toEqual(['PROTO_DIC_FORMAT']);
  });
});
