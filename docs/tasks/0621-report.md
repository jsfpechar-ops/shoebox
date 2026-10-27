# 0621 report

Status: review

## Files changed (`git diff --stat cc1b668 HEAD` (branch base; the brief base 6e7c134 is older))
Edits in packages/db (document-reading.ts, document-categorize.ts, 2 db test/src), apps/worker (doc-extract/handler.ts, register.ts, 3 test files, categorize/plan.ts, 2 categorize tests), apps/web/src/documents/manual-entry-actions.ts. Nothing else touched. Commits: `0621 step 1` to `0621 step 8`.

## Commands (last lines)
- `pnpm --filter @shoebox/db typecheck`: clean, no errors.
- `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts`: 20 passed.
- `pnpm --filter @shoebox/worker exec vitest run test/categorize-plan.test.ts test/categorize-job.test.ts`: 15 passed (2 files).
- `pnpm --filter @shoebox/worker typecheck`: 0 errors.
- `pnpm --filter @shoebox/web typecheck`: no error lines.
- `pnpm exec biome ci <changed files>`: "Checked 53 files. No fixes applied", no errors on changed files.
- `pnpm exec biome ci apps/worker packages/db apps/web/src/documents/manual-entry-actions.ts`: 2 errors, both pre-existing and outside this brief: `apps/worker/test/drift-monitors.test.ts:61` (useTemplate) and `apps/worker/src/vat/amendment-detect.ts:8` (noUnusedImports). Not touched.

## §7 acceptance
- [x] Saved reading not `supporting` enqueues `doc.categorize` with revision, trigger `pipeline`, nonce (new test passes).
- [x] `planCategorization` returns `needs_review` when `openBlocking > 0` (new test passes).
- [x] Manual entry enqueues `doc.categorize` (step 8, typecheck clean; not unit-tested, as the brief did not ask).
- [x] Commands in §6 pass (biome: pre-existing errors above only).

## Deviations
- Step 8a: the brief said to add the `./enqueue` import after the last import. Biome `organizeImports` requires it before `./manual-entry`, so it is placed there.
- Step 8b: `savedId` is typed `string`, so no `null` guard was added.
- Step 2 and 3 typecheck errors in test fixtures were expected and fixed in step 4 (`revision: 1` added in doc-extract-isdoc.test.ts, as step 4c asked).
- Biome formatting fix on the new `enqueueCategorize` type line in handler.ts (line wrap only).
- Tool-call count went past the 25-call checkpoint (about 28 by the end). All steps were finished and committed before stopping, so no step was cut short.

## Questions
- Pre-existing biome errors in `drift-monitors.test.ts` and `amendment-detect.ts` should be fixed in a separate ticket if CI runs biome on them.

## Owner steps left
- None. Not pushed, no PR opened.
