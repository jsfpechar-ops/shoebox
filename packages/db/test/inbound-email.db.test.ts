import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInboundEmailStore,
  finishInboundEmail,
  type InboundEmailStore,
  insertEmailAttachment,
  loadInboundEmail,
} from '../src/inbound-email';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000103';
const ORG2 = 'eeeeeeee-0000-4000-8000-000000000104';

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('inbound e-mail store', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;
  let store: InboundEmailStore;
  const now = new Date('2026-10-26T10:00:00Z');

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret,
        inbound_email_secret_prev, inbound_email_secret_prev_until)
      values (${ORG}, 'Mail Org', 'jan-novak-0103', 'AB12CD34', 'OLDOLD11', '2026-10-27T00:00:00Z'),
             (${ORG2}, 'Mail Org 2', 'eva-0103', 'ZZ99ZZ99', 'GONEGONE', '2026-10-01T00:00:00Z')`;
    db = createTenantDb(
      { workerUrl: process.env.WORKER_DATABASE_URL ?? workerUrlFrom(serviceUrl), serviceUrl },
      { max: 1 },
    );
    store = createInboundEmailStore(serviceUrl);
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql`delete from organizations where id in (${ORG}, ${ORG2})`;
    await sql?.end();
    await store?.close();
    await db?.close();
    await closeDb();
  });

  it('finds the org by slug and current or still-valid previous secret, any case', async () => {
    expect(await store.findOrg('jan-novak-0103', 'ab12cd34', now)).toBe(ORG);
    expect(await store.findOrg('jan-novak-0103', 'OLDOLD11', now)).toBe(ORG);
    expect(await store.findOrg('eva-0103', 'GONEGONE', now)).toBeNull();
    expect(await store.findOrg('jan-novak-0103', 'ZZ99ZZ99', now)).toBeNull();
    expect(await store.findOrg('nobody-0103', 'AB12CD34', now)).toBeNull();
  });

  it('stores a mail once, even when it arrives twice', async () => {
    const row = {
      orgId: ORG,
      messageId: '<m1@example.test>',
      fromAddress: 'dodavatel@example.test',
      toAddress: 'jan-novak-0103-ab12cd34@in.example.test',
      subject: 'Faktura',
      receivedAt: now,
      purpose: 'documents' as const,
      emlPath: `org/${ORG}/eml/m1.eml`,
    };
    const inserted = await store.insertEmail(row);
    expect(inserted.created).toBe(true);
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.insertEmail(row)).toEqual({ id: inserted.id, created: false });
    const first: string | null = inserted.id;

    const loaded = await db.withTenant(ORG, (tx) => loadInboundEmail(tx, first ?? ''));
    expect(loaded).toEqual({
      id: first,
      orgId: ORG,
      emlPath: `org/${ORG}/eml/m1.eml`,
      purpose: 'documents',
      processedAt: null,
    });
    expect(await db.withTenant(ORG2, (tx) => loadInboundEmail(tx, first ?? ''))).toBeNull();

    await db.withTenant(ORG, (tx) =>
      finishInboundEmail(tx, first ?? '', { spamVerdict: 'pass', bodyText: 'x'.repeat(25_000) }),
    );
    const [done] =
      await sql`select spam_verdict, length(body_text) as len, processed_at from inbound_emails where id = ${first ?? ''}`;
    expect(done?.spam_verdict).toBe('pass');
    expect(done?.len).toBe(20_000);
    expect(done?.processed_at).not.toBeNull();
  });

  it('turns an attachment into a file and a received document, once', async () => {
    const [mail] = await sql`select id from inbound_emails where org_id = ${ORG} limit 1`;
    const sha = 'c'.repeat(64);
    const row = {
      orgId: ORG,
      inboundEmailId: mail?.id as string,
      sha256: sha,
      storagePath: `org/${ORG}/files/${sha}`,
      mimeType: 'application/pdf',
      byteSize: 1234,
      originalFilename: 'faktura.pdf',
      batchId: 'eeeeeeee-0000-4000-8000-0000000b0103',
    };
    const first = await db.withTenant(ORG, (tx) => insertEmailAttachment(tx, row));
    expect(first.documentId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await db.withTenant(ORG, (tx) => insertEmailAttachment(tx, row));
    expect(again).toEqual({ sourceFileId: first.sourceFileId, documentId: null });
    const [file] =
      await sql`select channel, inbound_email_id from source_files where id = ${first.sourceFileId}`;
    expect(file).toEqual({ channel: 'email', inbound_email_id: mail?.id });
    const [doc] =
      await sql`select status, received_date, upload_batch_id from documents where id = ${first.documentId ?? ''}`;
    expect(doc?.status).toBe('received');
    expect(doc?.received_date).not.toBeNull();
    expect(doc?.upload_batch_id).toBe('eeeeeeee-0000-4000-8000-0000000b0103');
  });
});
