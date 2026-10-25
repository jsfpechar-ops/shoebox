# 0023c: Theme switch (light / dark / system) and the / redirect

Status: review
Ticket: P0-UI-03 (part c of 4) | Depends on: 0023b merged into phase/0 | Base commit: head of phase/0 | Branch: task/0023c-web-theme | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the theme switch Světlý / Tmavý / Podle systému to the shell header, remembered in a cookie and applied on the server so the page never flashes the wrong theme, and make `/` redirect to the Inbox. Users who read receipts at night get dark mode; everyone else follows their system.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. For a file marked "full content" Read it once, then Write it exactly. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0023c step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/` (they are ignored once 0023a is merged). If `tsc` reports an error inside `apps/web/.next/types/`, that is stale build output: run `rm -rf apps/web/.next` and rerun the command once.

**Test filter:** `pnpm --filter @shoebox/web test <name>` (no `--`).

**Already in phase/0 (from 0023a/b, do not change beyond this brief):** `apps/web/app/layout.tsx` (root), `apps/web/app/(app)/layout.tsx` (shell with the comment `{/* 0023c adds the theme switch here. */}`), `apps/web/src/shell/app-nav.tsx`, the four pages, and the i18n keys `shell.theme.label` "Vzhled", `shell.theme.system` "Podle systému", `shell.theme.light` "Světlý", `shell.theme.dark` "Tmavý". If `apps/web/src/shell/app-nav.tsx` is missing: STOP.

**How the theme works today (packages/ui, do not change):** `tokens.css` holds light colors on `:root`, dark colors on `:root[data-theme="dark"]`, and dark colors under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`. So: no `data-theme` = follow the system; `data-theme="light"` or `"dark"` = manual choice. Tailwind's `dark:` variant in `theme.css` reads the same attribute.

**Spec 07 §3 (pasted):** light and dark themes from the same tokens; the user can choose light, dark or system. **07 §8:** visible labels on form controls (never placeholder-only); 44 px targets; focus ring never removed. **M11 §13.1:** server actions validate their input. **M11 §10:** RSC by default; client components only for interactive islands.

**Choices made by the brief writer (do not change):**
- A native `<select>` with a visible `<label>` (not the Radix `Select`): the OS picker on phones, no portal, simplest keyboard and screen-reader path. Styled like `Input` with tokens only.
- The choice lives in an `httpOnly` cookie `theme` (`light` | `dark`; no cookie = system), written by the server action `saveTheme` and read by the root layout, which sets `<html data-theme>` before the first paint. No inline script (Biome forbids `dangerouslySetInnerHTML`), no `localStorage`, no `document.cookie`. The switch also sets the attribute on `<html>` at once, so the change is instant.
- `parseTheme` accepts only `light` and `dark`; anything else (missing, empty, uppercase, junk) is `system`. That is the input validation for the action (no zod needed for a 3-value enum).
- The theme switch is a shell control, not one of the 15 user settings of M11 §5.4, so the settings budget is unchanged.
- Reading the cookie makes the shell routes dynamic (`ƒ` in the build table instead of `○`). Expected.
- `/` redirects to `/inbox` with `TODO(P0-AUTH-01)` for the role-based target of M11 §3.

Hard rules: 6 (strings through i18n, tokens only), 7 (no dependency).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/shell/theme.ts` | new | `themeChoices`, `ThemeChoice`, `THEME_COOKIE`, `parseTheme`, `themeAttribute` |
| `apps/web/test/theme.test.ts` | new | tests for `theme.ts` |
| `apps/web/src/shell/theme-actions.ts` | new | server action `saveTheme` |
| `apps/web/src/shell/theme-switch.tsx` | new | client `<select>` |
| `apps/web/app/(app)/layout.tsx` | edit (full content) | header gets `ThemeSwitch` |
| `apps/web/app/layout.tsx` | edit (full content) | `<html data-theme>` from the cookie |
| `apps/web/app/page.tsx` | new | `/` → `/inbox` |

No other file may change. Quote paths with `(app)` in shell commands.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0023c-web-theme origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/src/shell`. Expected: `app-nav.tsx`. Otherwise STOP (0023b not merged).

**Step 1: `apps/web/src/shell/theme.ts` (new).** Exported names and types exactly as below.

```ts
/**
 * Theme choice (07 §3): `system` follows prefers-color-scheme; `light` and `dark` set
 * <html data-theme>, which tokens.css and the Tailwind `dark` variant read. Pure: server, client, tests.
 */
export const themeChoices = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof themeChoices)[number];

/** Cookie that remembers a manual choice; no cookie means `system`. */
export const THEME_COOKIE = 'theme';

/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 31_536_000;

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The value for <html data-theme>; undefined for `system`, so the media query in tokens.css applies. */
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | undefined {
  return choice === 'system' ? undefined : choice;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 2: `apps/web/test/theme.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import { parseTheme, THEME_COOKIE, themeAttribute, themeChoices } from '../src/shell/theme';

describe('theme choice (07 §3)', () => {
  it('offers system, light and dark, in that order', () => {
    expect(themeChoices).toEqual(['system', 'light', 'dark']);
    expect(THEME_COOKIE).toBe('theme');
  });

  it('parses only light and dark; anything else is system', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('')).toBe('system');
    expect(parseTheme('DARK')).toBe('system');
    expect(parseTheme('<script>')).toBe('system');
  });

  it('maps system to no data-theme attribute', () => {
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});
```

Command: `pnpm --filter @shoebox/web test theme 2>&1 | tail -6`. Expected: `Tests  3 passed`.

**Step 3: `apps/web/src/shell/theme-actions.ts` (new).**

```ts
'use server';

import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from './theme';

/** Server action: remembers the theme in a cookie (`system` deletes it). Input is parsed, never trusted. */
export async function saveTheme(value: string): Promise<void> {
  const choice = parseTheme(value);
  const store = await cookies();
  if (choice === 'system') {
    store.delete(THEME_COOKIE);
    return;
  }
  // A display preference, not a secret: httpOnly and lax; `secure` is left to the CSP/headers ticket.
  store.set(THEME_COOKIE, choice, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
  });
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 4: `apps/web/src/shell/theme-switch.tsx` (new).**

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { cn, focusRing, motion } from '@shoebox/ui';
import { useId, useState, useTransition } from 'react';
import { parseTheme, type ThemeChoice, themeAttribute, themeChoices } from './theme';
import { saveTheme } from './theme-actions';

const labels: Readonly<Record<ThemeChoice, MessageKey>> = {
  system: 'shell.theme.system',
  light: 'shell.theme.light',
  dark: 'shell.theme.dark',
};

/** Světlý / Tmavý / Podle systému. Applies at once on <html>, then saves the cookie. */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const id = useId();
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const [, startTransition] = useTransition();

  function change(value: string) {
    const next = parseTheme(value);
    setChoice(next);
    const attribute = themeAttribute(next);
    if (attribute === undefined) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', attribute);
    }
    startTransition(async () => {
      await saveTheme(next);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-meta text-muted-foreground">
        {t('shell.theme.label')}
      </label>
      <select
        id={id}
        value={choice}
        onChange={(event) => change(event.target.value)}
        className={cn(
          'min-h-11 rounded-control border border-input bg-card px-3 text-body text-foreground',
          motion,
          focusRing,
        )}
      >
        {themeChoices.map((option) => (
          <option key={option} value={option}>
            {t(labels[option])}
          </option>
        ))}
      </select>
    </div>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 5: `apps/web/app/(app)/layout.tsx` (full content).** Read it, then Write exactly:

```tsx
import { t } from '@shoebox/i18n';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppNav } from '../../src/shell/app-nav';
import { parseTheme, THEME_COOKIE } from '../../src/shell/theme';
import { ThemeSwitch } from '../../src/shell/theme-switch';

/** App shell (07 §5, §8): skip link, header, nav, main. Server component; AppNav and ThemeSwitch are the client islands. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:outline-none focus:ring-[3px] focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        {t('shell.skip_link')}
      </a>
      <header
        data-slot="app-header"
        className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-2 md:px-6"
      >
        <p className="text-card-title">{t('shell.app.name')}</p>
        <ThemeSwitch initial={theme} />
      </header>
      <div className="md:flex">
        <AppNav />
        <main
          id="obsah"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-content flex-1 px-4 pt-6 pb-32 outline-none md:px-6 md:pb-12"
        >
          {children}
        </main>
      </div>
    </>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 6: `apps/web/app/layout.tsx` (full content).** Read it, then Write exactly:

```tsx
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { parseTheme, THEME_COOKIE, themeAttribute } from '../src/shell/theme';
import './globals.css';

// 07 §4: Inter, self-hosted by next/font at build time (no request to Google at runtime).
// next/font needs literal options; test/fonts.test.ts checks them against @shoebox/ui/fonts.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = themeAttribute(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html lang="cs" className={inter.variable} data-theme={theme}>
      <body className="min-h-dvh bg-background font-sans text-body text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

Command: `pnpm --filter @shoebox/web test 2>&1 | tail -6`. Expected: `Test Files  3 passed`, `Tests  7 passed` (the fonts test still passes).

**Step 7: `apps/web/app/page.tsx` (new).**

```tsx
import { redirect } from 'next/navigation';

/** `/` (M11 §3). TODO(P0-AUTH-01): owner/member → /prehled when they have documents, accountant → /ucetni. */
export default function Home(): never {
  redirect('/inbox');
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 8: build, format and lint (no new file).** Command: `pnpm exec biome check --write apps/web 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -15 && git status --short 2>&1 | tail -5 && pnpm lint 2>&1 | tail -8 && pnpm depcruise 2>&1 | tail -3`. Expected: `✓ Compiled successfully`; routes `/`, `/inbox`, `/nastaveni`, `/prehled`, `/ucetni` marked `ƒ` (dynamic); `git status` lists nothing; lint without errors; `no dependency violations found`. Commit if anything changed.

## 5. Do not touch

`apps/web/src/shell/app-nav.tsx`, the four `page.tsx` files under `(app)`, `globals.css`, `next.config.ts`, `tsconfig.json`, `package.json`, `pnpm-lock.yaml`; `packages/**` (the theme keys already exist; `tokens.css`/`theme.css` unchanged). Hard rules 6 and 7. Never run `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/web test 2>&1 | tail -30` → 7 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → five routes listed.
- `pnpm lint 2>&1 | tail -30` → no errors.
- `pnpm depcruise 2>&1 | tail -30` → no violations.

## 7. Acceptance

- [ ] `test/theme.test.ts` passes: only `light`/`dark` parsed, everything else `system`; `system` → no `data-theme`.
- [ ] Root layout sets `<html data-theme>` from the `theme` cookie; the header shows the labelled select "Vzhled" with Podle systému / Světlý / Tmavý.
- [ ] `/` redirects to `/inbox` (with `TODO(P0-AUTH-01)`).
- 07 §9 pre-delivery checklist (verified end to end by the 0023d E2E run; tick here what the code shows):
- [ ] Only tokens from 07 §3; no raw hex outside `tokens.css`.
- [ ] Lucide icons only, no emoji; status = icon + word + color.
- [ ] Hover and press states with a 150–250 ms transition; reduced motion respected.
- [ ] Visible focus on every interactive element; keyboard path works end to end.
- [ ] Targets ≥ 44 px; works at 375 px with no horizontal page scroll.
- [ ] Light and dark both checked; text contrast ≥ 4.5:1 (body ≥ 7:1).
- [ ] Amounts tabular, right-aligned, Czech format.
- [ ] Click budget (07 §2) met for the flow touched.
- [ ] Czech labels fit at 375 px (Czech runs ~20 % longer than English).
- [ ] axe 0 violations; 375 px screenshot in the report.
- Screenshots and axe: in 0023d. Amounts and click budget: not applicable.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or the brief this one depends on is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `next build` fails to download Inter from Google (network error): STOP, do not switch to another font loader;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency or lockfile change beyond this brief seems needed;
- a file outside §3 needs a change (including Next rewriting `apps/web/tsconfig.json`);
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0023c-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0023c report" && git push -u origin task/0023c-web-theme 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `theme-actions.ts`: input parsed by `parseTheme`, cookie `httpOnly` + `sameSite: 'lax'`, nothing else written.
- `app/layout.tsx`: the cookie value reaches the HTML only through `themeAttribute(parseTheme(…))` (no raw cookie in markup).
- `theme-switch.tsx`: visible label bound to the select, focus ring, tokens only.

## Owner steps

None.
