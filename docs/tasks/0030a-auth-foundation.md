# 0030a: Auth foundation: Supabase SSR client, session rules, input schemas, copy

Status: review
Ticket: P0-AUTH-01 (part a of 4) | Depends on: 0023d merged into phase/0 (independent of 0031a/b) | Base commit: head of phase/0 | Branch: task/0030a-auth-foundation | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full; the tests are the spec.

## 1. Objective

Add the three approved auth dependencies, the Czech and English copy of the login flow, and the pure building blocks every later auth brief uses: cookie policy and idle rule (`session.ts`), zod input schemas and the error mapping (`schemas.ts`), the idle-clock cookie writer (`last-seen.ts`), the env readers and the server-side Supabase client (`src/supabase/`). Nothing is wired into a page yet, so this merge changes no behavior; it makes 0030b–d small and exact.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0030a step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. Test filter: `pnpm --filter @shoebox/web test <name>` (no `--`).

**Already in phase/0 (do not change):** `apps/web` with the shell (0023a–d), `packages/i18n` (`t`, `MessageKey`; the catalog test requires every cs key in en and keys shaped `<area>.<object>.<element>`), `packages/ui` (`Button`, `Input`, tokens). If `apps/web/e2e/fixtures.ts` is missing: STOP.

**Spec ADR-012 (pasted):** Supabase Auth (e-mail magic link + password, Google, Apple), TOTP MFA later. **M12 §4.4 (pasted):** Session: access token 1 h, refresh rotation on, idle logout after 12 h of inactivity in the web app. **M12 §4.5 (pasted):** V2.1–2.2 password min 12 chars + HIBP check [verify Supabase setting]; V2.5 recovery = magic link only; V3.2–3.4 HttpOnly, Secure, SameSite=Lax cookies (`@supabase/ssr`), rotation on refresh, logout everywhere; V5.1 zod on every server action. **M12 §4.13 (pasted):** `SUPABASE_ANON_KEY`, `SUPABASE_URL` are build-time public env; nothing secret in `NEXT_PUBLIC_*`. **M11 §7 (pasted):** Session expired → "Z bezpečnostních důvodů jsme vás odhlásili."; errors never show stack traces, SQL or provider names. **M11 §12:** keys `<area>.<screen|object>.<element>`, ICU params `{email}`.

**Dependencies (decisions.md 2026-10-18 "zod, @supabase/ssr + Supabase CLI"):** `@supabase/ssr` 0.12.7 (2026-09-08), `zod` 4.6.5 (2026-09-13) and `@supabase/supabase-js` 2.117.2 (2026-09-25), the required peer dependency of `@supabase/ssr` (`peerDependencies: { "@supabase/supabase-js": "^2.114.0" }`, not installed automatically: `.npmrc` has `auto-install-peers=false`). The orchestrator asks the owner to confirm `@supabase/supabase-js` as part of the `@supabase/ssr` approval; this brief proceeds on that default. All three are more than 14 days old (M12 V10.3 `minimumReleaseAge`).

**Rules:** 4 (no secrets committed; env names only in `.env.example`, which 0030d edits), 6 (every string through `packages/i18n`), 7 (only the three dependencies above).

**Choices made by the brief writer (verified in a scratch copy: tests, tsc, Biome, `next build`; do not change):**
- Only server-side Supabase clients exist (server actions, route handlers, middleware). So the auth cookies can be `httpOnly: true` (the library default is `false` for its browser client); `AUTH_COOKIE_OPTIONS` overrides it and adds `secure: true`, `sameSite: 'lax'`. `secure` is always on: Chromium and Firefox accept Secure cookies on `http://localhost` (the e2e runs there); Safari over plain http does not, which only affects local development in Safari.
- Idle logout is app-side: the HttpOnly cookie `shoebox_last_seen` (unix ms) is refreshed on every authenticated request by the middleware (0030d); `isIdle` says when 12 h passed. A missing cookie is not idle (it is set on that request); the Supabase refresh-token lifetime still bounds a session.
- `safeNextPath` is the only way a `?next=` value becomes a redirect target: same-origin path only, never the auth routes, no `//`, no backslash, no control characters (open-redirect guard).
- Error codes shown to the user are a closed set (`AuthErrorCode`); `mapAuthError` turns Supabase codes into them and anything unknown (including a network failure) into `unknown`. No provider text ever reaches the page (M11 §7).
- `APP_URL` is the public origin for magic-link return addresses and redirects (never the Host header, which a client controls). Default `http://localhost:3000` for `pnpm dev`.
- `.env.example` and `supabase/config.toml` are edited in 0030d together with the middleware, so this brief touches no config.
- Files live under `apps/web/src/` (the convention since 0023a; `tsconfig.json` includes `src`, not `lib`), not `apps/web/lib/` as the backlog line says.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/package.json` + `pnpm-lock.yaml` | edit (by `pnpm add`) | `@supabase/ssr`, `@supabase/supabase-js`, `zod` |
| `packages/i18n/messages/cs.json` | edit | 19 `auth.*` keys |
| `packages/i18n/messages/en.json` | edit | the same keys in English |
| `apps/web/src/auth/session.ts` | new | cookie policy, idle rule, `safeNextPath`, `loginUrl`, reasons |
| `apps/web/test/session.test.ts` | new | tests for session.ts |
| `apps/web/src/auth/schemas.ts` | new | zod schemas, `AuthActionState`, `mapAuthError` |
| `apps/web/test/schemas.test.ts` | new | tests for schemas.ts |
| `apps/web/src/auth/last-seen.ts` | new | `touchLastSeen(store)` |
| `apps/web/src/supabase/env.ts` | new | `supabaseEnv()`, `appOrigin()` |
| `apps/web/src/supabase/server.ts` | new | `createSupabaseServerClient()` |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 2 code: lines 70–88
Step 3 code: lines 96–114
Step 4 code: lines 122–186
Step 5 code: lines 194–296
Step 6 code: lines 304–364
Step 7 code: lines 372–434
Step 8 code: lines 442–459
Step 9 code: lines 467–480
Step 10 code: lines 488–516

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0030a-auth-foundation origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/e2e/fixtures.ts`. Expected: the path listed. Otherwise STOP.

**Step 1: `apps/web/package.json` (edit by pnpm).** Command: `pnpm --filter @shoebox/web add --save-exact @supabase/ssr@0.12.7 @supabase/supabase-js@2.117.2 zod@4.6.5 2>&1 | tail -4 && grep -n 'supabase\|zod' apps/web/package.json`. Expected: `Done in …`, no `ERR_PNPM`, and three lines `"@supabase/ssr": "0.12.7"`, `"@supabase/supabase-js": "2.117.2"`, `"zod": "4.6.5"` under `dependencies`. Commit (includes `pnpm-lock.yaml`).

**Step 2: `packages/i18n/messages/cs.json` (edit).** Anchor (verbatim): `  "shell.theme.dark": "Tmavý",`. Insert right after it:

```json
  "auth.login.title": "Přihlášení",
  "auth.field.email": "E-mail",
  "auth.field.password": "Heslo",
  "auth.magic.title": "Přihlášení odkazem",
  "auth.magic.cta": "Poslat přihlašovací odkaz",
  "auth.magic.sent": "Odkaz jsme poslali na {email}. Platí hodinu.",
  "auth.password.title": "Přihlášení heslem",
  "auth.password.cta": "Přihlásit se heslem",
  "auth.password.hint": "Heslo má aspoň {min} znaků.",
  "auth.error.invalid_email": "Zadejte platný e-mail.",
  "auth.error.invalid_password": "Heslo má aspoň 12 znaků.",
  "auth.error.invalid_credentials": "E-mail nebo heslo nesedí.",
  "auth.error.rate_limited": "Zkuste to prosím za chvíli.",
  "auth.error.link": "Odkaz už neplatí. Pošlete si nový.",
  "auth.error.unknown": "Něco se pokazilo na naší straně. Zkuste to prosím znovu.",
  "auth.notice.idle": "Z bezpečnostních důvodů jsme vás odhlásili.",
  "auth.notice.signed_out": "Jste odhlášeni.",
  "auth.logout.cta": "Odhlásit",
  "auth.logout.everywhere": "Odhlásit všude",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`. Expected: fails only on "en has every cs key" (en follows). Commit.

**Step 3: `packages/i18n/messages/en.json` (edit).** Anchor (verbatim): `  "shell.theme.dark": "Dark",`. Insert right after it:

```json
  "auth.login.title": "Sign in",
  "auth.field.email": "E-mail",
  "auth.field.password": "Password",
  "auth.magic.title": "Sign in with a link",
  "auth.magic.cta": "Send sign-in link",
  "auth.magic.sent": "We sent a link to {email}. It is valid for an hour.",
  "auth.password.title": "Sign in with a password",
  "auth.password.cta": "Sign in with password",
  "auth.password.hint": "The password has at least {min} characters.",
  "auth.error.invalid_email": "Enter a valid e-mail.",
  "auth.error.invalid_password": "The password has at least 12 characters.",
  "auth.error.invalid_credentials": "E-mail or password does not match.",
  "auth.error.rate_limited": "Please try again in a moment.",
  "auth.error.link": "The link is no longer valid. Send yourself a new one.",
  "auth.error.unknown": "Something went wrong on our side. Please try again.",
  "auth.notice.idle": "For security reasons we signed you out.",
  "auth.notice.signed_out": "You are signed out.",
  "auth.logout.cta": "Sign out",
  "auth.logout.everywhere": "Sign out everywhere",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`. Expected: all pass. Commit.

**Step 4: `apps/web/src/auth/session.ts` (new).** Exported names exactly as below.

```ts
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 5: `apps/web/test/session.test.ts` (new).** Do not edit the test file.

```ts
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
```

Command: `pnpm --filter @shoebox/web test session 2>&1 | tail -6`. Expected: `Tests  9 passed`. Commit.

**Step 6: `apps/web/src/auth/schemas.ts` (new).** Exported names exactly as below.

```ts
import { z } from 'zod';

/** M12 §4.5 V2.1: password min 12 chars (+ leaked-password check, a Supabase setting; owner step). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Trimmed, lower-cased, RFC-shaped, ≤ 254 chars. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const magicLinkSchema = z.object({ email: emailSchema });

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

/** What the login form can show; each maps to an i18n key `auth.error.<code>`. */
export type AuthErrorCode =
  | 'invalid_email'
  | 'invalid_password'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'link'
  | 'unknown';

/** State of the two login forms (React `useActionState`). */
export type AuthActionState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; code: AuthErrorCode };

/** The subset of a Supabase AuthError the mapping needs. Never exposes the provider message. */
export interface AuthErrorLike {
  code?: string | null | undefined;
  status?: number | null | undefined;
}

/** Maps a Supabase Auth error to a user-facing code (M11 §7: errors never show provider names or details). */
export function mapAuthError(error: AuthErrorLike | null | undefined): AuthErrorCode {
  if (!error) return 'unknown';
  const code = error.code ?? '';
  if (error.status === 429 || code.startsWith('over_') || code.endsWith('_rate_limit')) {
    return 'rate_limited';
  }
  if (code === 'invalid_credentials' || code === 'email_not_confirmed' || code === 'user_banned') {
    return 'invalid_credentials';
  }
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'invalid_email';
  if (code === 'weak_password') return 'invalid_password';
  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    code === 'bad_code_verifier' ||
    code === 'flow_state_not_found' ||
    code === 'flow_state_expired' ||
    code === 'validation_failed_pkce'
  ) {
    return 'link';
  }
  return 'unknown';
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 7: `apps/web/test/schemas.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  magicLinkSchema,
  mapAuthError,
  PASSWORD_MIN_LENGTH,
  passwordLoginSchema,
} from '../src/auth/schemas';

describe('login input (M12 §4.5 V5.1: zod on every server action)', () => {
  it('normalizes e-mail: trim, lower-case', () => {
    expect(emailSchema.parse('  Josef@Example.CZ ')).toBe('josef@example.cz');
  });

  it('rejects malformed e-mail', () => {
    for (const bad of [
      '',
      'josef',
      'josef@',
      '@example.cz',
      'a b@example.cz',
      `${'a'.repeat(250)}@x.cz`,
    ]) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('magic link needs only an e-mail', () => {
    expect(magicLinkSchema.parse({ email: 'a@b.cz' })).toEqual({ email: 'a@b.cz' });
    expect(magicLinkSchema.safeParse({}).success).toBe(false);
  });

  it('password login needs 12 to 128 characters (M12 V2.1)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    const ok = { email: 'a@b.cz', password: 'x'.repeat(12) };
    expect(passwordLoginSchema.parse(ok)).toEqual(ok);
    expect(passwordLoginSchema.safeParse({ ...ok, password: 'x'.repeat(11) }).success).toBe(false);
    expect(passwordLoginSchema.safeParse({ ...ok, password: 'x'.repeat(129) }).success).toBe(false);
    expect(passwordLoginSchema.safeParse({ ...ok, password: undefined }).success).toBe(false);
  });
});

describe('mapAuthError (M11 §7: no provider details reach the user)', () => {
  it('maps Supabase codes to the form codes', () => {
    expect(mapAuthError({ code: 'invalid_credentials', status: 400 })).toBe('invalid_credentials');
    expect(mapAuthError({ code: 'email_not_confirmed' })).toBe('invalid_credentials');
    expect(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' })).toBe('rate_limited');
    expect(mapAuthError({ status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'validation_failed' })).toBe('invalid_email');
    expect(mapAuthError({ code: 'weak_password' })).toBe('invalid_password');
    expect(mapAuthError({ code: 'otp_expired' })).toBe('link');
    expect(mapAuthError({ code: 'bad_code_verifier' })).toBe('link');
    expect(mapAuthError({ code: 'flow_state_not_found' })).toBe('link');
  });

  it('everything else, including network failures, is unknown', () => {
    expect(mapAuthError(null)).toBe('unknown');
    expect(mapAuthError(undefined)).toBe('unknown');
    expect(mapAuthError({})).toBe('unknown');
    expect(mapAuthError({ code: 'unexpected_failure', status: 500 })).toBe('unknown');
  });
});
```

Command: `pnpm --filter @shoebox/web test schemas 2>&1 | tail -6`. Expected: `Tests  6 passed`. Commit.

**Step 8: `apps/web/src/auth/last-seen.ts` (new).**

```ts
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 9: `apps/web/src/supabase/env.ts` (new).**

```ts
/** Env readers shared by the Edge middleware and the Node server code. No Next or Node API. */

/** `SUPABASE_URL` + `SUPABASE_ANON_KEY` (M12 §4.13: public, build-time env). Throws early when missing. */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  return { url, anonKey };
}

/** `APP_URL`: the public origin used in e-mail links and redirects (never the Host header). */
export function appOrigin(): string {
  return new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 10: `apps/web/src/supabase/server.ts` (new).**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_OPTIONS } from '../auth/session';
import { supabaseEnv } from './env';

export { appOrigin, supabaseEnv } from './env';

/**
 * Supabase client for server actions, route handlers and server components (ADR-012, @supabase/ssr).
 * Session cookies are HttpOnly + Secure + Lax (AUTH_COOKIE_OPTIONS overrides the library default
 * `httpOnly: false`; no browser client exists, so nothing needs to read them from JavaScript).
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; the middleware refreshes the session instead.
        }
      },
    },
  });
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 11: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web packages/i18n 2>&1 | tail -3 && pnpm --filter @shoebox/web test 2>&1 | tail -4 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -6 && git status --short | tail -5`. Expected: web tests all pass (the count grew by 15), lint without errors, `no dependency violations found`, `✓ Compiled successfully` (routes unchanged), `git status` lists nothing. Commit if anything changed.

## 5. Do not touch

`apps/web/app/**`, `apps/web/middleware.ts`, `apps/web/e2e/**`, `playwright.config.ts`, `.env.example`, `supabase/config.toml`, `packages/ui/**`, every i18n key not listed in steps 2–3. No dependency beyond step 1. Hard rules 4, 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/web test session 2>&1 | tail -30` → 9 passed; `… test schemas …` → 6 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.

## 7. Acceptance

- [ ] `AUTH_COOKIE_OPTIONS` = `{ path: '/', httpOnly: true, secure: true, sameSite: 'lax' }`; `IDLE_TIMEOUT_MS` = 12 h; `isIdle` true only after 12 h (session.test.ts).
- [ ] `safeNextPath` rejects absolute URLs, `//`, backslashes, control characters, the auth routes; keeps same-origin paths with query (session.test.ts).
- [ ] Password schema: 12–128 chars; e-mail trimmed and lower-cased; `mapAuthError` closed set (schemas.test.ts).
- [ ] 19 keys in cs and en; i18n catalog test passes.
- [ ] Only the three dependencies of step 1 were added (`git diff origin/phase/0 -- apps/web/package.json`).
- [ ] `next build` still lists only the 0023 routes (nothing is wired yet).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0023d is not in phase/0;
- `pnpm add` reports `ERR_PNPM_*` (peer or release-age problem): quote the message, do not change versions;
- a test fails twice, or a test this brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency beyond step 1 seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0030a-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions; the `[verify]` below. Then `git add -A && git commit -qm "0030a report" && git push -u origin task/0030a-auth-foundation 2>&1 | tail -3`. The orchestrator opens and merges the PR.

**[verify] (record in the report, M12 V2.1):** open `apps/web/node_modules/@supabase/ssr/dist/main/utils/constants.js` and quote `DEFAULT_COOKIE_OPTIONS` (expected `httpOnly: false`, which `AUTH_COOKIE_OPTIONS` overrides) and `apps/web/node_modules/@supabase/ssr/package.json` `peerDependencies`. The Supabase password settings (min length 12, leaked-password check) are a Supabase config, not code: 0030d sets `minimum_password_length = 12` in `supabase/config.toml`; the leaked-password check is a hosted dashboard setting (owner step there).

## Risk list (for the reviewer)

- `session.ts`: `safeNextPath` and `AUTH_COOKIE_OPTIONS` (every later redirect and cookie builds on them).
- `server.ts`: `cookieOptions: AUTH_COOKIE_OPTIONS` is passed (HttpOnly on), `setAll` swallows only the Server-Component write error.
- `schemas.ts`: `mapAuthError` never returns provider text; password 12–128.
- `pnpm-lock.yaml`: only `@supabase/ssr`, `@supabase/supabase-js` (+ its `@supabase/*-js` packages), `zod`.

## Owner steps

1. Confirm in `docs/context/decisions.md` (the orchestrator adds the line) that `@supabase/supabase-js` 2.117.2 counts under the approved `@supabase/ssr` (it is its required peer dependency). Default applied: yes.
