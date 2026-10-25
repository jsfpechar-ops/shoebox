# 0031a report: security headers

Status: review
Branch: task/0031a-security-headers (base origin/phase/0)

## Done
- Steps 1-6 committed; last commit 838c5d4 "0031a step 6" (adds apps/web/e2e/headers.spec.ts, 4 tests, one Write, typecheck clean).
- `apps/web/test/headers.test.ts` has 12 tests, not the 13 the brief says. Used unchanged.
- Step 7-8 commands run (see below). Step 8 build not run.

## §6 commands (last lines)
- `pnpm --filter @shoebox/web typecheck`: no `error TS`.
- `pnpm exec playwright test --project desktop-chromium --project mobile-chromium`: `31 passed`, `1 failed`. Failure: headers.spec.ts:85 (test 3, AC-8, desktop-chromium), `toHaveValue('dark')` after `page.reload()` got `system`. Not a CSP violation. Rerun with `-g "AC-8"` on desktop-chromium: `1 passed`. Test not edited.
- `pnpm lint`: biome checked 235 files, no fixes, 1 info (config migrate). i18n 24 passed. check:tenant-sql OK.
- `pnpm depcruise`: no dependency violations found (212 modules).
- `headers` and `csp-sonner` vitest files not rerun in this session (step 2/3 reports: 12 and 1 passed).

## §7
- [x] Test 1 (headers), [x] test 2 (nonce), [x] test 4 (every screen) passed in the run.
- [~] Test 3 (AC-8): passed on rerun, failed once on the theme-after-reload check. Flaky.
- [ ] headers.test 13 count: file has 12.
- [x] No new dependency; `.env.example` gains only `CSP_REPORT_URI=`.

## Deviations
- headers.test.ts has 12 tests, not 13.
- `git diff --stat origin/phase/0` shows 25 files and 4430 deletions, including 0029a/0030 briefs, migration 0005_documents_core and packages/db documents schema that this branch does not touch. The branch base differs from origin/phase/0's tip; the orchestrator should diff against the merge base.
- The brief is not in this worktree; read from origin/claude/phase-0-resume-oaa6ss into /tmp/0031a.md. Its Status line was set to `review` in that copy only.

## Questions
- Test 3 flakiness: the theme select is checked right after `page.reload()`. Options: add a wait for `data-theme` before the reload (edits the test file), or accept as flaky.
