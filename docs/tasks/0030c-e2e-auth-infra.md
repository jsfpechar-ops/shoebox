# 0030c: E2E auth infrastructure: fake Auth server, signed-in storage state, route guard logic

Status: review
Ticket: P0-AUTH-01 (part c of 4) | Depends on: 0030b and 0031b merged into phase/0 | Base commit: head of phase/0 | Branch: task/0030c-e2e-auth-infra | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full; the tests are the spec.

## 1. Objective

Make the E2E suite run signed in before the route guard exists: a dependency-free fake Supabase Auth + Mailpit server for machines without Docker (the same tests run against the Supabase CLI when `SUPABASE_URL` is set), a `setup` project that creates the e2e user and logs in once, and the pure guard decision `decide()` with its unit tests. After this merge every browser test starts with a real session, so 0030d can turn the guard on without breaking the shell tests.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. For a file marked "full content" Read it once, then Write it exactly. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0030c step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. **Never run `playwright install`**; WebKit is not installed here: run `--project desktop-chromium --project mobile-chromium` only.

**Already in phase/0 (do not change beyond this brief):** 0030a/b (login page `/prihlaseni` with the password form "Přihlášení heslem", labels "E-mail" / "Heslo", button "Přihlásit se heslem"; server actions; `/auth/callback`), 0031a/b (middleware with headers, `/api/health`, `apps/web/e2e/headers.spec.ts`, `health.spec.ts`), 0023d (`playwright.config.ts`, `apps/web/e2e/fixtures.ts`, `shell.spec.ts`). If `apps/web/app/(auth)/prihlaseni/page.tsx` or `apps/web/e2e/health.spec.ts` is missing: STOP.

**Spec M12 §4.1 (pasted):** `playwright.config.ts` at the repo root: projects `desktop-chromium`, `mobile-webkit` (iPhone 14), `mobile-chromium` (Pixel 7); `@axe-core/playwright` fixture auto-run. **M12 §4.2 (pasted):** `local` env = Supabase CLI (Docker); `ci` = Supabase CLI in the runner. **M12 §4.4 / §4.5 V1.4 (pasted):** access control enforced server-side, deny by default; idle logout after 12 h. **Rule 8:** never e-mail real third parties (the fake inbox and Mailpit are local only).

**Rules:** 4, 7 (no dependency: the fake server is plain Node `http` + `crypto`), 8.

**Choices made by the brief writer (verified in a scratch copy, 61 E2E tests green with the fake server; do not change):**
- `apps/web/e2e/fake-auth-server.mjs` speaks the GoTrue subset supabase-js uses here: `POST /auth/v1/token?grant_type=password|pkce|refresh_token`, `POST /auth/v1/otp` (stores a Mailpit-shaped message with the verify link), `GET /auth/v1/verify` (303 to `redirect_to?code=…`), `GET /auth/v1/user`, `POST /auth/v1/logout?scope=local|global`, `POST /auth/v1/admin/users`, plus Mailpit's `GET /api/v1/messages`, `GET /api/v1/message/:id`. HS256 JWTs with a throw-away secret; everything in memory; port 54329; never deployed (it lives under `e2e/`, outside `app/` and `src/`). It always starts with the suite (harmless when a real Supabase is used).
- `playwright.config.ts` gets a `setup` project (`auth.setup.ts`) that the three browser projects depend on; they start from `test-results/.auth/user.json` (`storageState`, HttpOnly cookies included; `test-results/` is git-ignored). The Next server receives `SUPABASE_URL` (default: the fake server), `SUPABASE_ANON_KEY` (default `e2e-anon-key`) and `APP_URL=http://localhost:3100`; its readiness URL is `/prihlaseni` (`/api/health` answers 503 without a database, which Playwright would not treat as ready).
- `fixtures.ts` keeps the axe auto fixture and adds the shared constants: `STORAGE_STATE`, `LOGGED_OUT`, `E2E_USER` (`e2e@shoebox.test`, 19-char password), `supabaseUrl()`, `serviceRoleKey()`, `inboxUrl()` (env `INBOX_URL`, default the fake server; Supabase CLI: `http://127.0.0.1:54324`).
- `decide()` in `apps/web/src/auth/guard.ts` is pure and fully unit-tested here; 0030d wires it into the middleware. Public paths: `/prihlaseni`, `/auth/callback`, `/api/health`; everything else needs a user; a signed-in user on `/prihlaseni` is sent to `/inbox`; an idle user is signed out with `reason=idle`.
- Running against the real local stack (owner/CI): `supabase start`, then `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key from supabase status> SUPABASE_SERVICE_ROLE_KEY=<service_role key> INBOX_URL=http://127.0.0.1:54324 pnpm exec playwright test`. `supabase/config.toml` gets the matching redirect URLs in 0030d.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/e2e/fake-auth-server.mjs` | new | fake GoTrue + Mailpit, plain Node |
| `apps/web/e2e/fixtures.ts` | edit (full content) | axe fixture + auth constants |
| `apps/web/e2e/auth.setup.ts` | new | creates the e2e user, logs in, saves storage state |
| `playwright.config.ts` | edit (full content) | `setup` project, storage state, two web servers, env |
| `apps/web/src/auth/guard.ts` | new | `PUBLIC_PATHS`, `isPublicPath`, `decide` |
| `apps/web/test/guard.test.ts` | new | tests for guard.ts |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 57–345
Step 2 code: lines 353–395
Step 3 code: lines 403–427
Step 4 code: lines 435–501
Step 5 code: lines 509–549
Step 6 code: lines 557–703

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0030c-e2e-auth-infra origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls 'apps/web/app/(auth)/prihlaseni/page.tsx' apps/web/e2e/health.spec.ts && ls /opt/pw-browsers`. Expected: both paths and `chromium-1194`. Otherwise STOP.

**Step 1: `apps/web/e2e/fake-auth-server.mjs` (new).**

```js
// Fake Supabase Auth (GoTrue) + Mailpit inbox for the E2E runs where no Supabase CLI (Docker) is
// available. Plain Node, no dependencies. It speaks only what @supabase/ssr + supabase-js need for
// ADR-012: password login, magic link (PKCE), getUser, refresh, logout (local/global), admin user
// creation; plus the two Mailpit endpoints the tests read the magic link from. Never deployed.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.FAKE_AUTH_PORT ?? 54329);
const secret = 'fake-auth-secret-not-for-production';
const users = new Map(); // email -> { id, email, password, created_at }
const sessions = new Map(); // sessionId -> { userId, accessToken, refreshToken, expiresAt }
const magicTokens = new Map(); // token -> { email, challenge }
const authCodes = new Map(); // code -> { email, challenge }
const messages = []; // Mailpit-shaped, newest first

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};
const gotrueError = (res, status, code, msg) =>
  json(res, status, { code: status, error_code: code, msg });

function publicUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: user.created_at,
    updated_at: user.created_at,
    is_anonymous: false,
  };
}

function jwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function createSession(user) {
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const accessToken = jwt({
    iss: `http://127.0.0.1:${port}/auth/v1`,
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    session_id: sessionId,
    iat: now,
    exp: now + expiresIn,
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    is_anonymous: false,
  });
  const refreshToken = b64url(randomBytes(24));
  sessions.set(sessionId, {
    userId: user.id,
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn,
  });
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

function sessionFromBearer(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  for (const [id, session] of sessions) {
    if (session.accessToken === token) return { id, session };
  }
  return null;
}

function userById(id) {
  for (const user of users.values()) if (user.id === id) return user;
  return undefined;
}

function getOrCreateUser(email, password) {
  let user = users.get(email);
  if (!user) {
    user = { id: randomUUID(), email, password, created_at: new Date().toISOString() };
    users.set(email, user);
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function appendRedirect(redirectTo, params) {
  const url = new URL(redirectTo);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (pathname === '/health') return json(res, 200, { ok: true });

  // Mailpit API subset (https://mailpit.axllent.org/docs/api-v1/)
  if (pathname === '/api/v1/messages' && method === 'GET') {
    return json(res, 200, {
      total: messages.length,
      messages: messages.map(({ Text, HTML, ...m }) => m),
    });
  }
  if (pathname === '/api/v1/messages' && method === 'DELETE') {
    messages.length = 0;
    return json(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/v1/message/') && method === 'GET') {
    const message = messages.find((m) => m.ID === pathname.slice('/api/v1/message/'.length));
    return message ? json(res, 200, message) : json(res, 404, { error: 'not found' });
  }

  // GoTrue admin
  if (pathname === '/auth/v1/admin/users' && method === 'POST') {
    const body = await readBody(req);
    if (!body.email) return gotrueError(res, 422, 'validation_failed', 'email required');
    if (users.has(body.email)) {
      return gotrueError(
        res,
        422,
        'email_exists',
        'A user with this email address has already been registered',
      );
    }
    const user = getOrCreateUser(body.email, body.password ?? null);
    return json(res, 200, publicUser(user));
  }

  // GoTrue auth
  if (pathname === '/auth/v1/token' && method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const user = users.get(body.email);
      if (!user || user.password === null || user.password !== body.password) {
        return gotrueError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      return json(res, 200, createSession(user));
    }
    if (grant === 'pkce') {
      const entry = authCodes.get(body.auth_code);
      authCodes.delete(body.auth_code);
      if (!entry)
        return gotrueError(
          res,
          404,
          'flow_state_not_found',
          'invalid flow state, no valid flow state found',
        );
      const challenge = createHash('sha256')
        .update(body.code_verifier ?? '')
        .digest('base64url');
      if (challenge !== entry.challenge)
        return gotrueError(res, 403, 'bad_code_verifier', 'code challenge does not match');
      const user = users.get(entry.email);
      return json(res, 200, createSession(user));
    }
    if (grant === 'refresh_token') {
      for (const [id, session] of sessions) {
        if (session.refreshToken === body.refresh_token) {
          const user = userById(session.userId);
          sessions.delete(id);
          return json(res, 200, createSession(user));
        }
      }
      return gotrueError(
        res,
        400,
        'refresh_token_not_found',
        'Invalid Refresh Token: Refresh Token Not Found',
      );
    }
    return gotrueError(res, 400, 'unsupported_grant_type', 'unsupported grant type');
  }

  if (pathname === '/auth/v1/otp' && method === 'POST') {
    const body = await readBody(req);
    if (!body.email) return gotrueError(res, 422, 'validation_failed', 'email required');
    getOrCreateUser(body.email, null);
    const token = b64url(randomBytes(18));
    magicTokens.set(token, { email: body.email, challenge: body.code_challenge ?? null });
    const redirectTo =
      url.searchParams.get('redirect_to') ??
      body.redirect_to ??
      `http://localhost:3100/auth/callback`;
    const link = `http://127.0.0.1:${port}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`;
    messages.unshift({
      ID: randomUUID(),
      From: { Name: 'Supabase Auth', Address: 'noreply@mail.app.supabase.io' },
      To: [{ Name: '', Address: body.email }],
      Subject: 'Your Magic Link',
      Created: new Date().toISOString(),
      Text: `Follow this link to login:\n${link}\n`,
      HTML: `<p><a href="${link}">Log In</a></p>`,
    });
    return json(res, 200, {});
  }

  if (pathname === '/auth/v1/verify' && method === 'GET') {
    const token = url.searchParams.get('token') ?? '';
    const redirectTo = url.searchParams.get('redirect_to') ?? 'http://localhost:3100/';
    const entry = magicTokens.get(token);
    magicTokens.delete(token);
    if (!entry) {
      res.writeHead(303, {
        location: appendRedirect(redirectTo, {
          error: 'access_denied',
          error_code: 'otp_expired',
          error_description: 'Email link is invalid or has expired',
        }),
      });
      return res.end();
    }
    const code = randomUUID();
    authCodes.set(code, entry);
    res.writeHead(303, { location: appendRedirect(redirectTo, { code }) });
    return res.end();
  }

  if (pathname === '/auth/v1/user' && method === 'GET') {
    const found = sessionFromBearer(req);
    if (!found)
      return gotrueError(
        res,
        403,
        'session_not_found',
        'Session from session_id claim in JWT does not exist',
      );
    return json(res, 200, publicUser(userById(found.session.userId)));
  }

  if (pathname === '/auth/v1/logout' && method === 'POST') {
    const found = sessionFromBearer(req);
    if (found) {
      const scope = url.searchParams.get('scope') ?? 'global';
      if (scope === 'global') {
        for (const [id, session] of sessions)
          if (session.userId === found.session.userId) sessions.delete(id);
      } else {
        sessions.delete(found.id);
      }
    }
    res.writeHead(204);
    return res.end();
  }

  return gotrueError(res, 404, 'not_found', `fake-auth-server: no route for ${method} ${pathname}`);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-auth-server listening on http://127.0.0.1:${port}\n`);
});
```

Command: `(node apps/web/e2e/fake-auth-server.mjs & sleep 1; curl -s http://127.0.0.1:54329/health; echo; curl -s -X POST http://127.0.0.1:54329/auth/v1/admin/users -H 'content-type: application/json' -d '{"email":"a@b.cz","password":"e2e-password-123456"}' | head -c 80; echo; kill %1) 2>&1 | tail -4`. Expected: `{"ok":true}` and a JSON user with `"email":"a@b.cz"`. Commit.

**Step 2: `apps/web/e2e/fixtures.ts` (full content).** Read it, then Write exactly:

```ts
import AxeBuilder from '@axe-core/playwright';
import { type BrowserContextOptions, test as base, expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA (07 §8). */
export const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** axe on the current page; returns `rule: targets` per violation, so a failure names the element. */
export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

/** Auto fixture (M12 §4.1): after every passing test, axe checks the page it ended on. */
export const test = base.extend<{ autoAxe: undefined }>({
  autoAxe: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus || !page.url().startsWith('http')) return;
      expect(await axeViolations(page), `axe on ${page.url()}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// Auth (P0-AUTH-01). The same values drive the fake server and a real Supabase CLI stack.
/** Where the setup project stores the signed-in session for the browser projects. */
export const STORAGE_STATE = 'test-results/.auth/user.json';
/** A session-less browser for tests that start logged out. */
export const LOGGED_OUT: NonNullable<BrowserContextOptions['storageState']> = {
  cookies: [],
  origins: [],
};
export const E2E_USER = { email: 'e2e@shoebox.test', password: 'e2e-password-123456' } as const;
export const supabaseUrl = (): string => process.env.SUPABASE_URL ?? 'http://127.0.0.1:54329';
export const serviceRoleKey = (): string =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-service-key';
/** Mailpit API of the Supabase CLI (port 54324) or the fake server's copy of it. */
export const inboxUrl = (): string => process.env.INBOX_URL ?? 'http://127.0.0.1:54329';
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 3: `apps/web/e2e/auth.setup.ts` (new).**

```ts
import { expect, test as setup } from '@playwright/test';
import { E2E_USER, STORAGE_STATE, serviceRoleKey, supabaseUrl } from './fixtures';

/**
 * Runs once before the browser projects (playwright.config.ts `dependencies: ['setup']`): creates the
 * e2e user through the Auth admin API (fake server or Supabase CLI; 422 = already there), signs in
 * with the password form and stores the HttpOnly session cookies for every other test.
 */
setup('create the e2e user and sign in with the password', async ({ page, request }) => {
  const created = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: { apikey: serviceRoleKey(), Authorization: `Bearer ${serviceRoleKey()}` },
    data: { email: E2E_USER.email, password: E2E_USER.password, email_confirm: true },
  });
  expect([200, 201, 422], await created.text()).toContain(created.status());

  await page.goto('/prihlaseni');
  const form = page.getByRole('form', { name: 'Přihlášení heslem' });
  await form.getByLabel('E-mail').fill(E2E_USER.email);
  await form.getByLabel('Heslo').fill(E2E_USER.password);
  await form.getByRole('button', { name: 'Přihlásit se heslem' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');

  await page.context().storageState({ path: STORAGE_STATE });
});
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 4: `playwright.config.ts` (full content, repo root).** Read it, then Write exactly:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * M12 §4.1: E2E for apps/web. Every test runs axe through the auto fixture in apps/web/e2e/fixtures.ts.
 * Auth (P0-AUTH-01): the `setup` project signs the e2e user in once and the browser projects start from
 * that storage state. Without SUPABASE_URL the fake Auth + inbox server (apps/web/e2e/fake-auth-server.mjs)
 * stands in for the Supabase CLI; with it (CI, owner) the same tests run against the real local stack.
 */
const port = 3100;
const isCI = Boolean(process.env.CI);
const fakeAuthPort = 54329;
const supabaseUrl = process.env.SUPABASE_URL ?? `http://127.0.0.1:${fakeAuthPort}`;
export const STORAGE_STATE = 'test-results/.auth/user.json';

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'node apps/web/e2e/fake-auth-server.mjs',
      url: `http://127.0.0.1:${fakeAuthPort}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @shoebox/web build && pnpm --filter @shoebox/web exec next start --port ${port}`,
      // A public page: /api/health answers 503 without a database, which Playwright would not treat as ready.
      url: `http://localhost:${port}/prihlaseni`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? 'e2e-anon-key',
        APP_URL: `http://localhost:${port}`,
      },
    },
  ],
});
```

Command: `pnpm exec playwright test --list --project desktop-chromium 2>&1 | tail -4`. Expected: the listing ends with `Total: N tests in 5 files` where the files are `auth.setup.ts`, `headers.spec.ts`, `health.spec.ts`, `shell.spec.ts` (the setup counts as a file) and no config error. Commit.

**Step 5: `apps/web/src/auth/guard.ts` (new).** Exported names exactly as below.

```ts
import { DEFAULT_AFTER_LOGIN, isIdle, LOGIN_PATH, loginUrl } from './session';

/** Reachable without a session: the login page, the magic-link callback, the health probe. Everything else needs a user. */
export const PUBLIC_PATHS = [LOGIN_PATH, '/auth/callback', '/api/health'] as const;

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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 6: `apps/web/test/guard.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import { decide, isPublicPath, PUBLIC_PATHS } from '../src/auth/guard';
import { IDLE_TIMEOUT_MS } from '../src/auth/session';

const NOW = 1_800_000_000_000;
const fresh = String(NOW - 60_000);
const stale = String(NOW - IDLE_TIMEOUT_MS - 1);

describe('isPublicPath (deny by default, M12 §4.5 V1.4)', () => {
  it('only the login page, the callback and the health probe are public', () => {
    expect(PUBLIC_PATHS).toEqual(['/prihlaseni', '/auth/callback', '/api/health']);
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
```

Command: `pnpm --filter @shoebox/web test guard 2>&1 | tail -6`. Expected: `Tests  8 passed`. Commit.

**Step 7: run the E2E (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30`. Expected: the first line of results is `✓ [setup] › apps/web/e2e/auth.setup.ts …`, then `37 passed` (1 setup + 2 × 18), 0 failed, 0 skipped. If the setup fails on `toHaveURL('/inbox')`: STOP and report the page URL and the fake server output (it is the 0030b login flow that failed, not this brief).

**Step 8: format, lint (no new file).** Command: `pnpm exec biome check --write apps/web playwright.config.ts 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && git status --short | tail -5`. Expected: lint without errors (Biome also checks the `.mjs`: no `console`), `no dependency violations found`, `git status` lists nothing. Commit if anything changed.

## 5. Do not touch

`apps/web/app/**`, `apps/web/middleware.ts`, `apps/web/src/auth/{session,schemas,actions,last-seen}.ts`, `apps/web/e2e/shell.spec.ts`, `headers.spec.ts`, `health.spec.ts`, `turbo.json`, `.env.example`, `supabase/config.toml`, `packages/**`. No dependency. Hard rules 4, 7, 8. Never `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/web test guard 2>&1 | tail -30` → 8 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 37 passed.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.

## 7. Acceptance

- [ ] `playwright.config.ts`: projects `setup`, `desktop-chromium`, `mobile-webkit`, `mobile-chromium`; the three browser projects depend on `setup` and use `STORAGE_STATE`; axe auto fixture unchanged.
- [ ] The setup creates `e2e@shoebox.test` through the admin API and signs in through the real password form; `test-results/.auth/user.json` exists after a run and holds `sb-*` cookies with `httpOnly: true`.
- [ ] `decide()`: deny by default; public paths exactly `/prihlaseni`, `/auth/callback`, `/api/health`; idle → `reason=idle` + sign-out; signed-in on `/prihlaseni` → `/inbox` (guard.test.ts, 8 tests).
- [ ] 37 E2E passed on the two Chromium projects; `mobile-webkit` listed for CI.
- [ ] No dependency added; the fake server has no `require`/`import` outside `node:`.

## 8. Stop and ask

Stop, and write the report, if:

- a file this brief depends on is missing (0030b or 0031b not merged);
- the setup project fails twice;
- a test fails twice, or a test this brief wrote seems wrong;
- port 54329 or 3100 is already taken by a stray process (`pkill -f fake-auth-server.mjs; pkill -f 'next start'` once, then retry once);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0030c-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0030c report" && git push -u origin task/0030c-e2e-auth-infra 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `fake-auth-server.mjs`: test-only; lives in `e2e/`, excluded from the Next build; HS256 secret is a constant and the server binds `127.0.0.1` only.
- `playwright.config.ts`: `reuseExistingServer` only outside CI; env defaults are placeholders, real values come from the environment.
- `guard.ts`: `PUBLIC_PATHS` is the whole allow-list; prefix matching uses `path + '/'`, so `/prihlasenix` is not public.

## Owner steps

1. To run the suite against the real local Supabase once: `supabase start`, copy the `anon key` and `service_role key` from `supabase status`, then run the command from §2 "Running against the real local stack". Report the result to the orchestrator (that is the `[verify]` of the real magic-link flow; the sandbox has no Docker).
