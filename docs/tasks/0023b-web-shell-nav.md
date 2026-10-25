# 0023b: App shell: nav, skip link and the four screens

Status: review
Ticket: P0-UI-03 (part b of 4) | Depends on: 0023a merged into phase/0 | Base commit: head of phase/0 | Branch: task/0023b-web-shell-nav | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the app shell (skip link, header, nav, main) and the four screens Inbox, Přehled, Pro účetní and Nastavení, with a left rail on desktop and a bottom bar with "+" on mobile. Every later screen lives inside this shell, so keyboard, landmarks and reflow are right once.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. For a file marked "full content" Read it once, then Write it exactly. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0023b step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/` (they are ignored once 0023a is merged). If `tsc` reports an error inside `apps/web/.next/types/`, that is stale build output: run `rm -rf apps/web/.next` and rerun the command once.

**Already in phase/0 (from 0023a, do not change):** `apps/web` builds with Next.js 15.5.27; `app/layout.tsx` (root: `<html lang="cs">`, Inter, `globals.css`); `@shoebox/ui`, `@shoebox/i18n`, `lucide-react` are dependencies of `@shoebox/web`. If `apps/web/app/layout.tsx` or `apps/web/next.config.ts` is missing: STOP.

**From `@shoebox/i18n` (exists):** `t(key, params?)` (Czech), `type MessageKey`. The catalog test requires every cs key in en and keys shaped `<area>.<object>.<element>`. `inbox.title` ("Inbox") already exists.

**From `@shoebox/ui` (exists):** `cn(...classes)`, `focusRing` (3 px `ring-ring`, 2 px offset, `focus-visible`), `motion` (200 ms opacity, `motion-reduce:transition-none`). Import them only in client components (`'use client'`): the ui index also exports Radix primitives, which cannot load in a server component.

**Spec 07 §5 App shell (pasted):** Desktop: a left rail with the four screens: Inbox, Přehled, Pro účetní, Nastavení. Mobile: a bottom bar with the same four, plus a central "+" button. No hamburger menus. Breakpoints 375 / 768 / 1024 / 1440; content max-width 1200 px. Radius 8 px controls, 12 px cards; borders over shadows.

**Spec M11 §3 (pasted):** routes `/` (redirect: owner/member → `/prehled` if any document else `/inbox`; accountant → `/ucetni`), `/inbox`, `/prehled`, `/ucetni`, `/nastaveni`. Navigation: desktop = left rail (64 px, icons + labels on hover; expanded 200 px at wide screens); mobile = bottom tab bar with 4 tabs and a centre button. Later tickets put screens under `apps/web/app/(app)/` (P1-UI-02 adds the "+" menu Nahrát · Vyfotit · Přidat ručně).

**Spec 07 §8 / M11 §9 Accessibility (pasted):** everything reachable by keyboard in visual order; a skip link "Přeskočit na obsah"; landmarks `header`, `nav`, `main`; one `h1` per screen; `lang="cs"`. Focus: a 3 px ring in `--ring` with a 2 px offset, never removed, not obscured by sticky bars (2.4.11). Targets ≥ 44 × 44 px. Reflow: works at 320 px width with no horizontal page scroll. Testing: axe in every Playwright E2E (0 violations).

**Spec 07 §4 (pasted):** Inter via `next/font`, subsets `latin` + `latin-ext` (Czech diacritics), self-hosted, so no requests to Google at runtime. Nothing below 14 px; weights 400/500/600.

**Rules:** every user-facing string through `packages/i18n` (rule 6; the Biome plugin `no-jsx-literal-text` covers `apps/web/**`: JSX text and string-literal `aria-label|title|placeholder|alt` are errors, `aria-label={t('…')}` is fine). Tokens only: color classes are `bg-background`, `bg-card`, `bg-muted`, `bg-primary`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground`, `border-border`, `border-input`, `ring-ring` (from `@shoebox/ui/theme.css`); no hex, no `rgb()`. Rule 7: no dependency beyond those named in this brief.

**Choices made by the brief writer (do not change):**
- One `<nav>` for both layouts: fixed bottom bar below 768 px (`md`), sticky left rail from 768 px, 64 px wide with the label as `title` tooltip and screen-reader text, 200 px with visible labels from 1440 px (`xl`). DOM order is skip link → header → nav → main on every device.
- Nav labels reuse the page-title keys (`inbox.title`, `overview.title`, `accountant.title`, `settings.title`), so a screen's nav word and its `h1` never drift apart. Each nav link carries `data-nav-item` (the E2E test counts these: exactly 4) and `aria-current="page"` when active; the active item gets `bg-muted` + `text-primary`, so it is not shown by color alone.
- The "+" (mobile only, `md:hidden`) links to `/inbox` with `aria-label` "Přidat doklad" and `TODO(P1-UI-02)`; its menu comes with P1-UI-02.
- `main` has `id="obsah"` and `tabIndex={-1}` so the skip link moves focus there; bottom padding `pb-32` keeps content and focus clear of the fixed bottom bar (2.4.11).
- The 11 new keys include the theme words for 0023c, so that brief does not touch the catalogs.
- Lucide icons verified in lucide-react 1.51.0: `Inbox`, `LayoutDashboard`, `Briefcase`, `Settings`, `Plus`.
- No `/` page yet (0023c adds the redirect). The E2E tests for everything here come in 0023d.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/cs.json` | edit | 11 keys (titles, shell, theme words) |
| `packages/i18n/messages/en.json` | edit | the same keys in English |
| `apps/web/src/shell/app-nav.tsx` | new | client nav: rail / bottom bar with "+" |
| `apps/web/app/(app)/layout.tsx` | new | shell: skip link, header, nav, main |
| `apps/web/app/(app)/inbox/page.tsx` | new | `h1` Inbox |
| `apps/web/app/(app)/prehled/page.tsx` | new | `h1` Přehled |
| `apps/web/app/(app)/ucetni/page.tsx` | new | `h1` Pro účetní |
| `apps/web/app/(app)/nastaveni/page.tsx` | new | `h1` Nastavení |

No other file may change. The folder name `(app)` includes the parentheses (a Next route group; it is not part of the URL). Quote the path in shell commands.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0023b-web-shell-nav origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/app`. Expected: `globals.css  layout.tsx`. Otherwise STOP (0023a not merged).

**Step 1: `packages/i18n/messages/cs.json` (edit).** Anchor (verbatim): `  "settings.expert_view": "Pohled pro pokročilé",`. Insert right after it:

```json
  "settings.title": "Nastavení",
  "overview.title": "Přehled",
  "accountant.title": "Pro účetní",
  "shell.app.name": "Shoebox",
  "shell.skip_link": "Přeskočit na obsah",
  "shell.nav.label": "Hlavní navigace",
  "shell.nav.add": "Přidat doklad",
  "shell.theme.label": "Vzhled",
  "shell.theme.system": "Podle systému",
  "shell.theme.light": "Světlý",
  "shell.theme.dark": "Tmavý",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`. Expected: the catalog test fails only on "en has every cs key" (en follows in step 2). Commit.

**Step 2: `packages/i18n/messages/en.json` (edit).** Anchor (verbatim): `  "settings.expert_view": "Expert view",`. Insert right after it:

```json
  "settings.title": "Settings",
  "overview.title": "Overview",
  "accountant.title": "For the accountant",
  "shell.app.name": "Shoebox",
  "shell.skip_link": "Skip to content",
  "shell.nav.label": "Main navigation",
  "shell.nav.add": "Add document",
  "shell.theme.label": "Appearance",
  "shell.theme.system": "System",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
```

Command: `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`. Expected: all pass.

**Step 3: `apps/web/src/shell/app-nav.tsx` (new).**

```tsx
'use client';

import { type MessageKey, t } from '@shoebox/i18n';
import { cn, focusRing, motion } from '@shoebox/ui';
import { Briefcase, Inbox, LayoutDashboard, type LucideIcon, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: MessageKey; icon: LucideIcon };

/** The four screens of the app shell (07 §5, M11 §3), in this order on every device. */
export const navItems: readonly NavItem[] = [
  { href: '/inbox', label: 'inbox.title', icon: Inbox },
  { href: '/prehled', label: 'overview.title', icon: LayoutDashboard },
  { href: '/ucetni', label: 'accountant.title', icon: Briefcase },
  { href: '/nastaveni', label: 'settings.title', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const label = t(item.label);
  const Icon = item.icon;
  return (
    <li className="flex flex-1 md:flex-none">
      <Link
        href={item.href}
        data-nav-item=""
        aria-current={active ? 'page' : undefined}
        title={label}
        className={cn(
          'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control px-1 text-center text-meta text-muted-foreground',
          'hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-primary',
          'md:size-11 md:min-h-11 xl:w-full xl:flex-row xl:justify-start xl:gap-3 xl:px-3',
          motion,
          focusRing,
        )}
      >
        <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
        <span className="md:sr-only xl:not-sr-only">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Mobile (< 768 px): bottom bar with the four screens and a central "+" (07 §5).
 * Desktop: left rail, 64 px with icons (label as tooltip), 200 px with labels from 1440 px. No hamburger.
 */
export function AppNav() {
  const pathname = usePathname();
  const [first, second, third, fourth] = navItems;
  const link = (item: NavItem | undefined) =>
    item ? <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} /> : null;

  return (
    <nav
      aria-label={t('shell.nav.label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]',
        'md:sticky md:top-0 md:h-dvh md:w-16 md:shrink-0 md:border-t-0 md:border-r md:pb-0 xl:w-50',
      )}
    >
      <ul className="flex items-stretch gap-1 px-1 md:flex-col md:items-center md:gap-2 md:px-0 md:pt-4 xl:items-stretch xl:px-3">
        {link(first)}
        {link(second)}
        <li className="flex flex-1 items-center justify-center md:hidden">
          {/* TODO(P1-UI-02): the "+" opens the menu Nahrát · Vyfotit · Přidat ručně. */}
          <Link
            href="/inbox"
            aria-label={t('shell.nav.add')}
            className={cn(
              'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90',
              motion,
              focusRing,
            )}
          >
            <Plus size={24} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
        {link(third)}
        {link(fourth)}
      </ul>
    </nav>
  );
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 4: `apps/web/app/(app)/layout.tsx` (new).** 0023c later adds the theme switch to this file; write this version now.

```tsx
import { t } from '@shoebox/i18n';
import type { ReactNode } from 'react';
import { AppNav } from '../../src/shell/app-nav';

/** App shell (07 §5, §8): skip link, header, nav, main. Server component; AppNav is the client island. */
export default function AppLayout({ children }: { children: ReactNode }) {
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
        {/* 0023c adds the theme switch here. */}
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

**Step 5: `apps/web/app/(app)/inbox/page.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('inbox.title') };

export default function InboxPage() {
  return <h1 className="text-title">{t('inbox.title')}</h1>;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 6: `apps/web/app/(app)/prehled/page.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('overview.title') };

export default function OverviewPage() {
  return <h1 className="text-title">{t('overview.title')}</h1>;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 7: `apps/web/app/(app)/ucetni/page.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('accountant.title') };

export default function AccountantPage() {
  return <h1 className="text-title">{t('accountant.title')}</h1>;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 8: `apps/web/app/(app)/nastaveni/page.tsx` (new).**

```tsx
import { t } from '@shoebox/i18n';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: t('settings.title') };

export default function SettingsPage() {
  return <h1 className="text-title">{t('settings.title')}</h1>;
}
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 9: build, format and lint (no new file).** Command: `pnpm exec biome check --write apps/web packages/i18n 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -15 && git status --short 2>&1 | tail -5 && pnpm lint 2>&1 | tail -8`. Expected: `✓ Compiled successfully`; the route table lists `/inbox`, `/nastaveni`, `/prehled`, `/ucetni`; `git status` lists nothing; lint without errors (the `no-jsx-literal-text` plugin finds no literal text). Commit if anything changed.

## 5. Do not touch

`apps/web/app/layout.tsx`, `globals.css`, `next.config.ts`, `tsconfig.json`, `package.json`, `pnpm-lock.yaml` (no dependency change); `packages/ui/**`; every i18n key not listed in steps 1–2. Hard rules 6 (strings through i18n, tokens only) and 7. Never run `playwright install`.

## 6. Commands

- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → four routes listed.
- `pnpm lint 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] Build lists `/inbox`, `/prehled`, `/ucetni`, `/nastaveni`; each page renders one `h1` from i18n.
- [ ] Nav: 4 `data-nav-item` links in the order Inbox, Přehled, Pro účetní, Nastavení; "+" only below 768 px; no hamburger.
- [ ] Skip link `href="#obsah"` is the first element of the shell; `header`, `nav` (labelled "Hlavní navigace"), `main#obsah`.
- [ ] i18n catalog test passes with the 11 new keys in cs and en.
- 07 §9 pre-delivery checklist (checked by the 0023d E2E run; tick here what the code shows):
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
- Screenshots and axe: in 0023d (Playwright is not installed yet). Amounts and click budget: not applicable (no amounts, no flow).

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

Write `docs/tasks/0023b-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0023b report" && git push -u origin task/0023b-web-shell-nav 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `app-nav.tsx`: 44 px targets (`min-h-14`, `md:size-11`), focus ring kept, `aria-current`, no literal strings.
- `(app)/layout.tsx`: landmark order and skip-link target; server component imports nothing from `@shoebox/ui`.
- `cs.json` / `en.json`: only the 11 keys added; Czech words match 07 §5 and 07 §8 exactly.

## Owner steps

None.
