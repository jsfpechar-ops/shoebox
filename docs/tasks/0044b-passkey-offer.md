# 0044b: Offer a passkey once after the first e-mail-link sign-in

Status: review
Ticket: owner decision 2026-10-25 (decisions [auth], ADR-012) | Depends on: 0044a merged | Base commit: head of phase/0 | Branch: claude/project-thread-bpqq3g (commit locally, no push) | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

After someone signs in with the e-mail link, one screen asks whether they want to sign in by fingerprint or face next time. One tap adds a passkey, and "Teď ne" goes straight on. This is the reference-app-style login Josef asked for. The passkey button on the login page comes in 0044c.

## 2. Context

- ADR-012: passkey and e-mail only. The first sign-in is by e-mail link, then one tap offers a passkey. The e-mail link stays the fallback and the recovery path. Supabase passkeys (supabase-js 2.117.2 in the repo) are used through the **two-step API on the server**: `supabase.auth.passkey.startRegistration()` returns `{ data: { challenge_id, options, expires_at } }`, and `verifyRegistration({ challengeId, credential })` takes the browser's `PublicKeyCredential.toJSON()`.
- Session cookies are HttpOnly, and there is no browser Supabase client (`apps/web/src/supabase/server.ts`). So the browser only runs `navigator.credentials.create()`, while both Supabase calls run in server actions.
- The browser side uses the standard JSON helpers `PublicKeyCredential.parseCreationOptionsFromJSON()` and `credential.toJSON()` (in TypeScript 5.9 `lib.dom`). There is no polyfill and no new dependency (hard rule 7). A browser without them never sees the offer.
- `/pristupovy-klic` is not in `PUBLIC_PATHS` (`apps/web/src/auth/guard.ts`), so the middleware already requires a signed-in user there. It sits in the `(auth)` route group (no app nav).
- The offer is remembered per browser in the HttpOnly cookie `shoebox_passkey_offer`: `later` lasts 30 days, `done` lasts a year. Without the cookie, the callback sends the user to the offer.
- 07 rules: plain words, no fine print (`text-body`), labels and results in `role="status"`, two buttons at most.
- Hard rule 6: strings go through i18n, and `en.json` has the same keys as `cs.json`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `supabase/config.toml` | edit | step 1 |
| `apps/web/src/auth/session.ts` | edit | step 2 |
| `apps/web/src/auth/passkey.ts` | new | step 3 |
| `apps/web/test/passkey.test.ts` | new | step 3 |
| `apps/web/src/auth/passkey-actions.ts` | new | step 4 |
| `apps/web/src/auth/passkey-offer.tsx` | new | step 5 |
| `apps/web/app/(auth)/pristupovy-klic/page.tsx` | new | step 6 |
| `apps/web/app/auth/callback/route.ts` | edit | step 7 |
| `packages/i18n/messages/cs.json`, `en.json` | edit | step 8 |
| `apps/web/e2e/fixtures.ts` | edit | step 9 |
| `apps/web/e2e/auth-live.spec.ts` | edit | step 10 |
| `apps/web/e2e/shell.spec.ts` | edit | step 11 (fallout of 0043a) |
| `docs/tasks/0044b-report.md` | new | report |

No other file may change.

## 4. Steps

1. `supabase/config.toml`: replace these lines

```
# [auth.passkey]
# enabled = false
```

with

```
[auth.passkey]
enabled = true
```

and these lines

```
# [auth.webauthn]
# rp_display_name = "Supabase"
# rp_id = "localhost"
# rp_origins = ["http://127.0.0.1:3000"]
```

with

```
[auth.webauthn]
rp_display_name = "Shoebox"
rp_id = "localhost"
rp_origins = ["http://localhost:3000", "http://localhost:3100"]
```

2. `apps/web/src/auth/session.ts`: after the line `export const DEFAULT_AFTER_LOGIN = '/inbox';` add:

```ts

/** The one-time passkey offer after an e-mail-link sign-in (ADR-012, 0044b). Needs a session. */
export const PASSKEY_OFFER_PATH = '/pristupovy-klic';
/** `later` ("Teď ne") or `done` (a passkey was added in this browser). */
export const PASSKEY_OFFER_COOKIE = 'shoebox_passkey_offer';
export const PASSKEY_OFFER_LATER_S = 30 * 24 * 60 * 60;
export const PASSKEY_OFFER_DONE_S = 365 * 24 * 60 * 60;
```

   and at the end of the file add:

```ts

/** Where the e-mail-link callback sends the user: the passkey offer unless this browser answered it. */
export function afterLinkSignIn(next: string, offerCookie: string | undefined): string {
  const target = safeNextPath(next);
  if (offerCookie === 'later' || offerCookie === 'done') return target;
  return target === DEFAULT_AFTER_LOGIN
    ? PASSKEY_OFFER_PATH
    : `${PASSKEY_OFFER_PATH}?next=${encodeURIComponent(target)}`;
}
```

3. New `apps/web/src/auth/passkey.ts`, implemented so that the test file below passes (do not edit the test). Exports exactly:

```ts
import { z } from 'zod';

export const challengeIdSchema = z.string().min(1).max(128);

/** Shape of `PublicKeyCredential.toJSON()`; only the shape is checked here, Supabase verifies the signature. */
export const credentialSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({}),
});

export type PasskeyErrorCode = 'cancelled' | 'expired' | 'unsupported' | 'unknown';

export type PasskeyResult = { status: 'ok' } | { status: 'error'; code: PasskeyErrorCode };

/**
 * Browser (DOMException `name`) and Supabase (`code`) failures to a user-facing code:
 * NotAllowedError / AbortError / code ERROR_CEREMONY_ABORTED -> cancelled;
 * code webauthn_challenge_expired -> expired; NotSupportedError / SecurityError -> unsupported;
 * anything else, null or undefined -> unknown.
 */
export function mapPasskeyError(
  error: { code?: string | null; name?: string | null } | null | undefined,
): PasskeyErrorCode;

/** True when the scope has the JSON WebAuthn helpers this app uses and `navigator.credentials`. */
export function passkeySupported(scope: {
  PublicKeyCredential?: unknown;
  navigator?: { credentials?: unknown };
}): boolean;
```

   `passkeySupported` returns true only when `scope.PublicKeyCredential` has both `parseCreationOptionsFromJSON` and `parseRequestOptionsFromJSON` as functions, and `scope.navigator?.credentials` is not undefined. It never throws.

   New `apps/web/test/passkey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  challengeIdSchema,
  credentialSchema,
  mapPasskeyError,
  passkeySupported,
} from '../src/auth/passkey';
import { afterLinkSignIn, PASSKEY_OFFER_PATH } from '../src/auth/session';

const fn = () => undefined;

describe('passkeySupported (no polyfill: browsers without JSON WebAuthn get e-mail only)', () => {
  it('needs both JSON parsers and navigator.credentials', () => {
    const full = {
      PublicKeyCredential: { parseCreationOptionsFromJSON: fn, parseRequestOptionsFromJSON: fn },
      navigator: { credentials: {} },
    };
    expect(passkeySupported(full)).toBe(true);
    expect(passkeySupported({ navigator: { credentials: {} } })).toBe(false);
    expect(
      passkeySupported({ ...full, PublicKeyCredential: { parseCreationOptionsFromJSON: fn } }),
    ).toBe(false);
    expect(passkeySupported({ PublicKeyCredential: full.PublicKeyCredential, navigator: {} })).toBe(
      false,
    );
    expect(passkeySupported({})).toBe(false);
  });
});

describe('mapPasskeyError (no provider details reach the user)', () => {
  it('maps browser and Supabase failures', () => {
    expect(mapPasskeyError({ name: 'NotAllowedError' })).toBe('cancelled');
    expect(mapPasskeyError({ name: 'AbortError' })).toBe('cancelled');
    expect(mapPasskeyError({ code: 'ERROR_CEREMONY_ABORTED' })).toBe('cancelled');
    expect(mapPasskeyError({ code: 'webauthn_challenge_expired' })).toBe('expired');
    expect(mapPasskeyError({ name: 'NotSupportedError' })).toBe('unsupported');
    expect(mapPasskeyError({ name: 'SecurityError' })).toBe('unsupported');
    expect(mapPasskeyError({ code: 'unexpected_failure' })).toBe('unknown');
    expect(mapPasskeyError(null)).toBe('unknown');
    expect(mapPasskeyError(undefined)).toBe('unknown');
  });
});

describe('server action input (M12 §4.5 V5.1)', () => {
  it('accepts a toJSON() credential, rejects other shapes', () => {
    const ok = { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: 'x' } };
    expect(credentialSchema.safeParse(ok).success).toBe(true);
    expect(credentialSchema.safeParse({ ...ok, type: 'password' }).success).toBe(false);
    expect(credentialSchema.safeParse({ ...ok, id: '' }).success).toBe(false);
    expect(credentialSchema.safeParse('abc').success).toBe(false);
    expect(challengeIdSchema.safeParse('').success).toBe(false);
    expect(challengeIdSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('afterLinkSignIn (the offer is asked once per browser)', () => {
  it('sends to the offer without an answer, keeping next', () => {
    expect(PASSKEY_OFFER_PATH).toBe('/pristupovy-klic');
    expect(afterLinkSignIn('/inbox', undefined)).toBe('/pristupovy-klic');
    expect(afterLinkSignIn('/prehled?tab=x', undefined)).toBe(
      '/pristupovy-klic?next=%2Fprehled%3Ftab%3Dx',
    );
    expect(afterLinkSignIn('/prehled', 'garbage')).toBe('/pristupovy-klic?next=%2Fprehled');
  });

  it('goes straight to next after "later" or "done", never off-site', () => {
    expect(afterLinkSignIn('/prehled', 'later')).toBe('/prehled');
    expect(afterLinkSignIn('/prehled', 'done')).toBe('/prehled');
    expect(afterLinkSignIn('https://evil.example', 'done')).toBe('/inbox');
    expect(afterLinkSignIn('//evil.example', undefined)).toBe('/pristupovy-klic');
  });
});
```

   Run `pnpm --filter @shoebox/web test passkey 2>&1 | tail -30`: all pass.

4. New `apps/web/src/auth/passkey-actions.ts`, exactly:

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import {
  challengeIdSchema,
  credentialSchema,
  mapPasskeyError,
  type PasskeyErrorCode,
  type PasskeyResult,
} from './passkey';
import {
  AUTH_COOKIE_OPTIONS,
  PASSKEY_OFFER_COOKIE,
  PASSKEY_OFFER_DONE_S,
  PASSKEY_OFFER_LATER_S,
  safeNextPath,
} from './session';

type PasskeyApi = Awaited<ReturnType<typeof createSupabaseServerClient>>['auth']['passkey'];
type RegistrationOptions = NonNullable<
  Awaited<ReturnType<PasskeyApi['startRegistration']>>['data']
>['options'];
type Credential = Parameters<PasskeyApi['verifyRegistration']>[0]['credential'];

export type PasskeyRegistrationStart =
  | { status: 'ok'; challengeId: string; options: RegistrationOptions }
  | { status: 'error'; code: PasskeyErrorCode };

/** Step 1 (ADR-012): Supabase issues a challenge for the signed-in user. The session stays on the server. */
export async function startPasskeyRegistration(): Promise<PasskeyRegistrationStart> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.passkey.startRegistration();
    if (error || !data) return { status: 'error', code: mapPasskeyError(error) };
    return { status: 'ok', challengeId: data.challenge_id, options: data.options };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
}

/** Step 2: Supabase verifies what the browser created; on success the offer is answered and the user goes on. */
export async function finishPasskeyRegistration(
  challengeId: unknown,
  credential: unknown,
  next: unknown,
): Promise<PasskeyResult> {
  const id = challengeIdSchema.safeParse(challengeId);
  const parsed = credentialSchema.safeParse(credential);
  if (!id.success || !parsed.success) return { status: 'error', code: 'unknown' };

  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.auth.passkey.verifyRegistration({
      challengeId: id.data,
      credential: parsed.data as unknown as Credential,
    });
    if (error) return { status: 'error', code: mapPasskeyError(error) };
  } catch {
    return { status: 'error', code: 'unknown' };
  }
  (await cookies()).set(PASSKEY_OFFER_COOKIE, 'done', {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: PASSKEY_OFFER_DONE_S,
  });
  redirect(safeNextPath(typeof next === 'string' ? next : undefined));
}

/** "Teď ne": asked again in 30 days, in this browser only. */
export async function skipPasskey(formData: FormData): Promise<void> {
  const raw = formData.get('next');
  (await cookies()).set(PASSKEY_OFFER_COOKIE, 'later', {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: PASSKEY_OFFER_LATER_S,
  });
  redirect(safeNextPath(typeof raw === 'string' ? raw : undefined));
}
```

   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. If the only errors are in the three `type` aliases, STOP (§8) and paste the error; do not guess other types.

5. New `apps/web/src/auth/passkey-offer.tsx`, exactly:

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button } from '@shoebox/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { mapPasskeyError, type PasskeyErrorCode, passkeySupported } from './passkey';
import {
  finishPasskeyRegistration,
  skipPasskey,
  startPasskeyRegistration,
} from './passkey-actions';

const errorKeys: Readonly<Record<PasskeyErrorCode, MessageKey>> = {
  cancelled: 'auth.passkey.error.cancelled',
  expired: 'auth.passkey.error.expired',
  unsupported: 'auth.passkey.error.unsupported',
  unknown: 'auth.error.unknown',
};

/** Two buttons: add a passkey, or go on (ADR-012). A browser without passkeys goes on at once. */
export function PasskeyOffer({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<PasskeyErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!passkeySupported(window)) router.replace(next);
  }, [next, router]);

  function add() {
    setError(null);
    startTransition(async () => {
      const start = await startPasskeyRegistration();
      if (start.status === 'error') {
        setError(start.code);
        return;
      }
      let credential: unknown;
      try {
        // Supabase's options type is its own copy of the DOM JSON type.
        const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
          start.options as unknown as PublicKeyCredentialCreationOptionsJSON,
        );
        const created = await navigator.credentials.create({ publicKey });
        if (!(created instanceof PublicKeyCredential)) {
          setError('cancelled');
          return;
        }
        credential = created.toJSON();
      } catch (caught) {
        setError(mapPasskeyError(caught as { name?: string }));
        return;
      }
      const result = await finishPasskeyRegistration(start.challengeId, credential, next);
      if (result?.status === 'error') setError(result.code);
    });
  }

  return (
    <div className="grid gap-3">
      <Button type="button" onClick={add} disabled={pending} aria-busy={pending}>
        {t('auth.passkey.offer.cta')}
      </Button>
      <form action={skipPasskey} className="grid">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary">
          {t('auth.passkey.offer.later')}
        </Button>
      </form>
      <p role="status" aria-live="polite" className="min-h-6 text-body">
        {error && <span className="text-destructive">{t(errorKeys[error])}</span>}
      </p>
    </div>
  );
}
```

6. New `apps/web/app/(auth)/pristupovy-klic/page.tsx`, exactly:

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { PasskeyOffer } from '../../../src/auth/passkey-offer';
import { safeNextPath } from '../../../src/auth/session';

export const metadata: Metadata = { title: t('auth.passkey.offer.title') };

/** Shown once after an e-mail-link sign-in (ADR-012). The middleware already requires a session here. */
export default async function PasskeyOfferPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  return (
    <div className="grid gap-6">
      <h1 className="text-title">{t('auth.passkey.offer.title')}</h1>
      <p className="text-body">{t('auth.passkey.offer.body')}</p>
      <PasskeyOffer next={next} />
    </div>
  );
}
```

7. `apps/web/app/auth/callback/route.ts`:
   - Change `import { loginUrl, safeNextPath } from '../../../src/auth/session';` to `import { afterLinkSignIn, loginUrl, PASSKEY_OFFER_COOKIE, safeNextPath } from '../../../src/auth/session';` (let Biome wrap it).
   - Replace the two lines

```ts
  touchLastSeen(await cookies());
  return NextResponse.redirect(new URL(next, origin), 303);
```

   with

```ts
  const store = await cookies();
  touchLastSeen(store);
  const to = afterLinkSignIn(next, store.get(PASSKEY_OFFER_COOKIE)?.value);
  return NextResponse.redirect(new URL(to, origin), 303);
```

8. In both catalogs, directly after the `auth.magic.hint` line, add these seven keys (cs, then en):

| Key | cs | en |
|---|---|---|
| `auth.passkey.offer.title` | Příště bez e-mailu | Next time without e-mail |
| `auth.passkey.offer.body` | Příště se můžete přihlásit otiskem prstu, obličejem nebo kódem telefonu. Je to rychlejší a bezpečnější než heslo. Když o telefon přijdete, přihlásíte se zase odkazem z e-mailu. | Next time you can sign in with your fingerprint, face or phone code. It is faster and safer than a password. If you lose your phone, you sign in with the e-mail link again. |
| `auth.passkey.offer.cta` | Zapnout přihlášení otiskem nebo obličejem | Turn on fingerprint or face sign-in |
| `auth.passkey.offer.later` | Teď ne | Not now |
| `auth.passkey.error.cancelled` | Nic se nezměnilo. Můžete to zkusit znovu. | Nothing changed. You can try again. |
| `auth.passkey.error.expired` | Trvalo to moc dlouho. Zkuste to prosím znovu. | That took too long. Please try again. |
| `auth.passkey.error.unsupported` | Tohle zařízení to neumí. Přihlašujte se odkazem z e-mailu. | This device cannot do this. Sign in with the e-mail link. |

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`: all pass.

9. `apps/web/e2e/fixtures.ts`: replace the function `loginWithLink` (from its `/** Signs in through the e-mail link …` comment to its closing `}`) with:

```ts
/**
 * Signs in through the e-mail link in this page's browser context and waits for `next`. The passkey
 * offer (0044b) is pre-answered with "later" unless `offer` is true, so other specs land on `next`.
 */
export async function loginWithLink(
  page: Page,
  email: string,
  next = '/inbox',
  offer = false,
): Promise<void> {
  const link = await magicLinkIn(await requestLink(page, email, next));
  if (!offer) {
    await page.context().addCookies([
      {
        name: 'shoebox_passkey_offer',
        value: 'later',
        url: 'http://localhost:3100',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  }
  // Same browser context as the request: the PKCE verifier cookie is here.
  await page.goto(link);
  await expect(page).toHaveURL(offer ? /\/pristupovy-klic/ : next);
}
```

10. `apps/web/e2e/auth-live.spec.ts`:
    - Change the import to `import { expect, LOGGED_OUT, loginWithLink, magicLinkIn, requestLink, test, uniqueEmail } from './fixtures';` (let Biome wrap it).
    - In the existing test, replace the two lines

```ts
  await page.goto(link);
  await expect(page).toHaveURL('/prehled');
```

    with

```ts
  await page.goto(link);
  // First e-mail-link sign-in in this browser: the passkey offer, then "Teď ne" goes on to next.
  await expect(page).toHaveURL('/pristupovy-klic?next=%2Fprehled');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Příště bez e-mailu');
  await expect(
    page.getByRole('button', { name: 'Zapnout přihlášení otiskem nebo obličejem' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Teď ne' }).click();
  await expect(page).toHaveURL('/prehled');
```

    - Change the cookie loop `for (const cookie of auth) {` to `for (const cookie of [...auth, ...cookies.filter((c) => c.name === 'shoebox_passkey_offer')]) {`.
    - Append at the end of the file:

```ts

test('the passkey offer is asked once per browser: after "Teď ne" the link goes straight on', async ({
  page,
}) => {
  const email = uniqueEmail('e2e-offer');
  await loginWithLink(page, email, '/inbox', true);
  await expect(page).toHaveURL('/pristupovy-klic');
  await page.getByRole('button', { name: 'Teď ne' }).click();
  await expect(page).toHaveURL('/inbox');

  await page.getByRole('button', { name: 'Odhlásit', exact: true }).click();
  await expect(page).toHaveURL('/prihlaseni?reason=signed_out');
  const link = await magicLinkIn(await requestLink(page, email, '/prehled'));
  await page.goto(link);
  await expect(page).toHaveURL('/prehled');
});

test('the passkey offer needs a session', async ({ page }) => {
  await page.goto('/pristupovy-klic');
  await expect(page).toHaveURL('/prihlaseni?next=%2Fpristupovy-klic');
});
```

11. `apps/web/e2e/shell.spec.ts`: the test `'Inter is self-hosted: no request to Google font hosts'` has failed since 0043a removed Inter (it expects `.woff2` files). Replace the whole test with:

```ts
test('system font only: no web font is downloaded (07 §4)', async ({ page }) => {
  const google: string[] = [];
  page.on('request', (request) => {
    if (GOOGLE_FONT_HOST.test(new URL(request.url()).hostname)) google.push(request.url());
  });
  for (const screen of screens) {
    await page.goto(screen.path);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
  }
  expect(google).toEqual([]);
  const fontFiles = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\.(woff2?|ttf|otf)(\?|$)/.test(name)),
  );
  expect(fontFiles).toEqual([]);
});
```

12. Run §6. Fix only the files in §3 (never an assertion the brief wrote) until all pass. Commit with the session trailers, write the report, set Status `review`.

## 5. Do not touch

`apps/web/middleware.ts`, `apps/web/src/auth/guard.ts`, `apps/web/src/auth/login-form.tsx`, `apps/web/e2e/fake-auth-server.mjs`, `apps/web/e2e/auth.spec.ts`, every other test in `shell.spec.ts`, `packages/ui/**`. Hard rules 6 and 7 (no new dependency, no WebAuthn library).

## 6. Commands

```
pnpm --filter @shoebox/web test 2>&1 | tail -30
pnpm --filter @shoebox/web typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
pnpm --filter @shoebox/web e2e -- auth shell 2>&1 | tail -30
pnpm exec biome check apps/web packages/i18n supabase 2>&1 | tail -30
python3 scripts/context_lint.py 2>&1 | tail -30
```

The e2e line runs against the fake server: 0 failed, 0 skipped. If Playwright says the browser executable is missing, run with `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/-home-user-leonoperations/e092e891-17fc-53b1-8e6b-0b5f58326e96/scratchpad/pw` and add `--project=setup --project=desktop-chromium --project=mobile-chromium` (WebKit is not installed here); never run `playwright install`. The offer screen must pass the automatic axe check.

## 7. Acceptance

- [ ] All §6 commands pass.
- [ ] One 375 px screenshot of `/pristupovy-klic` (path in the report).
- [ ] `grep -rn "simplewebauthn\|@github/webauthn" apps packages --include=package.json | grep -v node_modules` prints nothing.

## 8. Stop and ask

As TEMPLATE §8. Also stop if `supabase.auth.passkey` or the `startRegistration`/`verifyRegistration` types differ from §2 (paste the tsc error), or if a spec other than `auth-live.spec.ts` lands on `/pristupovy-klic`.

## 9. Report

`docs/tasks/0044b-report.md`, as TEMPLATE §9.
