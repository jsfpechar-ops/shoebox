# 0044a report: login by e-mail link only

Status: blocked (e2e and screenshot not run: Playwright browser missing in this session)
Branch: claude/project-thread-bpqq3g, local commits 2c84e93..4fbe1c8 (steps 1-10), not pushed.
Base check: PR #92 merge 20ad1cd is the head of origin/phase/0 and the parent of the brief commit.

## Files changed (git diff --stat 1add4cf..HEAD)

apps/web/e2e/auth-live.spec.ts   |  50 ++-----------------
 apps/web/e2e/auth.setup.ts       |  24 +++------
 apps/web/e2e/auth.spec.ts        |  94 ++++++++++-------------------------
 apps/web/e2e/fixtures.ts         |  68 ++++++++++++++++++++++++-
 apps/web/src/auth/actions.ts     |  36 +-------------
 apps/web/src/auth/login-form.tsx | 105 +++++++++++----------------------------
 apps/web/src/auth/schemas.ts     |  23 +--------
 apps/web/test/schemas.test.ts    |  24 ++-------
 packages/i18n/messages/cs.json   |   7 +--
 packages/i18n/messages/en.json   |   7 +--
 supabase/config.toml             |  10 ----
 11 files changed, 141 insertions(+), 307 deletions(-)

## Commands (§6)

- `pnpm --filter @shoebox/web test`: Test Files 10 passed (10), Tests 91 passed (91).
- `pnpm --filter @shoebox/web typecheck`: no errors, exit 0.
- `pnpm --filter @shoebox/i18n test`: Test Files 3 passed (3), Tests 24 passed (24).
- `pnpm --filter @shoebox/web e2e -- auth`: NOT RUN TO COMPLETION. Setup failed before any test: `browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. Playwright asks for `pnpm exec playwright install`. Last lines: "1 failed [setup] › e2e/auth.setup.ts:9:1 › sign the e2e user in with the e-mail link", "33 did not run", "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL", "Exit status 1". Environment issue, not caused by this change. 0 tests ran, so the 0-failed, 0-skipped bar is unverified.
- `pnpm exec biome check apps/web packages/i18n`: "Checked 66 files ... No fixes applied."
- `python3 scripts/context_lint.py`: "next free: task 0040 | migration 0008", "context lint: OK" (4 existing WARN lines, none from this change).

## §7 Acceptance

- [ ] All §6 commands pass: NO, the e2e line did not run (see above).
- [x] Grep for `signInWithPassword|passwordLoginSchema|PASSWORD_MIN_LENGTH|auth.password.|external.google` prints nothing.
- [ ] 375 px screenshot of `/prihlaseni`: NOT TAKEN (needs the browser).

## Deviations

- Step 10 wrote `expect(page.locator('input[type="password"]')).toHaveCount(0);` into the new login test (brief §4 step 10 text). The step's own grep for `password` therefore still matches `apps/web/e2e/auth.spec.ts:49`. Left as written; it asserts the password input is gone.
- Step 3 removed the `touchLastSeen` import, as the brief says. Its only use was in the deleted `signInWithPassword`.
- Commit trailers use Claude Opus 5.5, as the orchestrator's message asked.

## Questions

- None blocking. The screenshot and e2e need a browser in the session.

## Owner / next steps

1. In the session (or on your machine): `pnpm exec playwright install chromium`.
2. Run `pnpm --filter @shoebox/web e2e -- auth 2>&1 | tail -30` and confirm 0 failed, 0 skipped.
3. Take the 375 px screenshot of `/prihlaseni` and place it in `test-results/`.
4. Push the branch and open the PR to `phase/0` once the e2e is green.

## Orchestrator review (2026-10-25)

e2e rerun with the preinstalled Chromium (`PLAYWRIGHT_BROWSERS_PATH` shim, no install): projects setup, desktop-chromium, mobile-chromium: **57 passed, 2 failed**. Both failures are `shell.spec.ts` "Inter is self-hosted", which expects `.woff2` files and has been broken since 0043a removed Inter (not this change); fixed in 0044b. mobile-webkit cannot run in this container (no WebKit). Accepted.
