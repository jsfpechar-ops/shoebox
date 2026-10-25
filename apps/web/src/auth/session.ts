/**
 * Session rules (M12 §4.4, §4.5 V3.2–3.4). Pure: no Node, DOM or Supabase import, so it runs in the
 * Edge middleware, in server actions and in unit tests.
 */

/** Supabase auth cookies (`sb-*-auth-token*`) and our own: HttpOnly, Secure, SameSite=Lax (V3.2–3.4). */
export const AUTH_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const;

/** Unix time in ms (decimal string) of the last authenticated request; drives the idle logout. */
export const LAST_SEEN_COOKIE = 'shoebox_last_seen';

/** M12 §4.4: idle logout after 12 h of inactivity in the web app. */
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export const LOGIN_PATH = '/prihlaseni';
export const CALLBACK_PATH = '/auth/callback';
export const DEFAULT_AFTER_LOGIN = '/inbox';

/** The one-time passkey offer after an e-mail-link sign-in (ADR-012, 0044b). Needs a session. */
export const PASSKEY_OFFER_PATH = '/pristupovy-klic';
/** `later` ("Teď ne") or `done` (a passkey was added in this browser). */
export const PASSKEY_OFFER_COOKIE = 'shoebox_passkey_offer';
export const PASSKEY_OFFER_LATER_S = 30 * 24 * 60 * 60;
export const PASSKEY_OFFER_DONE_S = 365 * 24 * 60 * 60;

/** Why the user sees the login page (query `reason`): shown as a notice, never trusted for anything else. */
export const loginReasons = ['idle', 'link', 'signed_out'] as const;
export type LoginReason = (typeof loginReasons)[number];

export function parseLoginReason(value: string | undefined | null): LoginReason | undefined {
  return (loginReasons as readonly string[]).includes(value ?? '')
    ? (value as LoginReason)
    : undefined;
}

/** True when the last authenticated request is older than IDLE_TIMEOUT_MS. No or malformed cookie: not idle (it is set on this request). */
export function isIdle(lastSeen: string | undefined, now: number): boolean {
  if (lastSeen === undefined || !/^\d{1,16}$/.test(lastSeen)) return false;
  return now - Number(lastSeen) > IDLE_TIMEOUT_MS;
}

/**
 * The only redirect target the login flow accepts: a same-origin path. Anything else (absolute URL,
 * protocol-relative `//`, backslashes, the auth routes themselves) becomes DEFAULT_AFTER_LOGIN,
 * so `?next=` can never send a user off-site (open redirect) or into a login loop.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\'))
    return DEFAULT_AFTER_LOGIN;
  if (/[\\\s\p{Cc}]/u.test(raw)) return DEFAULT_AFTER_LOGIN;
  const pathname = raw.split(/[?#]/)[0] ?? '';
  if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`)) return DEFAULT_AFTER_LOGIN;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return DEFAULT_AFTER_LOGIN;
  if (pathname === '/api' || pathname.startsWith('/api/')) return DEFAULT_AFTER_LOGIN;
  return raw;
}

/** `/prihlaseni?next=…&reason=…` (both optional; `next` only when it is not the default). */
export function loginUrl(next?: string, reason?: LoginReason): string {
  const params = new URLSearchParams();
  const target = safeNextPath(next);
  if (target !== DEFAULT_AFTER_LOGIN) params.set('next', target);
  if (reason) params.set('reason', reason);
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}

/** Where the e-mail-link callback sends the user: the passkey offer unless this browser answered it. */
export function afterLinkSignIn(next: string, offerCookie: string | undefined): string {
  const target = safeNextPath(next);
  if (offerCookie === 'later' || offerCookie === 'done') return target;
  return target === DEFAULT_AFTER_LOGIN
    ? PASSKEY_OFFER_PATH
    : `${PASSKEY_OFFER_PATH}?next=${encodeURIComponent(target)}`;
}
