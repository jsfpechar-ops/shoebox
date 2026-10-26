# 0317 report

Status: blocked
Done: steps 1 to 2. Left: step 3 (`packages/db/src/document-categorize.ts`), step 4 (`packages/db/src/index.ts` export line).

## Files changed
- `packages/pipeline/src/jobs.ts`: appended the four M04 job definitions and the constants (+50 lines).
- `packages/pipeline/test/jobs.test.ts`: extended the import, appended the `M04 jobs` describe block (+29 lines).

## Commands
- Step 1 `pnpm --filter @shoebox/pipeline typecheck`: passed, no errors. `z.iso.date()` exists in zod 4.6.5.
- Step 2 `pnpm --filter @shoebox/pipeline test -- jobs`: 20 passed (20).
- Step 3 `pnpm --filter @shoebox/db typecheck`: FAILED, 2 errors:
  - `src/document-categorize.ts(21,23): error TS2391: Function implementation is missing or not immediately following the declaration.`
  - `src/document-categorize.ts(43,23): error TS2391: Function implementation is missing or not immediately following the declaration.`
  Cause: the brief gives `loadDocumentForCategorize` and `saveCategorization` as bodiless declarations ending in `;`, which a `.ts` file cannot compile. The brief also says these functions are the I/O the worker needs, so bodies are required. The file was removed and not committed.

## Checks
- `biome check` on the two edited files: formatting only; fixed with `biome check --write` (commit `dba4d6e`).

## Deviations
- Biome formatting fix applied to step 2 files (separate commit).
- Step 3 not applied: see the TS2391 error above.

## Questions
- Should `loadDocumentForCategorize` and `saveCategorization` be implemented here (Drizzle queries, with the rules from the brief), or should they be declared with `export declare function` and implemented in 0318/0319? The brief does not say which.

## Owner steps left
- None.
