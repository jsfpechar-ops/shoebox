import { AUTH_COOKIE_OPTIONS, IDLE_TIMEOUT_MS, LAST_SEEN_COOKIE } from './session';

/** The minimum cookie-store surface this needs (Next's `cookies()` store and `NextResponse.cookies` both fit). */
export interface CookieSetter {
  set(
    name: string,
    value: string,
    options: { path: string; httpOnly: boolean; secure: boolean; sameSite: 'lax'; maxAge: number },
  ): unknown;
}

/** Starts or refreshes the idle clock (M12 §4.4: 12 h). Not a server action on purpose: only our code calls it. */
export function touchLastSeen(store: CookieSetter, now: number = Date.now()): void {
  store.set(LAST_SEEN_COOKIE, String(now), {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: Math.floor(IDLE_TIMEOUT_MS / 1000),
  });
}
