# 0514 report: stop retrying reads that cannot succeed

Status: review

## Files changed (git diff --stat)
- packages/pipeline/src/jobs.ts: docExtractJob `retry: { retryLimit: 2 }`
- apps/worker/src/doc-extract/handler.ts: final from docExtractJob, retryable() for model/save errors, onError(error, code, retry), stopReason max_tokens/refusal recorded at once
- apps/worker/src/doc-extract/register.ts: maxAttempts 2
- apps/worker/src/doc-split/register.ts: maxAttempts 2
- apps/worker/test/doc-extract-handler.test.ts: 4 new tests

## Commands
- `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/doc-split-handler.test.ts` : 22 passed (2 files)
- `pnpm --filter @shoebox/worker typecheck` : passed (tsc, no errors)
- `pnpm --filter @shoebox/pipeline typecheck` : passed (tsc, no errors)
- `grep -n DEFAULT_RETRY apps/worker/src/doc-extract/handler.ts` : prints nothing

## Acceptance (§7)
- [x] All three commands pass.
- [x] DEFAULT_RETRY grep prints nothing.

## Deviations
- Test "fails a parse error at once": `llmReturning({ nonsense: true })` did not raise ProtoParseError (the parser accepted it and the reading was saved). Used `llmReturning(null)` as the brief's fallback. Test passes.
- Brief §4 step 1 names `docExtractJob`'s `entityId` line; the anchor exists at jobs.ts line 307 (unique). Line ~330 of jobs.ts is importSpreadsheetRunJob's retry, left untouched.
- Tool-call budget: this chat went past the 30 tool-call guide by a few calls (one extra test run and the fallback fix) to finish and commit.

## Questions
- None.

## Owner steps left
- Review and open the PR into phase/0 (not pushed by executor).
