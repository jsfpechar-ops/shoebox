# 0055: Test environment signs in by itself

Status: todo
Ticket: Phase 1 test environment (owner request 2026-10-25) | Depends on: 0054 | Base commit: see branch | Branch: claude/project-thread-2s0mp2 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the hosted test environment the owner wants no login screen: opening the site signs him in as one test user. This works only when `APP_ENV=test` and both test-login variables are set, so production and local runs are unchanged.

## 2. Context

- Owner decision 2026-10-25 `[test-env]` (orchestrator writes the decisions line): test env only, auto sign-in as a Supabase user created in the dashboard with e-mail + password.
- Env: `APP_ENV` (`test` on Render), `SHOEBOX_TEST_AUTOLOGIN_EMAIL`, `SHOEBOX_TEST_AUTOLOGIN_PASSWORD`.
- `apps/web/middleware.ts` already builds `supabase` (an `@supabase/ssr` server client whose `setAll` writes the new auth cookies into `response`), `headers` (security headers) and imports `touchLastSeen` from `./src/auth/last-seen`. The anchor excerpt (find it verbatim):

```ts
  // No Supabase cookie at all: no round trip to the Auth server (also keeps the e2e fast).
  let hasUser = false;
  if (request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'))) {
    try {
      hasUser = (await supabase.auth.getUser()).data.user !== null;
    } catch {
      hasUser = false;
    }
  }
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/auth/test-autologin.ts` | new | `testAutoLogin(env)` |
| `apps/web/test/test-autologin.test.ts` | new | unit test below |
| `apps/web/middleware.ts` | edit | sign in as the test user when no user |

No other file may change.

## 4. Steps

1. Create `apps/web/src/auth/test-autologin.ts`:

```ts
/**
 * Test environment only (owner 2026-10-25): the hosted test site has no login screen and signs in as
 * one Supabase user. Active only when APP_ENV is `test` and both variables are set; null otherwise.
 */
export function testAutoLogin(
  env: Record<string, string | undefined>,
): { email: string; password: string } | null {
  if (env.APP_ENV !== 'test') return null;
  const email = env.SHOEBOX_TEST_AUTOLOGIN_EMAIL;
  const password = env.SHOEBOX_TEST_AUTOLOGIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
```

2. Create `apps/web/test/test-autologin.test.ts` exactly as below. Run `pnpm --filter @shoebox/web test -- test/test-autologin.test.ts 2>&1 | tail -30`. Expected: 3 passed.

```ts
import { describe, expect, it } from 'vitest';
import { testAutoLogin } from '../src/auth/test-autologin';

const creds = { SHOEBOX_TEST_AUTOLOGIN_EMAIL: 'test@example.com', SHOEBOX_TEST_AUTOLOGIN_PASSWORD: 'pw' };

describe('testAutoLogin', () => {
  it('is off outside the test environment', () => {
    expect(testAutoLogin({ ...creds, APP_ENV: 'production' })).toBeNull();
    expect(testAutoLogin({ ...creds })).toBeNull();
  });

  it('is off when a variable is missing', () => {
    expect(testAutoLogin({ APP_ENV: 'test', SHOEBOX_TEST_AUTOLOGIN_EMAIL: 'test@example.com' })).toBeNull();
  });

  it('returns the credentials in the test environment', () => {
    expect(testAutoLogin({ ...creds, APP_ENV: 'test' })).toEqual({
      email: 'test@example.com',
      password: 'pw',
    });
  });
});
```

3. `apps/web/middleware.ts`: add `import { testAutoLogin } from './src/auth/test-autologin';` after the `last-seen` import, and insert directly after the anchor excerpt in §2:

```ts

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
```

Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/web test -- test/guard.test.ts test/test-autologin.test.ts 2>&1 | tail -30`. Expected: clean, all pass. Then `npx --yes pnpm@10.28.0 exec biome check apps/web/middleware.ts apps/web/src/auth/test-autologin.ts apps/web/test/test-autologin.test.ts 2>&1 | tail -30`; if it reports formatting only, run the same with `--write` and re-check.

## 5. Do not touch

Every other file under `apps/web/src/auth/`, `guard.ts`, the login page, `packages/`. Hard rules 4 (no secrets in code or tests; the test uses fake values), 8.

## 6. Commands

As in §4.

## 7. Acceptance

- [ ] 3 new tests pass; guard tests still pass; web typecheck clean; biome clean on the three files.
- [ ] `git diff --stat origin/phase/0` lists only §3 files plus this brief and its report.

## 8. Stop and ask

An excerpt not found, a test failing twice, 25 tool calls or about 50k tokens, a file outside §3, anything needing secrets or a deploy.

## 9. Report

Write `docs/tasks/0055-report.md` (600 tokens at most), set `Status: review`: files changed, each command with the last 5 lines of output.
