# 0023b report: app shell, nav and four screens

Status: review
Branch: task/0023b-web-shell-nav | Base: origin/phase/0 (f71a765)

## Files changed (git diff --stat origin/phase/0)

8 files, 176 insertions: packages/i18n/messages/cs.json and en.json (11 keys each), apps/web/src/shell/app-nav.tsx, apps/web/app/(app)/layout.tsx, and the four pages inbox, prehled, ucetni, nastaveni.

## Commands (last lines)

- `pnpm --filter @shoebox/i18n test`: Test Files 3 passed (3), Tests 24 passed (24).
- `pnpm --filter @shoebox/web typecheck`: tsc -p tsconfig.json, no errors.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build`: Compiled successfully; routes /inbox, /nastaveni, /prehled, /ucetni listed as static.
- `pnpm lint`: biome checked 195 files, no fixes applied, 1 info (biome config migration hint, not an error); i18n check passed 24/24.
- `pnpm exec biome check --write apps/web packages/i18n`: Checked 26 files, no fixes applied.

## Section 7 (acceptance)

- [x] Build lists four routes.
- [x] Nav code: 4 data-nav-item links in order; "+" is md:hidden; no hamburger. (Not checked in a browser; 0023d E2E.)
- [x] Skip link href="#obsah" is first in the shell; header, nav (aria-label from shell.nav.label), main#obsah.
- [x] i18n catalog test passes with the 11 keys in cs and en.
- [ ] 07 §9 checklist, axe and 375 px screenshot: deferred to 0023d, as the brief says.

## Deviations

- Steps 5 to 8 (four pages) were written in one batch and committed as one commit "0023b step 5-8" instead of four commits. Content is exactly as given.
- Step 1 test was run and failed as the brief expected (en missing) before step 2 was applied; it passes after step 2.

## Questions

None.

## Owner steps

None.
