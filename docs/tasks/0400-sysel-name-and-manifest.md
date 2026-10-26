# 0400: Sysel name and home-screen manifest

Status: todo
Ticket: P1-TRUST-01 (part 1), lane D | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The UI shows the working name "Sysel" instead of "Shoebox", and the app can be installed on a phone's home screen (web app manifest + icon). The repo and package names stay `shoebox`.

## 2. Context

- Owner 2026-10-26: working name SYSEL, not final. Only user-visible copy changes.
- Strings only through `packages/i18n` (`en.json` defines keys; `cs.json` is dormant: change only the `shell.app.name` value there too, so it does not say Shoebox).
- Next.js 15 file conventions: `app/manifest.ts` default-exports a function returning `MetadataRoute.Manifest` (served at `/manifest.webmanifest`, linked automatically); `app/icon.svg` is served at `/icon.svg` and linked automatically.
- The middleware guard sends every non-public path to the login page. The manifest and icon must be public (browsers fetch them without cookies). `apps/web/src/auth/guard.ts` line 4:
  `export const PUBLIC_PATHS = [LOGIN_PATH, '/auth/callback', '/api/health'] as const;`
- Theme colours: the manifest needs literal hex values (CSS tokens are not available there). Use `#FFFFFF` background and `#37352F` theme colour (07 design system, Notion text colour); this is the one allowed raw-colour exception, add the comment `// manifest needs literal colours (07 tokens: background, foreground)`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/i18n/messages/en.json` | edit | name value + 3 new keys |
| `packages/i18n/messages/cs.json` | edit | `shell.app.name` value only |
| `apps/web/app/manifest.ts` | new | manifest |
| `apps/web/app/icon.svg` | new | app icon |
| `apps/web/src/auth/guard.ts` | edit | two public paths |
| `apps/web/test/guard.test.ts` | edit | expected list |
| `apps/web/test/manifest.test.ts` | new | test below |

## 4. Steps

1. `en.json`: change `"shell.app.name": "Shoebox",` to `"shell.app.name": "Sysel",`; change `"proto.page.title": "Shoebox – document reading prototype",` to `"proto.page.title": "Sysel – document reading prototype",`. Directly after the `shell.app.name` line add:
   ```
     "shell.manifest.short_name": "Sysel",
     "shell.manifest.description": "Your invoices and receipts, read and checked for you.",
     "shell.manifest.shortcut_upload": "Add a document",
   ```
   `cs.json`: `"shell.app.name": "Shoebox",` → `"shell.app.name": "Sysel",` and the `proto.page.title` value `Shoebox –` → `Sysel –`. Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` (pass; if it complains that cs lacks the 3 new keys, that is expected to be allowed for dormant cs; if it fails, add the same 3 English lines to cs.json).
2. New `apps/web/app/icon.svg`:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#37352F"/><path d="M144 176h224v208a32 32 0 0 1-32 32H176a32 32 0 0 1-32-32z" fill="#FFFFFF"/><path d="M120 144h272v48H120z" fill="#FFDD00"/></svg>
   ```
3. New `apps/web/app/manifest.ts`:
   ```ts
   import { t } from '@shoebox/i18n';
   import type { MetadataRoute } from 'next';

   /** Home-screen install (M01 §4.1.1 PWA). Served at /manifest.webmanifest, public (guard.ts). */
   export default function manifest(): MetadataRoute.Manifest {
     // manifest needs literal colours (07 tokens: background, foreground)
     return {
       name: t('shell.app.name'),
       short_name: t('shell.manifest.short_name'),
       description: t('shell.manifest.description'),
       start_url: '/inbox',
       scope: '/',
       display: 'standalone',
       background_color: '#FFFFFF',
       theme_color: '#37352F',
       icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
       shortcuts: [{ name: t('shell.manifest.shortcut_upload'), url: '/inbox' }],
     };
   }
   ```
4. `guard.ts`: replace the PUBLIC_PATHS line with
   `export const PUBLIC_PATHS = [LOGIN_PATH, '/auth/callback', '/api/health', '/manifest.webmanifest', '/icon.svg'] as const;`
   and in the doc comment above it append `, the web app manifest and its icon`. In `apps/web/test/guard.test.ts` change the expected array to `['/prihlaseni', '/auth/callback', '/api/health', '/manifest.webmanifest', '/icon.svg']`. Run `pnpm --filter @shoebox/web test -- guard 2>&1 | tail -30` (pass).
5. New `apps/web/test/manifest.test.ts` (do not edit after writing):
   ```ts
   import { describe, expect, it } from 'vitest';
   import manifest from '../app/manifest';

   describe('web app manifest', () => {
     it('installs as Sysel, opens the inbox, has an icon', () => {
       const m = manifest();
       expect(m.name).toBe('Sysel');
       expect(m.start_url).toBe('/inbox');
       expect(m.display).toBe('standalone');
       expect(m.icons?.[0]?.src).toBe('/icon.svg');
       expect(m.shortcuts?.[0]?.url).toBe('/inbox');
     });
   });
   ```
   Run `pnpm --filter @shoebox/web test -- manifest 2>&1 | tail -30` (pass) and `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (0 errors).
6. `grep -rn "Shoebox" packages/i18n/messages apps/web/app 2>&1 | tail -5` shows nothing. Run `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15`; fix only formatting in files of §3 (`pnpm exec biome check --write <file>`).

## 5. Do not touch

Package names, `@shoebox/*` imports, README, docs other than this brief and its report. Hard rules 6, 7.

## 6. Commands

As in each step.

## 7. Acceptance

- [ ] guard, manifest tests pass; web typecheck 0 errors; i18n test passes.
- [ ] No "Shoebox" in UI copy.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0400-report.md`, 200 tokens at most: files changed, commands with last 3 lines, deviations. Set `Status: review`.
