# 0515 report: free pre-check rules and bulk-mail image filter

Status: review

## Files changed (git diff --stat, vs 17a44f5)

- `packages/extraction/src/precheck/precheck.ts` (new, step 1 verbatim)
- `packages/extraction/src/index.ts` (one export line after the scan line)
- `packages/extraction/test/precheck.test.ts` (new, step 2 verbatim, then biome format)
- `apps/worker/src/email-received/triage.ts` (`isBulkMail`, `bulk` option)
- `apps/worker/src/email-received/handler.ts` (import and `{ bulk: isBulkMail(headers) }`)
- `apps/worker/test/email-received.test.ts` (one bulk-mail test, one `isBulkMail` test, import)

## Commands (last 5 lines each, abridged)

- `pnpm --filter @shoebox/extraction exec vitest run test/precheck.test.ts`: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
- `pnpm --filter @shoebox/extraction typecheck`: `tsc -p tsconfig.json`, no errors
- `pnpm --filter @shoebox/worker exec vitest run test/email-received.test.ts`: `Test Files 1 passed (1)`, `Tests 11 passed (11)`
- `pnpm --filter @shoebox/worker typecheck`: `tsc -p tsconfig.json`, no errors

## Acceptance (§7)

- [x] All four commands pass.

## Deviations

1. Step 3, "add after the MIN_IMAGE_BYTES line": that line is a module-level const, and the check needs local `isImage` and `options`. I put `if (isImage && options.bulk === true) return;` right after the existing `if (isImage && part.content.length < MIN_IMAGE_BYTES) return;` line inside the function.
2. Step 4: the three `isBulkMail` cases are in one `it` block, not three.
3. Biome: `precheck.ts` (verbatim from the brief) fails `biome check`. Biome wants the `return skip('government_filing', ...)` line wrapped. Not changed, because the brief says verbatim. The test file and the worker files are formatted.
4. Commits: step 1 commit holds the step 1 and step 2 files, `bfaa76a`. Then `adf5935` (biome format of the test), `2f4cc89` (steps 3-4). Nothing pushed.

## Questions

- Fix the `precheck.ts` format nit (wrap one line) in 0516 or in a follow-up? Brief said verbatim, so I left it.

## Owner steps left

- None for this brief. Wiring into the jobs is brief 0516.
