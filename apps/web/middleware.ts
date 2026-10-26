import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { decide } from './src/auth/guard';
import { touchLastSeen } from './src/auth/last-seen';
import { AUTH_COOKIE_OPTIONS, LAST_SEEN_COOKIE } from './src/auth/session';
import { testAutoLogin } from './src/auth/test-autologin';
import { createNonce, NONCE_HEADER, securityHeaders } from './src/security/headers';
import { supabaseEnv } from './src/supabase/env';

/**
 * Every page and API request (matcher below):
 * 1. M12 §4.5: a fresh nonce, the CSP and the header set. The CSP also goes on the *request* headers:
 *    Next.js reads the nonce from there and puts it on its own inline scripts.
 * 2. ADR-012 / M12 §4.4: the Supabase session is refreshed (rotated refresh token lands in the response
 *    cookies), the user is confirmed with the Auth server (`getUser`, never only the JWT), and the pure
 *    `decide()` says: serve, send to the login page, or idle-logout after 12 h.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
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

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, anonKey } = supabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // No Supabase cookie at all: no round trip to the Auth server (also keeps the e2e fast).
  let hasUser = false;
  if (request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'))) {
    try {
      hasUser = (await supabase.auth.getUser()).data.user !== null;
    } catch {
      hasUser = false;
    }
  }

  // Test environment only (owner 2026-10-25): no login screen, sign in as the configured test user,
  // then load the same address again so the page sees the new session cookies.
  const autoLogin = testAutoLogin(process.env);
  if (!hasUser && autoLogin && request.method === 'GET') {
    let signedIn = false;
    try {
      signedIn = (await supabase.auth.signInWithPassword(autoLogin)).error === null;
    } catch {
      signedIn = false;
    }
    if (signedIn) {
      const again = NextResponse.redirect(request.nextUrl, 303);
      for (const cookie of response.cookies.getAll()) again.cookies.set(cookie);
      touchLastSeen(again.cookies);
      for (const [name, value] of Object.entries(headers)) again.headers.set(name, value);
      return again;
    }
  }

  const decision = decide({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasUser,
    lastSeen: request.cookies.get(LAST_SEEN_COOKIE)?.value,
    now: Date.now(),
  });

  let final: NextResponse;
  if (decision.kind === 'redirect') {
    if (decision.signOut) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Cookies are cleared below either way.
      }
    }
    const target = request.nextUrl.clone();
    const [pathname, search = ''] = decision.to.split('?');
    target.pathname = pathname ?? '/';
    target.search = search ? `?${search}` : '';
    final = NextResponse.redirect(target, 303);
    for (const cookie of response.cookies.getAll()) final.cookies.set(cookie);
    if (decision.signOut) final.cookies.delete(LAST_SEEN_COOKIE);
  } else {
    final = response;
    if (decision.touch) touchLastSeen(final.cookies);
  }

  for (const [name, value] of Object.entries(headers)) final.headers.set(name, value);
  return final;
}

export const config = {
  // Pages and API routes. Not the immutable build assets (content-hashed, cacheable) nor the manifest and icon: browsers fetch the manifest without cookies, so it only ever got a 303 to the login page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)'],
};
