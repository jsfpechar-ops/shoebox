# 0103: Database side of the e-mail inbox

Status: done
Ticket: P1-ING-06 (store part) | Depends on: 0100 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The e-mail inbox needs three database pieces: find the firm from the address a mail was sent to, store one row per received mail (once, even if the mail arrives twice), and turn each attachment into a file and a document for the reader. This brief adds them plus the `email.received` job definition; the webhook (0104) and the worker job (0105) use them.

## 2. Context

- Address (M01 §4.1.2): `{inbound_email_slug}-{inbound_email_secret}@<domain>`, shown lower-case, secret stored upper-case (8 chars). The previous secret stays valid while `inbound_email_secret_prev_until > now`.
- Tables exist (migration 0005): `inbound_emails (id, org_id, message_id, from_address, to_address, subject, received_at, purpose 'documents'|'bank_notice', eml_path, body_text, spam_verdict 'pass'|'spoof_fail'|'unknown', processed_at)`, unique `(org_id, message_id)`; `source_files` has `inbound_email_id`, `channel` ('email' here), unique `(org_id, sha256)`; `documents (org_id, source_file_id, status 'received', received_date)`.
- The webhook runs without a user, so `findOrg` and `insertEmail` use the service connection (`DATABASE_URL`) with explicit `org_id` filters (hard rule 3). The worker helpers take the worker's tenant transaction (`TenantTx`).
- `packages/pipeline/src/jobs.ts` excerpt (find verbatim):

```ts
/** M02: read one document (Haiku 5.5), then run the checks. Enqueued by the upload API. */
export const docExtractJob = defineTenantJob({
```

## 3. Files

| Path | Action | What |
|---|---|---|
| packages/db/src/inbound-email.ts | new | store + worker helpers |
| packages/db/src/index.ts | edit | export it |
| packages/db/test/inbound-email.db.test.ts | new | the test below |
| packages/pipeline/src/jobs.ts | edit | `emailReceivedJob` |

No other file may change.

## 4. Steps

1. Create `packages/db/src/inbound-email.ts` with exactly these exports (follow the style of `document-reading.ts`; drizzle for tenant helpers, the `postgres` client for the service store):

```ts
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
  /** Inserts the row; returns its id, or null when (org_id, message_id) already exists. */
  insertEmail(row: InboundEmailInsert): Promise<string | null>;
  close(): Promise<void>;
}

/** Service connection (DATABASE_URL); one pool of at most 2 connections. */
export function createInboundEmailStore(serviceUrl: string): InboundEmailStore;

export interface InboundEmailForWorker {
  readonly id: string;
  readonly orgId: string;
  readonly emlPath: string;
  readonly purpose: 'documents' | 'bank_notice';
  readonly processedAt: Date | null;
}

export function loadInboundEmail(tx: TenantTx, id: string): Promise<InboundEmailForWorker | null>;

/** Sets processed_at = now(), spam_verdict, and body_text (cut to 20 000 characters). */
export function finishInboundEmail(
  tx: TenantTx,
  id: string,
  result: { spamVerdict: 'pass' | 'spoof_fail' | 'unknown'; bodyText: string | null },
): Promise<void>;

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
export function insertEmailAttachment(
  tx: TenantTx,
  row: EmailAttachmentInsert,
): Promise<{ sourceFileId: string; documentId: string | null }>;
```

   `filename_nfc` = `originalFilename.normalize('NFC')`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

2. Edit `packages/db/src/index.ts`: after `export * from './document-reading';` add `export * from './inbound-email';`. Typecheck.

3. Create `packages/db/test/inbound-email.db.test.ts` exactly; implement until it passes (CI `db` job; it skips without `DATABASE_URL`). Do not edit it.

```ts
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
    const first = await store.insertEmail(row);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.insertEmail(row)).toBeNull();

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
    const [done] = await sql`select spam_verdict, length(body_text) as len, processed_at from inbound_emails where id = ${first ?? ''}`;
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
    const [file] = await sql`select channel, inbound_email_id from source_files where id = ${first.sourceFileId}`;
    expect(file).toEqual({ channel: 'email', inbound_email_id: mail?.id });
    const [doc] = await sql`select status, received_date, upload_batch_id from documents where id = ${first.documentId ?? ''}`;
    expect(doc?.status).toBe('received');
    expect(doc?.received_date).not.toBeNull();
    expect(doc?.upload_batch_id).toBe('eeeeeeee-0000-4000-8000-0000000b0103');
  });
});
```

4. Edit `packages/pipeline/src/jobs.ts`: insert before the §2 excerpt:

```ts
/** M01 §4.1.2: turn one stored inbound e-mail into documents. Enqueued by the inbound-email webhook. */
export const emailReceivedJob = defineTenantJob({
  name: 'email.received',
  payload: tenantPayload({ inboundEmailId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.inboundEmailId,
});

```

   Run `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/pipeline test 2>&1 | tail -30` → pass.

## 5. Do not touch

`apps/`, migrations, other `packages/` files. Hard rules 3 and 4 (no mail content in logs or error messages).

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/db exec vitest run test/inbound-email.db.test.ts 2>&1 | tail -30` → passes or skipped (no DATABASE_URL).
- `pnpm --filter @shoebox/pipeline test 2>&1 | tail -30` → passes.
- `pnpm exec biome check packages/db packages/pipeline 2>&1 | tail -30` → clean (format with `biome format --write` if needed).

## 7. Acceptance

- [ ] Tests pass in CI; diff limited to §3 files plus this brief and its report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0103-report.md`, 300 tokens at most. Set `Status: review`.
