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

const env = {
  INBOUND_URL: 'https://app.example.test/api/inbound-email',
  INBOUND_WEBHOOK_SECRET: SECRET,
};

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
