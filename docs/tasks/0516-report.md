# 0516 report

Status: review

## Files changed (`git diff --stat b82a160 HEAD`)

- apps/worker/src/doc-extract/handler.ts (+31)
- apps/worker/src/doc-extract/rows.ts (+62)
- apps/worker/src/doc-split/handler.ts (+22)
- apps/worker/test/doc-extract-handler.test.ts (+56)
- apps/worker/test/doc-split-handler.test.ts (+43)
- packages/db/src/document-reading.ts (+3 -3)
- packages/i18n/messages/en.json (+5)

## Commands (§6)

1. `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/doc-extract-rows.test.ts test/doc-extract-parts.test.ts test/doc-extract-isdoc.test.ts test/doc-split-handler.test.ts`: 5 files, 46 tests passed.
2. `pnpm --filter @shoebox/worker typecheck`: passed, no errors.
3. `pnpm --filter @shoebox/db typecheck`: passed, no errors.
4. `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.

## §7 acceptance

- [x] All four commands pass.

## Deviations

- Doc-split test: the brief said to copy a two-page case. The bank-statement test uses a single PDF instead. With a jpeg added, the drop has one page, so the handler reads both files directly without the look-over. That is correct behaviour, but it is not the pre-check path under test.
- Commits carry the `0516 step k` message with the Co-Authored-By trailer.
- No PR opened and nothing pushed (brief §9 and the owner's no-push rule).

## Questions

None.

## Owner steps left

- Review the branch and open the PR against `phase/0` (`git push -u origin claude/project-thread-jrsxk4`, then open the PR).
