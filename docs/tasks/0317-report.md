# 0317 report

Status: done
Done: steps 1 to 4.

## Files changed
- `packages/pipeline/src/jobs.ts`: four M04 job definitions and constants.
- `packages/pipeline/test/jobs.test.ts`: import extended, `M04 jobs` describe block.
- `packages/db/src/document-categorize.ts`: new. `loadDocumentForCategorize` and `saveCategorization` implemented with Drizzle (no schema change).
- `packages/db/src/index.ts`: `export * from './document-categorize';`.

## Commands
- `pnpm --filter @shoebox/pipeline typecheck`: pass, 0 errors.
- `pnpm --filter @shoebox/pipeline test -- jobs`: 20 passed (20).
- `pnpm --filter @shoebox/db typecheck`: pass, 0 errors.
- `pnpm --filter @shoebox/db test -- rls` (DB wt0317 from template ci): 156 passed, 3 failed. All 3 are in `test/rls/storage.db.test.ts`, "permission denied for table objects" on `storage.objects`. The failing code is the storage RLS test (Supabase shim), which this change does not touch. Not investigated further.
- `biome check --write` on all touched files: formatting only, applied.

## Deviations
- Step 3 brief gave bodiless declarations (TS2391). Implemented the bodies per the doc comments, as the coordinator instructed.
- `saveCategorization` links new fields to the last inserted categorize run (`extractionRunId`), and sets `setBy` from the field input. The brief did not say which run to link.
- Question dedupe uses `answered_at IS NULL` for "unanswered".
- `runs` insert also writes `ok` and `error` from the input.

## Questions
- Storage RLS test failures (3): environment or pre-existing? Owner or orchestrator to decide.

## Owner steps left
- None.
