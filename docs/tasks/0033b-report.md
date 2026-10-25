# 0033b report

Status: review. Branch task/0033-db-platform, commits `0033b step 1` (8404056) to `0033b step 5` (5b948ae), then this report.

## 1. Files changed (vs. the 0033a head)

- `packages/db/src/schema/platform.ts` (new): six `pgTable` mirrors of 0007 (`cost_usd` numeric(10,4), no float columns).
- `packages/db/src/schema/index.ts`: `export * from './platform'`.
- `packages/db/src/rate-limit.ts` (new): `rateLimitHit(key, max, windowS, db)` and type `RateLimitDb`.
- `packages/db/src/index.ts`: exports `rateLimitHit`, `RateLimitDb`, `./schema/platform`.
- `packages/db/test/rate-limit.db.test.ts` (new): 4 tests.
- `packages/db/test/migrations/platform.db.test.ts` (new): 6 tests.
- `docs/tasks/0033b-db-platform-schema.md`: Status line only (todo to review).
- `docs/tasks/0033b-report.md` (new).

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/db typecheck`: no errors (tsc prints no diagnostics).
- `pnpm --filter @shoebox/db test rate-limit.db.test.ts` (DATABASE_URL set): `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm --filter @shoebox/db test platform.db.test.ts` (DATABASE_URL set): `Tests 6 passed (6)`.
- `pnpm --filter @shoebox/db test` (DATABASE_URL set, full suite): `Test Files 14 passed (14)`, `Tests 107 passed (107)`.
- `pnpm exec biome ci packages/db`: `Checked 33 files ... No fixes applied.`
- `pnpm check:tenant-sql`: `105 files, no Drizzle call on a tenant table outside withTenant()`.
- `python3 scripts/pii_guard.py --all <4 files>`: `pii_guard: OK`.
- `env -u DATABASE_URL pnpm --filter @shoebox/db test`: `Tests 29 passed | 78 skipped (107)`.
- Acceptance greps: `pgTable(` in platform.ts = 6; `doublePrecision|real(` = 0; `rateLimitHit` in index.ts = 1.

## 3. §7 acceptance

- [x] rate-limit 4 passed; platform 6 passed; full suite passes with DATABASE_URL (run once after both files were written; not run twice in a row).
- [ ] Not checked: the psql leftover-row queries (`ffffffff-%` orgs, `test:%` counters). See the cleanup note in §4.
- [x] pgTable count 6; no float columns; `numeric('cost_usd', { precision: 10, scale: 4 })`.
- [x] `rateLimitHit` in index.ts; typecheck; biome ci; check:tenant-sql.

## 4. Deviations

- Test counts differ from the brief's expectations: the full suite is 107 (14 files), not 105 (13 files); without DATABASE_URL it is 29 passed / 78 skipped, not 28 / 77. The two new files account for 4 + 6 tests as written; the extra baseline comes from the branch state after 0033a, which the brief writer did not have.
- Test commands were run per file (`pnpm --filter @shoebox/db test <file>`) as the executor brief requires; the full-suite command was run once more with DATABASE_URL.
- Step 2 commit ran in parallel with its Edit call; the commit succeeded, so the edit was in place and the commit contains only `schema/index.ts`.
- Step 2 and 3 greps (`check:tenant-sql`, `biome ci`, db test without DB after steps 1-3) were skipped per the executor prompt (typecheck once after steps 1-3); the step 6 checks were run at the end.

## 5. Questions

- None blocking. The brief's test counts (105 / 28 / 77) should be updated to 107 / 29 / 78 if they are used as acceptance baselines.

## 6. Owner steps left

- Review the PR-less branch `task/0033-db-platform`; the owner merges it into `phase/0` as the brief states.
