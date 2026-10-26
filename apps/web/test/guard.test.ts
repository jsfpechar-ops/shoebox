import { describe, expect, it } from 'vitest';
import { decide, isPublicPath, PUBLIC_PATHS } from '../src/auth/guard';
import { IDLE_TIMEOUT_MS } from '../src/auth/session';

const NOW = 1_800_000_000_000;
const fresh = String(NOW - 60_000);
const stale = String(NOW - IDLE_TIMEOUT_MS - 1);

describe('isPublicPath (deny by default, M12 §4.5 V1.4)', () => {
  it('only the login page, the callback and the health probe are public', () => {
    expect(PUBLIC_PATHS).toEqual([
      '/prihlaseni',
      '/auth/callback',
      '/api/health',
      '/manifest.webmanifest',
      '/icon.svg',
      '/api/inbound-email',
    ]);
    for (const path of ['/prihlaseni', '/auth/callback', '/api/health', '/auth/callback/']) {
      expect(isPublicPath(path), path).toBe(true);
    }
    for (const path of [
      '/',
      '/inbox',
      '/prehled',
      '/ucetni',
      '/nastaveni',
      '/api',
      '/api/v1/x',
      '/prihlasenix',
      '/auth',
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});

describe('decide: no user', () => {
  it('redirects every app page to the login page with next', () => {
    expect(
      decide({ pathname: '/inbox', search: '', hasUser: false, lastSeen: undefined, now: NOW }),
    ).toEqual({
      kind: 'redirect',
      to: '/prihlaseni',
      signOut: false,
    });
    expect(
      decide({
        pathname: '/prehled',
        search: '?tab=x',
        hasUser: false,
        lastSeen: undefined,
        now: NOW,
      }),
    ).toEqual({
      kind: 'redirect',
      to: '/prihlaseni?next=%2Fprehled%3Ftab%3Dx',
      signOut: false,
    });
    expect(
      decide({ pathname: '/', search: '', hasUser: false, lastSeen: undefined, now: NOW }),
    ).toEqual({
      kind: 'redirect',
      to: '/prihlaseni?next=%2F',
      signOut: false,
    });
  });

  it('serves public paths without touching the idle clock', () => {
    for (const pathname of ['/prihlaseni', '/auth/callback', '/api/health']) {
      expect(
        decide({ pathname, search: '?code=1', hasUser: false, lastSeen: undefined, now: NOW }),
      ).toEqual({
        kind: 'next',
        touch: false,
      });
    }
  });
});

describe('decide: user with a fresh session', () => {
  it('serves app pages and refreshes the idle clock', () => {
    expect(
      decide({ pathname: '/inbox', search: '', hasUser: true, lastSeen: fresh, now: NOW }),
    ).toEqual({
      kind: 'next',
      touch: true,
    });
    expect(
      decide({ pathname: '/inbox', search: '', hasUser: true, lastSeen: undefined, now: NOW }),
    ).toEqual({
      kind: 'next',
      touch: true,
    });
  });

  it('sends a signed-in user away from the login page', () => {
    expect(
      decide({ pathname: '/prihlaseni', search: '', hasUser: true, lastSeen: fresh, now: NOW }),
    ).toEqual({
      kind: 'redirect',
      to: '/inbox',
      signOut: false,
    });
  });

  it('still serves the callback and health while signed in', () => {
    expect(
      decide({
        pathname: '/auth/callback',
        search: '?code=1',
        hasUser: true,
        lastSeen: fresh,
        now: NOW,
      }),
    ).toEqual({
      kind: 'next',
      touch: true,
    });
    expect(
      decide({ pathname: '/api/health', search: '', hasUser: true, lastSeen: fresh, now: NOW }),
    ).toEqual({
      kind: 'next',
      touch: true,
    });
  });
});

describe('decide: user idle for more than 12 h (M12 §4.4)', () => {
  it('signs out and returns to the login page with reason=idle and next', () => {
    expect(
      decide({ pathname: '/prehled', search: '', hasUser: true, lastSeen: stale, now: NOW }),
    ).toEqual({
      kind: 'redirect',
      to: '/prihlaseni?next=%2Fprehled&reason=idle',
      signOut: true,
    });
  });

  it('on the login page an idle user is treated as signed out (no loop)', () => {
    expect(
      decide({
        pathname: '/prihlaseni',
        search: '?reason=idle',
        hasUser: true,
        lastSeen: stale,
        now: NOW,
      }),
    ).toEqual({
      kind: 'next',
      touch: false,
    });
  });
});
