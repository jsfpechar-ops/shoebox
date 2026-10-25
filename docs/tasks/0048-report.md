# 0048 report: reading store

Status: review

## Files changed
- `packages/db/src/document-reading.ts` (new): the §4 step 2 exports.
- `packages/db/src/index.ts`: export added (see Deviations).
- `packages/db/test/document-reading.db.test.ts` (new, verbatim from brief; coordinator fixed line 76 in ee51122).
- `docs/tasks/0048-reading-store.md`, `docs/tasks/0048-report.md`.

## Commands (last lines)
- `DATABASE_URL=... WORKER_DATABASE_URL=... pnpm --filter @shoebox/db exec vitest run test/document-reading.db.test.ts 2>&1 | tail -30`
  `Test Files 1 passed (1)` / `Tests 4 passed (4)`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`: clean (tsc exit 0, no output).
- `pnpm exec biome ci packages/db 2>&1 | tail -30`: `Found 1 error.` (see below).

## Section 7
- [x] Test file unchanged (except the coordinator's ee51122 fix) and passes against local DB: 4/4.
- [x] No raw SQL strings and no `withServiceRole` in `document-reading.ts`.
- [ ] Typecheck clean; biome NOT clean: one format error in `packages/db/test/document-reading.db.test.ts` (test file, not touched).

## Deviations
- `document-reading.ts` imports `isNull` (approved by coordinator).
- `class` in `saveDocumentReading` cast to the enum type: `ReadingPatch.class` is `string`, the column is `document_class`.
- `index.ts`: biome organizeImports moved `export * from './document-reading';` above `./health`. Export is present.

## Questions
- Biome format error in the brief's test file (line 1–190 formatting). Owner or coordinator to decide whether to reformat the test file (`pnpm exec biome format --write packages/db/test/document-reading.db.test.ts`).

## Owner steps left
- Merge after review. None else.
