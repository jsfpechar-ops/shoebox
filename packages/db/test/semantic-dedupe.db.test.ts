import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ReadingWrite, saveDocumentReading } from '../src/document-reading';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000100';
const ORG2 = 'eeeeeeee-0000-4000-8000-000000000101';
const id = (n: number) => `eeeeeeee-0000-4000-8000-0000001001${String(n).padStart(2, '0')}`;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function write(
  orgId: string,
  documentId: string,
  patch: Partial<ReadingWrite['patch']> = {},
  status: ReadingWrite['status'] = 'ready',
): ReadingWrite {
  return {
    orgId,
    documentId,
    status,
    patch: {
      class: 'received_invoice',
      classSource: 'llm',
      direction: 'in',
      taxDocStatus: 'full_tax_document',
      partnerSnapshot: { name: 'Dodavatel s.r.o.', ico: '27082440', dic: null, vat_id: null, country: 'CZ' },
      buyerSnapshot: null,
      documentNumber: 'FV 2026-0001',
      variableSymbol: null,
      issueDate: '2026-10-01',
      duzp: '2026-10-01',
      dueDate: null,
      currency: 'CZK',
      totalNet: '1000',
      totalVat: '210',
      totalGross: '1210',
      paymentMethod: null,
      payToAccount: null,
      isPaidPerDocument: null,
      ...patch,
    },
    vatSummary: [],
    fields: [],
    validations: [],
    run: {
      model: 'claude-haiku-5-5',
      promptVersion: 'test',
      attempt: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 0,
    },
  };
}

describe.skipIf(DATABASE_URL === undefined)('semantic dedupe after a reading', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  async function newDoc(orgId: string, n: number): Promise<string> {
    const sha = String(n).padStart(2, '0').repeat(32);
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${id(n)}, ${orgId}, ${sha}, ${`org/${orgId}/files/${sha}`}, 'image/jpeg', 10, 'upload')`;
    await sql`insert into documents (id, org_id, source_file_id, status, created_at)
      values (${id(n)}, ${orgId}, ${id(n)}, 'extracting', now() - make_interval(secs => ${100 - n}))`;
    return id(n);
  }
  const statusOf = async (doc: string) =>
    (await sql`select status from documents where id = ${doc}`)[0]?.status;
  const save = (w: ReadingWrite) => db.withTenant(w.orgId, (tx) => saveDocumentReading(tx, w));

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org D', 'org-d-0100', 'DDDDDDDD'), (${ORG2}, 'Org E', 'org-e-0100', 'EEEEEEEE')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql?.end();
    await db?.close();
    await closeDb();
  });

  it('the second copy becomes a duplicate of the first, even with a differently written number', async () => {
    const first = await newDoc(ORG, 1);
    const second = await newDoc(ORG, 2);
    await save(write(ORG, first));
    await save(write(ORG, second, { documentNumber: 'fv2026/0001' }));
    expect(await statusOf(first)).toBe('ready');
    expect(await statusOf(second)).toBe('duplicate');
    const links = await sql`select to_document_id, kind from document_links where from_document_id = ${second}`;
    expect(links).toEqual([{ to_document_id: first, kind: 'duplicate_of' }]);
  });

  it('a different total, number or supplier is not a duplicate', async () => {
    const a = await newDoc(ORG, 3);
    const b = await newDoc(ORG, 4);
    const c = await newDoc(ORG, 5);
    await save(write(ORG, a, { totalGross: '1211' }));
    await save(write(ORG, b, { documentNumber: 'FV 2026-0002' }));
    await save(write(ORG, c, { partnerSnapshot: { name: 'Jiný s.r.o.', ico: '12345679', dic: null, vat_id: null, country: 'CZ' } }));
    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(['ready', 'ready', 'ready']);
  });

  it('without an IČO the supplier name decides, ignoring case and spaces', async () => {
    const noIco = { name: 'Kavárna  U Lípy', ico: null, dic: null, vat_id: null, country: 'CZ' };
    const a = await newDoc(ORG, 6);
    const b = await newDoc(ORG, 7);
    await save(write(ORG, a, { partnerSnapshot: noIco, documentNumber: 'U-77' }));
    await save(write(ORG, b, { partnerSnapshot: { ...noIco, name: 'kavárna u lípy ' }, documentNumber: 'U-77' }));
    expect(await statusOf(b)).toBe('duplicate');
  });

  it('a document kept as separate ("Keep both") never matches', async () => {
    const a = await newDoc(ORG, 8);
    const b = await newDoc(ORG, 9);
    await save(write(ORG, a, { documentNumber: 'K-1' }));
    await sql`update documents set semantic_dedupe_exempt = true where id = ${a}`;
    await save(write(ORG, b, { documentNumber: 'K-1' }));
    expect(await statusOf(b)).toBe('ready');
  });

  it('a supporting document, a document without a number and another org are never duplicates', async () => {
    const a = await newDoc(ORG, 10);
    const b = await newDoc(ORG, 11);
    const c = await newDoc(ORG, 12);
    const d = await newDoc(ORG, 13);
    const e = await newDoc(ORG2, 14);
    await save(write(ORG, a, { documentNumber: 'S-1' }));
    await save(write(ORG, b, { documentNumber: 'S-1' }, 'supporting'));
    await save(write(ORG, c, { documentNumber: null }));
    await save(write(ORG, d, { documentNumber: null }));
    await save(write(ORG2, e, { documentNumber: 'S-1' }));
    expect([await statusOf(b), await statusOf(d), await statusOf(e)]).toEqual(['supporting', 'ready', 'ready']);
  });
});
