# 0105: Worker turns a received e-mail into documents

Status: todo
Ticket: P1-ING-07 (attachments only) | Depends on: 0103 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When `email.received` runs, the worker opens the stored mail, skips signature images and calendar files, and turns every real attachment (PDF, photo, ISDOC) into a document that is read like an upload. A mail that fails both SPF and DKIM is held back (quarantined), not read.

## 2. Context

- Decision (orchestrator 2026-10-26, logged in decisions): new dependency `postal-mime` **4.0.5** exactly (zero dependencies, MIT; already named for M01 in P1-OWN-01), in `apps/worker` only.
- Triage (M01 §4.5.1, first match wins), per attachment:
  1. type `text/calendar`, `text/vcard`, `text/x-vcard`, `application/pkcs7-signature`, `application/pgp-signature`, or filename `smime.p7s` → skip;
  2. `application/ms-tnef`, filename `winmail.dat`, `application/pkcs7-mime` → skip (unsupported);
  3. an image whose `contentId` (without `<>`) appears as `cid:<id>` in the HTML body → skip (inline image);
  4. an image under 15 360 bytes → skip (signature/logo);
  5. type decided by extension first: `.isdoc`/`.xml` → `application/xml`, `.isdocx` → `application/x-isdocx`, `.pdf` → `application/pdf`, `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.webp` → `image/webp`; else the part's own type if it is one of those; anything else (incl. HEIC, Office files, nested mails) → skip;
  6. over 20 MiB → skip. Everything left is a candidate.
- Spoof (ADR-005): read every `Authentication-Results` and `ARC-Authentication-Results` header value. If any says `spf=fail` and any says `dkim=fail` → `'spoof_fail'`; else if there is at least one such header → `'pass'`; else `'unknown'`. `spoof_fail` → no documents, mail finished as quarantined.
- `purpose = 'bank_notice'` → no documents (bank import is Phase 2); finish the mail with its verdict.
- A mail already processed (`processedAt` not null) → do nothing (job retries are safe).
- Reading: all attachments of one mail share one fresh `batchId` (`randomUUID()`), passed to `insertAttachment` as `batchId`. When at least one new document was created, ONE `doc.split` job is queued for the batch (`docSplitJob`, payload `{ orgId, batchId }`): the page-sorting job groups the pages and starts the reads, exactly like an upload drop.
- Storage: attachments go to `filePath(orgId, sha256)` (`@shoebox/platform`) with `blobs.put`; an object that already exists (BlobStoreError with `status` 409 or 400) is fine.
- 0103 gives from `@shoebox/db`: `loadInboundEmail`, `finishInboundEmail`, `insertEmailAttachment`; from `@shoebox/pipeline`: `emailReceivedJob`, `docSplitJob`.
- `apps/worker/src/main.ts` excerpt (find verbatim):

```ts
  register: (registry) => {
    registerDocExtract(registry, process.env, logger);
  },
```

## 3. Files

| Path | Action | What |
|---|---|---|
| apps/worker/package.json | edit | `"postal-mime": "4.0.5"` in dependencies (then `pnpm install`, which updates pnpm-lock.yaml) |
| pnpm-lock.yaml | edit | by `pnpm install` only |
| apps/worker/src/email-received/triage.ts | new | `triageAttachments`, `spamVerdictOf` |
| apps/worker/src/email-received/handler.ts | new | `createEmailReceivedHandler` |
| apps/worker/src/email-received/register.ts | new | `registerEmailReceived` |
| apps/worker/src/main.ts | edit | register it |
| apps/worker/test/email-received.test.ts | new | the test below |

No other file may change.

## 4. Steps

1. Add the dependency: edit `apps/worker/package.json`, then `pnpm install 2>&1 | tail -5`. Check the parsed types: `grep -n 'interface Attachment\|interface Email\b\|content:' apps/worker/node_modules/postal-mime/postal-mime.d.ts | head` (adjust the path if the `.d.ts` is elsewhere).

2. Create `apps/worker/test/email-received.test.ts` exactly (never edit it later):

```ts
import type { TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import {
  createEmailReceivedHandler,
  type EmailReceivedDeps,
} from '../src/email-received/handler';
import { type MailPart, spamVerdictOf, triageAttachments } from '../src/email-received/triage';

const ORG = 'eeeeeeee-0000-4000-8000-000000000105';
const MAIL = 'eeeeeeee-0000-4000-8000-0000000001e5';
const big = (n: number) => new Uint8Array(n).fill(1);

const part = (over: Partial<MailPart>): MailPart => ({
  filename: 'faktura.pdf',
  mimeType: 'application/pdf',
  contentId: null,
  content: big(20_000),
  ...over,
});

describe('triageAttachments', () => {
  it('keeps real documents and decides the type by extension first', () => {
    const out = triageAttachments(
      [
        part({}),
        part({ filename: 'scan.JPG', mimeType: 'application/octet-stream' }),
        part({ filename: 'faktura.isdoc', mimeType: 'text/plain' }),
        part({ filename: 'faktura.isdocx', mimeType: 'application/zip' }),
        part({ filename: null, mimeType: 'image/png' }),
      ],
      null,
    );
    expect(out.map((c) => c.mimeType)).toEqual([
      'application/pdf',
      'image/jpeg',
      'application/xml',
      'application/x-isdocx',
      'image/png',
    ]);
    expect(out[4]?.filename).toBe('attachment-5.png');
  });

  it('skips calendar, signatures, winmail, inline and tiny images, unknown types and huge files', () => {
    const out = triageAttachments(
      [
        part({ filename: 'invite.ics', mimeType: 'text/calendar' }),
        part({ filename: 'smime.p7s', mimeType: 'application/octet-stream' }),
        part({ filename: 'winmail.dat', mimeType: 'application/ms-tnef' }),
        part({ filename: 'logo.png', mimeType: 'image/png', contentId: '<logo1>' }),
        part({ filename: 'podpis.jpg', mimeType: 'image/jpeg', content: big(15_000) }),
        part({ filename: 'IMG_1.HEIC', mimeType: 'image/heic' }),
        part({ filename: 'smlouva.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        part({ filename: 'velky.pdf', content: big(20 * 1024 * 1024 + 1) }),
      ],
      '<p>Dobrý den<img src="cid:logo1"></p>',
    );
    expect(out).toEqual([]);
  });

  it('an image with a content id that the HTML does not use is kept', () => {
    const out = triageAttachments([part({ filename: 'uctenka.jpg', mimeType: 'image/jpeg', contentId: '<x9>' })], '<p>hi</p>');
    expect(out).toHaveLength(1);
  });
});

describe('spamVerdictOf', () => {
  it('spf and dkim both failing is spoof_fail', () => {
    expect(spamVerdictOf([{ key: 'authentication-results', value: 'mx.cloudflare.net; spf=fail smtp.mailfrom=x; dkim=fail header.d=x' }])).toBe('spoof_fail');
  });
  it('one passing is pass; no header is unknown', () => {
    expect(spamVerdictOf([{ key: 'authentication-results', value: 'mx; spf=fail; dkim=pass' }])).toBe('pass');
    expect(spamVerdictOf([{ key: 'ARC-Authentication-Results', value: 'i=1; mx; spf=pass; dkim=none' }])).toBe('pass');
    expect(spamVerdictOf([{ key: 'subject', value: 'spf=fail dkim=fail' }])).toBe('unknown');
  });
});

const EML = new TextEncoder().encode(
  [
    'From: Dodavatel <dodavatel@example.test>',
    'To: firma-ab12cd34@in.example.test',
    'Subject: Faktura',
    'Message-ID: <m1@example.test>',
    'Authentication-Results: mx; spf=pass; dkim=pass',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'V příloze faktura.',
    '--b1',
    'Content-Type: application/pdf; name="faktura.pdf"',
    'Content-Disposition: attachment; filename="faktura.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 fake'.padEnd(16_000, ' ')).toString('base64'),
    '--b1--',
    '',
  ].join('\r\n'),
);

function fakeDeps(over: Partial<EmailReceivedDeps> = {}) {
  const log = { put: [] as string[], inserted: [] as string[], batches: [] as string[], finished: [] as unknown[], queued: [] as string[] };
  const deps: EmailReceivedDeps = {
    blobs: {
      get: async () => EML,
      put: async (path) => void log.put.push(path),
    },
    store: {
      load: async () => ({ id: MAIL, orgId: ORG, emlPath: `org/${ORG}/eml/x.eml`, purpose: 'documents', processedAt: null }),
      finish: async (_tx, id, result) => void log.finished.push({ id, ...result }),
      insertAttachment: async (_tx, row) => {
        log.inserted.push(row.originalFilename);
        log.batches.push(row.batchId);
        return { sourceFileId: 's1', documentId: 'd1' };
      },
    },
    enqueueSplit: async (_orgId, batchId) => void log.queued.push(batchId),
    ...over,
  };
  return { deps, log };
}

const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };

describe('email.received handler', () => {
  it('turns the PDF attachment into a document and starts reading it', async () => {
    const { deps, log } = fakeDeps();
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual(['faktura.pdf']);
    expect(log.put).toHaveLength(1);
    expect(log.put[0]).toMatch(new RegExp(`^org/${ORG}/files/[0-9a-f]{64}$`));
    expect(log.batches).toHaveLength(1);
    expect(log.batches[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.queued).toEqual(log.batches);
    expect(log.finished).toEqual([{ id: MAIL, spamVerdict: 'pass', bodyText: expect.stringContaining('V příloze faktura.') }]);
  });

  it('a spoofed mail is held back: nothing stored or read', async () => {
    const spoofed = new TextDecoder().decode(EML).replace('spf=pass; dkim=pass', 'spf=fail; dkim=fail');
    const { deps, log } = fakeDeps({ blobs: { get: async () => new TextEncoder().encode(spoofed), put: async () => undefined } });
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual([]);
    expect(log.queued).toEqual([]);
    expect(log.finished).toEqual([{ id: MAIL, spamVerdict: 'spoof_fail', bodyText: null }]);
  });

  it('an already processed or missing mail is left alone; an exact duplicate file is not read again', async () => {
    const done = fakeDeps({
      store: {
        load: async () => ({ id: MAIL, orgId: ORG, emlPath: 'p', purpose: 'documents', processedAt: new Date() }),
        finish: async () => undefined,
        insertAttachment: async () => ({ sourceFileId: 's', documentId: 'd' }),
      },
    });
    await createEmailReceivedHandler(done.deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(done.log.put).toEqual([]);

    const dup = fakeDeps();
    dup.deps.store.insertAttachment = async () => ({ sourceFileId: 's1', documentId: null });
    await createEmailReceivedHandler(dup.deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(dup.log.queued).toEqual([]);
    expect(dup.log.finished).toHaveLength(1);
  });

  it('a bank notice creates no documents yet', async () => {
    const { deps, log } = fakeDeps();
    deps.store.load = async () => ({ id: MAIL, orgId: ORG, emlPath: 'p', purpose: 'bank_notice', processedAt: null });
    await createEmailReceivedHandler(deps)({ orgId: ORG, inboundEmailId: MAIL }, ctx);
    expect(log.inserted).toEqual([]);
    expect(log.finished).toHaveLength(1);
  });
});
```

3. Create `triage.ts`, `handler.ts` with these exports; implement until the test passes:

```ts
// triage.ts
export interface MailPart { readonly filename: string | null; readonly mimeType: string; readonly contentId: string | null; readonly content: Uint8Array }
export interface Candidate { readonly filename: string; readonly mimeType: string; readonly content: Uint8Array }
/** §2 triage; a candidate without a filename is named `attachment-<1-based index>.<ext of its type>`. */
export function triageAttachments(parts: readonly MailPart[], html: string | null): Candidate[];
export function spamVerdictOf(headers: readonly { key: string; value: string }[]): 'pass' | 'spoof_fail' | 'unknown';

// handler.ts
export interface EmailReceivedDeps {
  readonly blobs: { get(path: string): Promise<Uint8Array>; put(path: string, body: Uint8Array, contentType: string): Promise<void> };
  readonly store: {
    load: typeof loadInboundEmail;          // from @shoebox/db
    finish: typeof finishInboundEmail;
    insertAttachment: typeof insertEmailAttachment;
  };
  readonly enqueueSplit: (orgId: string, batchId: string) => Promise<void>;
}
export function createEmailReceivedHandler(deps: EmailReceivedDeps): TenantHandler<{ orgId: string; inboundEmailId: string }>;
```

   Handler order: load (null or processedAt → return); `bank_notice` → finish with verdict from the parsed headers and `bodyText: null`; parse with `PostalMime.parse(bytes)` (header keys from `email.headers`, `{ key, value }`); verdict `spoof_fail` → finish `{ spamVerdict: 'spoof_fail', bodyText: null }`, return; triage (convert each attachment's `content` to `Uint8Array`); `batchId = randomUUID()`; for each candidate: sha256 hex (`node:crypto`), `filePath(orgId, sha)`, `blobs.put` (ignore errors with `status` 409/400), `insertAttachment(ctx.tx, { orgId, inboundEmailId, sha256, storagePath, mimeType, byteSize, originalFilename, batchId })`; if any returned a non-null documentId, `await deps.enqueueSplit(orgId, batchId)` once; finish `{ spamVerdict: verdict, bodyText: email.text ?? null }`. Errors from get/parse/put/insert are re-thrown (pg-boss retries). Never log names, addresses or content.

   Run `pnpm --filter @shoebox/worker exec vitest run test/email-received.test.ts 2>&1 | tail -30` → all pass.

4. Create `register.ts` mirroring `apps/worker/src/doc-extract/register.ts`: `registerEmailReceived(registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>, env, logger): boolean` — needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (warn and return false otherwise); deps: `createSupabaseBlobStore({ url, apiKey })`, the three db functions, `enqueueSplit: async (orgId, batchId) => { await registry.enqueue(docSplitJob, { orgId, batchId }); }`. Log `'email.received registered'`.

5. Edit `main.ts`: import `registerEmailReceived` from `'./email-received/register'` and replace the excerpt with:

```ts
  register: (registry) => {
    registerDocExtract(registry, process.env, logger);
    registerEmailReceived(registry, process.env, logger);
  },
```

   Typecheck: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors. If the `register` callback's registry type lacks `enqueue`, stop and report (do not change worker.ts).

## 5. Do not touch

`apps/worker/src/doc-extract/`, `apps/worker/src/worker.ts`, `packages/`. Hard rules 3, 4, 7 (only the one dependency named here).

## 6. Commands

- `pnpm --filter @shoebox/worker exec vitest run test/email-received.test.ts 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors.
- `pnpm exec biome check apps/worker 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] Tests pass; CI green; diff limited to §3 files plus brief and report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0105-report.md`, 300 tokens at most. Set `Status: review`.
