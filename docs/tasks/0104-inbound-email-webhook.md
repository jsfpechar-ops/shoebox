# 0104: Web endpoint that receives an e-mail

Status: review
Ticket: P1-ING-06 (webhook part) | Depends on: 0103 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens | Risk: HIGH (auth)

## 1. Objective

The Cloudflare mail worker (0106) will POST each raw e-mail to `POST /api/inbound-email`. The endpoint checks the signature, finds the firm from the address, stores the raw mail, records it once and queues `email.received`. Unknown address → 404 so the worker rejects the mail.

## 2. Context

- Request: body = the raw `.eml` bytes (max 25 MiB). Headers: `X-Shoebox-To` (the recipient), `X-Shoebox-From` (envelope sender, may be absent), `X-Shoebox-Signature` = `signWebhook(secret, `${to}\n${sha256hex(body)}`)` from `@shoebox/platform` (format `t=<unix>,v1=<hex>`; checked with `verifyWebhook([secret], header, signedText)`). Secret env: `SHOEBOX_INBOUND_WEBHOOK_SECRET`.
- Address: local part `{slug}-{secret}` optionally followed by `+tag` (`+banka` → purpose `bank_notice`, any other tag → `documents`). Slug: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`; secret: the 8 characters after the last `-`, `^[0-9a-z]{8}$`. Everything compared lower-case. The domain part is ignored (the mail worker only receives our domain).
- `messageId` = value of the first `Message-ID` header (search only the header block, before the first empty line; trim; at most 500 chars), else `sha256:{sha256 of body}`. `emlPath(orgId, sha256hex(messageId))` from `@shoebox/platform` is the storage path.
- Answers: 413 too large; 401 bad or missing signature (or secret env unset); 404 `{ decision: 'unknown_recipient' }`; 200 `{ decision: 'duplicate' }` when the mail was already stored (it is enqueued again, which is a no-op by job key); 503 `{ error: 'retry' }` when storage, database or queue fails (the sender retries); 202 `{ decision: 'accept' }`. No mail content, address or subject in logs or answers (hard rule 4).
- 0103 gives `createInboundEmailStore(url)` (`findOrg`, `insertEmail`) from `@shoebox/db` and `emailReceivedJob` from `@shoebox/pipeline`.
- `apps/web/src/auth/guard.ts` excerpt (find verbatim):

```ts
export const PUBLIC_PATHS = [LOGIN_PATH, '/auth/callback', '/api/health'] as const;
```

  and `apps/web/test/guard.test.ts` line `expect(PUBLIC_PATHS).toEqual(['/prihlaseni', '/auth/callback', '/api/health']);` If either now holds more paths (another lane adds some), append `'/api/inbound-email'` at the end of whatever list is there, in both files.

## 3. Files

| Path | Action | What |
|---|---|---|
| apps/web/src/inbound-email/webhook.ts | new | `parseInboundAddress`, `messageIdOf`, `handleInboundEmail` |
| apps/web/test/inbound-email-webhook.test.ts | new | the test below |
| apps/web/src/documents/enqueue.ts | edit | append `enqueueEmailReceived` |
| apps/web/app/api/inbound-email/route.ts | new | wires real deps |
| apps/web/src/auth/guard.ts | edit | public path |
| apps/web/test/guard.test.ts | edit | expected list |

No other file may change.

## 4. Steps

1. Create `apps/web/test/inbound-email-webhook.test.ts` exactly (never edit it later):

```ts
import { createHash } from 'node:crypto';
import { signWebhook } from '@shoebox/platform';
import { describe, expect, it } from 'vitest';
import {
  handleInboundEmail,
  type InboundDeps,
  messageIdOf,
  parseInboundAddress,
} from '../src/inbound-email/webhook';

const SECRET = 'test-webhook-secret';
const ORG = 'eeeeeeee-0000-4000-8000-000000000104';
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const RAW = enc('Message-ID: <abc@example.test>\r\nSubject: Faktura\r\n\r\nMessage-ID: <body@x>\r\n');
const TO = 'jan-novak-ab12cd34@in.example.test';

function signed(to: string, body: Uint8Array) {
  return signWebhook(SECRET, `${to}\n${sha(body)}`);
}

function fakeDeps(over: Partial<InboundDeps> = {}) {
  const calls = { put: [] as string[], insert: [] as unknown[], enqueue: [] as string[] };
  const deps: InboundDeps = {
    secret: SECRET,
    findOrg: async (slug, secret) => (slug === 'jan-novak' && secret === 'ab12cd34' ? ORG : null),
    putEml: async (path) => {
      calls.put.push(path);
    },
    insertEmail: async (row) => {
      calls.insert.push(row);
      return 'eeeeeeee-0000-4000-8000-0000000001e1';
    },
    enqueue: async (_orgId, id) => {
      calls.enqueue.push(id);
    },
    now: () => new Date('2026-10-26T10:00:00Z'),
    ...over,
  };
  return { deps, calls };
}

describe('parseInboundAddress', () => {
  it('splits slug and secret, any case, with or without a +tag', () => {
    expect(parseInboundAddress('Jan-Novak-AB12CD34@in.example.test')).toEqual({ slug: 'jan-novak', secret: 'ab12cd34', purpose: 'documents' });
    expect(parseInboundAddress('firma-ab12cd34+banka@in.example.test')).toEqual({ slug: 'firma', secret: 'ab12cd34', purpose: 'bank_notice' });
    expect(parseInboundAddress('firma-ab12cd34+cokoli@x')).toEqual({ slug: 'firma', secret: 'ab12cd34', purpose: 'documents' });
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'firma@x', 'firma-short@x', '-ab12cd34@x', 'fir ma-ab12cd34@x', 'firma-ab12cd3!@x', 'no-at-sign-ab12cd34']) {
      expect(parseInboundAddress(bad), bad).toBeNull();
    }
  });
});

describe('messageIdOf', () => {
  it('reads Message-ID from the header block only', () => {
    expect(messageIdOf(RAW)).toBe('<abc@example.test>');
    expect(messageIdOf(enc('Subject: x\r\n\r\nMessage-ID: <body@x>\r\n'))).toBeNull();
    expect(messageIdOf(enc('message-id:\r\n  <folded@x>\r\n\r\n'))).toBe('<folded@x>');
  });
});

describe('handleInboundEmail', () => {
  it('accepts a signed mail: stores, records and queues it', async () => {
    const { deps, calls } = fakeDeps();
    const res = await handleInboundEmail(deps, { to: TO, from: 'a@b.test', signature: signed(TO, RAW), body: RAW });
    expect(res).toEqual({ status: 202, body: { decision: 'accept' } });
    expect(calls.put).toEqual([`org/${ORG}/eml/${sha(enc('<abc@example.test>'))}.eml`]);
    expect(calls.insert).toEqual([
      {
        orgId: ORG,
        messageId: '<abc@example.test>',
        fromAddress: 'a@b.test',
        toAddress: TO,
        subject: null,
        receivedAt: new Date('2026-10-26T10:00:00Z'),
        purpose: 'documents',
        emlPath: `org/${ORG}/eml/${sha(enc('<abc@example.test>'))}.eml`,
      },
    ]);
    expect(calls.enqueue).toEqual(['eeeeeeee-0000-4000-8000-0000000001e1']);
  });

  it('a bad, missing or replayed-for-another-recipient signature is 401', async () => {
    const { deps, calls } = fakeDeps();
    expect((await handleInboundEmail(deps, { to: TO, from: null, signature: null, body: RAW })).status).toBe(401);
    expect((await handleInboundEmail(deps, { to: TO, from: null, signature: signed('other-ab12cd34@x', RAW), body: RAW })).status).toBe(401);
    expect((await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, enc('other')), body: RAW })).status).toBe(401);
    expect(calls.put).toEqual([]);
  });

  it('no configured secret is 401, never accept', async () => {
    const { deps } = fakeDeps({ secret: '' });
    expect((await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, RAW), body: RAW })).status).toBe(401);
  });

  it('an unknown address is 404 unknown_recipient', async () => {
    const { deps, calls } = fakeDeps();
    const to = 'jan-novak-zz99zz99@in.example.test';
    expect(await handleInboundEmail(deps, { to, from: null, signature: signed(to, RAW), body: RAW })).toEqual({ status: 404, body: { decision: 'unknown_recipient' } });
    const bad = 'not-an-address';
    expect((await handleInboundEmail(deps, { to: bad, from: null, signature: signed(bad, RAW), body: RAW })).status).toBe(404);
    expect(calls.insert).toEqual([]);
  });

  it('a mail stored before is 200 duplicate and is queued again', async () => {
    const { deps, calls } = fakeDeps({ insertEmail: async () => null });
    const res = await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, RAW), body: RAW });
    expect(res).toEqual({ status: 200, body: { decision: 'duplicate' } });
    expect(calls.enqueue).toEqual([]);
  });

  it('without a Message-ID the body hash is the id', async () => {
    const { deps, calls } = fakeDeps();
    const raw = enc('Subject: x\r\n\r\nhello');
    await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, raw), body: raw });
    expect((calls.insert[0] as { messageId: string }).messageId).toBe(`sha256:${sha(raw)}`);
  });

  it('a failing store or queue is 503 so the sender retries', async () => {
    const boom = async () => {
      throw new Error('down');
    };
    for (const over of [{ putEml: boom }, { insertEmail: boom }, { enqueue: boom }, { findOrg: boom }]) {
      const { deps } = fakeDeps(over as Partial<InboundDeps>);
      expect((await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, RAW), body: RAW })).status).toBe(503);
    }
  });

  it('over 25 MiB is 413', async () => {
    const { deps } = fakeDeps();
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    expect((await handleInboundEmail(deps, { to: TO, from: null, signature: signed(TO, big), body: big })).status).toBe(413);
  });
});
```

   Note the duplicate case: when `insertEmail` returns null, the mail is not queued again from here (keep it simple: answer 200 duplicate). The §2 line about re-enqueueing is replaced by this test.

2. Create `apps/web/src/inbound-email/webhook.ts` with these exports; implement until the test passes:

```ts
export const INBOUND_MAX_BYTES = 25 * 1024 * 1024;
export interface InboundAddress { readonly slug: string; readonly secret: string; readonly purpose: 'documents' | 'bank_notice' }
export function parseInboundAddress(to: string): InboundAddress | null;
export function messageIdOf(raw: Uint8Array): string | null;
export interface InboundDeps {
  readonly secret: string;
  findOrg(slug: string, secret: string, now: Date): Promise<string | null>;
  putEml(path: string, body: Uint8Array): Promise<void>;
  insertEmail(row: InboundEmailInsert): Promise<string | null>; // type from @shoebox/db
  enqueue(orgId: string, inboundEmailId: string): Promise<void>;
  now(): Date;
}
export interface InboundRequest { readonly to: string; readonly from: string | null; readonly signature: string | null; readonly body: Uint8Array }
export function handleInboundEmail(deps: InboundDeps, req: InboundRequest): Promise<{ status: number; body: Record<string, string> }>;
```

   Order: size → signature (empty secret = 401; `verifyWebhook` result not ok = 401) → address → findOrg → putEml → insertEmail → enqueue. Wrap findOrg..enqueue in one try/catch → 503. `messageIdOf`: decode with `new TextDecoder('latin1')` the first 64 KiB, header block = text before the first `\r\n\r\n` or `\n\n`, unfold lines that start with space/tab, match `/^message-id:\s*(.+)$/im`. Import only `type InboundEmailInsert` from `@shoebox/db` (type import). Run `pnpm --filter @shoebox/web exec vitest run test/inbound-email-webhook.test.ts 2>&1 | tail -30` → all pass.

3. Edit `apps/web/src/documents/enqueue.ts`: change the first import line to also import `emailReceivedJob` from `@shoebox/pipeline`, and append:

```ts

/** Queues `email.received` for one stored inbound e-mail; a second call for the same mail is a no-op. */
export async function enqueueEmailReceived(orgId: string, inboundEmailId: string): Promise<void> {
  const payload = emailReceivedJob.payload.parse({ orgId, inboundEmailId });
  const key = jobKey(emailReceivedJob, payload);
  await (await boss()).send(emailReceivedJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}
```

4. Create `apps/web/app/api/inbound-email/route.ts`:

```ts
import { createInboundEmailStore, type InboundEmailStore } from '@shoebox/db';
import { createSupabaseBlobStore } from '@shoebox/platform';
import { enqueueEmailReceived } from '../../../src/documents/enqueue';
import { handleInboundEmail, INBOUND_MAX_BYTES } from '../../../src/inbound-email/webhook';

export const runtime = 'nodejs';

let store: InboundEmailStore | undefined;

/** Called by the Cloudflare mail worker only; signed, no session (M01 §4.1.2). */
export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > INBOUND_MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !supabaseUrl || !serviceKey)
    return Response.json({ error: 'retry' }, { status: 503 });
  store ??= createInboundEmailStore(databaseUrl);
  const blobs = createSupabaseBlobStore({ url: supabaseUrl, apiKey: serviceKey });
  const db = store;
  const result = await handleInboundEmail(
    {
      secret: process.env.SHOEBOX_INBOUND_WEBHOOK_SECRET ?? '',
      findOrg: (slug, secret, now) => db.findOrg(slug, secret, now),
      putEml: async (path, body) => {
        try {
          await blobs.put(path, body, 'message/rfc822');
        } catch (error) {
          // The same mail stored before: the object already exists, which is fine.
          if (!(error instanceof Error && 'status' in error && (error.status === 409 || error.status === 400))) throw error;
        }
      },
      insertEmail: (row) => db.insertEmail(row),
      enqueue: enqueueEmailReceived,
      now: () => new Date(),
    },
    {
      to: request.headers.get('x-shoebox-to') ?? '',
      from: request.headers.get('x-shoebox-from'),
      signature: request.headers.get('x-shoebox-signature'),
      body: new Uint8Array(await request.arrayBuffer()),
    },
  );
  return Response.json(result.body, { status: result.status });
}
```

   If `createSupabaseBlobStore` options differ, match `apps/worker/src/doc-extract/register.ts`. Typecheck.

5. Edit `guard.ts` and `guard.test.ts` as §2 says. Run `pnpm --filter @shoebox/web exec vitest run test/guard.test.ts 2>&1 | tail -30` → passes.

## 5. Do not touch

`apps/web/src/documents/upload.ts`, `apps/web/app/api/documents/`, `middleware.ts`, `packages/`. Hard rules 3, 4, 7.

## 6. Commands

- `pnpm --filter @shoebox/web exec vitest run test/inbound-email-webhook.test.ts test/guard.test.ts 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm exec biome check apps/web 2>&1 | tail -30` → no new findings.

## 7. Acceptance

- [ ] Tests pass; CI green; diff limited to §3 files plus brief and report.

## 8. Stop and ask

Stop and write the report as `blocked` if an excerpt is not found, a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0104-report.md`, 300 tokens at most. Set `Status: review`.
