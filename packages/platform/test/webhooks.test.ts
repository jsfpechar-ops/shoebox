import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  signWebhook,
  verifyWebhook,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../src/index';

const SECRET_A = 'a-secret-of-at-least-32-characters-aaaa';
const SECRET_B = 'b-secret-of-at-least-32-characters-bbbb';
const NOW = 1_760_745_600;
const BODY = '{"message_id":"m-1","org_id":"org-1"}';
const HEADER_RE = /^t=\d+,v1=[0-9a-f]{64}$/;

function hmac(secret: string, t: number, body: string): string {
  return createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
}

function flipLastHexDigit(sig: string): string {
  return `${sig.slice(0, 63)}${sig.endsWith('0') ? '1' : '0'}`;
}

describe('signWebhook', () => {
  it('produces t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>', () => {
    const header = signWebhook(SECRET_A, BODY, NOW);
    expect(header).toBe(`t=${NOW},v1=${hmac(SECRET_A, NOW, BODY)}`);
    expect(header).toMatch(HEADER_RE);
  });

  it('uses the current Unix time in seconds when now is omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const header = signWebhook(SECRET_A, BODY);
    const after = Math.floor(Date.now() / 1000);
    const t = Number(header.slice(2, header.indexOf(',')));
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('throws on an empty secret or a non-integer / negative now', () => {
    expect(() => signWebhook('', BODY, NOW)).toThrow();
    expect(() => signWebhook(SECRET_A, BODY, 1.5)).toThrow();
    expect(() => signWebhook(SECRET_A, BODY, -1)).toThrow();
  });

  it('exports the header name and limits from M12 §4.5', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('X-Shoebox-Signature');
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect(WEBHOOK_MAX_BODY_BYTES).toBe(1_048_576);
  });
});

describe('verifyWebhook', () => {
  const good = (): string => signWebhook(SECRET_A, BODY, NOW);

  it('accepts a header it signed', () => {
    expect(verifyWebhook([SECRET_A], good(), BODY, NOW)).toEqual({ ok: true });
  });

  it('rejects a missing header', () => {
    expect(verifyWebhook([SECRET_A], null, BODY, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhook([SECRET_A], '', BODY, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhook([SECRET_A], '   ', BODY, NOW)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects malformed headers without reaching the compare', () => {
    const sig = hmac(SECRET_A, NOW, BODY);
    const malformed = [
      'garbage',
      `v1=${sig}`,
      `t=${NOW}`,
      `t=,v1=${sig}`,
      `t=abc,v1=${sig}`,
      `t=${NOW},v1=`,
      `t=${NOW},v1=${sig.slice(0, 63)}`,
      `t=${NOW},v1=${sig}0`,
      `t=${NOW},v1=${sig.toUpperCase()}`,
      `t=${NOW},v1=${sig},v1=${sig},v1=${sig}`,
      `t=${NOW},t=${NOW},v1=${sig}`,
      `t=${NOW},v1=${sig},x=1`,
      `t=${NOW},v1=${sig},`,
      `t=${NOW}, v1=${sig}`,
      `t=${'1'.repeat(13)},v1=${sig}`,
      `t=${'1'.repeat(2000)},v1=${sig}`,
    ];
    for (const h of malformed) {
      expect(verifyWebhook([SECRET_A], h, BODY, NOW), h).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('accepts a timestamp exactly 300 s old or 300 s ahead', () => {
    const old = signWebhook(SECRET_A, BODY, NOW - 300);
    const ahead = signWebhook(SECRET_A, BODY, NOW + 300);
    expect(verifyWebhook([SECRET_A], old, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_A], ahead, BODY, NOW)).toEqual({ ok: true });
  });

  it('rejects a timestamp 301 s old or 301 s ahead', () => {
    const old = signWebhook(SECRET_A, BODY, NOW - 301);
    const ahead = signWebhook(SECRET_A, BODY, NOW + 301);
    expect(verifyWebhook([SECRET_A], old, BODY, NOW)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyWebhook([SECRET_A], ahead, BODY, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports expired before mismatch', () => {
    const old = signWebhook(SECRET_A, BODY, NOW - 301);
    expect(verifyWebhook([SECRET_B], old, BODY, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered body', () => {
    const header = good();
    const bodies = [BODY.replace('m-1', 'm-2'), `${BODY} `, ` ${BODY}`, '', BODY.toUpperCase()];
    for (const body of bodies) {
      expect(verifyWebhook([SECRET_A], header, body, NOW)).toEqual({
        ok: false,
        reason: 'mismatch',
      });
    }
  });

  it('rejects a wrong secret', () => {
    const header = good();
    for (const secrets of [
      [SECRET_B],
      [`${SECRET_A}x`],
      [SECRET_A.slice(1)],
      [SECRET_B, `${SECRET_A} `],
    ]) {
      expect(verifyWebhook(secrets, header, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
    }
  });

  it('rejects a tampered signature and a signature replayed under another timestamp', () => {
    const sig = hmac(SECRET_A, NOW, BODY);
    const flipped = `t=${NOW},v1=${flipLastHexDigit(sig)}`;
    const moved = `t=${NOW + 1},v1=${sig}`;
    expect(verifyWebhook([SECRET_A], flipped, BODY, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verifyWebhook([SECRET_A], moved, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('accepts the second secret during rotation', () => {
    const signedWithA = signWebhook(SECRET_A, BODY, NOW);
    const signedWithB = signWebhook(SECRET_B, BODY, NOW);
    expect(verifyWebhook([SECRET_B, SECRET_A], signedWithA, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_A, SECRET_B], signedWithB, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_A], signedWithB, BODY, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('accepts a header carrying two v1 signatures when one matches a known secret', () => {
    const dual = `t=${NOW},v1=${hmac(SECRET_B, NOW, BODY)},v1=${hmac(SECRET_A, NOW, BODY)}`;
    expect(verifyWebhook([SECRET_A], dual, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_B], dual, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook(['neither'], dual, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('throws on an empty secret list or an empty secret', () => {
    expect(() => verifyWebhook([], good(), BODY, NOW)).toThrow();
    expect(() => verifyWebhook([SECRET_A, ''], good(), BODY, NOW)).toThrow();
  });

  it('uses the current time when now is omitted', () => {
    expect(verifyWebhook([SECRET_A], signWebhook(SECRET_A, BODY), BODY)).toEqual({ ok: true });
    const stale = signWebhook(SECRET_A, BODY, Math.floor(Date.now() / 1000) - 301);
    expect(verifyWebhook([SECRET_A], stale, BODY)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('property: verify(sign(x)) = ok', () => {
  // Deterministic PRNG (mulberry32) so a failure reproduces; no fast-check in this brief.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ALPHABET = [...'abcXYZ019 ,=.\n\t{}":/\\éřž€𝄞'];
  function randomString(rnd: () => number, max: number): string {
    const len = Math.floor(rnd() * (max + 1));
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += ALPHABET[Math.floor(rnd() * ALPHABET.length)] ?? '';
    }
    return out;
  }

  it('holds for 500 random secrets, bodies, timestamps and skews; tampering fails', () => {
    const rnd = mulberry32(20261018);
    for (let i = 0; i < 500; i += 1) {
      const secret = `s${randomString(rnd, 40)}`;
      const other = `${secret}x`;
      const body = randomString(rnd, 200);
      const t = Math.floor(rnd() * 4_000_000_000);
      const skew = Math.floor(rnd() * 601) - 300;
      const header = signWebhook(secret, body, t);
      expect(header).toMatch(HEADER_RE);
      expect(verifyWebhook([secret], header, body, t + skew)).toEqual({ ok: true });
      expect(verifyWebhook([other, secret], header, body, t)).toEqual({ ok: true });
      expect(verifyWebhook([other], header, body, t)).toEqual({ ok: false, reason: 'mismatch' });
      expect(verifyWebhook([secret], header, `${body}x`, t)).toEqual({
        ok: false,
        reason: 'mismatch',
      });
      expect(verifyWebhook([secret], header, body, t + 301)).toEqual({
        ok: false,
        reason: 'expired',
      });
    }
  });
});
