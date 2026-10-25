# 0030d: Route guard, idle logout, logout buttons, Supabase config and the auth E2E

Status: review
Ticket: P0-AUTH-01 (part d of 4) | Depends on: 0030c merged into phase/0 (0031a is in it) | Base commit: head of phase/0 | Branch: task/0030d-auth-guard | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full; the tests are the spec.

## 1. Objective

Turn authentication on: the middleware refreshes the Supabase session, confirms the user with the Auth server on every request, applies `decide()` (login redirect with `next`, idle logout after 12 h) and keeps the 0031a security headers; the shell header gets "Odhlásit" and "Odhlásit všude"; the Supabase CLI config gets the password length, the redirect URLs and the disabled Google/Apple providers; `auth.spec.ts` and `auth-live.spec.ts` prove the whole P0-AUTH-01 acceptance list (magic link via the local inbox, HttpOnly/Secure/Lax cookies, logout everywhere, idle logout).

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. For a file marked "full content" Read it once, then Write it exactly. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0030d step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. **Never run `playwright install`**; run `--project desktop-chromium --project mobile-chromium` only.

**Already in phase/0 (do not change beyond this brief):** 0030a–c (`src/auth/{session,schemas,last-seen,actions,guard}.ts`, `src/supabase/{env,server}.ts`, `login-form.tsx`, `app/(auth)/…`, `app/auth/callback/route.ts`, `e2e/fake-auth-server.mjs`, `e2e/fixtures.ts` with `E2E_USER`, `LOGGED_OUT`, `supabaseUrl()`, `serviceRoleKey()`, `inboxUrl()`, `e2e/auth.setup.ts`, `playwright.config.ts` with the `setup` project), 0031a (`apps/web/middleware.ts` with headers only; `src/security/headers.ts` exporting `createNonce`, `NONCE_HEADER`, `securityHeaders`), 0023c (`apps/web/app/(app)/layout.tsx` with `<ThemeSwitch initial={theme} />` in the header). If `apps/web/src/auth/guard.ts` is missing: STOP.

**Spec (pasted):** **M12 §4.4:** access token 1 h, refresh rotation on, idle logout after 12 h of inactivity in the web app. **M12 §4.5:** V2.1 password min 12 chars + HIBP check [verify Supabase setting]; V3.2–3.4 HttpOnly, Secure, SameSite=Lax cookies, rotation on refresh, logout everywhere (avatar menu); V1.4 deny by default. **ADR-012:** Google, Apple providers. **M11 §3:** header has org name + switcher, search, bell, avatar menu (later tickets; the logout buttons sit in the header until the avatar menu exists). **M11 §7:** Session expired → "Z bezpečnostních důvodů jsme vás odhlásili." **M12 §4.13:** `.env.example` lists names only. **Backlog P0-AUTH-01 acceptance:** `apps/web/e2e/auth.spec.ts`: magic link via local Supabase inbox logs in; cookies HttpOnly, Secure, SameSite=Lax; logout everywhere ends other sessions; Google and Apple configured but disabled until the owner adds credentials; the report records the [verify] of password length 12 + leaked-password check.

**Rules:** 4 (env names only; no secret values), 6 (strings through i18n; the keys exist since 0030a), 7 (no dependency).

**Choices made by the brief writer (verified in a scratch copy: 61 E2E green on both Chromium projects with the fake server; do not change):**
- The middleware (Edge runtime) builds a `@supabase/ssr` client over `request.cookies`/`response.cookies` with `AUTH_COOKIE_OPTIONS` (HttpOnly on), calls `getUser()` only when an `sb-*` cookie is present (no Auth round trip for anonymous requests, which also keeps the e2e fast) and then applies `decide()`. A refreshed session's cookies are copied onto a redirect response too. On idle it signs out locally first, so the session is really gone, then redirects with `reason=idle`. `touchLastSeen` refreshes the idle clock on every authenticated response.
- "Logout everywhere" works immediately on other devices because every request confirms the user with the Auth server (`getUser`), not from the JWT alone; the cost is one Auth call per authenticated request (TODO for a later ticket: `getClaims()` with cached JWKS once Supabase's asymmetric keys are enabled on the project).
- The logout buttons are a server-component `<form>` with two `formAction`s (plain `<button>`s with token classes: the ui index cannot be imported in a server component). `TODO(P1-UI)`: avatar menu.
- `supabase/config.toml`: `minimum_password_length = 12` (M12 V2.1; the local CLI has no leaked-password toggle, that is a hosted dashboard setting: owner step), `additional_redirect_urls` gains `http://localhost:3000/**` and `http://localhost:3100/**` (dev and e2e), a `[auth.external.google]` block mirrors the existing `[auth.external.apple]` one: both `enabled = false` with `env(...)` secrets, so nothing is committed.
- `auth.spec.ts` tests start logged out (`LOGGED_OUT`) and sign in themselves; the "Odhlásit všude" test creates a user of its own through the admin API, because a global logout of the shared e2e user would end the storage-state session of every parallel test. `auth-live.spec.ts` reads the magic link from the inbox API (fake server by default; Mailpit of the Supabase CLI with `INBOX_URL`), opens it in the same context (PKCE verifier cookie) and checks the cookies. `/inbox` is the default target after login, so its login URL carries no `next`.
- `turbo.json` passes the auth/e2e env names into the `e2e` task (Turbo strict env mode drops them otherwise).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/middleware.ts` | edit (full content) | headers + session refresh + guard |
| `apps/web/src/auth/logout-buttons.tsx` | new | "Odhlásit" / "Odhlásit všude" |
| `apps/web/app/(app)/layout.tsx` | edit | logout buttons next to the theme switch |
| `supabase/config.toml` | edit (3 anchors) | password 12, redirect URLs, Google block |
| `.env.example` | edit | `APP_URL`, provider secret names |
| `turbo.json` | edit | `passThroughEnv` for `e2e` |
| `apps/web/e2e/auth.spec.ts` | new | 11 tests |
| `apps/web/e2e/auth-live.spec.ts` | new | magic link through the inbox |

No other file may change. Quote paths with `(app)` in shell commands.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 62–150
Step 2 code: lines 158–177
Step 3 code: lines 185–186
Step 4 code: lines 213–213
Step 5 code: lines 249–253
Step 6 code: lines 261–269
Step 7 code: lines 277–484
Step 8 code: lines 492–569

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0030d-auth-guard origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/src/auth/guard.ts apps/web/e2e/auth.setup.ts apps/web/src/security/headers.ts`. Expected: the three paths. Otherwise STOP.

**Step 1: `apps/web/middleware.ts` (full content).** Read it, then Write exactly:

```ts
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { decide } from './src/auth/guard';
import { touchLastSeen } from './src/auth/last-seen';
import { AUTH_COOKIE_OPTIONS, LAST_SEEN_COOKIE } from './src/auth/session';
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
  // Pages and API routes. Not the immutable build assets (they are content-hashed and must stay cacheable).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 2: `apps/web/src/auth/logout-buttons.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import { signOut, signOutEverywhere } from './actions';

// Server component (no @shoebox/ui import: the ui index pulls Radix, client only). Tokens only (07 §3).
const button =
  'min-h-11 rounded-control border border-input bg-card px-3 text-body text-foreground hover:opacity-80 transition-opacity duration-200 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** "Odhlásit" and "Odhlásit všude" (M12 §4.5 V3.4). TODO(P1-UI): move into the avatar menu of M11 §3. */
export function LogoutButtons() {
  return (
    <form className="flex items-center gap-2" data-slot="logout">
      <button type="submit" formAction={signOut} className={button}>
        {t('auth.logout.cta')}
      </button>
      <button type="submit" formAction={signOutEverywhere} className={button}>
        {t('auth.logout.everywhere')}
      </button>
    </form>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 3: `apps/web/app/(app)/layout.tsx` (edit, two anchors).** Anchor A (verbatim, two lines):

```tsx
import type { ReactNode } from 'react';
import { AppNav } from '../../src/shell/app-nav';
```

Replace with:

```tsx
import type { ReactNode } from 'react';
import { LogoutButtons } from '../../src/auth/logout-buttons';
import { AppNav } from '../../src/shell/app-nav';
```

Anchor B (verbatim): `        <ThemeSwitch initial={theme} />`. Replace with:

```tsx
        <div className="flex flex-wrap items-center gap-3">
          <ThemeSwitch initial={theme} />
          <LogoutButtons />
        </div>
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5 && grep -c 'LogoutButtons' 'apps/web/app/(app)/layout.tsx'`. Expected: no `error TS`; `2`. Commit.

**Step 4: `supabase/config.toml` (edit, three anchors).**

Anchor A (verbatim): `additional_redirect_urls = ["https://127.0.0.1:3000"]`. Replace with:

```toml
additional_redirect_urls = ["https://127.0.0.1:3000", "http://localhost:3000/**", "http://localhost:3100/**"]
```

Anchor B (verbatim): `minimum_password_length = 6`. Replace with `minimum_password_length = 12`.

Anchor C (verbatim, three lines, the end of the `[auth.external.apple]` block):

```toml
email_optional = false

# Allow Solana wallet holders
```

Replace with:

```toml
email_optional = false

# Google and Apple sign-in (ADR-012): configured here, enabled only after the owner adds credentials.
[auth.external.google]
enabled = false
client_id = ""
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false

# Allow Solana wallet holders
```

Command: `grep -n 'minimum_password_length\|additional_redirect_urls\|^\[auth.external' supabase/config.toml | tail -6`. Expected: `minimum_password_length = 12`, the three redirect URLs, `[auth.external.apple]` and `[auth.external.google]`. Commit.

**Step 5: `.env.example` (edit).** Anchor (verbatim): `SUPABASE_SERVICE_ROLE_KEY=`. Insert right after that line:

```
# Public origin of the web app (magic-link return address and redirects), e.g. https://app.example.cz
APP_URL=
# OAuth provider secrets for the Supabase CLI config (auth.external.*); empty until the owner enables a provider
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=
```

Command: `grep -c '=$' .env.example && grep -n 'APP_URL\|EXTERNAL' .env.example`. Expected: the three new names listed. Commit.

**Step 6: `turbo.json` (edit).** Anchor (verbatim): `      "passThroughEnv": ["CI", "PLAYWRIGHT_BROWSERS_PATH"]`. Replace with:

```json
      "passThroughEnv": [
        "CI",
        "PLAYWRIGHT_BROWSERS_PATH",
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "INBOX_URL"
      ]
```

Command: `node -e "console.log(JSON.parse(require('fs').readFileSync('turbo.json','utf8')).tasks.e2e.passThroughEnv.length)"`. Expected: `7`. Commit.

**Step 7: `apps/web/e2e/auth.spec.ts` (new).** Do not edit the test file.

```ts
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { E2E_USER, expect, LOGGED_OUT, serviceRoleKey, supabaseUrl, test } from './fixtures';

/**
 * P0-AUTH-01 (ADR-012, M12 §4.4, §4.5 V3.2–3.4). Every test here starts logged out and signs in on
 * its own, so ending a session never touches the shared storage state of the other specs. `/inbox`
 * is the default target after login, so its login URL carries no `next`.
 */
test.use({ storageState: LOGGED_OUT });

const IDLE_MS = 12 * 60 * 60 * 1000;

type Credentials = { email: string; password: string };

/** A user of its own for a test that revokes every session of the user (the shared e2e user must stay signed in). */
async function createUser(request: APIRequestContext): Promise<Credentials> {
  const user = {
    email: `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shoebox.test`,
    password: 'e2e-password-123456',
  };
  const created = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: { apikey: serviceRoleKey(), Authorization: `Bearer ${serviceRoleKey()}` },
    data: { ...user, email_confirm: true },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return user;
}

async function loginWithPassword(
  page: Page,
  next = '/inbox',
  user: Credentials = E2E_USER,
): Promise<void> {
  await page.goto(
    next === '/inbox' ? '/prihlaseni' : `/prihlaseni?next=${encodeURIComponent(next)}`,
  );
  const form = page.getByRole('form', { name: 'Přihlášení heslem' });
  await form.getByLabel('E-mail').fill(user.email);
  await form.getByLabel('Heslo').fill(user.password);
  await form.getByRole('button', { name: 'Přihlásit se heslem' }).click();
  await expect(page).toHaveURL(next);
}

async function freshLogin(browser: Browser, user: Credentials): Promise<Page> {
  const context = await browser.newContext({ storageState: LOGGED_OUT });
  const page = await context.newPage();
  await loginWithPassword(page, '/inbox', user);
  return page;
}

test('without a session every app page redirects to the login page with next', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
  await page.goto('/prehled?tab=x');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled%3Ftab%3Dx');
  await page.goto('/');
  await expect(page).toHaveURL('/prihlaseni?next=%2F');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Přihlášení');
});

test('login page: two labelled forms, magic link first; HTML validation on the e-mail', async ({
  page,
}) => {
  await page.goto('/prihlaseni');
  await expect(page).toHaveTitle('Přihlášení');
  const forms = page.getByRole('form');
  await expect(forms).toHaveCount(2);
  await expect(forms.nth(0)).toHaveAccessibleName('Přihlášení odkazem');
  await expect(forms.nth(1)).toHaveAccessibleName('Přihlášení heslem');
  const magic = forms.nth(0);
  await expect(magic.getByLabel('E-mail')).toHaveAttribute('type', 'email');
  await expect(magic.getByLabel('E-mail')).toHaveAttribute('required', '');
  await expect(magic.getByRole('button', { name: 'Poslat přihlašovací odkaz' })).toBeVisible();
  const password = forms.nth(1);
  await expect(password.getByLabel('Heslo')).toHaveAttribute('type', 'password');
  await expect(password.getByLabel('Heslo')).toHaveAttribute('minlength', '12');
  await expect(password.getByText('Heslo má aspoň 12 znaků.')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('login page fits 375 px without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/prihlaseni');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('next is never an off-site URL (open redirect)', async ({ page }) => {
  await page.goto('/prihlaseni?next=https%3A%2F%2Fevil.example%2Fx');
  const values = await page
    .locator('input[name="next"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).toEqual(['/inbox', '/inbox']);
  await page.goto('/prihlaseni?next=%2F%2Fevil.example');
  await expect(page.locator('input[name="next"]').first()).toHaveValue('/inbox');
  await page.goto('/prihlaseni?next=%2Fprehled%3Ftab%3Dx');
  await expect(page.locator('input[name="next"]').first()).toHaveValue('/prehled?tab=x');
});

test('a magic link without a code goes back to the login page with a notice', async ({ page }) => {
  await page.goto('/auth/callback?next=%2Fprehled');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled&reason=link');
  await expect(page.getByRole('status').first()).toHaveText('Odkaz už neplatí. Pošlete si nový.');
  await page.goto('/auth/callback?code=not-a-real-code');
  await expect(page).toHaveURL('/prihlaseni?reason=link');
});

test('wrong password: one neutral message, no provider details', async ({ page }) => {
  await page.goto('/prihlaseni');
  const form = page.getByRole('form', { name: 'Přihlášení heslem' });
  await form.getByLabel('E-mail').fill(E2E_USER.email);
  await form.getByLabel('Heslo').fill('definitely-not-the-password');
  await form.getByRole('button', { name: 'Přihlásit se heslem' }).click();
  await expect(form.getByRole('status')).toHaveText('E-mail nebo heslo nesedí.');
  await expect(page).toHaveURL('/prihlaseni');
  await expect(page.locator('body')).not.toContainText(/supabase|gotrue|invalid_credentials/i);
});

test('password login: session cookies are HttpOnly, Secure, SameSite=Lax; next is honoured', async ({
  page,
  context,
}) => {
  await loginWithPassword(page, '/prehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Přehled');
  const cookies = await context.cookies();
  const auth = cookies.filter((cookie) => cookie.name.startsWith('sb-'));
  expect(auth.length).toBeGreaterThan(0);
  const lastSeen = cookies.filter((cookie) => cookie.name === 'shoebox_last_seen');
  expect(lastSeen).toHaveLength(1);
  for (const cookie of [...auth, ...lastSeen]) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.secure, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe('Lax');
    expect(cookie.path, cookie.name).toBe('/');
  }
  // A signed-in user is sent away from the login page.
  await page.goto('/prihlaseni');
  await expect(page).toHaveURL('/inbox');
});

test('"Odhlásit" ends this browser\'s session', async ({ page }) => {
  await loginWithPassword(page);
  await page.getByRole('button', { name: 'Odhlásit', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  await expect(page.getByRole('status').first()).toHaveText('Jste odhlášeni.');
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
});

test('"Odhlásit všude" ends the sessions of other browsers too (V3.4)', async ({
  page,
  browser,
  request,
}) => {
  const user = await createUser(request);
  const other = await freshLogin(browser, user);
  await loginWithPassword(page, '/inbox', user);
  await other.goto('/prehled');
  await expect(other).toHaveURL('/prehled');

  await page.getByRole('button', { name: 'Odhlásit všude' }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');

  await other.goto('/inbox');
  await expect(other).toHaveURL('/prihlaseni');
  await other.context().close();
});

test('idle for more than 12 h: signed out with the M11 notice, session really gone', async ({
  page,
  context,
}) => {
  await loginWithPassword(page);
  await context.addCookies([
    {
      name: 'shoebox_last_seen',
      value: String(Date.now() - IDLE_MS - 60_000),
      url: 'http://localhost:3100',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/prehled');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled&reason=idle');
  await expect(page.getByRole('status').first()).toHaveText(
    'Z bezpečnostních důvodů jsme vás odhlásili.',
  );
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => cookie.name.startsWith('sb-'))).toEqual([]);
  await page.goto('/inbox');
  await expect(page).toHaveURL('/prihlaseni');
});

test('an active user keeps the session: last_seen moves forward on every request', async ({
  page,
  context,
}) => {
  await loginWithPassword(page);
  const first = (await context.cookies()).find((c) => c.name === 'shoebox_last_seen')?.value;
  await page.waitForTimeout(1100);
  await page.goto('/nastaveni');
  await expect(page).toHaveURL('/nastaveni');
  const second = (await context.cookies()).find((c) => c.name === 'shoebox_last_seen')?.value;
  expect(Number(second)).toBeGreaterThan(Number(first));
});
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 8: `apps/web/e2e/auth-live.spec.ts` (new).** Do not edit the test file.

```ts
import { expect, inboxUrl, LOGGED_OUT, test } from './fixtures';

/**
 * The magic-link flow end to end, read from the local inbox (ADR-012). Runs against the fake Auth +
 * inbox server by default and against the Supabase CLI (Mailpit on 54324) when SUPABASE_URL and
 * INBOX_URL are set, so CI and the owner verify the real provider with the same test.
 */
test.use({ storageState: LOGGED_OUT });

interface InboxMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

async function findMessage(address: string): Promise<InboxMessage> {
  let found: InboxMessage | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${inboxUrl()}/api/v1/messages`);
        const body = (await response.json()) as { messages: InboxMessage[] };
        found = body.messages.find((message) =>
          message.To.some((to) => to.Address.toLowerCase() === address),
        );
        return found !== undefined;
      },
      { timeout: 15_000, message: `no inbox message for ${address}` },
    )
    .toBe(true);
  if (!found) throw new Error('unreachable');
  return found;
}

/** The verify link, from the text part or (Supabase's HTML-only template) the HTML part. */
async function magicLink(id: string): Promise<string> {
  const response = await fetch(`${inboxUrl()}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  const haystack = `${body.Text ?? ''}\n${(body.HTML ?? '').replaceAll('&amp;', '&')}`;
  const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/.exec(haystack);
  if (!match) throw new Error(`no verify link in message ${id}`);
  return match[0];
}

test('magic link from the local inbox logs in, with HttpOnly Secure Lax cookies', async ({
  page,
  context,
}) => {
  const email = `e2e-magic-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shoebox.test`;
  await page.goto('/prihlaseni?next=%2Fprehled');
  const form = page.getByRole('form', { name: 'Přihlášení odkazem' });
  await form.getByLabel('E-mail').fill(email);
  await form.getByRole('button', { name: 'Poslat přihlašovací odkaz' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `Odkaz jsme poslali na ${email}. Platí hodinu.`,
  );
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled');

  const message = await findMessage(email);
  const link = await magicLink(message.ID);
  // Same browser context as the request: the PKCE verifier cookie is here.
  await page.goto(link);
  await expect(page).toHaveURL('/prehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Přehled');

  const cookies = await context.cookies();
  const auth = cookies.filter((cookie) => cookie.name.startsWith('sb-'));
  expect(auth.length).toBeGreaterThan(0);
  for (const cookie of auth) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.secure, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe('Lax');
  }

  // The link is single use.
  await page.goto(link);
  await expect(page).toHaveURL(/\/prihlaseni\?.*reason=link|\/inbox/);
});
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 9: run the E2E (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: `61 passed` (1 setup + 2 × 30: 12 shell, 4 headers, 2 health, 11 auth, 1 auth-live), 0 failed, 0 skipped. The shell and headers specs now run signed in (storage state from 0030c). A failure in `shell.spec.ts` means the guard redirected a signed-in user: STOP and report the URL.

**Step 10: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web turbo.json 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -6 && git status --short | tail -5`. Expected: lint without errors, `no dependency violations found`, `✓ Compiled successfully`, `git status` lists nothing. Commit if anything changed. Then look at `test-results/` for the 375 px screenshot from the shell spec (`find test-results -name '375-inbox.png' | head -1`), Read it once and describe the header (theme select + two logout buttons) in one line in the report.

## 5. Do not touch

`apps/web/src/security/**`, `apps/web/src/auth/{session,schemas,last-seen,actions,guard}.ts`, `apps/web/src/supabase/**`, `apps/web/app/(auth)/**`, `apps/web/app/auth/**`, `apps/web/e2e/{fixtures,auth.setup,shell.spec,headers.spec,health.spec}.ts`, `apps/web/e2e/fake-auth-server.mjs`, `playwright.config.ts`, `packages/**`, `.github/**`. No dependency. Hard rules 4, 6, 7, 8. Never `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 61 passed.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → compiled.

## 7. Acceptance (P0-AUTH-01)

- [ ] `auth-live.spec.ts`: magic link requested on `/prihlaseni`, read from the local inbox API, opened in the same browser → signed in on `next`; cookies `sb-*` HttpOnly, Secure, SameSite=Lax; the link is single use.
- [ ] `auth.spec.ts`: unauthenticated pages redirect to `/prihlaseni` (+ `next`); `next` never leaves the origin; wrong password → "E-mail nebo heslo nesedí." and nothing else; password login sets HttpOnly/Secure/Lax cookies and `shoebox_last_seen`; "Odhlásit" ends this browser; "Odhlásit všude" ends another browser's session; idle > 12 h → signed out with "Z bezpečnostních důvodů jsme vás odhlásili." and no `sb-*` cookie left; an active user's `last_seen` advances.
- [ ] Login page: axe 0 violations (auto fixture), no horizontal scroll at 375 px, two labelled forms.
- [ ] `supabase/config.toml`: `minimum_password_length = 12`; `[auth.external.google]` and `[auth.external.apple]` both `enabled = false` with `env(...)` secrets; redirect URLs for 3000 and 3100.
- [ ] `.env.example` gains only names; `turbo.json` passes the 7 env names.
- [ ] 61 E2E passed on the two Chromium projects; `mobile-webkit` listed for CI; the real Supabase run is the owner's step.
- [ ] Report records the `[verify]` below.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0030c is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- the setup project fails (0030c regression);
- port 54329 or 3100 is taken by a stray process (`pkill -f fake-auth-server.mjs; pkill -f 'next start'` once, then retry once);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0030d-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; the screenshot line; deviations; questions; the `[verify]` below. Then `git add -A && git commit -qm "0030d report" && git push -u origin task/0030d-auth-guard 2>&1 | tail -3`. The orchestrator opens and merges the PR.

**[verify] (M12 V2.1, record the finding with its source):** `grep -n 'minimum_password_length\|password_requirements' supabase/config.toml` (the CLI setting, now 12) and `grep -rn 'leaked\|hibp\|pwned' supabase/config.toml` (expected: no such key: the leaked-password check exists only in the hosted dashboard, Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords"). Quote both greps.

## Risk list (for the reviewer)

- `middleware.ts`: `cookieOptions: AUTH_COOKIE_OPTIONS`; `getUser()` (not `getSession()`) decides `hasUser`; refreshed cookies are copied onto redirects; idle path signs out before redirecting; the 0031a headers are set on every response including redirects; matcher unchanged.
- `(app)/layout.tsx`: only the import and the header slot change.
- `supabase/config.toml`: no secret value; providers disabled.
- `auth.spec.ts` "Odhlásit všude" uses its own user (shared session untouched).
- Not verified locally: the real Supabase CLI + Mailpit run (owner step 1), `mobile-webkit`.

## Owner steps

1. Local verification of the real provider (once): `supabase start`; from `supabase status` copy the `anon key` and `service_role key`; run `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service_role> INBOX_URL=http://127.0.0.1:54324 pnpm exec playwright test --project desktop-chromium 2>&1 | tail -20`. Expected `31 passed`. Paste the last lines to the orchestrator.
2. Hosted projects `shoebox-staging` / `shoebox-prod` (Supabase dashboard → Authentication): Sign In / Providers → Email: minimum password length 12, turn on "Prevent use of leaked passwords" (HIBP; Pro plan); Sessions: leave "Time-box user sessions" off, set "Inactivity timeout" to 12 hours if the plan offers it (the app enforces 12 h itself either way); URL Configuration: Site URL = the app origin, add `https://<app origin>/auth/callback` to the redirect allow list.
3. Cloud Run `web-staging` / `web`: set `APP_URL` to the public origin (`https://…`), `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the project's API settings.
4. Google and Apple stay disabled until you create the OAuth clients; then set `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` / `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` in your local `.env` and in the dashboard provider settings, and flip `enabled = true` in a later brief.
