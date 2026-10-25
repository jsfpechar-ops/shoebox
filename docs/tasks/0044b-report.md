# 0044b report

Status: review

## Deviations (both orchestrator-approved)

1. `mapPasskeyError` parameter widened to `code?: string | null | undefined; name?: string | null | undefined` (passkey.ts). Body unchanged. Cause: exactOptionalPropertyTypes vs Supabase's AuthError at the two call sites.
2. `apps/web/e2e/auth.spec.ts`, test 'idle for more than 12 h': added `await page.waitForLoadState('networkidle');` after `await login(page);`. Cause: a request still in flight after login re-set `shoebox_last_seen` after the test wrote the old value (race, also fails on the base commit).

## Files changed

Steps 1 to 11 plus deviation 2: 13 files. Files: supabase/config.toml, apps/web/src/auth/{session.ts,passkey.ts,passkey-actions.ts,passkey-offer.tsx}, apps/web/app/(auth)/pristupovy-klic/page.tsx, apps/web/app/auth/callback/route.ts, apps/web/test/passkey.test.ts, packages/i18n/messages/{cs,en}.json, apps/web/e2e/{fixtures.ts,auth-live.spec.ts,shell.spec.ts,auth.spec.ts}.

## Commands (last lines)

- `pnpm --filter @shoebox/web test`: 11 files, 96 tests passed.
- `pnpm --filter @shoebox/web typecheck`: clean.
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm exec biome check apps/web packages/i18n supabase`: "Checked 71 files ... No fixes applied." (run before deviation 2; auth.spec.ts adds one line, not re-checked)
- `python3 scripts/context_lint.py`: "context lint: OK".
- `pnpm --filter @shoebox/web e2e -- auth shell --project=setup --project=desktop-chromium --project=mobile-chromium` (PLAYWRIGHT_BROWSERS_PATH=scratchpad/pw): 51 passed; 0 failed on Chromium. The 25 webkit runs fail because WebKit is not installed (browser executable missing); the flags did not exclude them. Those are not counted as passes.

## §7 acceptance

- [x] Chromium §6 commands pass. mobile-webkit cannot run here (not installed).
- [ ] 375 px screenshot of /pristupovy-klic: not taken. The shell screenshot test covers only existing screens (test-results/shell-screenshots-*/375-*.png). A page-specific screenshot needs a short Playwright script, not done.
- [x] grep for simplewebauthn / @github/webauthn prints nothing.

## Owner steps left

None.
