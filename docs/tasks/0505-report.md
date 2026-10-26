# 0505 report: read a document from its chosen pages

Status: review

## Files changed (vs fc05710)
- New: packages/db/src/document-pages.ts, packages/extraction/src/sort/read-parts.ts, packages/extraction/test/read-parts.test.ts, apps/worker/src/doc-extract/parts.ts, apps/worker/test/doc-extract-parts.test.ts
- Edited: packages/db/src/index.ts, packages/extraction/src/index.ts, apps/worker/src/doc-extract/handler.ts, apps/worker/test/doc-extract-handler.test.ts
- Brief status set to in-progress at step 10 (not at start, a missed step) and to review at the end.

## Commands (last lines)
- `pnpm --filter @shoebox/extraction test -- read-parts`: 10 files, 85 tests passed.
- `pnpm --filter @shoebox/worker test -- doc-extract`: 7 files passed, 2 skipped; 47 tests passed, 7 skipped (skips are pre-existing, not in the new tests).
- `pnpm --filter @shoebox/db --filter @shoebox/extraction --filter @shoebox/worker typecheck`: clean.
- `pnpm eval --quick`: PASS, 2 pass, 0 fail, 20 skip (M01 to M05 have no adapter registered).
- `pnpm exec biome check packages/db packages/extraction apps/worker`: clean after `biome check --write` on the brief's files (import order and format only).

## 7 acceptance
- [x] §6 commands pass.
- [x] Only §3 files changed.

## Deviations
- Step 3 impl: `buildPartsRequest` builds the base request from the first part (brief said "buildProtoRequest's request"); no behaviour difference.
- Biome import sort and format applied to the §3 files (allowed by §6).
- Untracked `docs/tasks/0506-sort-plan.md` was already in the tree before this run; not touched, not committed.

## Questions
- None.

## Owner steps left
- Review and merge branch claude/project-thread-z0dj04 per workflow (not pushed by executor).
