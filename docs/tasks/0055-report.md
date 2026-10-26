# 0055 report: test environment signs in by itself

Status: review

## Files changed (my commits: cc4732b, 2357b2f, 76c9696, d47e1be)

- `apps/web/src/auth/test-autologin.ts` (new, 13 lines): `testAutoLogin(env)`
- `apps/web/test/test-autologin.test.ts` (new, 27 lines): 3 tests
- `apps/web/middleware.ts` (+20): import after the `last-seen` import; sign-in block after the cookie check, before `decide(`

Against `origin/phase/0` the stat also lists `deploy/render-test.yaml`, `docs/context/decisions.md` and `docs/tasks/0055-test-autologin.md`. These come from the orchestrator's commit `e341fdf`, already on the branch, not from this executor run.

## Checks

- `pnpm --filter @shoebox/web test -- test/test-autologin.test.ts`: 161 passed, 22 files. Expected 3 new passes. Note: the `--` argument did not filter, so the whole web suite ran. All green.
- `pnpm --filter @shoebox/web test -- test/guard.test.ts test/test-autologin.test.ts`: 161 passed, 22 files, all green.
- `pnpm --filter @shoebox/web typecheck`: clean, no output.
- `biome check` on the three files: first run reported formatting only (2 files). Ran `biome check --write`, then re-check: "Checked 3 files. No fixes applied." Clean.

## Deviations

- Biome `--write` reformatted the brief's test file (`test-autologin.test.ts`) as the brief allows. It is committed as a separate commit "0055 step 2 (biome format)".
- Test runs executed the full web test suite (see above), because the `--` argument does not filter vitest here. Not a failure, but it costs more than the brief intended.

## Questions

- None.

## Owner steps left

- Merge via the normal phase flow. Set `APP_ENV=test`, `SHOEBOX_TEST_AUTOLOGIN_EMAIL` and `SHOEBOX_TEST_AUTOLOGIN_PASSWORD` on Render for the test service only. The Supabase test user must exist (created in the dashboard with e-mail and password).
