# 0213 report

Commit "0213: spreadsheet import run job". Tests: worker import-run 4 passed (worker 90 total), pipeline 32 passed; typecheck worker/pipeline/db, depcruise, biome, context lint clean.

Deviations:
- Added `loadImportRun` and `addImportRunCounts` to `packages/db/src/imports.ts` (no helper loaded the run).
- Unreadable file or a missing mapping/options finishes the import with 0 imported and one skipped entry (row 0).
- `sheet_name` ignored: first sheet only.
- No 120 s timeout: `RetryPolicy` has no timeout field; retry limit 2.
- `by_sign`: a positive gross is income.
