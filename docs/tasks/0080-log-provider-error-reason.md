# 0080: A failed AI call logs a short reason code

Status: review
Ticket: Phase 1 test environment (owner request 2026-10-25) | Depends on: 0079 | Base commit: see branch | Branch: claude/project-thread-2s0mp2 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the test environment every Haiku read fails with `httpStatus: 400` and the owner has plenty of credit, so we need Anthropic's reason. The provider's message must not reach the logs as free text (hard rule 4), so `AnthropicHttpError` gets a `reason`: a fixed code derived from the message, or the request parameter path Anthropic names (e.g. `param:output_config.format.schema`). The job-failed log line carries it as `errorReason`.

## 2. Context

- `packages/extraction/src/llm/anthropic.ts` excerpt (find verbatim):

```ts
export class AnthropicHttpError extends Error {
  readonly provider = 'anthropic';
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`anthropic: HTTP ${status}${detail === '' ? '' : `: ${detail}`}`);
    this.name = 'AnthropicHttpError';
    this.status = status;
  }
}
```

- `apps/worker/src/registry.ts` excerpt (from 0078):

```ts
function errorStatus(error: unknown): { httpStatus: number } | Record<string, never> {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? { httpStatus: status } : {};
}
```

- `packages/platform/src/logger/allowlist.ts` list ends `  'errorCode',\n  'httpStatus',\n] as const;`; the exact-list test in `packages/platform/test/logger.test.ts` ends `      'errorCode',\n      'httpStatus',\n    ]);`; `docs/v3/modules/M12-platform-ops-security.md` line 293 contains `errorCode?, httpStatus?`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/llm/anthropic.ts` | edit | `anthropicErrorReason`, `reason` on the error |
| `packages/extraction/test/anthropic.test.ts` | edit | one new `describe` |
| `apps/worker/src/registry.ts` | edit | log `errorReason` |
| `apps/worker/test/registry.test.ts` | edit | extend the 0078 test |
| `packages/platform/src/logger/allowlist.ts` | edit | add `'errorReason'` after `'httpStatus'` |
| `packages/platform/test/logger.test.ts` | edit | add `'errorReason'` after `'httpStatus'` in the exact-list test |
| `docs/v3/modules/M12-platform-ops-security.md` | edit | `errorCode?, httpStatus?` → `errorCode?, httpStatus?, errorReason?` |

No other file may change.

## 4. Steps

1. In `anthropic.ts`, replace the `AnthropicHttpError` class above with:

```ts
/**
 * A fixed code for a provider error message, or the request parameter path it names, so the
 * reason can be logged without the message itself (hard rule 4). Exported for tests.
 */
export function anthropicErrorReason(detail: string): string {
  const text = detail.toLowerCase();
  if (text.includes('credit balance')) return 'credit_balance';
  if (text.includes('password')) return 'pdf_password';
  if (text.includes('max_tokens')) return 'max_tokens';
  if (text.includes('page') && text.includes('pdf')) return 'pdf_pages';
  if (text.includes('too large') || text.includes('too long') || text.includes('exceed')) {
    return 'too_large';
  }
  const param = /^([a-z_][a-z0-9_.]*)\s*:/i.exec(detail);
  if (param?.[1] !== undefined) return `param:${param[1].slice(0, 60)}`;
  if (text.includes('model')) return 'model';
  if (text.includes('schema') || text.includes('output_config') || text.includes('output_format')) {
    return 'output_schema';
  }
  return detail === '' ? 'none' : 'other';
}

export class AnthropicHttpError extends Error {
  readonly provider = 'anthropic';
  readonly status: number;
  /** Safe to log: a fixed code or a parameter path, never the message (see anthropicErrorReason). */
  readonly reason: string;

  constructor(status: number, detail: string) {
    super(`anthropic: HTTP ${status}${detail === '' ? '' : `: ${detail}`}`);
    this.name = 'AnthropicHttpError';
    this.status = status;
    this.reason = anthropicErrorReason(detail);
  }
}
```

2. In `anthropic.test.ts`, add `anthropicErrorReason,` to the import list (after `ANTHROPIC_API_URL,`, keep it sorted as biome wants) and append at the end of the file:

```ts

describe('anthropicErrorReason', () => {
  it('maps known messages to fixed codes', () => {
    expect(anthropicErrorReason('Your credit balance is too low to access the Anthropic API.')).toBe(
      'credit_balance',
    );
    expect(anthropicErrorReason('The PDF specified is password protected.')).toBe('pdf_password');
    expect(anthropicErrorReason('A maximum of 100 PDF pages may be provided.')).toBe('pdf_pages');
    expect(anthropicErrorReason('prompt is too long: 250000 tokens > 200000 maximum')).toBe('too_large');
    expect(anthropicErrorReason('model: claude-x')).toBe('param:model');
    expect(anthropicErrorReason('output_config.format.schema: unsupported keyword')).toBe(
      'param:output_config.format.schema',
    );
    expect(anthropicErrorReason('Invalid model name')).toBe('model');
    expect(anthropicErrorReason('')).toBe('none');
    expect(anthropicErrorReason('Something else happened with Jan Novák')).toBe('other');
  });

  it('is set on the error', () => {
    expect(new AnthropicHttpError(400, 'Your credit balance is too low').reason).toBe('credit_balance');
  });
});
```

3. In `registry.ts`, replace the `errorStatus` function above with:

```ts
function errorStatus(
  error: unknown,
): { httpStatus?: number; errorReason?: string } {
  const source = (error as { status?: unknown; reason?: unknown } | null) ?? {};
  return {
    ...(typeof source.status === 'number' ? { httpStatus: source.status } : {}),
    ...(typeof source.reason === 'string' ? { errorReason: source.reason } : {}),
  };
}
```

and keep its doc comment, changing it to `/** HTTP status and reason code of a provider error (never content), so a failed call can be diagnosed. */`.

4. In `registry.test.ts`, test `'a failing provider call also logs its HTTP status'`: in the fake class add `readonly reason = 'credit_balance';` after `readonly status = 401;`, and in the expected object add `errorReason: 'credit_balance',` after `httpStatus: 401,`.

5. Make the allowlist, logger test and M12 edits from §3.

6. Run, all must pass/be clean:
   - `pnpm --filter @shoebox/extraction test -- test/anthropic.test.ts 2>&1 | tail -30`
   - `pnpm --filter @shoebox/worker test -- test/registry.test.ts 2>&1 | tail -30`
   - `pnpm --filter @shoebox/platform test -- test/logger.test.ts 2>&1 | tail -30`
   - `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`, same for `@shoebox/worker` and `@shoebox/platform`
   - `npx --yes pnpm@10.28.0 exec biome check <the six code/test files> 2>&1 | tail -30`; formatting only: rerun with `--write`
   - `python3 scripts/context_lint.py 2>&1 | tail -30`

## 5. Do not touch

Everything else; never log `error.message` or the detail. Hard rules 4, 8.

## 6. Commands

As in §4.

## 7. Acceptance

- [ ] All commands in §4.6 pass; only §3 files plus this brief and its report changed.

## 8. Stop and ask

An excerpt not found, a test failing twice, 25 tool calls.

## 9. Report

Write `docs/tasks/0080-report.md` (300 tokens at most), set `Status: review`.
