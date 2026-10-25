# 0030d report: login guard (steps 7-10)

Status: review. Steps 1-6 were committed earlier at bceba59. Steps 7 and 8 are committed as `0030d step 7` and `0030d step 8`.

## Diff stat (git diff --stat origin/phase/0)

```
.env.example                         |   5 +
apps/web/app/(app)/layout.tsx        |   6 +-
apps/web/e2e/auth-live.spec.ts       |  78 +++
apps/web/e2e/auth.spec.ts            | 208 +++
apps/web/middleware.ts               |  75 +++-
apps/web/src/auth/logout-buttons.tsx |  20 +
supabase/config.toml                 |  14 ++-
turbo.json                           |  10 +-
8 files changed, 404 insertions(+), 12 deletions(-)
```

## Commands (last lines)

- Typecheck (`pnpm --filter @shoebox/web typecheck`): tsc ran with no `error TS` lines.
- E2E (`pnpm exec playwright test --project desktop-chromium --project mobile-chromium`): `61 passed (1.5m)`. No failures, no retries. The headers AC-8 test passed on the first run.
- Biome (`pnpm exec biome check --write apps/web turbo.json`): `Checked 53 files in 3s. No fixes applied.`
- Lint (`pnpm lint`): last lines are `check:tenant-sql: 100 files, no Drizzle call on a tenant table outside withTenant()` and a test-run summary with no errors.
- Depcruise (`pnpm depcruise`): `✔ no dependency violations found (241 modules, 463 dependencies cruised)`.
- Build (`NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build`): the route table printed (`ƒ Middleware 95.6 kB`, `ƒ (Dynamic) server-rendered on demand`). The `✓ Compiled successfully` line was above the `tail -6` window, so it is not shown here.
- `git status` after the format and build: clean. Nothing changed, so no extra commit.

## Section 7 (P0-AUTH-01)

- [x] auth-live.spec.ts: magic link flow, cookies, single use (passed in E2E).
- [x] auth.spec.ts: redirects, next, wrong password, password cookies, logout, logout-all, idle, last_seen (passed in E2E).
- [x] Login page: two labelled forms, 375 px no overflow (passed in E2E). The axe auto-fixture is not confirmed for this page here.
- [x] supabase/config.toml: `minimum_password_length = 12` (line 183). Provider and redirect checks were not re-read in this step.
- [x] .env.example and turbo.json were changed in steps 1-6 (not re-verified here).
- [x] 61 E2E passed on the two Chromium projects. mobile-webkit is not run here.
- [ ] Real Supabase plus Mailpit run: owner step 1, not run.

## Screenshot

`375-inbox.png` (test-results/shell-screenshots-of-every-64161--and-1440-px-for-the-report-desktop-chromium/): header shows the title "Shoebox", a theme select ("Podle systému"), and two logout buttons ("Odhlásit", "Odhlásit všude"), with the bottom bar and the Inbox heading below.

## Deviations

- The typecheck commands for steps 7 and 8 were not run separately after each file. The typecheck was run once after step 10 instead, and it passed.

## Questions

None.

## [verify] (M12 V2.1)

- `grep -n 'minimum_password_length\|password_requirements' supabase/config.toml`:
  - `183:minimum_password_length = 12`
  - `186:password_requirements = ""`
- `grep -rn 'leaked\|hibp\|pwned' supabase/config.toml`: no output. The leaked-password check is not in the CLI config; it is a hosted dashboard setting (Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords").
