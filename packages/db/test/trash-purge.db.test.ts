import { sql as q } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { closeDb, createTenantDb, type TenantDb } from '../src/tenant';
import { purgeTrash } from '../src/trash-purge';

const DATABASE_URL = process.env.DATABASE_URL;
const ORG = 'eeeeeeee-0000-4000-8000-000000000412';
const F1 = 'eeeeeeee-0000-4000-8000-0000000004f1';
const F2 = 'eeeeeeee-0000-4000-8000-0000000004f2';
const D = (n: number) => `eeeeeeee-0000-4000-8000-0000000004d${n}`;

function workerUrlFrom(serviceUrl: string): string {
  const u = new URL(serviceUrl);
  u.username = 'app_worker';
  u.password = '';
  return u.toString();
}

describe.skipIf(DATABASE_URL === undefined)('purgeTrash', () => {
  const serviceUrl = DATABASE_URL ?? '';
  let sql: Sql;
  let db: TenantDb;

  beforeAll(async () => {
    sql = postgres(serviceUrl, { max: 1, onnotice: () => undefined });
    await runMigrations(serviceUrl);
    await sql`delete from organizations where id = ${ORG}`;
    await sql`insert into organizations (id, name, inbound_email_slug, inbound_email_secret)
      values (${ORG}, 'Org P', 'org-p-0412', 'PPPPPPPP')`;
    await sql`insert into source_files (id, org_id, sha256, storage_path, mime_type, byte_size, channel) values
      (${F1}, ${ORG}, ${'a'.repeat(64)}, ${`org/${ORG}/files/${'a'.repeat(64)}`}, 'application/pdf', 1, 'upload'),
      (${F2}, ${ORG}, ${'b'.repeat(64)}, ${`org/${ORG}/files/${'b'.repeat(64)}`}, 'application/pdf', 1, 'upload')`;
    await sql`insert into documents (id, org_id, source_file_id, status, deleted_at, finalized_at, retention_until) values
      (${D(1)}, ${ORG}, ${F1}, 'ready', now() - interval '40 days', null, null),
      (${D(2)}, ${ORG}, ${F2}, 'ready', now() - interval '40 days', null, null),
      (${D(3)}, ${ORG}, ${F2}, 'ready', null, null, null),
      (${D(4)}, ${ORG}, ${F2}, 'ready', now() - interval '40 days', now(), '2037-12-31'),
      (${D(5)}, ${ORG}, ${F2}, 'ready', now() - interval '5 days', null, null)`;
    await sql`insert into ingest_items (org_id, origin, channel, original_filename, filename_nfc, byte_size, sha256, state, source_file_id)
      values (${ORG}, 'upload', 'upload', 'a.pdf', 'a.pdf', 1, ${'a'.repeat(64)}, 'accepted', ${F1})`;
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

  it('deletes old trash, keeps retained, live and recent documents, frees unused files', async () => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const result = await db.withServiceRole('retention', (tx) =>
      purgeTrash(tx, cutoff, '2026-10-26', 200),
    );
    expect(result.documents).toBe(2);
    expect(result.paths).toEqual([`org/${ORG}/files/${'a'.repeat(64)}`]);
    const docs = await sql`select id from documents where org_id = ${ORG} order by id`;
    expect(docs.map((r) => r.id)).toEqual([D(3), D(4), D(5)]);
    const files = await sql`select id from source_files where org_id = ${ORG}`;
    expect(files.map((r) => r.id)).toEqual([F2]);
    const audit =
      await sql`select diff from audit_log where org_id = ${ORG} and action = 'trash_purge'`;
    expect(audit.map((r) => r.diff)).toEqual([{ documents: 2 }]);
  });

  it('is idempotent', async () => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const again = await db.withServiceRole('retention', (tx) =>
      purgeTrash(tx, cutoff, '2026-10-26', 200),
    );
    expect(again).toEqual({ documents: 0, paths: [] });
  });

  it('the worker role cannot call it', async () => {
    await expect(
      db.withTenant(ORG, (tx) =>
        tx.execute(q`select * from app.purge_trash(now(), current_date, 1)`),
      ),
    ).rejects.toThrow();
  });
});
