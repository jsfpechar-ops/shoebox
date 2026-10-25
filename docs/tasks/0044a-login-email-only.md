# 0044a: Login by e-mail link only (remove password, Google and Apple)

Status: done
Ticket: owner decision 2026-10-25 (decisions [auth], ADR-012) | Depends on: PR #92 merged | Base commit: head of phase/0 | Branch: claude/project-thread-bpqq3g (commit locally, no push) | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The login page gets one e-mail field and one button that sends a sign-in link. The password form and the Google/Apple configuration go away. Josef chose "passkey and e-mail only, the reference app style". Passkeys come next in 0044b.

## 2. Context

- ADR-012 (03-architecture, 2026-10-25): Supabase Auth with **passkey and e-mail only**: no password, no Google or Apple. The first sign-in is by e-mail link. The e-mail link stays the fallback.
- 07 rule 13: no fine print. Labels and help text use `text-body` (16 px), not grey `text-meta`.
- 07 §8: labels go above fields, and results are announced in a `role="status"` live region.
- Hard rule 6: every string goes through `packages/i18n`. `en.json` must have exactly the keys of `cs.json` (catalog test).
- The e2e suite (Playwright, fake Auth server `apps/web/e2e/fake-auth-server.mjs`) signs in with the password form today. After this brief it signs in with the magic link, read from the fake server's inbox (`/api/v1/messages`, newest first, same shape as Mailpit). The fake server is **not** changed: its password grant just stops being used.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/auth/schemas.ts` | replace | step 1 |
| `apps/web/test/schemas.test.ts` | replace | step 2 |
| `apps/web/src/auth/actions.ts` | edit | step 3 |
| `apps/web/src/auth/login-form.tsx` | replace | step 4 |
| `packages/i18n/messages/cs.json` | edit | step 5 |
| `packages/i18n/messages/en.json` | edit | step 5 |
| `supabase/config.toml` | edit | step 6 |
| `apps/web/e2e/fixtures.ts` | edit | step 7 |
| `apps/web/e2e/auth.setup.ts` | replace | step 8 |
| `apps/web/e2e/auth-live.spec.ts` | edit | step 9 |
| `apps/web/e2e/auth.spec.ts` | edit | step 10 |
| `docs/tasks/0044a-report.md` | new | report |

No other file may change.

## 4. Steps

1. Replace all of `apps/web/src/auth/schemas.ts` with:

```ts
import { z } from 'zod';

/** Trimmed, lower-cased, RFC-shaped, ≤ 254 chars. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const magicLinkSchema = z.object({ email: emailSchema });

/** What the login form can show; each maps to an i18n key `auth.error.<code>`. */
export type AuthErrorCode = 'invalid_email' | 'rate_limited' | 'link' | 'unknown';

/** State of the login form (React `useActionState`). */
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
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'invalid_email';
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

   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. It fails in `actions.ts` and `login-form.tsx` until steps 3–4 are done; that is expected.

2. Replace all of `apps/web/test/schemas.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { emailSchema, magicLinkSchema, mapAuthError } from '../src/auth/schemas';

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
});

describe('mapAuthError (M11 §7: no provider details reach the user)', () => {
  it('maps Supabase codes to the form codes', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'over_request_rate_limit' })).toBe('rate_limited');
    expect(mapAuthError({ status: 429 })).toBe('rate_limited');
    expect(mapAuthError({ code: 'validation_failed' })).toBe('invalid_email');
    expect(mapAuthError({ code: 'otp_expired' })).toBe('link');
    expect(mapAuthError({ code: 'bad_code_verifier' })).toBe('link');
    expect(mapAuthError({ code: 'flow_state_not_found' })).toBe('link');
  });

  it('everything else, including password-era codes and network failures, is unknown', () => {
    expect(mapAuthError(null)).toBe('unknown');
    expect(mapAuthError(undefined)).toBe('unknown');
    expect(mapAuthError({})).toBe('unknown');
    expect(mapAuthError({ code: 'invalid_credentials', status: 400 })).toBe('unknown');
    expect(mapAuthError({ code: 'weak_password' })).toBe('unknown');
    expect(mapAuthError({ code: 'unexpected_failure', status: 500 })).toBe('unknown');
  });
});
```

3. `apps/web/src/auth/actions.ts`:
   - Replace the import block from `import { touchLastSeen } from './last-seen';` through `} from './schemas';` with:

```ts
import { type AuthActionState, type AuthErrorLike, magicLinkSchema, mapAuthError } from './schemas';
```

   - Delete the whole function `signInWithPassword`, from its comment line `/** Password login (ADR-012; …` through its closing `}` and the blank line after it.
   - Nothing else changes (`cookies` and `redirect` are still used by `endSession`).

4. Replace all of `apps/web/src/auth/login-form.tsx` with:

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button, Input } from '@shoebox/ui';
import { useActionState, useId } from 'react';
import { sendMagicLink } from './actions';
import type { AuthActionState, AuthErrorCode } from './schemas';

const idle: AuthActionState = { status: 'idle' };

const errorKeys: Readonly<Record<AuthErrorCode, MessageKey>> = {
  invalid_email: 'auth.error.invalid_email',
  rate_limited: 'auth.error.rate_limited',
  link: 'auth.error.link',
  unknown: 'auth.error.unknown',
};

/** The result is announced without moving focus (07 §8). Body size, no fine print (07 rule 13). */
function Status({ state }: { state: AuthActionState }) {
  return (
    <p role="status" aria-live="polite" className="min-h-6 text-body">
      {state.status === 'sent' && (
        <span className="text-success">{t('auth.magic.sent', { email: state.email })}</span>
      )}
      {state.status === 'error' && (
        <span className="text-destructive">{t(errorKeys[state.code])}</span>
      )}
    </p>
  );
}

/** One e-mail field, one button (ADR-012, owner 2026-10-25: passkey and e-mail only). */
export function LoginForm({ next }: { next: string }) {
  const id = useId();
  const [state, action, pending] = useActionState(sendMagicLink, idle);

  return (
    <form action={action} className="grid gap-3" aria-label={t('auth.magic.title')}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor={`${id}-email`} className="text-body font-medium">
        {t('auth.field.email')}
      </label>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-body">
        {t('auth.magic.hint')}
      </p>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('auth.magic.cta')}
      </Button>
      <Status state={state} />
    </form>
  );
}
```

   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. It fails only on the `auth.magic.hint` key until step 5.

5. In **both** `packages/i18n/messages/cs.json` and `en.json`:
   - Delete these six lines: `auth.field.password`, `auth.password.title`, `auth.password.cta`, `auth.password.hint`, `auth.error.invalid_password`, `auth.error.invalid_credentials`.
   - Directly after the `auth.magic.sent` line, add:
     - cs: `  "auth.magic.hint": "Pošleme vám e-mailem odkaz. Stačí na něj kliknout, heslo nepotřebujete.",`
     - en: `  "auth.magic.hint": "We e-mail you a link. Just click it, no password needed.",`

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`: everything passes.

6. `supabase/config.toml`: delete the comment line `# Google and Apple sign-in (ADR-012): configured here, enabled only after the owner adds credentials.` and the whole `[auth.external.google]` block below it (8 lines, `[auth.external.google]` through `email_optional = false`) plus the blank line after it. Leave `[auth.external.apple]` as it is: it is the CLI template default, and it stays `enabled = false`.

7. `apps/web/e2e/fixtures.ts`:
   - Replace the line `export const E2E_USER = { email: 'e2e@shoebox.test', password: 'e2e-password-123456' } as const;` with `export const E2E_USER = { email: 'e2e@shoebox.test' } as const;`
   - Append at the end of the file:

```ts

interface InboxMessage {
  ID: string;
  To: Array<{ Address: string }>;
}

async function inboxIds(address: string): Promise<string[]> {
  const response = await fetch(`${inboxUrl()}/api/v1/messages`);
  const body = (await response.json()) as { messages: InboxMessage[] };
  return body.messages
    .filter((message) => message.To.some((to) => to.Address.toLowerCase() === address))
    .map((message) => message.ID);
}

/** The verify link, from the text part or (Supabase's HTML-only template) the HTML part. */
export async function magicLinkIn(id: string): Promise<string> {
  const response = await fetch(`${inboxUrl()}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text?: string; HTML?: string };
  const haystack = `${body.Text ?? ''}\n${(body.HTML ?? '').replaceAll('&amp;', '&')}`;
  const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/.exec(haystack);
  if (!match) throw new Error(`no verify link in message ${id}`);
  return match[0];
}

/** A fresh address per test, so parallel tests never read each other's link. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shoebox.test`;
}

/**
 * Asks for a sign-in link on the login page and returns the id of the NEW inbox message for
 * `email` (messages that were already there are ignored).
 */
export async function requestLink(page: Page, email: string, next = '/inbox'): Promise<string> {
  const address = email.toLowerCase();
  const before = new Set(await inboxIds(address));
  await page.goto(
    next === '/inbox' ? '/prihlaseni' : `/prihlaseni?next=${encodeURIComponent(next)}`,
  );
  const form = page.getByRole('form', { name: 'Přihlášení odkazem' });
  await form.getByLabel('E-mail').fill(email);
  await form.getByRole('button', { name: 'Poslat přihlašovací odkaz' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `Odkaz jsme poslali na ${address}. Platí hodinu.`,
  );
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await inboxIds(address)).find((candidate) => !before.has(candidate));
        return id !== undefined;
      },
      { timeout: 15_000, message: `no new inbox message for ${address}` },
    )
    .toBe(true);
  if (!id) throw new Error('unreachable');
  return id;
}

/** Signs in through the e-mail link in this page's browser context and waits for `next`. */
export async function loginWithLink(page: Page, email: string, next = '/inbox'): Promise<void> {
  const link = await magicLinkIn(await requestLink(page, email, next));
  // Same browser context as the request: the PKCE verifier cookie is here.
  await page.goto(link);
  await expect(page).toHaveURL(next);
}
```

8. Replace all of `apps/web/e2e/auth.setup.ts` with:

```ts
import { expect, test as setup } from '@playwright/test';
import { E2E_USER, loginWithLink, STORAGE_STATE } from './fixtures';

/**
 * Runs once before the browser projects (playwright.config.ts `dependencies: ['setup']`): signs the
 * e2e user in with the e-mail link (ADR-012: passkey and e-mail only; the link creates the user on
 * first use) and stores the HttpOnly session cookies for every other test.
 */
setup('sign the e2e user in with the e-mail link', async ({ page }) => {
  await loginWithLink(page, E2E_USER.email);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  await page.context().storageState({ path: STORAGE_STATE });
});
```

9. `apps/web/e2e/auth-live.spec.ts`:
   - Change the first line to `import { expect, LOGGED_OUT, magicLinkIn, requestLink, test, uniqueEmail } from './fixtures';`
   - Delete the `interface InboxMessage { … }`, the function `findMessage` and the function `magicLink` with its comment (everything between `test.use({ storageState: LOGGED_OUT });` and the line `test('magic link from the local inbox logs in, …`).
   - Inside the test, replace the lines from `const email = \`e2e-magic-…` through `const link = await magicLink(message.ID);` with:

```ts
  const email = uniqueEmail('e2e-magic');
  const link = await magicLinkIn(await requestLink(page, email, '/prehled'));
  await expect(page).toHaveURL('/prihlaseni?next=%2Fprehled');
```

   Everything below (from the comment `// Same browser context as the request…`) stays.

10. `apps/web/e2e/auth.spec.ts`:
    - Replace everything from line 1 through the closing `}` of `freshLogin` (the line before `test('without a session every app page redirects…`) with:

```ts
import type { Browser, Page } from '@playwright/test';
import { expect, LOGGED_OUT, loginWithLink, test, uniqueEmail } from './fixtures';

/**
 * P0-AUTH-01 (ADR-012, M12 §4.4, §4.5 V3.2–3.4). Every test here starts logged out and signs in on
 * its own with a fresh address and the e-mail link, so ending a session never touches the shared
 * storage state of the other specs. `/inbox` is the default target, so its login URL has no `next`.
 */
test.use({ storageState: LOGGED_OUT });

const IDLE_MS = 12 * 60 * 60 * 1000;

async function login(page: Page, next = '/inbox', email = uniqueEmail()): Promise<void> {
  await loginWithLink(page, email, next);
}

async function freshLogin(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ storageState: LOGGED_OUT });
  const page = await context.newPage();
  await login(page, '/inbox', email);
  return page;
}
```

    - Replace the whole test `test('login page: two labelled forms, magic link first; …` with:

```ts
test('login page: one labelled form, e-mail only; HTML validation on the e-mail', async ({
  page,
}) => {
  await page.goto('/prihlaseni');
  await expect(page).toHaveTitle('Přihlášení');
  const forms = page.getByRole('form');
  await expect(forms).toHaveCount(1);
  await expect(forms.nth(0)).toHaveAccessibleName('Přihlášení odkazem');
  const form = forms.nth(0);
  await expect(form.getByLabel('E-mail')).toHaveAttribute('type', 'email');
  await expect(form.getByLabel('E-mail')).toHaveAttribute('required', '');
  await expect(form.getByRole('button', { name: 'Poslat přihlašovací odkaz' })).toBeVisible();
  await expect(
    form.getByText('Pošleme vám e-mailem odkaz. Stačí na něj kliknout, heslo nepotřebujete.'),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});
```

    - In the test `next is never an off-site URL (open redirect)`: change `expect(values).toEqual(['/inbox', '/inbox']);` to `expect(values).toEqual(['/inbox']);`.
    - Delete the whole test `test('wrong password: one neutral message, no provider details', …);` and the blank line after it.
    - In the test `password login: session cookies are HttpOnly, …`: rename it to `'e-mail link login: session cookies are HttpOnly, Secure, SameSite=Lax; next is honoured'` and change `await loginWithPassword(page, '/prehled');` to `await login(page, '/prehled');`.
    - In the test `"Odhlásit všude" …`: change its parameter list `{ page, browser, request }` to `{ page, browser }` (keep the same multi-line formatting Biome wants), replace `const user = await createUser(request);` with `const email = uniqueEmail();`, `await freshLogin(browser, user);` with `await freshLogin(browser, email);`, and `await loginWithPassword(page, '/inbox', user);` with `await login(page, '/inbox', email);`.
    - Every other remaining `await loginWithPassword(page);` becomes `await login(page);` (three places).

    Run `grep -n "loginWithPassword\|password\|Heslo\|createUser" apps/web/e2e/*.ts | head` : prints nothing.

11. Run §6. Fix only the files in §3 (never an assertion the brief wrote) until all pass. Commit with the session trailers, write the report, set Status `review`.

## 5. Do not touch

`apps/web/e2e/fake-auth-server.mjs`, `apps/web/app/**`, `apps/web/src/auth/session.ts`, `packages/ui/**`, `playwright.config.ts`. Hard rules 6 (i18n) and 7 (no new dependency).

## 6. Commands

```
pnpm --filter @shoebox/web test 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm --filter @shoebox/web e2e -- auth 2>&1 | tail -30
pnpm exec biome check apps/web packages/i18n 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

The e2e line runs `auth.setup.ts`, `auth.spec.ts` and `auth-live.spec.ts` against the fake server: 0 failed, 0 skipped. If the e2e stack cannot start in your session (browser or port error that is not caused by this change), write that in the report with the last 10 lines and continue; do not change the config.

## 7. Acceptance

- [ ] All §6 commands pass.
- [ ] `grep -rn "signInWithPassword\|passwordLoginSchema\|PASSWORD_MIN_LENGTH\|auth\.password\.\|external.google" apps packages supabase --include=*.ts --include=*.tsx --include=*.json --include=*.toml | grep -v node_modules` prints nothing.
- [ ] One 375 px screenshot of `/prihlaseni` in the report folder `test-results/` (path in the report).

## 8. Stop and ask

As TEMPLATE §8. Also stop if a spec other than the three auth specs fails because it used the password form: name it in the report, do not edit it.

## 9. Report

`docs/tasks/0044a-report.md`, as TEMPLATE §9.
