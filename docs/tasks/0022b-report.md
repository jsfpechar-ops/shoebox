# 0022b report: withTenant, withServiceRole, worker isolation test

Status: review

## Files changed (vs origin/task/0022-db-with-tenant)

- `packages/db/src/tenant.ts` (new, 117 lines)
- `packages/db/src/index.ts` (edit: export block after the tenancy export)
- `packages/db/test/with-tenant.db.test.ts` (new, not edited afterwards)
- `docs/tasks/0022b-db-with-tenant.md` (Status line only)
- `docs/tasks/0022b-report.md` (this file)

Note: `git diff --stat origin/phase/0` lists 21 files, mostly unrelated deletions (testkit, lockfile). `origin/phase/0` has moved ahead of this branch's base, so that diff is not this brief's change set.

## Commands (last lines)

- `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test`: `Test Files 4 passed (4)`, `Tests 49 passed (49)`
- `DATABASE_URL=... pnpm exec vitest run --project db`: `Test Files 2 passed (2)`, `Tests 21 passed (21)`
- `pnpm --filter @shoebox/db test` without DATABASE_URL: `Tests 28 passed | 21 skipped (49)`
- `pnpm --filter @shoebox/db typecheck`: exit 0
- `pnpm exec biome ci packages/db vitest.workspace.ts`: `Checked 15 files`, `No fixes applied.`
- `grep -c 'process.env' packages/db/src/tenant.ts`: `0`
- `grep -n "export function withTenant\|export function withServiceRole"`: lines 100 and 105

## Section 7 acceptance

- [x] with-tenant.db.test.ts: 12 pass with DATABASE_URL, 12 skip without (21 skipped across the db package); tenancy.db.test.ts still passes
- [x] process.env count in tenant.ts is 0
- [x] both export signatures present
- [x] typecheck exit 0; biome clean
- [ ] PR: not opened (brief step 7 forbids it for the executor; the orchestrator opens it)

## Deviations

- Ran the package tests with `pnpm --filter @shoebox/db test` (no `-- <file>`), per the executor instructions; same tests as the brief's command.
- Local cluster started with `packages/db/scripts/local-pg.sh`, stopped at the end.

## Questions

- None.

## Owner steps left

- None for this PR. Before the worker ships (P0-WORK), set the `app_worker` password on Supabase and store `WORKER_DATABASE_URL` as a worker secret (see 0022a).
