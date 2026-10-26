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
