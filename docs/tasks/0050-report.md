# 0050 report: English default, Czech dormant

Status: review

## Files changed (`git diff --stat` vs base, excluding docs)

10 files, 71 insertions, 72 deletions: `packages/i18n/src/index.ts`, `packages/i18n/test/catalog.test.ts`, `apps/web/app/layout.tsx`, `packages/ui/test/status-badge.test.tsx`, `apps/web/test/fonts.test.ts`, `apps/web/e2e/{auth,auth-live,fixtures,headers,shell}*.ts`. All within §3. Nothing in §5 touched.

## Commands (last lines)

- `pnpm --filter @shoebox/i18n typecheck`: clean, no cast needed.
- `pnpm --filter @shoebox/i18n test`: 24 passed.
- `pnpm --filter @shoebox/ui test`: 67 passed (after 25 then 2 expectation fixes).
- `pnpm --filter @shoebox/web test`: 91 passed.
- Playwright (Chromium, setup + desktop + mobile): 54 passed, 5 failed. Run via `pnpm exec playwright` from apps/web, since `pnpm ... e2e -- --project=` gave "No tests found".
  - `shell.spec` landmarks (lang): fixed, rerun passes.
  - `auth.spec` idle 12 h: URL stays `/prehled`, no redirect. Idle logic (`apps/web/src/auth/guard.ts`, middleware) does not use i18n. Likely pre-existing, not verified.
  - `shell.spec` Inter self-hosted: 0 woff2 requests. Unrelated to language, likely pre-existing, not verified.
  - Mobile landmarks: same as desktop, passes after fix.
- `pnpm exec biome ci packages/i18n packages/ui apps/web`: clean after `biome format --write` on 2 files.
- `pnpm --filter @shoebox/web typecheck`: clean.

## §7

- [x] `t('inbox.upload.cta')` is "Upload documents"; `createT('cs')` renders Czech.
- [x] i18n, ui, web unit tests pass.
- [ ] e2e on Chromium: 2 failures unrelated to language (see above). Not fully passing.
- [x] Only expectation lines changed (plus the lang test title below).

## Deviations

- Renamed test title `sets lang="cs"` to `lang="en"` in `apps/web/test/fonts.test.ts`.
- Kept Czech test titles in e2e and `status-badge` (only expectations/locators changed).

## Questions

- Are the idle-logout and Inter font e2e failures known on `main`? Please check.

## Owner steps left

None.
