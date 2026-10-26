# 0521 report: analytics views and CSV export

Status: review. Branch claude/project-thread-5vgi6d, not pushed.

## Files changed
- new: packages/db/migrations/0064_analytics_views.sql (schema analytics, 5 views, grants)
- new: packages/db/src/analytics.ts (ANALYTICS_VIEWS, toCsv, readAnalyticsView)
- new: packages/db/scripts/analytics-export.ts (CLI, one CSV per view)
- new: packages/db/test/analytics.test.ts, packages/db/test/migrations/analytics-views.db.test.ts
- edit: packages/db/migrations/meta/_journal.json (idx 22, 0064_analytics_views appended)
- edit: package.json (script analytics:export)
- edit: docs/v3/05-data-model.md (one paragraph after pipeline_events 0063)
- edit: docs/tasks/0521-analytics-views.md (Status: review; step 8 wording from the working tree)

## Commands
- `pnpm --filter @shoebox/db exec vitest run --no-file-parallelism --maxWorkers=1 analytics pipeline-events` : 3 files, 10 tests passed (includes the 4 db tests on real rows, app roles get 42501).
- `pnpm --filter @shoebox/db typecheck` : clean.
- `pnpm exec biome ci packages/db package.json` : clean after the fixes below.
- `node scripts/migration-lint.ts` : OK (all files).
- `python3 scripts/context_lint.py` : OK (warnings only, pre-existing).
- `pnpm --filter @shoebox/db exec vitest run --no-file-parallelism --maxWorkers=1 test/rls` : 4 failed, 4 passed. All 4 failures: "testkit: no factory for table pipeline_events". Not caused by 0064; see Deviations.

## Brief §7
- [x] Unit, typecheck, biome, migration lint, context lint pass.
- [x] Db tests for the new views pass locally.
- [x] No file outside §3 changed (plus the brief status line and the journal entry the brief names).

## Deviations
- Biome flagged console use in the CLI: replaced console.log/error with process.stdout.write / process.stderr.write (same output).
- Biome format: ran `biome format --write` on the four new TypeScript files (formatting only).
- `analytics-out/` not added to .gitignore: the file is outside §3. Owner may add it.
- Step 8 command: the brief's `-- analytics pipeline-events test/rls` runs all 38 db test files in parallel. Parallel `runMigrations` calls race on `create schema analytics` ("schema already exists"), so the db tests must run with one worker. Suggest the brief use `--no-file-parallelism --maxWorkers=1`.
- test/rls fails on this branch: packages/testkit has no factory for `pipeline_events` (table from 0063/0520). Not in this brief's scope, so I did not touch testkit. Needs a fix in 0520 follow-up or a testkit factory.

## Questions
- Should the RLS suite failure (testkit factory for pipeline_events) be fixed in a 0520 follow-up before merge?

## Owner steps left
- Export after deploy: `DATABASE_URL=<service-role URL> pnpm analytics:export -- --from 2026-10-01 --out analytics-out`. Do not commit the CSVs.
