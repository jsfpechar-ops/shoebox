# 0027 report

Status: blocked
Branch: task/0027-ci-db-job (local commits 927f8a9, 6cd0c6f, ee0e4d6, 7b12be1, 28edcf4; report commit follows)
Done: steps 1 to 5. Left: none of the brief's steps. Orchestrator: rebase onto current origin/phase/0 (see Deviations), then open the PR against phase/0 and read the `db` run.

## 1. Files changed (in this branch, vs. the base it was created from)

- `scripts/migration-lint.ts` (new, 146 lines)
- `scripts/test/migration-lint.test.ts` (new, 137 lines)
- `vitest.workspace.ts` (+1: `scripts/test/**/*.test.ts` in `unit`)
- `.github/workflows/ci.yml` (+ jobs `db` and `migration-lint`, appended after `depcruise`)
- `docs/tasks/0027-report.md` (this file)

`docs/context/test-map.md` (+1 row) is also changed. `git diff --stat origin/phase/0` also shows unrelated changes, see Deviations.

## 2. Commands (§6 and negative check)

- `vitest run --project unit scripts/test/migration-lint.test.ts`: `Test Files 1 passed (1)`, `Tests 15 passed (15)`. Run after step 3 (see Deviations).
- `vitest list --project unit | grep -c migration-lint`: `15`
- `node scripts/migration-lint.ts`: `migration-lint: OK (all file(s))`
- `biome ci scripts/migration-lint.ts scripts/test/migration-lint.test.ts vitest.workspace.ts`: `Checked 3 files ... No fixes applied.`
- `pnpm --filter @shoebox/db exec drizzle-kit check`: `Everything's fine`
- YAML parse of ci.yml: `['context-lint', 'db', 'depcruise', 'lint', 'migration-lint', 'pii', 'secrets', 'setup', 'typecheck', 'unit']`
- `python3 scripts/context_lint.py`: `context lint: OK` (WARN about 29 commits since status.md is expected)
- Negative check (fixture in the scratchpad, not in the repo): `::error file=...,line=3::drop-column: "alter table a drop column x" needs a "-- contract: <ticket>" header`, `migration-lint: 1 violation(s)`, `exit=1`
- actionlint 1.7.7 (downloaded once, succeeded): `actionlint .github/workflows/ci.yml` gave no output, `rc=0`.

## 3. §7 acceptance

- [x] 15 tests pass through the root `unit` project; `vitest list` counts 15
- [x] `node scripts/migration-lint.ts` passes on the current migrations; exits 1 with `::error` on the fixture
- [x] ci.yml parses, lists `db` and `migration-lint`; `drizzle-kit check` passes
- [x] Biome clean on the three TS files; `context lint: OK`
- [ ] On the PR (orchestrator): `db`, `migration-lint`, `unit` green

## 4. Deviations

1. Base commit. The brief says base `f90bf08`. The branch was created with `git checkout -B task/0027-ci-db-job origin/phase/0`, and its merge-base with origin/phase/0 is `a2c7cd6`. origin/phase/0 now points at `f71a765` (merge of PR #42, 0023a). The branch is behind that. The diff against origin/phase/0 therefore shows its changes as reversed (`apps/web/tsconfig.json`, `docs/tasks/0023a-report.md`, `pnpm-lock.yaml`), not as changes this brief made. Not rebased, because the cap was reached. Rebase onto `origin/phase/0` before the PR, then check that `vitest.workspace.ts`, `ci.yml` and `test-map.md` do not conflict.
2. Step 2 command expects 15 passed, but before step 3 the file is outside the `unit` include and vitest reports "No test files found". It passes after step 3, as the brief's order implies.
3. The negative fixture is in the session scratchpad, not `/tmp/0099_bad.sql` as the brief names.
4. The security hook warned on the ci.yml edit about untrusted `github.event` fields. The new `migration-lint` job only reads `github.event.pull_request.base.sha`, `head.sha`, `before` and `github.sha` through `env:`, all of them commit SHAs. No change made.

## 5. Questions

- Is the rebase onto `f71a765` to be done by the executor, or by the orchestrator?

## 6. Owner steps left

None for this brief.

## fix-1

- Cause: migration 0003 creates `app_worker` with LOGIN and no password. The local Supabase cluster uses scram, so the `with-tenant` tests fail with 28P01 (`password authentication failed for user "app_worker"`).
- Edit A: `.github/workflows/ci.yml`, job `db`, adds `WORKER_DATABASE_URL` with a throwaway password for the ephemeral CI database only.
- Edit B: new step after the first migrate, `alter role app_worker password 'ci-local-only'` via `psql "$DATABASE_URL"`.
- Check: `YAML OK`. `app_worker` appears on three lines (env, step name, step run).
