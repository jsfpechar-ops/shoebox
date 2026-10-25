# 0031a: Security headers: per-request nonce CSP, HSTS and the M12 header set

Status: todo
Ticket: P0-AUTH-03 (part a of 2) | Depends on: 0023d merged into phase/0 | Base commit: head of phase/0 | Branch: task/0031a-security-headers | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (security). Every file is given in full; the tests are the spec.

## 1. Objective

Every page and API response of `apps/web` gets a Content-Security-Policy with a fresh nonce, HSTS and the M12 §4.5 header set from a Next.js middleware, and a Playwright spec proves the shell flow runs with zero CSP violations. Users' sessions and documents are then protected against injected scripts, clickjacking and cached pages on shared machines before any authenticated screen exists.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0031a step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. Test filter: `pnpm --filter @shoebox/web test <name>` (no `--`). Browsers: Chromium is preinstalled at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` is set). **Never run `playwright install`.** WebKit is not installed here: run `--project desktop-chromium --project mobile-chromium` only; `mobile-webkit` runs in CI.

**Already in phase/0 (0023a–d, do not change):** the Next.js 15.5.27 app with the shell (`/inbox`, `/prehled`, `/ucetni`, `/nastaveni`), the theme switch (select "Vzhled", cookie `theme`), the `/` → `/inbox` redirect, `playwright.config.ts` (projects `desktop-chromium`, `mobile-webkit`, `mobile-chromium`, web server on port 3100), `apps/web/e2e/fixtures.ts` (`test` with the auto axe fixture, `expect`, `axeViolations`) and `apps/web/e2e/shell.spec.ts`. If `apps/web/e2e/fixtures.ts` is missing: STOP (0023d not merged). There is no `apps/web/middleware.ts` yet.

**Spec M12 §4.5 "CSP and headers" (pasted):** Next.js middleware, per-request nonce:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'nonce-{n}';
  img-src 'self' data: blob: https://{supabase-ref}.supabase.co; connect-src 'self' https://{supabase-ref}.supabase.co
  wss://{supabase-ref}.supabase.co https://{sentry-ingest-eu}; worker-src 'self' blob:; frame-src 'none'; object-src 'none';
  base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Referrer-Policy: strict-origin-when-cross-origin · X-Content-Type-Options: nosniff · Permissions-Policy: camera=(self), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```
CSP violations report to Sentry (`report-to`). **M12 §4.5 V8.1–8.3:** `Cache-Control: no-store` on authenticated pages and file responses. **V9.1:** HSTS `max-age=63072000; includeSubDomains; preload`. **M12 §9 AC-8:** response headers on `/inbox` include the CSP with a nonce, HSTS, `frame-ancestors 'none'`; Playwright asserts no CSP violations during the E2E flow. **M12 §4.13:** nothing secret in `NEXT_PUBLIC_*`; `.env.example` lists names only.

**Rules:** 4 (no secrets, no document content in logs), 6 (strings through i18n: no user-facing strings in this brief), 7 (no new dependency: this brief adds none).

**Choices made by the brief writer (verified in a scratch copy with Playwright 1.56.1 + Chromium; do not change):**
- Pure header logic lives in `apps/web/src/security/headers.ts` (no Node API, so it runs in the Edge middleware and in Vitest); `middleware.ts` only wires it. The CSP is set on the **request** headers as well: Next.js reads the nonce from there and puts it on its own inline scripts, which `'strict-dynamic'` then trusts. Verified: every inline script in the production HTML carries the nonce and the shell flow runs with 0 violations.
- `sonner` (toasts, part of `@shoebox/ui`) injects its CSS as an inline `<style>` at module load, first empty and then filled. No nonce can reach it, so `style-src` allows two hashes: the sha256 of sonner's CSS and the sha256 of the empty string (Chromium checks the empty element first and reports a violation without it; verified with a Playwright probe). `test/csp-sonner.test.ts` recomputes the sonner hash from the real package in happy-dom, so an upgrade of sonner fails that test with an instruction instead of silently breaking the app.
- Supabase and Sentry origins come from `SUPABASE_URL` and `SENTRY_DSN` at runtime (`originOf` keeps only an http(s) origin, so a bad value cannot widen the policy); without them the CSP stays local. `report-uri`/`report-to` and `Reporting-Endpoints` appear only when `CSP_REPORT_URI` is set (Sentry security endpoint, P0-PLAT-02 owner step).
- HSTS is sent always (browsers ignore it over plain http, so local runs are unaffected). `upgrade-insecure-requests` is sent always too; Chromium does not upgrade localhost (verified: the shell flow on `http://localhost:3100` passes).
- The matcher excludes `_next/static`, `_next/image` and `favicon.ico`: build assets are content-hashed and must stay cacheable; everything else (pages, API routes, 404) gets `Cache-Control: no-store`.
- A constraint for every later UI brief: no `style="…"` attributes in server-rendered HTML and no inline `<script>` without the nonce; the E2E test "no CSP violation during the shell flow" fails otherwise.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/security/headers.ts` | new | `createNonce`, `originOf`, `buildCsp`, `securityHeaders`, constants |
| `apps/web/test/headers.test.ts` | new | unit tests for headers.ts |
| `apps/web/test/csp-sonner.test.ts` | new | the sonner style hash matches the installed package |
| `apps/web/middleware.ts` | new | sets the nonce, the CSP and the header set on every request |
| `apps/web/e2e/headers.spec.ts` | new | AC-8: headers on `/inbox`, nonce freshness, 0 CSP violations, headers on every screen |
| `.env.example` | edit | `CSP_REPORT_URI=` name |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 67–172
Step 2 code: lines 180–330
Step 3 code: lines 338–357
Step 4 code: lines 365–394
Step 5 code: lines 402–403
Step 6 code: lines 418–518

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0031a-security-headers origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/e2e && ls /opt/pw-browsers`. Expected: `fixtures.ts  shell.spec.ts` and `chromium-1194` among the folders. Otherwise STOP.

**Step 1: `apps/web/src/security/headers.ts` (new).** Exported names exactly as below.

```ts
/**
 * Security headers (M12 §4.5 "CSP and headers", V8.1–8.3, V9.1, V14.4). Pure: no Node API, so it runs
 * in the Edge middleware, on the server and in unit tests. The nonce is per request (middleware.ts).
 */

/** Request header that carries the nonce to server components (`headers().get(NONCE_HEADER)`). */
export const NONCE_HEADER = 'x-nonce';

/** M12 §4.5 V9.1. Browsers ignore HSTS over plain http, so it is safe to send always. */
export const HSTS = 'max-age=63072000; includeSubDomains; preload';

/**
 * sonner 2.0.8 (toasts, via @shoebox/ui) injects its CSS as an inline <style> when its module loads, which
 * no nonce can reach, so its hash is allowed. `test/csp-sonner.test.ts` recomputes it: a sonner upgrade
 * changes the CSS, fails that test, and this constant is updated in the same PR.
 */
export const SONNER_STYLE_HASH = 'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=';

/**
 * sha256 of the empty string. sonner appends its <style> empty and fills it afterwards; Chromium checks
 * the empty element first and reports a violation without this hash (verified with Playwright). An
 * empty style can do nothing, so allowing it costs no security.
 */
export const EMPTY_STYLE_HASH = 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

export interface SecurityHeaderInput {
  /** Base64 nonce from `createNonce()`. */
  nonce: string;
  /** `SUPABASE_URL`: allows the Supabase origin for images, fetch and websockets. */
  supabaseUrl?: string;
  /** `SENTRY_DSN`: allows the Sentry ingest origin for `connect-src`. */
  sentryDsn?: string;
  /** `CSP_REPORT_URI`: CSP violation reports go here (Sentry security endpoint, P0-PLAT-02). */
  cspReportUri?: string;
}

/** 128 random bits, base64 (CSP nonce grammar: base64 string). Web Crypto only, so it works in Edge. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The origin (`https://host`) of an http(s) URL; undefined for anything else, so a bad env var cannot widen the CSP. */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/** `https://x` → `wss://x`, `http://x` → `ws://x` (Supabase Realtime). */
function websocketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

/** Content-Security-Policy per M12 §4.5, one directive per entry. */
export function buildCsp(input: SecurityHeaderInput): string {
  const supabase = originOf(input.supabaseUrl);
  const sentry = originOf(input.sentryDsn);
  const img = ["'self'", 'data:', 'blob:'];
  const connect = ["'self'"];
  if (supabase) {
    img.push(supabase);
    connect.push(supabase, websocketOrigin(supabase));
  }
  if (sentry) connect.push(sentry);

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${input.nonce}' '${SONNER_STYLE_HASH}' '${EMPTY_STYLE_HASH}'`,
    `img-src ${img.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ];
  if (input.cspReportUri) directives.push(`report-uri ${input.cspReportUri}`, 'report-to csp');
  return directives.join('; ');
}

/** Every response header of M12 §4.5 for one request. `Cache-Control: no-store` covers V8.3 (authenticated pages). */
export function securityHeaders(input: SecurityHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildCsp(input),
    'Strict-Transport-Security': HSTS,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  if (input.cspReportUri) headers['Reporting-Endpoints'] = `csp="${input.cspReportUri}"`;
  return headers;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 2: `apps/web/test/headers.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  createNonce,
  EMPTY_STYLE_HASH,
  HSTS,
  NONCE_HEADER,
  originOf,
  SONNER_STYLE_HASH,
  securityHeaders,
} from '../src/security/headers';

const nonce = 'dGVzdC1ub25jZS0xMjM0NTY3OA==';

describe('createNonce (M12 §4.5 per-request nonce)', () => {
  it('is base64 of 16 bytes and differs per call', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
    expect(NONCE_HEADER).toBe('x-nonce');
  });
});

describe('originOf', () => {
  it('keeps only the origin of an http(s) URL', () => {
    expect(originOf('https://abcd.supabase.co/auth/v1?x=1')).toBe('https://abcd.supabase.co');
    expect(originOf('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(originOf('https://key@o123.ingest.de.sentry.io/456')).toBe(
      'https://o123.ingest.de.sentry.io',
    );
  });

  it('rejects anything that is not an http(s) URL, so a bad env var cannot widen the policy', () => {
    expect(originOf(undefined)).toBeUndefined();
    expect(originOf('')).toBeUndefined();
    expect(originOf('not a url')).toBeUndefined();
    expect(originOf('javascript:alert(1)')).toBeUndefined();
    expect(originOf('file:///etc/passwd')).toBeUndefined();
  });
});

describe('buildCsp (M12 §4.5 directive list)', () => {
  it('carries the nonce in script-src and style-src, with strict-dynamic', () => {
    const csp = buildCsp({ nonce });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain(
      `style-src 'self' 'nonce-${nonce}' '${SONNER_STYLE_HASH}' '${EMPTY_STYLE_HASH}'`,
    );
    expect(EMPTY_STYLE_HASH).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(SONNER_STYLE_HASH).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('has every directive of M12 §4.5, in order', () => {
    const names = buildCsp({ nonce })
      .split('; ')
      .map((directive) => directive.split(' ')[0]);
    expect(names).toEqual([
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'connect-src',
      'worker-src',
      'frame-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'upgrade-insecure-requests',
    ]);
  });

  it('locks down frames, objects, base and forms', () => {
    const csp = buildCsp({ nonce });
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it('without Supabase and Sentry, img-src and connect-src stay local', () => {
    const csp = buildCsp({ nonce });
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("connect-src 'self';");
  });

  it('adds the Supabase origin (https + wss) and the Sentry ingest origin', () => {
    const csp = buildCsp({
      nonce,
      supabaseUrl: 'https://abcd.supabase.co',
      sentryDsn: 'https://key@o123.ingest.de.sentry.io/456',
    });
    expect(csp).toContain("img-src 'self' data: blob: https://abcd.supabase.co;");
    expect(csp).toContain(
      "connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co https://o123.ingest.de.sentry.io;",
    );
    expect(csp).not.toContain('key@');
  });

  it('local Supabase (http) gets ws://', () => {
    expect(buildCsp({ nonce, supabaseUrl: 'http://127.0.0.1:54321' })).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321;",
    );
  });

  it('reports violations only when a report URI is configured', () => {
    expect(buildCsp({ nonce })).not.toContain('report-');
    const csp = buildCsp({
      nonce,
      cspReportUri: 'https://o123.ingest.de.sentry.io/api/456/security/',
    });
    expect(csp).toContain('report-uri https://o123.ingest.de.sentry.io/api/456/security/');
    expect(csp).toContain('report-to csp');
  });
});

describe('securityHeaders (M12 §4.5 header set)', () => {
  it('sets every header of the M12 list plus Cache-Control: no-store', () => {
    const headers = securityHeaders({ nonce });
    expect(Object.keys(headers)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cache-Control',
    ]);
    expect(headers['Strict-Transport-Security']).toBe(HSTS);
    expect(HSTS).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Permissions-Policy']).toBe('camera=(self), microphone=(), geolocation=()');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Security-Policy']).toBe(buildCsp({ nonce }));
  });

  it('adds Reporting-Endpoints only with a report URI', () => {
    const uri = 'https://o123.ingest.de.sentry.io/api/456/security/';
    expect(securityHeaders({ nonce, cspReportUri: uri })['Reporting-Endpoints']).toBe(
      `csp="${uri}"`,
    );
    expect(securityHeaders({ nonce })['Reporting-Endpoints']).toBeUndefined();
  });
});
```

Command: `pnpm --filter @shoebox/web test headers 2>&1 | tail -6`. Expected: `Tests  13 passed`. Commit.

**Step 3: `apps/web/test/csp-sonner.test.ts` (new).** Do not edit the test file. It runs in happy-dom (the `@vitest-environment` pragma; `happy-dom` is a root devDependency).

```ts
// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SONNER_STYLE_HASH } from '../src/security/headers';

describe('CSP hash for the <style> that sonner injects (M12 §4.5)', () => {
  it('SONNER_STYLE_HASH is the sha256 of the CSS sonner injects at module load', async () => {
    // @shoebox/ui re-exports sonner (overlay.tsx); importing it runs sonner's __insertCSS in happy-dom.
    await import('@shoebox/ui');
    const styles = Array.from(document.head.querySelectorAll('style'));
    const sonner = styles.find((style) => style.textContent?.includes('[data-sonner-toaster]'));
    expect(sonner, 'sonner injected no <style>; drop SONNER_STYLE_HASH from the CSP').toBeDefined();
    const hash = `sha256-${createHash('sha256')
      .update(sonner?.textContent ?? '', 'utf8')
      .digest('base64')}`;
    expect(hash, 'sonner CSS changed: update SONNER_STYLE_HASH in src/security/headers.ts').toBe(
      SONNER_STYLE_HASH,
    );
  });
});
```

Command: `pnpm --filter @shoebox/web test csp-sonner 2>&1 | tail -6`. Expected: `Tests  1 passed`. If it fails with "sonner CSS changed": STOP and report the hash the test prints; do not edit the constant yourself. Commit.

**Step 4: `apps/web/middleware.ts` (new).**

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { createNonce, NONCE_HEADER, securityHeaders } from './src/security/headers';

/**
 * M12 §4.5: a fresh nonce per request, the CSP and the header set on every page and API response.
 * The CSP also goes on the *request* headers: Next.js reads the nonce from there and puts it on its
 * own inline scripts (hydration, RSC payload), which `'strict-dynamic'` then trusts.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const headers = securityHeaders({
    nonce,
    supabaseUrl: process.env.SUPABASE_URL,
    sentryDsn: process.env.SENTRY_DSN,
    cspReportUri: process.env.CSP_REPORT_URI,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Pages and API routes. Not the immutable build assets (they are content-hashed and must stay cacheable).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 5: `.env.example` (edit).** Anchor (verbatim, two lines):

```
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

Insert right after them:

```
# CSP violation reports (Sentry security endpoint); empty = no report-uri in the CSP
CSP_REPORT_URI=
```

Command: `grep -n 'CSP_REPORT_URI' .env.example | tail -2`. Expected: one line. Commit.

**Step 6: `apps/web/e2e/headers.spec.ts` (new).** Do not edit the test file.

```ts
import { expect, test } from './fixtures';

/** M12 §4.5 "CSP and headers", §9 AC-8, §4.2 health. Header names are case-insensitive in Playwright. */
const screens = ['/inbox', '/prehled', '/ucetni', '/nastaveni'] as const;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

function nonceOf(csp: string): string {
  const match = /script-src [^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(csp);
  if (match?.[1] === undefined) throw new Error(`no nonce in CSP: ${csp}`);
  return match[1];
}

test('/inbox carries the CSP with a nonce, HSTS and the M12 header set', async ({ page }) => {
  const response = await page.goto('/inbox');
  if (response === null) throw new Error('no response');
  const headers = response.headers();

  const csp = headers['content-security-policy'] ?? '';
  const nonce = nonceOf(csp);
  expect(nonce.length).toBeGreaterThanOrEqual(22);
  expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  expect(csp).toContain(`style-src 'self' 'nonce-${nonce}' 'sha256-`);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).not.toContain('unsafe-inline');

  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('the nonce is fresh per request and every inline script carries it', async ({ page }) => {
  const first = await page.goto('/prehled');
  const second = await page.goto('/prehled');
  if (first === null || second === null) throw new Error('no response');
  const nonce = nonceOf(second.headers()['content-security-policy'] ?? '');
  expect(nonceOf(first.headers()['content-security-policy'] ?? '')).not.toBe(nonce);

  // The DOM hides nonce attributes; the IDL property still reads them.
  const inline = await page.evaluate(() =>
    Array.from(document.scripts)
      .filter((script) => !script.src)
      .map((script) => script.nonce),
  );
  expect(inline.length).toBeGreaterThan(0);
  for (const value of inline) expect(value).toBe(nonce);
});

test('no CSP violation during the shell flow (AC-8)', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) consoleViolations.push(message.text());
  });

  await page.goto('/');
  await expect(page).toHaveURL('/inbox');
  const nav = page.getByRole('navigation', { name: 'Hlavní navigace' });
  for (const path of screens) {
    await nav.locator(`[data-nav-item][href="${path}"]`).click();
    await expect(page).toHaveURL(path);
  }
  const select = page.getByLabel('Vzhled');
  await select.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(select).toHaveValue('dark');
  await select.selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');

  expect(await page.evaluate(() => window.__cspViolations ?? [])).toEqual([]);
  expect(consoleViolations).toEqual([]);
});

test('every screen answers with the header set', async ({ request }) => {
  for (const path of screens) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['strict-transport-security'], path).toContain('max-age=63072000');
    expect(headers['cache-control'], path).toContain('no-store');
  }
});
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 7: run the E2E (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: `32 passed` (24 shell + 8 headers), 0 failed, 0 skipped. The first run builds the app (about 60 s). A failure in `shell.spec.ts` after this change is a CSP regression in the app, not in the test: STOP and report the violation line (it names the directive and the file).

**Step 8: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web .env.example 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -12 && git status --short | tail -5`. Expected: lint without errors, `no dependency violations found`, the route table ends with `ƒ Middleware` (about 35 kB), `git status` lists nothing. Commit if anything changed.

## 5. Do not touch

`apps/web/app/**`, `apps/web/src/shell/**`, `apps/web/e2e/fixtures.ts`, `apps/web/e2e/shell.spec.ts`, `playwright.config.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `packages/**`, `.github/**`. No dependency. Hard rules 4, 6, 7. Never `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/web test headers 2>&1 | tail -30` → 13 passed; `pnpm --filter @shoebox/web test csp-sonner 2>&1 | tail -30` → 1 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 32 passed.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.

## 7. Acceptance

- [ ] `/inbox` answers with `Content-Security-Policy` containing `script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, HSTS `max-age=63072000; includeSubDomains; preload`, `Cache-Control: no-store`, Referrer-Policy, nosniff, Permissions-Policy, COOP (headers.spec test 1).
- [ ] The nonce differs between two requests and every inline script carries it (test 2).
- [ ] The shell flow (`/` → the four screens → theme dark/system with reload) produces 0 `securitypolicyviolation` events and 0 CSP console errors on desktop and mobile Chromium (test 3, AC-8).
- [ ] Every screen answers with the header set (test 4).
- [ ] `headers.test.ts` (13) and `csp-sonner.test.ts` (1) pass; `shell.spec.ts` still passes (24).
- [ ] No new dependency; `.env.example` gains only `CSP_REPORT_URI=`.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0023d is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `csp-sonner.test.ts` reports a changed hash;
- `next build` fails to download Inter from Google (network error): STOP, do not switch font loaders;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency or lockfile change seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0031a-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0031a report" && git push -u origin task/0031a-security-headers 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `headers.ts`: the directive list equals M12 §4.5 plus the two `style-src` hashes (documented); `originOf` only ever returns an http(s) origin; no `unsafe-inline`/`unsafe-eval`.
- `middleware.ts`: the CSP goes on both request and response; the matcher excludes only `_next/static`, `_next/image`, `favicon.ico`.
- `headers.spec.ts` test 3 really fails on a violation (the brief writer saw it fail on sonner's inline style before the hashes were added).
- Not verified locally: `mobile-webkit` (CI).

## Owner steps

1. None now. When P0-PLAT-02 creates the Sentry EU project, copy its "Security Header Endpoint" URL into the `CSP_REPORT_URI` environment variable of `web-staging` and `web` (Cloud Run → service → Edit → Variables). Until then CSP violations are only visible in the browser console.
