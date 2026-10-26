# 0501 report: document_pages table and upload batch id

Status: review

## Files changed (§3 set only)

- `packages/db/migrations/0060_document_pages.sql` (new)
- `packages/db/migrations/meta/_journal.json` (one entry, idx 9)
- `packages/db/src/schema/document-pages.ts` (new)
- `packages/db/src/schema/index.ts` (export, then order fixed for biome)
- `packages/db/src/schema/documents.ts` (`uploadBatchId` + index)
- `packages/testkit/src/factories/document-details.ts` (`documentPageFactory`, registered)
- `packages/db/test/migrations/document-pages.db.test.ts` (new)

## Commands

- `pnpm --filter @shoebox/db typecheck`: clean, no output.
- `pnpm --filter @shoebox/testkit test`: 9 files, 103 tests passed.
- `pnpm exec biome check packages/db packages/testkit`: clean after one fix (export order in `schema/index.ts`).
- JSON check of `_journal.json`: parses, no output.
- `pnpm db:start`: failed, no Docker daemon (`/var/run/docker.sock` missing). DB tests (`migrations`, `rls`) not run. CI must run them.

## Checklist (§7)

- [x] Typecheck, testkit and biome clean.
- [ ] DB tests pass: not run, DB unavailable (see above).
- [x] Changes limited to §3 files (the branch also holds earlier orchestrator docs commits).

## Deviations

- Step 8 fix: biome required `document-pages` before `documents` in `schema/index.ts`. Committed separately as `0501 step 8`.

## Questions

None.

## Owner steps left

- CI or a machine with Docker: run `pnpm --filter @shoebox/db test -- migrations rls`.
