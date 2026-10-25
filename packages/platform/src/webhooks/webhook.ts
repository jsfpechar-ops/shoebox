import { createHmac, timingSafeEqual } from 'node:crypto';

/** HTTP header carrying the signature: `t=<unix seconds>,v1=<hex>[,v1=<hex>]`. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Shoebox-Signature' as const;
/** Accepted clock skew in either direction, in seconds (M12 §4.5). */
export const WEBHOOK_TOLERANCE_SECONDS = 300 as const;
/** Largest signed body the receiving route may accept; the route checks it, not this module. */
export const WEBHOOK_MAX_BODY_BYTES = 1_048_576 as const;
/** Longest header we parse; longer is `malformed`. */
export const WEBHOOK_MAX_HEADER_CHARS = 1024 as const;
/** Most `v1=` signatures in one header: one per key during rotation. */
const MAX_SIGNATURES = 2;

export type VerifyWebhookFailure = 'missing' | 'malformed' | 'expired' | 'mismatch';
export type VerifyWebhookResult = { ok: true } | { ok: false; reason: VerifyWebhookFailure };

const TIMESTAMP_RE = /^\d{1,12}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function nowSeconds(now: number | undefined): number {
  const t = now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(t) || t < 0) {
    throw new Error('webhook: now must be a non-negative integer of Unix seconds');
  }
  return t;
}

function hmacHex(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/** Returns `t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. */
export function signWebhook(secret: string, body: string, now?: number): string {
  if (secret.length === 0) {
    throw new Error('signWebhook: secret must not be empty');
  }
  const t = nowSeconds(now);
  return `t=${t},v1=${hmacHex(secret, t, body)}`;
}

type ParsedHeader = { timestamp: number; signatures: readonly string[] };

function parseHeader(header: string): ParsedHeader | null {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) {
      return null;
    }
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') {
      if (timestamp !== undefined || !TIMESTAMP_RE.test(value)) {
        return null;
      }
      timestamp = Number(value);
    } else if (key === 'v1') {
      if (!HEX64_RE.test(value) || signatures.length >= MAX_SIGNATURES) {
        return null;
      }
      signatures.push(value);
    } else {
      return null;
    }
  }
  if (timestamp === undefined || signatures.length === 0) {
    return null;
  }
  return { timestamp, signatures };
}

/**
 * Verifies a header produced by `signWebhook` against every secret (two during rotation).
 * Check order: missing → malformed → expired → mismatch. Comparison is constant-time and
 * evaluates every (secret, signature) pair. Throws when `secrets` is empty or contains ''.
 */
export function verifyWebhook(
  secrets: readonly string[],
  header: string | null,
  rawBody: string,
  now?: number,
): VerifyWebhookResult {
  if (secrets.length === 0 || secrets.some((s) => s.length === 0)) {
    throw new Error('verifyWebhook: secrets must be a non-empty list of non-empty strings');
  }
  if (header === null || header.trim().length === 0) {
    return { ok: false, reason: 'missing' };
  }
  if (header.length > WEBHOOK_MAX_HEADER_CHARS) {
    return { ok: false, reason: 'malformed' };
  }
  const parsed = parseHeader(header.trim());
  if (parsed === null) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(nowSeconds(now) - parsed.timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(hmacHex(secret, parsed.timestamp, rawBody), 'hex');
    for (const given of parsed.signatures) {
      // Both buffers are 32 bytes (HEX64_RE), so timingSafeEqual never throws.
      if (timingSafeEqual(expected, Buffer.from(given, 'hex'))) {
        matched = true;
      }
    }
  }
  return matched ? { ok: true } : { ok: false, reason: 'mismatch' };
}
