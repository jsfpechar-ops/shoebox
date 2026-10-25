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
