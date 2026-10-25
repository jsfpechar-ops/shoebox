# 0009: Signed webhooks (`signWebhook` / `verifyWebhook`)

Status: done
Ticket: P0-PLAT-03 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0009-signed-webhooks | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `signWebhook` and `verifyWebhook` to `@shoebox/platform`: HMAC-SHA256 over `t.body`, a ±300 s timestamp window, constant-time comparison and two accepted secrets during key rotation. Every internal webhook (Email Worker → web) will use it, so a forged or replayed call can never create an inbound e-mail for a tenant.

Risk HIGH (auth): the source and the test file below are exact. Write them verbatim; do not redesign. Brief 0008 (logger) edits the same package in parallel and owns `src/logger/**`; you own `src/webhooks/**` and `test/webhooks*.test.ts` only.

## 2. Context

Spec M12 §4.5 Security, "Signed webhooks" (pasted; never open `docs/v3/`):

- Header `X-Shoebox-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`; optional `v1` twice during key rotation (both keys accepted for 7 days).
- Reject if `|now − t| > 300 s`, signature mismatch (constant-time compare), or body > 1 MB (metadata only; files go via presigned PUT).
- Replay: `(org_id, message_id)` unique in `inbound_emails`; a replayed `complete` call is a no-op returning 200.

```ts
export function signWebhook(secret: string, body: string, now?: number): string;
export function verifyWebhook(secrets: string[], header: string | null, rawBody: string, now?: number):
  { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };
```

M12 §9 AC-6: `verifyWebhook` rejects: missing header, timestamp 301 s old, tampered body, wrong secret; accepts the second secret during rotation (unit + property tests).

Decisions taken in this brief (reviewer: these are the design, tests pin them):

- `now` is Unix **seconds** (integer). Omitted → `Math.floor(Date.now() / 1000)`.
- Check order: `missing` (null, empty or whitespace header) → `malformed` → `expired` → `mismatch`. Expiry is checked before the HMAC so an expired header never reaches the compare.
- Header grammar is strict: comma-separated `key=value` parts, exactly one `t` (1–12 decimal digits), one or two `v1` (exactly 64 lowercase hex chars), no other keys, no spaces, no trailing comma, at most 1024 chars. Anything else is `malformed`, never `mismatch` (a wrong-length signature must not reach `timingSafeEqual`).
- Match = any (secret × v1) pair equal under `crypto.timingSafeEqual`; all pairs are evaluated (no early exit). `secrets` empty or containing `''` throws (misconfiguration must be loud, not a silent `mismatch`).
- Body size (1 MB) and replay are not this function's job: the route checks `Content-Length` against the exported `WEBHOOK_MAX_BODY_BYTES`, and `inbound_emails` enforces `(org_id, message_id)` (P0 email tickets).
- The property test uses a seeded PRNG inside the test file: `node:crypto` only, no new dependency (hard rule 7; `fast-check` is approved but is not wired into the catalog yet).
- `node:crypto` types come from the root `@types/node` via `tsconfig.base.json` `"types": ["node"]`; no `package.json` change.

Existing file you edit, `packages/platform/src/index.ts` (whole file, from brief 0002):

```ts
export const packageName = '@shoebox/platform' as const;
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/platform/src/webhooks/webhook.ts` | new | `signWebhook`, `verifyWebhook`, constants, result type (exact source below) |
| `packages/platform/src/webhooks/index.ts` | new | `export * from './webhook';` |
| `packages/platform/src/index.ts` | edit | add `export * from './webhooks/index';` after the `packageName` line |
| `packages/platform/test/webhooks.test.ts` | new | unit + property tests (exact file below) |
| `docs/tasks/0009-report.md` | new | your report (§9) |

No other file may change. (The ticket names `src/webhook.ts` / `test/webhook.test.ts`; the orchestrator moved them to `src/webhooks/` and `test/webhooks.test.ts` so brief 0008 cannot collide. Mention this in the report.)

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0009-signed-webhooks origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -5`. Write each file with one Write call; never re-read a file you just wrote; do not explore the repo. Commit after every step as `0009 step k`.

### Step 1: `packages/platform/src/webhooks/webhook.ts` (new, verbatim)

```ts
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
```

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors (exit 0).

### Step 2: `packages/platform/src/webhooks/index.ts` (new)

```ts
export * from './webhook';
```

Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors.

### Step 3: edit `packages/platform/src/index.ts`

Anchor (must be found verbatim with `grep -nF "export const packageName = '@shoebox/platform' as const;" packages/platform/src/index.ts`):

```ts
export const packageName = '@shoebox/platform' as const;
```

Insert directly after it, as a new line:

```ts
export * from './webhooks/index';
```

Do not change or move any other line of this file (brief 0008 adds its own line here; the orchestrator resolves the order). Command: `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30`. Expected: no errors.

### Step 4: `packages/platform/test/webhooks.test.ts` (new, verbatim; do not edit it to make it pass)

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  signWebhook,
  verifyWebhook,
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
    for (const secrets of [[SECRET_B], [`${SECRET_A}x`], [SECRET_A.slice(1)], [SECRET_B, `${SECRET_A} `]]) {
      expect(verifyWebhook(secrets, header, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
    }
  });

  it('rejects a tampered signature and a signature replayed under another timestamp', () => {
    const sig = hmac(SECRET_A, NOW, BODY);
    const flipped = `t=${NOW},v1=${flipLastHexDigit(sig)}`;
    const moved = `t=${NOW + 1},v1=${sig}`;
    expect(verifyWebhook([SECRET_A], flipped, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyWebhook([SECRET_A], moved, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('accepts the second secret during rotation', () => {
    const signedWithA = signWebhook(SECRET_A, BODY, NOW);
    const signedWithB = signWebhook(SECRET_B, BODY, NOW);
    expect(verifyWebhook([SECRET_B, SECRET_A], signedWithA, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_A, SECRET_B], signedWithB, BODY, NOW)).toEqual({ ok: true });
    expect(verifyWebhook([SECRET_A], signedWithB, BODY, NOW)).toEqual({ ok: false, reason: 'mismatch' });
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
```

Command: `pnpm --filter @shoebox/platform test -- webhooks 2>&1 | tail -30`. Expected: `Test Files  1 passed`, `Tests  18 passed`, exit 0. If a test fails once, fix `webhook.ts` only (not the test) and rerun; a second failure → §8.

### Step 5: lint and format

Command: `pnpm lint 2>&1 | tail -30`. Expected: `Checked N files ... No fixes applied`, exit 0. If Biome reports **format** differences only in files of §3, run `pnpm exec biome format --write packages/platform/src/webhooks packages/platform/test/webhooks.test.ts 2>&1 | tail -5`, rerun `pnpm lint`, commit. Any lint error outside §3 files → §8.

### Step 6: report and push

Write `docs/tasks/0009-report.md` (§9), set `Status: review` in this brief, commit `0009 step 6`, then `git push -u origin task/0009-signed-webhooks 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## 5. Do not touch

- `packages/platform/src/logger/**`, `packages/platform/test/logger*.test.ts`, `packages/platform/test/smoke.test.ts`, `packages/platform/package.json`, `packages/platform/tsconfig.json`, `packages/platform/vitest.config.ts` (brief 0008 or 0002 own them).
- Every other app or package, every root file, `pnpm-lock.yaml`, `.github/**`, `docs/**` except this brief's Status line and `docs/tasks/0009-report.md`.
- No new dependency (hard rule 7): `node:crypto` only. No user-facing strings (hard rule 6 does not apply: none here). Never log a secret, a body or a signature (hard rule 4). Never push to `main` (hard rule 8).

## 6. Commands

Test-map row "A package with no row" for `packages/platform`, plus typecheck and lint:

```
pnpm --filter @shoebox/platform test -- webhooks 2>&1 | tail -30     # 1 file, 18 tests passed
pnpm --filter @shoebox/platform test -- smoke 2>&1 | tail -30        # still 1 test passed
pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30            # exit 0, no output lines with "error"
pnpm lint 2>&1 | tail -30                                            # exit 0
```

## 7. Acceptance

- [ ] `packages/platform/test/webhooks.test.ts` (ticket: `webhook.test.ts`, renamed for brief 0008) passes: rejects missing header, timestamp 301 s old, tampered body, wrong secret; accepts the second secret; property `verify(sign(x)) = ok` over 500 seeded cases.
- [ ] `import { signWebhook, verifyWebhook } from '@shoebox/platform'` typechecks (the `src/index.ts` re-export is in place).
- [ ] `pnpm --filter @shoebox/platform typecheck` and `pnpm lint` exit 0; `git diff --stat origin/phase/0` lists only §3 paths.
- [ ] Not in this brief (later tickets): the 1 MB body check and the `(org_id, message_id)` replay guard live in the receiving route / `inbound_emails` (P0 email-worker and DB tickets); the 7-day rotation window is an operational rule for the owner (two secrets in config), not code here.

## 8. Stop and ask

Stop, and write the report, if:

- the Step 3 anchor is not found verbatim (brief 0008 may have landed first: if the file now has an extra `export * from './logger/index';` line, that is fine, add yours after the `packageName` line anyway; anything else → stop);
- a test fails twice, or a test in this brief seems wrong (never edit the test file);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a new dependency seems needed (for example typecheck cannot resolve `node:crypto` or `Buffer`: report it, do not add `@types/node` yourself);
- a file outside §3 needs a change, or §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0009-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each §6 command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations (name the `src/webhooks/` + `test/webhooks.test.ts` relocation), and `[verify]` findings (none expected).
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

Auth code: read the whole diff of `packages/platform/src/webhooks/webhook.ts` against the source in Step 1 (must be verbatim). Check in particular: `timingSafeEqual` is the only comparison of signatures (no `===` on hex strings), both buffers are 32 bytes, the expiry uses `Math.abs` and `>` 300 (so 300 passes, 301 fails), all (secret × signature) pairs are evaluated, `secrets` empty throws, unknown header keys are `malformed`. Confirm the test file is byte-identical to Step 4 (`git diff` shows no edits after `0009 step 4`).

## Owner steps

1. None during this brief. When the Email Worker ticket lands you will create two secrets (`WEBHOOK_SECRET`, `WEBHOOK_SECRET_PREVIOUS`) in the hosting console; that ticket's brief gives the click-by-click steps. Rotation: set the new value in `WEBHOOK_SECRET`, move the old one to `WEBHOOK_SECRET_PREVIOUS`, deploy, and clear `WEBHOOK_SECRET_PREVIOUS` after 7 days.
