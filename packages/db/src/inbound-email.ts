import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import type { TenantTx } from './tenant';

export interface InboundEmailInsert {
  readonly orgId: string;
  readonly messageId: string;
  readonly fromAddress: string | null;
  readonly toAddress: string;
  readonly subject: string | null;
  readonly receivedAt: Date;
  readonly purpose: 'documents' | 'bank_notice';
  readonly emlPath: string;
}

export interface InboundEmailStore {
  /** Org id whose current secret, or previous secret still in its grace period, matches (secret compared upper-case). */
  findOrg(slug: string, secret: string, now: Date): Promise<string | null>;
  /** Inserts the row, or finds the existing one for (org_id, message_id); `created` says which. */
  insertEmail(row: InboundEmailInsert): Promise<{ id: string; created: boolean }>;
  close(): Promise<void>;
}

/** Service connection (DATABASE_URL); one pool of at most 2 connections. */
export function createInboundEmailStore(serviceUrl: string): InboundEmailStore {
  const client: Sql = postgres(serviceUrl, { max: 2, onnotice: () => undefined });

  return {
    async findOrg(slug, secret, now) {
      const upper = secret.toUpperCase();
      const rows = await client<{ id: string }[]>`
        select id from organizations
        where inbound_email_slug = ${slug}
          and (
            inbound_email_secret = ${upper}
            or (inbound_email_secret_prev = ${upper}
                and inbound_email_secret_prev_until > ${now})
          )
        limit 1`;
      return rows[0]?.id ?? null;
    },

    async insertEmail(row) {
      const rows = await client<{ id: string; created: boolean }[]>`
        insert into inbound_emails
          (org_id, message_id, from_address, to_address, subject, received_at, purpose, eml_path)
        values
          (${row.orgId}, ${row.messageId}, ${row.fromAddress}, ${row.toAddress}, ${row.subject},
           ${row.receivedAt}, ${row.purpose}, ${row.emlPath})
        on conflict (org_id, message_id) do update set message_id = excluded.message_id
        returning id, (xmax = 0) as created`;
      const found = rows[0];
      if (!found) throw new Error('inbound_emails upsert returned no row');
      return { id: found.id, created: found.created };
    },

    async close() {
      await client.end();
    },
  };
}

export interface InboundEmailForWorker {
  readonly id: string;
  readonly orgId: string;
  readonly emlPath: string;
  readonly purpose: 'documents' | 'bank_notice';
  readonly processedAt: Date | null;
}

export async function loadInboundEmail(
  tx: TenantTx,
  id: string,
): Promise<InboundEmailForWorker | null> {
  const rows = await tx.execute<{
    id: string;
    org_id: string;
    eml_path: string;
    purpose: 'documents' | 'bank_notice';
    processed_at: Date | null;
  }>(sql`
    select id, org_id, eml_path, purpose, processed_at
    from inbound_emails where id = ${id} limit 1`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    emlPath: row.eml_path,
    purpose: row.purpose,
    processedAt: row.processed_at,
  };
}

/** Sets processed_at = now(), spam_verdict, and body_text (cut to 20 000 characters). */
export async function finishInboundEmail(
  tx: TenantTx,
  id: string,
  result: { spamVerdict: 'pass' | 'spoof_fail' | 'unknown'; bodyText: string | null },
): Promise<void> {
  const body = result.bodyText === null ? null : [...result.bodyText].slice(0, 20_000).join('');
  await tx.execute(sql`
    update inbound_emails
    set processed_at = now(), spam_verdict = ${result.spamVerdict}, body_text = ${body}
    where id = ${id}`);
}

export interface EmailAttachmentInsert {
  readonly orgId: string;
  readonly inboundEmailId: string;
  readonly sha256: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly originalFilename: string;
  /** One fresh uuid per e-mail: documents.upload_batch_id, so doc.split sorts the mail's pages together. */
  readonly batchId: string;
}

/**
 * source_files row (channel 'email', on conflict (org_id, sha256) reuse the existing row), then a
 * 'received' document with received_date = today in Europe/Prague and upload_batch_id = batchId. documentId is null when the
 * file already has a live document (exact duplicate): nothing new is created then.
 */
export async function insertEmailAttachment(
  tx: TenantTx,
  row: EmailAttachmentInsert,
): Promise<{ sourceFileId: string; documentId: string | null }> {
  const filenameNfc = row.originalFilename.normalize('NFC');
  const [file] = await tx.execute<{ id: string }>(sql`
    insert into source_files
      (org_id, sha256, storage_path, mime_type, byte_size, original_filename, filename_nfc,
       inbound_email_id, channel)
    values
      (${row.orgId}, ${row.sha256}, ${row.storagePath}, ${row.mimeType}, ${row.byteSize},
       ${row.originalFilename}, ${filenameNfc}, ${row.inboundEmailId}, 'email')
    on conflict (org_id, sha256) do update set org_id = excluded.org_id
    returning id`);
  const sourceFileId = file?.id ?? '';

  const [live] = await tx.execute<{ id: string }>(sql`
    select id from documents
    where org_id = ${row.orgId} and source_file_id = ${sourceFileId} and deleted_at is null
    limit 1`);
  if (live) return { sourceFileId, documentId: null };

  const [doc] = await tx.execute<{ id: string }>(sql`
    insert into documents
      (org_id, source_file_id, status, received_date, upload_batch_id)
    values
      (${row.orgId}, ${sourceFileId}, 'received',
       (now() at time zone 'Europe/Prague')::date, ${row.batchId})
    returning id`);
  return { sourceFileId, documentId: doc?.id ?? null };
}
