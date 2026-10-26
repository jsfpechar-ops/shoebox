import type { LegalDate } from '@shoebox/domain';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSpreadsheetImport,
  finishImport,
  type ImportedValues,
  insertImportedRow,
  undoImport,
} from '../src/imports';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000200';
const USER = 'eeeeeeee-0000-4000-8000-000000000299';
const FILE = 'eeeeeeee-0000-4000-8000-000000000201';
const TODAY = '2026-10-26' as LegalDate;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

function values(patch: Partial<ImportedValues> = {}): ImportedValues {
  return {
    issue_date: '2026-10-01',
    total_gross: '1210.00',
    currency: 'CZK',
    partner_name: 'Dodavatel s.r.o.',
    partner_ico: '27082440',
    document_number: 'FV 2026-0001',
    total_vat: null,
    total_net: null,
    variable_symbol: null,
    due_date: null,
    description: 'Nákup',
    paid: null,
    paid_on: null,
    ...patch,
  };
}

describe.skipIf(DATABASE_URL === undefined)('spreadsheet import writer', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  const newImport = () =>
    db.withTenant(ORG, (tx) =>
      createSpreadsheetImport(tx, { orgId: ORG, sourceFileId: FILE, rowCount: 3, userId: USER }),
    );
  const addRow = (importId: string, row: number, v: ImportedValues) =>
    db.withTenant(ORG, (tx) =>
      insertImportedRow(tx, {
        orgId: ORG,
        importId,
        row,
        values: v,
        direction: 'expense',
        userId: USER,
        today: TODAY,
        org: undefined,
      }),
    );

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into auth.users (id) values (${USER}) on conflict (id) do nothing`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org I', 'org-i-0200', 'IIIIIIII')`;
    const sha = '20'.repeat(32);
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel)
      values (${FILE}, ${ORG}, ${sha}, ${`org/${ORG}/files/${sha}`}, 'text/csv', 10, 'upload')`;
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

  it('a row becomes one ready imported document with user fields; the same row again writes nothing', async () => {
    const imp = await newImport();
    const first = await addRow(imp, 1, values());
    expect(first.created).toBe(true);
    expect(first.status).toBe('ready');
    const doc = (
      await sql`select entry_mode, class, direction, source_file_id, import_row, total_gross::text as gross
        from documents where id = ${first.documentId}`
    )[0];
    expect(doc).toEqual({
      entry_mode: 'imported',
      class: 'received_invoice',
      direction: 'in',
      source_file_id: null,
      import_row: 1,
      gross: '1210.00',
    });
    const fields =
      await sql`select field_key from document_fields where document_id = ${first.documentId} and source = 'user' and set_by = ${USER}`;
    expect(fields.map((f) => f.field_key)).toContain('supplier.ico');
    expect(fields.map((f) => f.field_key)).toContain('totals.gross');
    const lines =
      await sql`select position from document_lines where document_id = ${first.documentId}`;
    expect(lines).toHaveLength(1);

    const again = await addRow(imp, 1, values());
    expect(again).toEqual({ documentId: first.documentId, status: 'ready', created: false });
    const count = await sql`select count(*)::int as n from documents where import_id = ${imp}`;
    expect(count[0]?.n).toBe(1);
  });

  it('a row repeating an existing live document is a duplicate', async () => {
    const existing = 'eeeeeeee-0000-4000-8000-000000000210';
    await sql`insert into documents (id, org_id, entry_mode, status, class, partner_snapshot, document_number, total_gross, currency)
      values (${existing}, ${ORG}, 'manual', 'ready', 'received_invoice', '{"ico":"12345679","name":"Jiný s.r.o."}'::jsonb, 'DUP-77', 500.00, 'CZK')`;
    const imp = await newImport();
    const r = await addRow(
      imp,
      1,
      values({
        partner_ico: '12345679',
        partner_name: 'Jiný s.r.o.',
        document_number: 'DUP-77',
        total_gross: '500.00',
      }),
    );
    expect(r.status).toBe('duplicate');
    const links =
      await sql`select to_document_id from document_links where from_document_id = ${r.documentId}`;
    expect(links).toEqual([{ to_document_id: existing }]);
  });

  it('undo removes an untouched document and keeps a finalized one', async () => {
    const imp = await newImport();
    const a = await addRow(imp, 1, values({ document_number: 'U-1', total_gross: '100.00' }));
    const b = await addRow(imp, 2, values({ document_number: 'U-2', total_gross: '200.00' }));
    await db.withTenant(ORG, (tx) =>
      finishImport(tx, {
        orgId: ORG,
        importId: imp,
        imported: 2,
        skipped: 0,
        duplicates: 0,
        skippedRows: [],
      }),
    );
    await sql`update documents set status = 'finalized', finalized_at = now() where id = ${b.documentId}`;
    const out = await db.withTenant(ORG, (tx) =>
      undoImport(tx, { orgId: ORG, importId: imp, now: new Date() }),
    );
    expect(out).toEqual({ removed: 1, kept: 1 });
    const gone =
      await sql`select id from documents where id = ${a.documentId} and deleted_at is not null`;
    expect(gone).toHaveLength(1);
    const state = await sql`select state from spreadsheet_imports where id = ${imp}`;
    expect(state[0]?.state).toBe('undone');
  });

  it('undo is refused for an import older than 30 days', async () => {
    const imp = await newImport();
    const later = new Date(Date.now() + 31 * 86_400_000);
    const out = await db.withTenant(ORG, (tx) =>
      undoImport(tx, { orgId: ORG, importId: imp, now: later }),
    );
    expect(out).toBeNull();
  });
});
