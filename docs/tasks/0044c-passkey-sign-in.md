# 0044c: Sign in with a passkey from the login page

Status: todo
Ticket: owner decision 2026-10-25 (decisions [auth], ADR-012) | Depends on: 0044b merged | Base commit: head of phase/0 | Branch: claude/project-thread-bpqq3g (commit locally, no push) | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The login page gets a "Přihlásit se otiskem prstu nebo obličejem" button above the e-mail field. A user who added a passkey (0044b) signs in with one tap. On a device without passkeys the button never shows, and the e-mail link works as before.

## 2. Context

- ADR-012: passkey and e-mail only, with the e-mail link as the fallback. The two-step server API is `supabase.auth.passkey.startAuthentication()` (returns `{ data: { challenge_id, options, expires_at } }`) and `verifyAuthentication({ challengeId, credential })` (returns `{ data: { session, user } }`). On the server client the session is saved to the HttpOnly cookies, as with the magic link.
- The browser side mirrors `apps/web/src/auth/passkey-offer.tsx` (0044b): `PublicKeyCredential.parseRequestOptionsFromJSON()`, `navigator.credentials.get({ publicKey })`, `credential.toJSON()`. No new dependency (hard rule 7).
- `apps/web/src/auth/passkey.ts` (0044b) already has `challengeIdSchema`, `credentialSchema`, `mapPasskeyError`, `passkeySupported`, `PasskeyResult` and `PasskeyErrorCode`.
- The e2e fake Auth server (`apps/web/e2e/fake-auth-server.mjs`) has no passkey endpoints yet. Step 4 adds them **without signature checks**: it stores the credential id at registration and maps it back to the user at sign-in. Real verification is Supabase's job, and the fake server is never deployed. Chromium's DevTools virtual authenticator (`WebAuthn.addVirtualAuthenticator`) runs the real browser ceremony in e2e.
- `Permissions-Policy` (`apps/web/src/security/headers.ts`) does not mention `publickey-credentials-*`, so the browser default (`self`) applies. No change is needed.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/auth/passkey-actions.ts` | edit | step 1 |
| `apps/web/src/auth/passkey-sign-in.tsx` | new | step 2 |
| `apps/web/app/(auth)/prihlaseni/page.tsx` | edit | step 3 |
| `apps/web/e2e/fake-auth-server.mjs` | edit | step 4 |
| `packages/i18n/messages/cs.json`, `en.json` | edit | step 5 |
| `apps/web/e2e/passkey.spec.ts` | new | step 6 |
| `docs/tasks/0044c-report.md` | new | report |

No other file may change.

## 4. Steps

1. `apps/web/src/auth/passkey-actions.ts`:
   - Change `import { createSupabaseServerClient } from '../supabase/server';` so that the next line after it is `import { touchLastSeen } from './last-seen';`.
   - After the line `type Credential = Parameters<PasskeyApi['verifyRegistration']>[0]['credential'];` add:

```ts
type AuthenticationOptions = NonNullable<
  Awaited<ReturnType<PasskeyApi['startAuthentication']>>['data']
>['options'];
type AuthenticationCredential = Parameters<PasskeyApi['verifyAuthentication']>[0]['credential'];

export type PasskeySignInStart =
  | { status: 'ok'; challengeId: string; options: AuthenticationOptions }
  | { status: 'error'; code: PasskeyErrorCode };
```

   - Append at the end of the file:

```ts

/** Sign-in step 1 (ADR-012): a challenge for any passkey of this site; the browser lets the user pick. */
export async function startPasskeySignIn(): Promise<PasskeySignInStart> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.startAuthentication();
    if (error || !data) return { status: 'error', code: mapPasskeyError(error) };
    return { status: 'ok', challengeId: data.challenge_id, options: data.options };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
}

/** Sign-in step 2: Supabase verifies the signature and opens the session (HttpOnly cookies), like the e-mail link. */
export async function finishPasskeySignIn(
  challengeId: unknown,
  credential: unknown,
  next: unknown,
): Promise<PasskeyResult> {
  const id = challengeIdSchema.safeParse(challengeId);
  const parsed = credentialSchema.safeParse(credential);
  if (!id.success || !parsed.success) return { status: 'error', code: 'unknown' };

  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.verifyAuthentication({
      challengeId: id.data,
      credential: parsed.data as unknown as AuthenticationCredential,
    });
    if (error || !data?.session) return { status: 'error', code: mapPasskeyError(error) };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
  const store = await cookies();
  touchLastSeen(store);
  store.set(PASSKEY_OFFER_COOKIE, 'done', { ...AUTH_COOKIE_OPTIONS, maxAge: PASSKEY_OFFER_DONE_S });
  redirect(safeNextPath(typeof next === 'string' ? next : undefined));
}
```

   If `mapPasskeyError(error)` does not typecheck here, pass `{ code: error?.code, name: error?.name }` instead, as in 0044b. Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`: clean.

2. New `apps/web/src/auth/passkey-sign-in.tsx`, exactly:

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useEffect, useState, useTransition } from 'react';
import { mapPasskeyError, type PasskeyErrorCode, passkeySupported } from './passkey';
import { finishPasskeySignIn, startPasskeySignIn } from './passkey-actions';

const errorKeys: Readonly<Record<PasskeyErrorCode, MessageKey>> = {
  cancelled: 'auth.passkey.error.cancelled',
  expired: 'auth.passkey.error.expired',
  unsupported: 'auth.passkey.error.unsupported',
  unknown: 'auth.passkey.error.signin',
};

/** One button above the e-mail form (ADR-012). Rendered only where the browser can use passkeys. */
export function PasskeySignIn({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<PasskeyErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSupported(passkeySupported(window));
  }, []);

  if (!supported) return null;

  function signIn() {
    setError(null);
    startTransition(async () => {
      const start = await startPasskeySignIn();
      if (start.status === 'error') {
        setError(start.code);
        return;
      }
      let credential: unknown;
      try {
        // Supabase's options type is its own copy of the DOM JSON type.
        const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
          start.options as unknown as PublicKeyCredentialRequestOptionsJSON,
        );
        const found = await navigator.credentials.get({ publicKey });
        if (!(found instanceof PublicKeyCredential)) {
          setError('cancelled');
          return;
        }
        credential = found.toJSON();
      } catch (caught) {
        setError(mapPasskeyError(caught as { name?: string }));
        return;
      }
      const result = await finishPasskeySignIn(start.challengeId, credential, next);
      if (result?.status === 'error') setError(result.code);
    });
  }

  return (
    <div className="grid gap-3">
      <Button type="button" onClick={signIn} disabled={pending} aria-busy={pending}>
        {t('auth.passkey.signin.cta')}
      </Button>
      <p role="status" aria-live="polite" className="min-h-6 text-body">
        {error && <span className="text-destructive">{t(errorKeys[error])}</span>}
      </p>
      <p className="text-body">{t('auth.passkey.signin.or')}</p>
    </div>
  );
}
```

3. `apps/web/app/(auth)/prihlaseni/page.tsx`:
   - After `import { LoginForm } from '../../../src/auth/login-form';` add `import { PasskeySignIn } from '../../../src/auth/passkey-sign-in';`.
   - Replace `      <LoginForm next={next} />` with:

```tsx
      <PasskeySignIn next={next} />
      <LoginForm next={next} />
```

4. `apps/web/e2e/fake-auth-server.mjs`:
   - Change the header comment's line `// ADR-012: password login, magic link (PKCE), getUser, refresh, logout (local/global), admin user` to `// ADR-012: magic link (PKCE), passkeys (no signature check), getUser, refresh, logout, admin user`.
   - After the line `const messages = []; // Mailpit-shaped, newest first` add:

```js
const passkeyChallenges = new Map(); // challenge_id -> { kind: 'registration' | 'authentication', userId }
const passkeys = new Map(); // credential id -> userId (fake: the signature is never checked)

function passkeyOptions(kind, user) {
  const challenge = b64url(randomBytes(32));
  if (kind === 'registration') {
    return {
      rp: { id: 'localhost', name: 'Shoebox' },
      user: { id: b64url(Buffer.from(user.id)), name: user.email, displayName: user.email },
      challenge,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    };
  }
  return { challenge, rpId: 'localhost', timeout: 60000, userVerification: 'preferred' };
}
```

   - Directly before the line `  if (pathname === '/auth/v1/otp' && method === 'POST') {` add:

```js
  // Passkeys (supabase-js two-step API). Shapes as GoTrue; nothing cryptographic is verified.
  const passkeyRoute = /^\/auth\/v1\/passkeys\/(registration|authentication)\/(options|verify)$/.exec(
    pathname,
  );
  if (passkeyRoute && method === 'POST') {
    const [, kind, step] = passkeyRoute;
    const body = await readBody(req);
    const bearer = sessionFromBearer(req);
    const user = bearer ? userById(bearer.session.userId) : undefined;
    if (kind === 'registration' && !user) {
      return gotrueError(res, 401, 'no_authorization', 'session required');
    }
    if (step === 'options') {
      const challengeId = randomUUID();
      passkeyChallenges.set(challengeId, { kind, userId: user?.id ?? null });
      return json(res, 200, {
        challenge_id: challengeId,
        options: passkeyOptions(kind, user),
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
    }
    const challenge = passkeyChallenges.get(body.challenge_id);
    passkeyChallenges.delete(body.challenge_id);
    const credentialId = body.credential?.id;
    if (!challenge || challenge.kind !== kind || typeof credentialId !== 'string') {
      return gotrueError(res, 400, 'webauthn_challenge_not_found', 'unknown challenge');
    }
    if (kind === 'registration') {
      passkeys.set(credentialId, user.id);
      return json(res, 200, { id: randomUUID(), created_at: new Date().toISOString() });
    }
    const owner = userById(passkeys.get(credentialId));
    if (!owner) return gotrueError(res, 400, 'webauthn_credential_not_found', 'unknown passkey');
    return json(res, 200, createSession(owner));
  }

```

   If supabase-js reads the sign-in response under another shape (the session comes back `null` in e2e), STOP (§8) and report the response it expected (`GoTrueClient.js`, `_verifyPasskeyAuthentication`, `xform: _sessionResponse`). Do not guess further.

5. Both catalogs, directly after the `auth.passkey.offer.later` line:

| Key | cs | en |
|---|---|---|
| `auth.passkey.signin.cta` | Přihlásit se otiskem prstu nebo obličejem | Sign in with fingerprint or face |
| `auth.passkey.signin.or` | Nebo vám pošleme odkaz e-mailem: | Or we e-mail you a link: |
| `auth.passkey.error.signin` | Přihlášení se nepovedlo. Pošlete si odkaz e-mailem. | Sign-in did not work. Send yourself an e-mail link. |

6. New `apps/web/e2e/passkey.spec.ts`, exactly:

```ts
import type { Page } from '@playwright/test';
import { expect, LOGGED_OUT, loginWithLink, test, uniqueEmail } from './fixtures';

/**
 * ADR-012 passkeys end to end with Chromium's virtual authenticator (a DevTools feature, so
 * Chromium only). The fake Auth server keeps credential ids and never checks signatures.
 */
test.use({ storageState: LOGGED_OUT });

async function virtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('add a passkey after the e-mail link, then sign in with one tap', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'virtual authenticator is Chromium-only');
  await virtualAuthenticator(page);
  const email = uniqueEmail('e2e-passkey');

  await loginWithLink(page, email, '/inbox', true);
  await page.getByRole('button', { name: 'Zapnout přihlášení otiskem nebo obličejem' }).click();
  await expect(page).toHaveURL('/inbox');

  await page.getByRole('button', { name: 'Odhlásit', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  await page.getByRole('button', { name: 'Přihlásit se otiskem prstu nebo obličejem' }).click();
  await expect(page).toHaveURL('/inbox');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
});

test('login page: passkey button first, the e-mail form stays', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the JSON WebAuthn helpers are checked in Chromium');
  await page.goto('/prihlaseni');
  const passkey = page.getByRole('button', { name: 'Přihlásit se otiskem prstu nebo obličejem' });
  await expect(passkey).toBeVisible();
  await expect(page.getByText('Nebo vám pošleme odkaz e-mailem:')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Přihlášení odkazem' })).toBeVisible();
  const passkeyBox = await passkey.boundingBox();
  const emailBox = await page.getByLabel('E-mail').boundingBox();
  expect(passkeyBox && emailBox && passkeyBox.y < emailBox.y).toBe(true);
});
```

7. Run §6. Fix only the files in §3 (never an assertion the brief wrote) until all pass. Commit with the session trailers, write the report, set Status `review`.

## 5. Do not touch

`apps/web/src/auth/passkey.ts`, `passkey-offer.tsx`, `login-form.tsx`, `session.ts`, `middleware.ts`, `apps/web/e2e/auth*.ts`, `fixtures.ts`, `playwright.config.ts`, `packages/ui/**`. Hard rules 6 and 7.

## 6. Commands

```
pnpm --filter @shoebox/web test 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm exec biome check apps/web packages/i18n 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

e2e, from `apps/web` (WebKit is not installed in this container; never run `playwright install`):

```
PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/-home-user-leonoperations/e092e891-17fc-53b1-8e6b-0b5f58326e96/scratchpad/pw pnpm exec playwright test --config ../../playwright.config.ts --project=setup --project=desktop-chromium --project=mobile-chromium 2>&1 | tail -30
```

Expected: 0 failed. The only skips allowed are the two `test.skip` lines above, on non-Chromium projects.

## 7. Acceptance

- [ ] All §6 commands pass.
- [ ] One 375 px screenshot of `/prihlaseni` with the passkey button (path in the report).

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0044c-report.md`, as TEMPLATE §9.
