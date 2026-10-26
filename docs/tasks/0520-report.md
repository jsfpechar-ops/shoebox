# 0520 report: pipeline_events

Status: blocked (step 12: context lint fails)

## Files changed (git diff --stat vs 886fc60)
- packages/db/migrations/0063_pipeline_events.sql (new)
- packages/db/migrations/meta/_journal.json (idx 21 appended, when 1793056249430)
- packages/db/src/schema/pipeline-events.ts (new), schema/index.ts (export)
- packages/db/src/rls-catalog.ts (pipeline_events in READ_ONLY_FOR_USERS)
- packages/db/src/document-reading.ts (read and read_failed events)
- packages/db/test/migrations/pipeline-events.db.test.ts (new), packages/db/test/document-reading.db.test.ts (one case)
- docs/v3/05-data-model.md (DDL, paragraph, §10.2 list), docs/context/decisions.md (one line)
- docs/tasks/0520-pipeline-events.md (status todo, per orchestrator)

## Commands
- migration-lint (all): OK
- db typecheck: clean
- biome ci packages/db: clean after `biome format --write` on the two test files I touched (only my lines)
- vitest pipeline-events, document-reading, audit-document (DATABASE_URL local PG 16): 12 passed, 0 skipped
- context_lint.py: FAIL. `docs/context/decisions.md ~2232 tokens > cap 2200`. My one appended line pushed it over. Also WARN: packages/testkit/src/factories/filings.ts named by briefs 0340/0341; status.md is behind.
- Not run: `meta` test file (no such file under packages/db/test/migrations). The brief's `-- meta` pattern matched nothing; pnpm filter ran all 36 files because the pattern was passed after `--`.

## Deviations
- Journal: my first read said it was out of sync. Orchestrator confirmed all 21 files are journaled, unsorted. Appended 0063 at idx 21 as instructed.
- Test command ran with `npx vitest run` in packages/db (pnpm filter did not narrow the run).

## Questions
- Compact docs/context/decisions.md below 2200 tokens (or allow the cap change). I did not edit it beyond the one line.

## Owner steps left
- None for the DB. Push is not done (per brief).
