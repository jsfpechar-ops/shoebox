# 0078: A failed job logs the HTTP status

Status: todo
Ticket: Phase 1 test environment (owner request 2026-10-25) | Depends on: 0055 | Base commit: 3cf5706 | Branch: claude/project-thread-2s0mp2 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the test environment every `doc.extract` fails with `errorCode: "AnthropicHttpError"`, but the log does not say which HTTP status (401 key, 400 credit, 404 model, 429 rate), so nobody can tell why. A failed job also logs `httpStatus` when the error carries a numeric `status`. Status codes hold no document content, so privacy (hard rule 4) is kept.

## 2. Context

`apps/worker/src/registry.ts`, excerpts to find verbatim:

```ts
/** Error class name only: messages may carry document content and never reach the logs. */
function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
```

```ts
      logger.warn({ ...fields, errorCode: errorCode(error) }, 'job failed');
```

`AnthropicHttpError` (packages/extraction) has `readonly status: number`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/registry.ts` | edit | `httpStatus` in the failure log |
| `apps/worker/test/registry.test.ts` | edit | one new test |

No other file may change.

## 4. Steps

1. In `registry.ts`, directly after the `errorCode` function add:

```ts

/** HTTP status of a provider error (a number, never content), so a failed call can be diagnosed. */
function errorStatus(error: unknown): { httpStatus: number } | Record<string, never> {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? { httpStatus: status } : {};
}
```

and replace the `logger.warn` line above with:

```ts
      logger.warn({ ...fields, errorCode: errorCode(error), ...errorStatus(error) }, 'job failed');
```

2. In `registry.test.ts`, directly after the test `'a failing handler is rethrown (pg-boss retries) and logged without its message'` (ends with `expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');` and `  });`), add:

```ts

  it('a failing provider call also logs its HTTP status', async () => {
    const { registry, workers, logger } = fakes();
    class AnthropicHttpError extends Error {
      readonly status = 401;
      constructor() {
        super('secret detail');
        this.name = 'AnthropicHttpError';
      }
    }
    registry.registerTenant(split, async () => {
      throw new AnthropicHttpError();
    });
    await registry.start();
    await expect(workers.get('doc.split')?.([job({ orgId: ORG, documentId: DOC })])).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        jobName: 'doc.split',
        jobId: 'job-1',
        orgId: ORG,
        errorCode: 'AnthropicHttpError',
        httpStatus: 401,
      },
      'job failed',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });
```

3. Run `pnpm --filter @shoebox/worker test -- test/registry.test.ts 2>&1 | tail -30` (all pass, the old failing-handler test unchanged) and `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` (clean). Then `npx --yes pnpm@10.28.0 exec biome check apps/worker/src/registry.ts apps/worker/test/registry.test.ts 2>&1 | tail -30`; formatting only: rerun with `--write`.

## 5. Do not touch

Everything else; never log `error.message`. Hard rules 4, 8.

## 6. Commands

As in §4.

## 7. Acceptance

- [ ] New test passes, old registry tests pass, typecheck and biome clean.
- [ ] `git diff --stat origin/phase/0` lists only §3 files plus this brief and its report.

## 8. Stop and ask

An excerpt not found, a test failing twice, 25 tool calls, a file outside §3.

## 9. Report

Write `docs/tasks/0078-report.md` (400 tokens at most), set `Status: review`: files changed, each command with its last 5 lines.
