# 0106: Cloudflare mail worker forwards each e-mail to the app

Status: todo
Ticket: P1-ING-06 (edge part) | Depends on: 0104 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens | Risk: HIGH (auth)

## 1. Objective

Free Cloudflare Email Routing hands every mail for the inbox domain to a small worker. The worker signs the raw mail and POSTs it to `/api/inbound-email` (0104); an unknown address or an oversized mail is rejected back to the sender, and any app error makes the sender retry later, so nothing is lost.

## 2. Context

- Cloudflare email handler: `export default { async email(message, env) }`. `message` has `from`, `to`, `raw` (ReadableStream of bytes), `rawSize` (number), `setReject(reason: string)`. Declare these as local TypeScript interfaces; no new dependency (no `@cloudflare/workers-types`).
- Env: `INBOUND_URL` (e.g. `https://shoebox-test.onrender.com/api/inbound-email`), `INBOUND_WEBHOOK_SECRET` (same value as the app's `SHOEBOX_INBOUND_WEBHOOK_SECRET`).
- Signature must equal `signWebhook(secret, `${to}\n${sha256hex(raw)}`)` of `@shoebox/platform`: header `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${to}\n${sha}`)>`. Use Web Crypto (`crypto.subtle`), not `node:crypto`, and do not import `@shoebox/platform` (it uses node:crypto).
- Request: `POST INBOUND_URL`, body = raw bytes, headers `content-type: message/rfc822`, `x-shoebox-to`, `x-shoebox-from`, `x-shoebox-signature`.
- Outcomes: `rawSize > 25 MiB` → `setReject('Message too large (max 25 MB)')`, no POST. Answer 404 → `setReject('Unknown recipient')`. 413 → `setReject('Message too large (max 25 MB)')`. 200/202 → done. Anything else (401, 5xx, network error) → throw (Cloudflare tells the sender to retry). Never log addresses or content.

## 3. Files

| Path | Action | What |
|---|---|---|
| apps/email-worker/src/index.ts | edit | keep `packageName`, add the worker |
| apps/email-worker/test/forward.test.ts | new | the test below |
| apps/email-worker/wrangler.toml | new | deploy config |

No other file may change.

## 4. Steps

1. Create `apps/email-worker/test/forward.test.ts` exactly (never edit it later):

```ts
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type EmailMessageLike, forwardEmail, signBody } from '../src/index';

const SECRET = 's3cret';
const RAW = new TextEncoder().encode('Subject: x\r\n\r\nhello');
const TO = 'firma-ab12cd34@in.example.test';

function message(over: Partial<EmailMessageLike> = {}) {
  const rejected: string[] = [];
  const msg: EmailMessageLike = {
    from: 'dodavatel@example.test',
    to: TO,
    rawSize: RAW.byteLength,
    raw: new Response(RAW).body as ReadableStream<Uint8Array>,
    setReject: (reason) => void rejected.push(reason),
    ...over,
  };
  return { msg, rejected };
}

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{}', { status });
  };
  return { fn: fn as typeof fetch, calls };
}

const env = { INBOUND_URL: 'https://app.example.test/api/inbound-email', INBOUND_WEBHOOK_SECRET: SECRET };

describe('signBody', () => {
  it('matches the app format t=<unix>,v1=<hmac of "t.text">', async () => {
    const header = await signBody(SECRET, 'abc', 1_700_000_000);
    const expected = createHmac('sha256', SECRET).update('1700000000.abc').digest('hex');
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe('forwardEmail', () => {
  it('posts the signed raw mail', async () => {
    const { msg, rejected } = message();
    const f = fakeFetch(202);
    await forwardEmail(msg, env, f.fn, 1_700_000_000);
    expect(rejected).toEqual([]);
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    const headers = new Headers(call?.init.headers);
    expect(call?.url).toBe(env.INBOUND_URL);
    expect(call?.init.method).toBe('POST');
    expect(headers.get('x-shoebox-to')).toBe(TO);
    expect(headers.get('x-shoebox-from')).toBe('dodavatel@example.test');
    const sha = createHash('sha256').update(RAW).digest('hex');
    const mac = createHmac('sha256', SECRET).update(`1700000000.${TO}\n${sha}`).digest('hex');
    expect(headers.get('x-shoebox-signature')).toBe(`t=1700000000,v1=${mac}`);
    expect(new Uint8Array(call?.init.body as ArrayBuffer)).toEqual(RAW);
  });

  it('rejects an unknown recipient and a too-large mail', async () => {
    const unknown = message();
    await forwardEmail(unknown.msg, env, fakeFetch(404).fn);
    expect(unknown.rejected).toEqual(['Unknown recipient']);

    const huge = message({ rawSize: 25 * 1024 * 1024 + 1 });
    const f = fakeFetch(202);
    await forwardEmail(huge.msg, env, f.fn);
    expect(huge.rejected).toEqual(['Message too large (max 25 MB)']);
    expect(f.calls).toEqual([]);

    const tooLarge = message();
    await forwardEmail(tooLarge.msg, env, fakeFetch(413).fn);
    expect(tooLarge.rejected).toEqual(['Message too large (max 25 MB)']);
  });

  it('throws on any other answer so the sender retries', async () => {
    for (const status of [401, 500, 503]) {
      const { msg } = message();
      await expect(forwardEmail(msg, env, fakeFetch(status).fn)).rejects.toThrow();
    }
  });

  it('a duplicate (200) is fine', async () => {
    const { msg, rejected } = message();
    await forwardEmail(msg, env, fakeFetch(200).fn);
    expect(rejected).toEqual([]);
  });
});
```

2. Edit `apps/email-worker/src/index.ts` (keep the `packageName` line) and add:

```ts
export interface EmailMessageLike {
  readonly from: string;
  readonly to: string;
  readonly rawSize: number;
  readonly raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}
export interface MailWorkerEnv { readonly INBOUND_URL: string; readonly INBOUND_WEBHOOK_SECRET: string }
export const MAX_MAIL_BYTES = 25 * 1024 * 1024;
/** `t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${text}`)>`, Web Crypto only. */
export function signBody(secret: string, text: string, nowSeconds?: number): Promise<string>;
export function forwardEmail(message: EmailMessageLike, env: MailWorkerEnv, doFetch?: typeof fetch, nowSeconds?: number): Promise<void>;
declare const _default: { email(message: EmailMessageLike, env: MailWorkerEnv): Promise<void> };
export default _default; // implement as: export default { email: (message, env) => forwardEmail(message, env) };
```

   Read `raw` fully with `new Response(message.raw).arrayBuffer()`; sha256 via `crypto.subtle.digest`; send the `ArrayBuffer` as body. Implement until `pnpm --filter @shoebox/email-worker test 2>&1 | tail -30` passes, then `pnpm --filter @shoebox/email-worker typecheck 2>&1 | tail -30` (if `ReadableStream`/`crypto` types are missing, add `"lib": ["ES2022", "DOM"]` only if the tsconfig base lacks it; that tsconfig change then needs §8: stop and report instead).

3. Create `apps/email-worker/wrangler.toml`:

```toml
# Cloudflare Email Worker for the Sysel inbox (M01 §4.1.2). Deploy: see deploy/inbound-email.md
name = "sysel-mail"
main = "src/index.ts"
compatibility_date = "2026-10-01"

[vars]
# Set to the app's endpoint, e.g. https://shoebox-test.onrender.com/api/inbound-email
INBOUND_URL = ""

# Secret: wrangler secret put INBOUND_WEBHOOK_SECRET (the same value as the app's SHOEBOX_INBOUND_WEBHOOK_SECRET)
```

## 5. Do not touch

Everything outside §3. No new dependency (hard rule 7). Hard rule 4.

## 6. Commands

- `pnpm --filter @shoebox/email-worker test 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/email-worker typecheck 2>&1 | tail -30` → no errors.
- `pnpm exec biome check apps/email-worker 2>&1 | tail -30` → clean.

## 7. Acceptance

- [ ] Tests pass; CI green; diff limited to §3 files plus brief and report.

## 8. Stop and ask

Stop and write the report as `blocked` if a test fails twice, a file outside §3 needs a change, or you reach 25 tool calls.

## 9. Report

`docs/tasks/0106-report.md`, 300 tokens at most. Set `Status: review`.
