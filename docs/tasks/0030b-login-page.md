# 0030b: Login page `/prihlaseni`, server actions and the magic-link callback

Status: review
Ticket: P0-AUTH-01 (part b of 4) | Depends on: 0030a merged into phase/0 | Base commit: head of phase/0 | Branch: task/0030b-login-page | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full.

## 1. Objective

Add the login page with two forms (magic link first, password second), the server actions behind them (`sendMagicLink`, `signInWithPassword`, `signOut`, `signOutEverywhere`) and the route `/auth/callback` where the magic link lands. A user can sign in from this merge on; the pages are not yet protected (0030d adds the guard), so nothing breaks for the existing shell tests.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0030b step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once. Never run `playwright install`; run only `--project desktop-chromium --project mobile-chromium`.

**Already in phase/0 (0030a, do not change):** `apps/web/src/auth/session.ts` (`safeNextPath`, `loginUrl`, `parseLoginReason`, `LoginReason`, `CALLBACK_PATH`, `LAST_SEEN_COOKIE`), `schemas.ts` (`magicLinkSchema`, `passwordLoginSchema`, `AuthActionState`, `AuthErrorCode`, `AuthErrorLike`, `mapAuthError`, `PASSWORD_MIN_LENGTH`), `last-seen.ts` (`touchLastSeen(store)`), `src/supabase/server.ts` (`createSupabaseServerClient`, `appOrigin`), the 19 `auth.*` i18n keys, and the dependencies `@supabase/ssr`, `@supabase/supabase-js`, `zod`. If `apps/web/src/auth/schemas.ts` is missing: STOP. Also from 0023/0031: the shell under `app/(app)/`, `@shoebox/ui` `Button` (`variant` `primary|secondary|…`, 44 px) and `Input`; **import `@shoebox/ui` only in client components** (its index pulls Radix).

**Spec ADR-012 / M12 §4.4–4.5 (pasted):** magic link + password login; V2.5 recovery = magic-link only, no security questions; V3.4 logout everywhere; V5.1 zod on every server action; **M11 §7:** errors never show stack traces, SQL or provider names; **M11 §9 / 07 §8:** visible labels on every input (never placeholder-only), 44 px targets, focus ring never removed, works with keyboard only; **07 §5:** content max-width, borders over shadows; **M11 §3:** the four screens are `/inbox`, `/prehled`, `/ucetni`, `/nastaveni`; the login page is an auth route outside the shell, not a fifth screen.

**Rules:** 4 (no secrets, no document content), 6 (every string through `packages/i18n`; the Biome plugin `no-jsx-literal-text` flags literal JSX text and string `aria-label|title|placeholder|alt` in `apps/web`), 7 (no new dependency).

**Choices made by the brief writer (verified in a scratch copy: tsc, Biome, `next build`, and end to end in 0030c/d; do not change):**
- Route group `app/(auth)/` with its own layout (header with the app name, `main#obsah`, no nav: the user has no session yet); page `/prihlaseni` (Czech slug, like the four screens). Query `next` (same-origin path, through `safeNextPath`) and `reason` (`idle` | `link` | `signed_out`) drive a `role="status"` notice above the forms with the M11 §7 copy.
- Two `<form>`s, each labelled by its `h2` (`aria-labelledby`), posting to server actions through React 19 `useActionState`; the result goes into a per-form `role="status" aria-live="polite"` line. The browser's own validation (`type="email" required`, `minLength=12`) stops obvious mistakes; the server actions validate again with zod and return a closed `AuthActionState`.
- `sendMagicLink` → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${APP_URL}/auth/callback?next=…`, shouldCreateUser: true } })`: the first login creates the account (ADR-012 has no separate sign-up). Password accounts are created by the owner (Supabase dashboard) or later tickets; this ticket only logs them in.
- `/auth/callback` accepts `?code=` (PKCE: `exchangeCodeForSession`, same browser that asked for the link) and `?token_hash=&type=` (the `{{ .TokenHash }}` e-mail template variant: `verifyOtp`); any failure → `/prihlaseni?reason=link`. Redirects are built on `appOrigin()` (env `APP_URL`), never on the Host header.
- `signOut` (this browser, `scope: 'local'`) and `signOutEverywhere` (`scope: 'global'`: Supabase revokes every refresh token of the user; other devices drop out at their next request because the middleware of 0030d confirms the user with the Auth server on every request) both clear `shoebox_last_seen` and land on `/prihlaseni?reason=signed_out`. The buttons that call them come in 0030d.
- `redirect()` is called outside `try/catch` (Next implements it by throwing).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/auth/actions.ts` | new | the four server actions |
| `apps/web/src/auth/login-form.tsx` | new | client: two forms with `useActionState` |
| `apps/web/app/(auth)/layout.tsx` | new | auth layout (header + main, no nav) |
| `apps/web/app/(auth)/prihlaseni/page.tsx` | new | the login page |
| `apps/web/app/auth/callback/route.ts` | new | magic-link landing |

No other file may change. Quote paths with `(auth)` in shell commands.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 56–149
Step 2 code: lines 157–265
Step 3 code: lines 273–291
Step 4 code: lines 299–332
Step 5 code: lines 340–378

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0030b-login-page origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/src/auth apps/web/src/supabase`. Expected: `last-seen.ts  schemas.ts  session.ts` and `env.ts  server.ts`. Otherwise STOP (0030a not merged).

**Step 1: `apps/web/src/auth/actions.ts` (new).**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appOrigin, createSupabaseServerClient } from '../supabase/server';
import { touchLastSeen } from './last-seen';
import {
  type AuthActionState,
  type AuthErrorLike,
  magicLinkSchema,
  mapAuthError,
  passwordLoginSchema,
} from './schemas';
import { CALLBACK_PATH, LAST_SEEN_COOKIE, loginUrl, safeNextPath } from './session';

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Magic link (ADR-012). The link returns to `/auth/callback?next=…` on APP_URL; the user sees "sent" either way. */
export async function sendMagicLink(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = magicLinkSchema.safeParse({ email: field(formData, 'email') });
  if (!parsed.success) return { status: 'error', code: 'invalid_email' };
  const next = safeNextPath(field(formData, 'next'));

  const supabase = await createSupabaseServerClient();
  let error: AuthErrorLike | null;
  try {
    ({ error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: `${appOrigin()}${CALLBACK_PATH}?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    }));
  } catch {
    error = {};
  }
  if (error) return { status: 'error', code: mapAuthError(error) };
  return { status: 'sent', email: parsed.data.email };
}

/** Password login (ADR-012; V2.1 length is checked by the schema, the leaked-password check by Supabase). */
export async function signInWithPassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = passwordLoginSchema.safeParse({
    email: field(formData, 'email'),
    password: field(formData, 'password'),
  });
  if (!parsed.success) {
    const emailBad = parsed.error.issues.some((issue) => issue.path[0] === 'email');
    return { status: 'error', code: emailBad ? 'invalid_email' : 'invalid_password' };
  }
  const next = safeNextPath(field(formData, 'next'));

  const supabase = await createSupabaseServerClient();
  let error: AuthErrorLike | null;
  try {
    ({ error } = await supabase.auth.signInWithPassword(parsed.data));
  } catch {
    error = {};
  }
  if (error) return { status: 'error', code: mapAuthError(error) };
  touchLastSeen(await cookies());
  redirect(next);
}

async function endSession(scope: 'local' | 'global'): Promise<never> {
  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut({ scope });
  } catch {
    // The cookies are cleared below either way; a failed remote revoke is not shown to the user.
  }
  const store = await cookies();
  store.delete(LAST_SEEN_COOKIE);
  redirect(loginUrl(undefined, 'signed_out'));
}

/** "Odhlásit": this browser only. */
export async function signOut(): Promise<void> {
  await endSession('local');
}

/** "Odhlásit všude" (M12 §4.5 V3.4): revokes every refresh token of the user, so other devices drop out at their next request. */
export async function signOutEverywhere(): Promise<void> {
  await endSession('global');
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 2: `apps/web/src/auth/login-form.tsx` (new).**

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { Button, Input } from '@shoebox/ui';
import { useActionState, useId } from 'react';
import { sendMagicLink, signInWithPassword } from './actions';
import { type AuthActionState, type AuthErrorCode, PASSWORD_MIN_LENGTH } from './schemas';

const idle: AuthActionState = { status: 'idle' };

const errorKeys: Readonly<Record<AuthErrorCode, MessageKey>> = {
  invalid_email: 'auth.error.invalid_email',
  invalid_password: 'auth.error.invalid_password',
  invalid_credentials: 'auth.error.invalid_credentials',
  rate_limited: 'auth.error.rate_limited',
  link: 'auth.error.link',
  unknown: 'auth.error.unknown',
};

/** One live region per form: the result is announced without moving focus (07 §8). */
function Status({ state }: { state: AuthActionState }) {
  return (
    <p role="status" aria-live="polite" className="min-h-6 text-meta">
      {state.status === 'sent' && (
        <span className="text-success">{t('auth.magic.sent', { email: state.email })}</span>
      )}
      {state.status === 'error' && (
        <span className="text-destructive">{t(errorKeys[state.code])}</span>
      )}
    </p>
  );
}

/** Magic link first (the default path, ADR-012), password second. Both post to server actions. */
export function LoginForm({ next }: { next: string }) {
  const id = useId();
  const [magic, magicAction, magicPending] = useActionState(sendMagicLink, idle);
  const [password, passwordAction, passwordPending] = useActionState(signInWithPassword, idle);

  return (
    <div className="grid gap-8">
      <form action={magicAction} className="grid gap-3" aria-labelledby={`${id}-magic`}>
        <h2 id={`${id}-magic`} className="text-card-title">
          {t('auth.magic.title')}
        </h2>
        <input type="hidden" name="next" value={next} />
        <label htmlFor={`${id}-magic-email`} className="text-meta text-muted-foreground">
          {t('auth.field.email')}
        </label>
        <Input
          id={`${id}-magic-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
        />
        <Button type="submit" disabled={magicPending} aria-busy={magicPending}>
          {t('auth.magic.cta')}
        </Button>
        <Status state={magic} />
      </form>

      <form action={passwordAction} className="grid gap-3" aria-labelledby={`${id}-password`}>
        <h2 id={`${id}-password`} className="text-card-title">
          {t('auth.password.title')}
        </h2>
        <input type="hidden" name="next" value={next} />
        <label htmlFor={`${id}-password-email`} className="text-meta text-muted-foreground">
          {t('auth.field.email')}
        </label>
        <Input
          id={`${id}-password-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
        />
        <label htmlFor={`${id}-password-password`} className="text-meta text-muted-foreground">
          {t('auth.field.password')}
        </label>
        <Input
          id={`${id}-password-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          aria-describedby={`${id}-password-hint`}
        />
        <p id={`${id}-password-hint`} className="text-meta text-muted-foreground">
          {t('auth.password.hint', { min: PASSWORD_MIN_LENGTH })}
        </p>
        <Button
          type="submit"
          variant="secondary"
          disabled={passwordPending}
          aria-busy={passwordPending}
        >
          {t('auth.password.cta')}
        </Button>
        <Status state={password} />
      </form>
    </div>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 3: `apps/web/app/(auth)/layout.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { ReactNode } from 'react';

/** Login pages: no app nav (the user has no session yet); the same landmarks as the shell (07 §8). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header
        data-slot="auth-header"
        className="flex min-h-14 items-center border-b border-border bg-card px-4 md:px-6"
      >
        <p className="text-card-title">{t('shell.app.name')}</p>
      </header>
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-md px-4 py-10 outline-none">
        {children}
      </main>
    </>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 4: `apps/web/app/(auth)/prihlaseni/page.tsx` (new).**

```tsx
import { type MessageKey, t } from '@shoebox/i18n';
import type { Metadata } from 'next';
import { LoginForm } from '../../../src/auth/login-form';
import { type LoginReason, parseLoginReason, safeNextPath } from '../../../src/auth/session';

export const metadata: Metadata = { title: t('auth.login.title') };

/** Notice above the form (M11 §7 "Session expired" copy for `idle`). */
const noticeKeys: Readonly<Record<LoginReason, MessageKey>> = {
  idle: 'auth.notice.idle',
  link: 'auth.error.link',
  signed_out: 'auth.notice.signed_out',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const reason = parseLoginReason(params.reason);
  return (
    <div className="grid gap-6">
      <h1 className="text-title">{t('auth.login.title')}</h1>
      {reason && (
        <p role="status" className="rounded-card border border-border bg-card p-4 text-body">
          {t(noticeKeys[reason])}
        </p>
      )}
      <LoginForm next={next} />
    </div>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 5: `apps/web/app/auth/callback/route.ts` (new).**

```ts
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { touchLastSeen } from '../../../src/auth/last-seen';
import { loginUrl, safeNextPath } from '../../../src/auth/session';
import { appOrigin, createSupabaseServerClient } from '../../../src/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Where the magic link lands (ADR-012, @supabase/ssr PKCE flow): `?code=` is exchanged for a session
 * in the same browser that asked for the link. `?token_hash=&type=` is the template variant of the
 * same link (Supabase "Confirm signup / Magic Link" templates with {{ .TokenHash }}); both are accepted.
 * Any failure goes back to the login page with `reason=link`; nothing from the provider is shown.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  const supabase = await createSupabaseServerClient();
  let failed = true;
  try {
    if (code) {
      failed = (await supabase.auth.exchangeCodeForSession(code)).error !== null;
    } else if (tokenHash && (type === 'email' || type === 'magiclink')) {
      failed =
        (await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })).error !== null;
    }
  } catch {
    failed = true;
  }

  const origin = appOrigin();
  if (failed) return NextResponse.redirect(new URL(loginUrl(next, 'link'), origin), 303);
  touchLastSeen(await cookies());
  return NextResponse.redirect(new URL(next, origin), 303);
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 6: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web 2>&1 | tail -3 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -16 && git status --short | tail -5`. Expected: lint without errors (no literal JSX text), `no dependency violations found`, the route table lists `ƒ /prihlaseni` and `ƒ /auth/callback` next to the 0023/0031 routes, `git status` lists nothing. Commit if anything changed.

**Step 7: the existing E2E still passes (no new file).** Command: `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -12`. Expected: `36 passed` (shell, headers, health; the login page gets its own spec in 0030d), 0 failed.

## 5. Do not touch

`apps/web/src/auth/session.ts`, `schemas.ts`, `last-seen.ts`, `apps/web/src/supabase/**`, `apps/web/middleware.ts`, `apps/web/app/(app)/**`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/e2e/**`, `playwright.config.ts`, `packages/**`, `.env.example`, `supabase/config.toml`. No dependency. Hard rules 4, 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → `/prihlaseni`, `/auth/callback` listed.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium 2>&1 | tail -30` → 36 passed.

## 7. Acceptance

- [ ] Build lists `/prihlaseni` and `/auth/callback`; `/prihlaseni` renders `h1` "Přihlášení", two forms "Přihlášení odkazem" / "Přihlášení heslem" with visible labels, hint "Heslo má aspoň 12 znaků.", buttons from i18n.
- [ ] `actions.ts`: every action validates with zod; errors become `AuthErrorCode` through `mapAuthError`; success paths call `touchLastSeen` and `redirect(next)` from `safeNextPath`.
- [ ] `/auth/callback` without `code`/`token_hash` → 303 to `/prihlaseni?reason=link`.
- [ ] No literal strings in JSX (lint); no `@shoebox/ui` import in a server component.
- [ ] Existing E2E unchanged: 36 passed. (The login page's own E2E, screenshots and axe come with 0030d's `auth.spec.ts`.)

## 8. Stop and ask

Stop, and write the report, if:

- an anchor or a file this brief depends on is missing (0030a not merged);
- `next build` reports a type error inside a file of this brief twice;
- `next build` fails to download Inter from Google: STOP;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0030b-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0030b report" && git push -u origin task/0030b-login-page 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `actions.ts`: input only through the zod schemas; `next` only through `safeNextPath`; `emailRedirectTo` built on `APP_URL`; `signOutEverywhere` uses `scope: 'global'`; no provider message in any return value.
- `route.ts` (callback): both branches end in a redirect built on `appOrigin()`; the failure branch leaks nothing.
- `login-form.tsx`: labels bound by `htmlFor`, `aria-live` status, 44 px controls, tokens only.

## Owner steps

None yet (env names and the Supabase settings come with 0030d).
