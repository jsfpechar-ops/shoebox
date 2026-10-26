import { DEFAULT_AFTER_LOGIN, isIdle, LOGIN_PATH, loginUrl } from './session';

/** Reachable without a session: the login page, the magic-link callback, the health probe, the web app manifest and its icon. Everything else needs a user. */
export const PUBLIC_PATHS = [
  LOGIN_PATH,
  '/auth/callback',
  '/api/health',
  '/manifest.webmanifest',
  '/icon.svg',
  '/api/inbound-email',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export interface GuardInput {
  pathname: string;
  /** Including the leading `?`, or ''. */
  search: string;
  /** Supabase confirmed a user for this request (`getUser()`), not just a cookie. */
  hasUser: boolean;
  /** Raw `shoebox_last_seen` cookie. */
  lastSeen: string | undefined;
  now: number;
}

export type GuardDecision =
  /** Serve the page; `touch` refreshes the idle clock (only for authenticated requests). */
  | { kind: 'next'; touch: boolean }
  /** Redirect; `signOut` also ends the local session first (idle logout, M12 §4.4). */
  | { kind: 'redirect'; to: string; signOut: boolean };

/** Pure decision for the middleware (M12 §4.4 sessions, §4.5 V1.4 deny by default). */
export function decide(input: GuardInput): GuardDecision {
  const idle = input.hasUser && isIdle(input.lastSeen, input.now);
  const target = `${input.pathname}${input.search}`;

  if (isPublicPath(input.pathname)) {
    if (input.pathname === LOGIN_PATH && input.hasUser && !idle) {
      return { kind: 'redirect', to: DEFAULT_AFTER_LOGIN, signOut: false };
    }
    return { kind: 'next', touch: input.hasUser && !idle };
  }
  if (!input.hasUser) return { kind: 'redirect', to: loginUrl(target), signOut: false };
  if (idle) return { kind: 'redirect', to: loginUrl(target, 'idle'), signOut: true };
  return { kind: 'next', touch: true };
}
