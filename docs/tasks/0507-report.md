# 0507 report: doc.split job

Status: review

## Files changed (git diff --stat vs. base 7016e0d)

- packages/pipeline/src/jobs.ts: `docSplitJob`, `DocSplitPayload`
- apps/worker/src/registry.ts: optional `options.startAfterSeconds` on `enqueue` (tenant jobs only)
- apps/worker/test/registry.test.ts: test "can delay a tenant job"
- apps/worker/src/doc-split/handler.ts (new): `createDocSplitHandler`, `DocSplitDeps`, `DocSplitStore`, `dbDocSplitStore`
- apps/worker/test/doc-split-handler.test.ts (new): brief's 5 tests (formatted by biome only)
- apps/worker/src/doc-split/register.ts (new): `registerDocSplit`
- apps/worker/src/main.ts: import and call `registerDocSplit`

## Commands (last lines)

- `pnpm --filter @shoebox/worker test -- registry` and `-- doc-split-handler`: 9 files passed, 56 tests passed, 7 skipped (pre-existing skips). The filter did not narrow the run, so the whole worker suite ran.
- `pnpm --filter @shoebox/pipeline test`: 2 files, 16 tests passed.
- `pnpm --filter @shoebox/pipeline --filter @shoebox/worker typecheck`: Done, no errors.
- `pnpm exec biome check packages/pipeline apps/worker`: 33 files, no errors (after `biome check --write` on my files).

## Checklist (§7)

- [x] §6 commands pass.
- [x] `git diff --stat` lists only §3 files.

## Deviations

- Done: steps 1 to 7. Left: none.
- `readIsdoc` is applied only to PDFs (the brief's "a PDF with ISDOC data" rule). ISDOC XML files are direct by mime type.
- Biome formatting was applied to the brief's test file and the new handler (format only, no logic change).
- Untracked files `docs/tasks/0511-pages-card.md` and `docs/tasks/0512-add-missing-page.md` were already in the tree; not mine, not committed.

## Questions

- None.

## Owner steps left

- None for this brief. Deploy of the worker and the upload switch to `doc.split` are in 0508.
