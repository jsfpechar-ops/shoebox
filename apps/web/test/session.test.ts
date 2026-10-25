import { describe, expect, it } from 'vitest';
import {
  AUTH_COOKIE_OPTIONS,
  DEFAULT_AFTER_LOGIN,
  IDLE_TIMEOUT_MS,
  isIdle,
  LAST_SEEN_COOKIE,
  LOGIN_PATH,
  loginUrl,
  parseLoginReason,
  safeNextPath,
} from '../src/auth/session';

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe('cookie policy (M12 §4.5 V3.2–3.4)', () => {
  it('auth cookies are HttpOnly, Secure, SameSite=Lax on /', () => {
    expect(AUTH_COOKIE_OPTIONS).toEqual({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    expect(LAST_SEEN_COOKIE).toBe('shoebox_last_seen');
  });
});

describe('isIdle (M12 §4.4: idle logout after 12 h)', () => {
  it('is 12 hours', () => {
    expect(IDLE_TIMEOUT_MS).toBe(12 * HOUR);
  });

  it('idle only when the last request is older than 12 h', () => {
    expect(isIdle(String(NOW - 11 * HOUR), NOW)).toBe(false);
    expect(isIdle(String(NOW - 12 * HOUR), NOW)).toBe(false);
    expect(isIdle(String(NOW - 12 * HOUR - 1), NOW)).toBe(true);
    expect(isIdle(String(NOW - 13 * HOUR), NOW)).toBe(true);
  });

  it('a missing or malformed cookie is not idle (it gets set on this request)', () => {
    expect(isIdle(undefined, NOW)).toBe(false);
    expect(isIdle('', NOW)).toBe(false);
    expect(isIdle('yesterday', NOW)).toBe(false);
    expect(isIdle('-1', NOW)).toBe(false);
    expect(isIdle('1e3', NOW)).toBe(false);
  });
});

describe('safeNextPath (no open redirect, no login loop)', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeNextPath('/prehled')).toBe('/prehled');
    expect(safeNextPath('/doklad/123?tab=a#b')).toBe('/doklad/123?tab=a#b');
    expect(safeNextPath('/')).toBe('/');
  });

  it('falls back to /inbox for anything off-site or malformed', () => {
    expect(DEFAULT_AFTER_LOGIN).toBe('/inbox');
    for (const bad of [
      undefined,
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/x\\y',
      'javascript:alert(1)',
      'inbox',
      '/a b',
      '/a\nb',
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe('/inbox');
    }
  });

  it('never points back at the auth routes', () => {
    expect(safeNextPath('/prihlaseni')).toBe('/inbox');
    expect(safeNextPath('/prihlaseni?next=/x')).toBe('/inbox');
    expect(safeNextPath('/auth/callback?code=1')).toBe('/inbox');
    expect(safeNextPath('/api/health')).toBe('/inbox');
    expect(safeNextPath('/prihlasenix')).toBe('/prihlasenix');
  });
});

describe('loginUrl and reasons', () => {
  it('builds the login URL with an encoded next and a reason', () => {
    expect(LOGIN_PATH).toBe('/prihlaseni');
    expect(loginUrl()).toBe('/prihlaseni');
    expect(loginUrl('/inbox')).toBe('/prihlaseni');
    expect(loginUrl('/prehled?x=1')).toBe('/prihlaseni?next=%2Fprehled%3Fx%3D1');
    expect(loginUrl('/prehled', 'idle')).toBe('/prihlaseni?next=%2Fprehled&reason=idle');
    expect(loginUrl('https://evil.example', 'link')).toBe('/prihlaseni?reason=link');
  });

  it('parses only the known reasons', () => {
    expect(parseLoginReason('idle')).toBe('idle');
    expect(parseLoginReason('link')).toBe('link');
    expect(parseLoginReason('signed_out')).toBe('signed_out');
    expect(parseLoginReason('x')).toBeUndefined();
    expect(parseLoginReason(undefined)).toBeUndefined();
  });
});
