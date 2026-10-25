# 0014b report

Status: review
Branch: task/0014b-db-tenancy (from origin/phase/0; the brief's task/0014-db-scaffold was already merged)

## Files changed (git diff --stat origin/phase/0)
- packages/db/migrations/0002_tenancy.sql (new)
- packages/db/migrations/meta/_journal.json (entry 1)
- packages/db/scripts/supabase-shim.sql (new)
- packages/db/scripts/local-pg.sh (new, executable)
- packages/db/src/migrate.ts (new)
- packages/db/src/schema/tenancy.ts (new)
- packages/db/src/index.ts (exports)
- packages/db/test/migrations/tenancy.db.test.ts (new)
- docs/tasks/0014b-report.md, brief Status line

## Commands (last lines)
- local-pg.sh start: `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test`
- `pnpm --filter @shoebox/db test migrations` (with DATABASE_URL): `Tests 9 passed (9)`
- `pnpm --filter @shoebox/db typecheck`: exit 0, no errors
- `pnpm lint`: `Checked 148 files ... No fixes applied.` exit 0
- `pnpm --filter @shoebox/db test` without DATABASE_URL: `Test Files 3 passed (3)`, `Tests 24 passed (24)` (see Questions)
- `bash packages/db/scripts/local-pg.sh stop`: `stopped`
- Brief's `-- migrations` form runs all 3 db files (37 passed); not used, per executor rules.

## §7 acceptance
- [x] 0002 creates tables, trigger, helpers, RLS; both migrations apply from scratch via runMigrations
- [x] tenancy.db.test.ts: 9 tests pass against DATABASE_URL
- [x] Enum parity against live DB (test 2)
- [x] tenancy.ts typechecks
- [x] lint and typecheck pass; no-DB run skips the db test

## Deviations
- Commits: step 3 (shim) landed inside the step 2 commit (fead2ca); step 6 (tenancy.ts) inside step 5 (91e20d2). Step 8 commit amended to message "0014b step 8" (c7e723a). Content is unchanged.
- Not run: `pnpm exec vitest run --project db` and `pnpm --filter @shoebox/db test` with DATABASE_URL (3 files) from §6.
- Plain Postgres 16.x via runuser as root worked; no STOP.

## Questions
- No-DB run shows 24 passed and no skipped count, while the brief expects 28 passed, 9 skipped. Please check the expected count.

## Owner steps left
- None for this part. P0-CI-02 runs the db job against Supabase.
- Not in this ticket: invitations (later DB ticket), app_worker (P0-DB-02), supabase/config.toml and root db scripts (0014c).
