# 0522: fill extraction_runs.cost_usd from a price table

Status: review
Ticket: owner ask 2026-10-26 (failure logging for analytics), M02 §4 pricing + acceptance 17 | Depends on: 0520 | Base commit: after 0521 | Branch: claude/project-thread-5vgi6d | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Every AI call row in `extraction_runs` gets its cost in USD, computed from its token counts and a price table. The analytics views of 0521 (`ai_cost_weekly`, `document_journey`) then show real cost per document and per week; today `cost_usd` is always null.

## 2. Context

- M02 §4 (pasted): "Prices USD/MTok — Haiku 5.5 (prompt ≤ 100 k): input 0.10, output 0.50, cache write 1 h 0.20, cache read 0.01, batch 0.05/0.25. Sonnet 5.5: input 2, output 10, cache write 1 h 4, cache read 0.10, batch 1/5. Stored in config `llm.pricing` with `verified_at`; `extraction_runs.cost_usd` is computed from usage (incl. cache tokens)." M02 acceptance 17: "`extraction_runs.cost_usd` equals the usage × `llm.pricing` (incl. cache tokens) to 5 decimals."
- Rule 1: rates live in `packages/domain`; money is never a float. Cost is computed in integer nano-dollars (1e-9 USD) with `bigint`, then written as a decimal string with 5 places (`numeric(10,5)`), rounded half up.
- Prices per token in nano-USD: Haiku input 100, output 500, cache write 200, cache read 10. Sonnet input 2000, output 10000, cache write 4000, cache read 100. (Batch prices are not used yet: batch is Later.)
- Provider model ids may carry a date suffix (`claude-haiku-5-5-20261001`): match by prefix.
- `extraction_runs` is inserted at three places in `packages/db/src`: `document-reading.ts` (`saveDocumentReading`, stage extract), `doc-split.ts` (stage split), `document-categorize.ts` (stage categorize). Each run object there has `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`. `packages/db` already depends on `@shoebox/domain`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/llm-pricing.ts` | new | price table + `llmCostUsd` |
| `packages/domain/src/index.ts` | edit | export it |
| `packages/domain/test/llm-pricing.test.ts` | new | unit tests |
| `packages/db/src/document-reading.ts` | edit | set `costUsd` |
| `packages/db/src/doc-split.ts` | edit | set `costUsd` |
| `packages/db/src/document-categorize.ts` | edit | set `costUsd` |
| `packages/testkit/src/factories/document-details.ts` | edit | factory for `pipeline_events` (0520 follow-up) |

No other file may change.

## 4. Steps

1. **New file** `packages/domain/src/llm-pricing.ts`, exactly:

```ts
// LLM prices (M02 §4 `llm.pricing`), in nano-USD (1e-9 USD) per token so cost math stays integer.
// Not law: update when the provider changes prices (06 maintenance, M02 §10) and bump VERIFIED_AT.
export const LLM_PRICING_VERIFIED_AT = '2026-10-26';

export interface LlmPrice {
  readonly input: bigint;
  readonly output: bigint;
  readonly cacheWrite: bigint;
  readonly cacheRead: bigint;
}

/** Model id prefix → price. A provider id with a date suffix matches its prefix. */
export const LLM_PRICING: Readonly<Record<string, LlmPrice>> = {
  'claude-haiku-5-5': { input: 100n, output: 500n, cacheWrite: 200n, cacheRead: 10n },
  'claude-sonnet-5-5': { input: 2000n, output: 10000n, cacheWrite: 4000n, cacheRead: 100n },
};

export interface LlmTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

function priceOf(model: string): LlmPrice | null {
  for (const [prefix, price] of Object.entries(LLM_PRICING)) {
    if (model === prefix || model.startsWith(`${prefix}-`)) return price;
  }
  return null;
}

/** Cost of one call as a 5-decimal USD string (rounded half up), or null for no or an unknown model. */
export function llmCostUsd(model: string | null, usage: LlmTokenUsage): string | null {
  if (model === null) return null;
  const price = priceOf(model);
  if (price === null) return null;
  const nano =
    BigInt(usage.inputTokens) * price.input +
    BigInt(usage.outputTokens) * price.output +
    BigInt(usage.cacheWriteTokens) * price.cacheWrite +
    BigInt(usage.cacheReadTokens) * price.cacheRead;
  const units = (nano + 5000n) / 10000n; // 1 unit = 1e-5 USD
  const whole = units / 100000n;
  const frac = (units % 100000n).toString().padStart(5, '0');
  return `${whole}.${frac}`;
}
```

2. **Edit** `packages/domain/src/index.ts`: add `export * from './llm-pricing';` in alphabetical position among the `export *` lines.

3. **New file** `packages/domain/test/llm-pricing.test.ts`, exactly:

```ts
import { describe, expect, it } from 'vitest';
import { llmCostUsd } from '../src/llm-pricing';

const usage = (i: number, o: number, r = 0, w = 0) => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: r,
  cacheWriteTokens: w,
});

describe('llmCostUsd', () => {
  it('prices a Haiku call with cache tokens to 5 decimals', () => {
    // 1000×0.10 + 200×0.50 + 5000×0.01 + 2000×0.20 per MTok = 0.00065 USD
    expect(llmCostUsd('claude-haiku-5-5', usage(1000, 200, 5000, 2000))).toBe('0.00065');
  });

  it('prices Sonnet and matches a dated model id by prefix', () => {
    // 10000×2 + 1000×10 per MTok = 0.03 USD
    expect(llmCostUsd('claude-sonnet-5-5-20261001', usage(10000, 1000))).toBe('0.03000');
  });

  it('rounds half up at the fifth decimal', () => {
    // 50 input tokens of Haiku = 5000 nano-USD = 0.000005 → 0.00001
    expect(llmCostUsd('claude-haiku-5-5', usage(50, 0))).toBe('0.00001');
    expect(llmCostUsd('claude-haiku-5-5', usage(49, 0))).toBe('0.00000');
  });

  it('is null without a model or for an unknown one', () => {
    expect(llmCostUsd(null, usage(1, 1))).toBeNull();
    expect(llmCostUsd('claude-haiku-5', usage(1, 1))).toBeNull();
  });
});
```

   Command: `pnpm --filter @shoebox/domain test -- llm-pricing 2>&1 | tail -15` → 4 passed. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`.

4. **Edit** the three insert sites in `packages/db/src`. In each file add `import { llmCostUsd } from '@shoebox/domain';` (merge into an existing `@shoebox/domain` import if the file has one), and in the `.values({ ... })` object of the `extractionRuns` insert add one line after `latencyMs: run.latencyMs,`:
   - `document-reading.ts`, `saveDocumentReading`: `costUsd: llmCostUsd(run.model, run),`
   - `doc-split.ts`: `costUsd: llmCostUsd(run.model, run),`
   - `document-categorize.ts`: `costUsd: llmCostUsd(run.model, run),`

   Do not change `recordFailedRead` (a failed call has no usage). If the Drizzle column is not named `costUsd` in `packages/db/src/schema/document-details.ts` (`cost_usd`), STOP. Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -10`.

4b. **Edit** `packages/testkit/src/factories/document-details.ts` (0520 follow-up: the RLS suite fails with `testkit: no factory for table "pipeline_events"`). After the `extractionRunFactory` block add:

```ts
/** `pipeline_events` has a bigserial `id` (left to the database). */
export const pipelineEventFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  kind: 'status',
  code: 'received',
  ...overrides,
});
```

   and in the factory list add `['pipeline_events', pipelineEventFactory],` right after `['extraction_runs', extractionRunFactory],`. Add `pipeline_events` to the table list in the file's header comment. Command (with `DATABASE_URL`): `pnpm --filter @shoebox/db test -- test/rls 2>&1 | tail -15` → all pass.

5. Run the db test for document reading if a `DATABASE_URL` sandbox is up (see K-P03, `packages/db/scripts/local-pg.sh`): `pnpm --filter @shoebox/db test -- document-reading 2>&1 | tail -15`. Otherwise say so in the report.

6. `pnpm exec biome ci packages/domain packages/db 2>&1 | tail -10`; `python3 scripts/context_lint.py 2>&1 | tail -5`.

## 5. Do not touch

`apps/`, migrations, the analytics views, other packages (testkit only as in step 4b). Hard rules: no floats in cost math; no new dependency; never push to `main`.

## 6. Commands

As in steps 3 to 6.

## 7. Acceptance

- [ ] 4/4 unit tests, both typechecks, biome and context lint pass.
- [ ] No file outside §3 changed.

## 8. Stop and ask

As in TEMPLATE §8.

## 9. Report

Write `docs/tasks/0522-report.md` (600 tokens at most), set `Status: review` here, commit everything as `0522 llm cost` on the current branch. Do not push.
