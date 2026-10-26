# 0514: Stop paying for reads that cannot succeed

Status: todo
Ticket: owner request 2026-10-26 (two non-invoice PDFs stuck "loading") | Depends on: none | Base commit: 17a44f5 | Branch: claude/project-thread-jrsxk4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A document the model cannot read (cut-off answer, refusal, bad JSON, a 4xx from the API) is retried up to 5 times today, each time paying for the whole page again, while the user sees "loading" for ~8 minutes. After this brief such errors fail at once; only transient errors (network, timeout, 408, 429, 5xx, storage) retry, and at most 3 job attempts × 2 API attempts.

## 2. Context

- `packages/pipeline/src/jobs.ts` line ~303:
  ```ts
  export const docExtractJob = defineTenantJob({
    name: 'doc.extract',
    payload: documentStagePayload,
    version: 1,
    entityId: (payload) => payload.documentId,
  });
  ```
  The default retry is `retryLimit: 4` (5 attempts).
- `apps/worker/src/doc-extract/handler.ts`: `const final = ctx.attempt >= DEFAULT_RETRY.retryLimit + 1;` and `onError(error, code)` re-throws when not final. `response.stopReason` is `'end_turn' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'tool_use'`. A `max_tokens` stop leaves `response.json === null`, so it fails as `parse` and is retried with the same result.
- `createAnthropicClient({ apiKey })` defaults to `maxAttempts: 4` (it retries network errors, timeouts, 429 and 5xx inside one call).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | `retry: { retryLimit: 2 }` on `docExtractJob` |
| `apps/worker/src/doc-extract/handler.ts` | edit | final from `docExtractJob`, permanent errors fail at once, stop reason check |
| `apps/worker/src/doc-extract/register.ts` | edit | `maxAttempts: 2` |
| `apps/worker/src/doc-split/register.ts` | edit | `maxAttempts: 2` |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | new tests (§4 step 5); fix only expectations that assumed a parse error retries |

No other file may change.

## 4. Steps

1. `jobs.ts`: add `retry: { retryLimit: 2 },` after `entityId` in `docExtractJob`, with the comment `// A read that fails for good stops at once (0514); transient errors get 2 retries.`
2. `handler.ts`:
   - Import `docExtractJob` from `@shoebox/pipeline` instead of `DEFAULT_RETRY` (remove `DEFAULT_RETRY` if unused).
   - `const final = ctx.attempt >= docExtractJob.retry.retryLimit + 1;`
   - Add above `createDocExtractHandler`:
     ```ts
     /** A retry cannot fix these: the same file gives the same answer, so a retry only pays for it again (0514). */
     function retryable(error: unknown): boolean {
       if (error instanceof ProtoParseError) return false;
       if (error instanceof AnthropicHttpError) {
         const s = error.status;
         return s === 0 || s === 408 || s === 429 || s >= 500;
       }
       return true;
     }
     ```
   - Change `onError` to `async (error: unknown, code: string, retry: boolean): Promise<void>` with body `if (!final && retry) throw error; await store.fail(ctx.tx, { ...run, error: code, final: true });`. Update the comment above it: transient failures before the last attempt are re-thrown for pg-boss; anything else is recorded at once.
   - Call sites: blob get → `retry: true`; loadPages/partsOf → `true`; ISDOC `toWrite` catch (`'parse'`) → `false`; `deps.llm.complete` catch → `retryable(error)`; parse/`toWrite` catch after the model → `false`; save catch → `retryable(error)`.
   - Right after `response = await deps.llm.complete(...)` succeeds (after that try/catch, before the parse try), add:
     ```ts
     // A cut-off or refused answer comes back the same on a retry: record it once (0514).
     if (response.stopReason === 'max_tokens' || response.stopReason === 'refusal') {
       await store.fail(ctx.tx, { ...run, error: response.stopReason, final: true });
       return;
     }
     ```
3. `doc-extract/register.ts` and `doc-split/register.ts`: `createAnthropicClient({ apiKey, maxAttempts: 2 })`.
4. Run `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts 2>&1 | tail -30`. If an existing test expected a parse failure to re-throw, change only its expectation to the recorded `{ error: 'parse', final: true }`.
5. Add to `doc-extract-handler.test.ts` (reuse `fakeStore`, `llmReturning`, `ctx`, `offline`, `blobs`, `clock`):
   - "fails a parse error at once, without a retry": `llmReturning({ nonsense: true })` on `ctx(1)` resolves, `failures` equals `[{ error: 'parse', final: true }]`.
   - "fails a 400 at once": `new AnthropicHttpError(400, '')` on `ctx(1)` resolves, failures `[{ error: 'http_400', final: true }]`.
   - "still retries a 529 on attempt 1 and records it on attempt 3": rejects on `ctx(1)`; on `ctx(3)` failures `[{ error: 'http_529', final: true }]`.
   - "fails a cut-off answer at once": an LLM whose response has `stopReason: 'max_tokens'` and `json: null` (copy `llmReturning`'s shape inline); on `ctx(1)` failures `[{ error: 'max_tokens', final: true }]`, `saved` is empty.
   If `{ nonsense: true }` does not raise `ProtoParseError` in the handler, use `json: null` instead.

## 5. Do not touch

`packages/extraction/**`, `packages/db/**`, `apps/web/**`. Hard rule 4: no document content in errors or logs.

## 6. Commands

```
pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/doc-split-handler.test.ts 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All three commands pass.
- [ ] `grep -n DEFAULT_RETRY apps/worker/src/doc-extract/handler.ts` prints nothing.

## 8. Stop and ask

As TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0514-report.md` (600 tokens at most), set `Status: review`, commit on the current branch with message `0514: stop retrying reads that cannot succeed`. Do not push.
