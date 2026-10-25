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
