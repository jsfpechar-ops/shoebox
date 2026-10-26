# 0315: P1-CAT-03a LLM categorizer request, output schema and retry (`packages/extraction`)

Status: done
Ticket: P1-CAT-03 | Depends on: 0303 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

Add the `m04-categorize-v1` prompt, its JSON schema (enum built from the category seed), a strict parser and a one-retry runner over the existing `LlmClient`, so the categorize job (brief 0319) can ask Haiku 5.5 for the unresolved lines only. Pure: no DB, no wall clock; the client is injected (fake in unit tests, cassette in evals).

## 2. Context

- M04 §4.3: called only when ≥ 1 line is unresolved after the cascade or the subject is missing. Model from config (default `claude-haiku-5-5`, effort `low`). One retry on invalid JSON or a code outside the enum; never persisted when invalid (AC-3). Text input only; descriptions truncated to 200 chars per line, max 60 lines. Positions not in the input are dropped; missing positions fall back (the cascade's fallback, not this package's concern). `supply_kind='mixed'` → question `supply_kind` (handled in 0318).
- Owner 2026-10-25: English copy. The spec's `subject_cs`/`reason_cs` keep their key names (05) but the prompt asks for English text; `TODO(i18n-cs)`.
- Existing API you build on (`packages/extraction/src/llm/client.ts`): `LlmRequest {model, promptVersion, maxTokens, effort?, system: LlmTextBlock[], messages, output?: {type:'json_schema', name, schema}}`, `LlmResponse {model, stopReason, text, json, usage {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens}, latencyMs}`, `LlmClient.complete(request)`. The static system block ends with `cache: true` (prompt cache prefix). Pattern to copy: `packages/extraction/src/proto/schema.ts` `buildProtoRequest`.
- Categories come from `@shoebox/domain`: `CATEGORIES: readonly Category[]` with `{code, direction: 'in'|'out'|'both', taxEffect, labelEn, explanationEn, validFrom, validTo}`, `categoryAllowsDirection(category, direction)`, `isCategoryValidOn(category, date)`.
- `@shoebox/extraction` has **no runtime dependencies** (see its package.json): validate by hand like `proto/schema.ts` does (`parseProtoExtraction`), no zod, no `@shoebox/domain` import. The caller passes the category list in. No new dependency.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/categorize/schema.ts` | create | prompt text, JSON schema builder, hand-rolled output validation, parser |
| `packages/extraction/src/categorize/run.ts` | create | `buildCategorizeRequest`, `runCategorize` (one retry) |
| `packages/extraction/src/index.ts` | edit | two export lines |
| `packages/extraction/test/categorize-llm.test.ts` | create | the test below, verbatim |

No other file may change.

## 4. Steps

1. Create `packages/extraction/src/categorize/schema.ts` exporting exactly:

```ts
export const CATEGORIZE_PROMPT_VERSION = 'm04-categorize-v1' as const;
export const CATEGORIZE_MAX_TOKENS = 2048;
export const CATEGORIZE_MAX_LINES = 60;
export const CATEGORIZE_DESCRIPTION_MAX = 200;
export const CATEGORIZE_SYSTEM_PROMPT: string;     // M04 §4.3 text, rules 1–9, in English; <categories> and <examples> are appended by buildCategorizeRequest
export interface CategorizeCategory { readonly code: string; readonly direction: 'in' | 'out' | 'both'; readonly taxEffect: string; readonly label: string; readonly explanation: string; }
export function buildCategorizeJsonSchema(codes: readonly string[]): Record<string, unknown>;  // the M04 §4.3 schema with {{codes}} expanded; throws RangeError on an empty list
export type BusinessLikelihood = 'business' | 'personal' | 'mixed' | 'unknown';
export type LlmSupplyKind = 'service' | 'goods' | 'mixed' | 'not_applicable';
export interface CategorizeLineOutput { readonly position: number; readonly categoryCode: string; readonly alternativeCategoryCode: string | null; readonly confidence: number; readonly supplyKind: LlmSupplyKind; readonly assetCandidate: boolean; readonly mixedUseItem: boolean; readonly placeOfSupplyAbroad: boolean; readonly reason: string; }
export interface CategorizeOutput { readonly subject: string; readonly dominantCategoryCode: string; readonly businessLikelihood: BusinessLikelihood; readonly personalReason: string | null; readonly lines: readonly CategorizeLineOutput[]; }
export class CategorizeParseError extends Error { /* name = 'CategorizeParseError'; reason: 'schema' | 'code' | 'empty' */ readonly reason: 'schema' | 'code' | 'empty'; }
/** Validates the raw JSON (hand-rolled, strict: unknown keys rejected), rejects any code outside `codes` (reason 'code'), drops lines whose position is not in `positions`, throws 'empty' when nothing remains although positions were requested. */
export function parseCategorizeOutput(json: unknown, codes: readonly string[], positions: readonly number[]): CategorizeOutput;
```
   Wire JSON keys are the spec's (`subject_cs`, `dominant_category_code`, `business_likelihood`, `personal_reason_cs`, `category_code`, `alternative_category_code`, `confidence`, `supply_kind`, `asset_candidate`, `mixed_use_item`, `place_of_supply_abroad`, `reason_cs`); the parser maps them to the camelCase fields above. `alternative_category_code` null is allowed; a non-null one outside `codes` → reason `'code'`.
   Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` → may fail until step 2; continue.

2. Create `packages/extraction/src/categorize/run.ts` exporting exactly:

```ts
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from '../llm/client';
import { type CategorizeCategory, type CategorizeOutput } from './schema';
export interface CategorizeRequestLine { readonly position: number; readonly description: string | null; readonly gross: string | null; readonly lineType: string; }
export interface CategorizeRequestInput {
  readonly model: string;
  readonly document: { readonly class: string; readonly direction: 'in' | 'out'; readonly supplier: { name: string | null; country: string | null; vatPayer: boolean | null; nace: string | null } | null; readonly taxDocStatus: string; readonly currency: string; readonly issueDate: string | null; readonly servicePeriod: readonly [string, string] | null; };
  readonly business: { readonly activities: readonly string[]; readonly nace: string | null; readonly vatStatus: string };
  readonly lines: readonly CategorizeRequestLine[];
  readonly resolved: Readonly<Record<string, string | null>>;   // position → category code already decided, or null
  readonly categories: readonly CategorizeCategory[];           // already filtered by direction and validity by the caller
  readonly fewShots?: string;                                   // optional <examples> body; default ''
}
export interface CategorizeRequest { readonly request: LlmRequest; readonly codes: readonly string[]; readonly positions: readonly number[]; }
/** Truncates descriptions to CATEGORIZE_DESCRIPTION_MAX, keeps at most CATEGORIZE_MAX_LINES lines (beyond: lines with identical description are grouped, first position kept), builds the system block (static text + <categories> + <examples>, `cache: true`) and one user text block with the M04 §4.3 JSON. `positions` are the unresolved ones (resolved[pos] === null). */
export function buildCategorizeRequest(input: CategorizeRequestInput): CategorizeRequest;
export interface CategorizeAttempt { readonly model: string; readonly promptVersion: string; readonly attempt: number; readonly usage: LlmUsage; readonly latencyMs: number; readonly ok: boolean; readonly error: string | null; }
export type CategorizeRunResult = { readonly ok: true; readonly output: CategorizeOutput; readonly attempts: readonly CategorizeAttempt[] } | { readonly ok: false; readonly error: string; readonly attempts: readonly CategorizeAttempt[] };
/** Calls `llm.complete` at most twice: a CategorizeParseError on the first answer triggers one retry with the same request (attempt 2); a second failure returns ok:false with error 'parse'. A thrown provider error is recorded as attempt with ok:false, error = error.name, and re-thrown (pg-boss retries). */
export async function runCategorize(llm: LlmClient, built: CategorizeRequest): Promise<CategorizeRunResult>;
```
   Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` → 0 errors.

3. Edit `packages/extraction/src/index.ts`: after the line `export * from './llm/provider';` add
```ts
export * from './categorize/run';
export * from './categorize/schema';
```
   Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` → 0 errors.

4. Create `packages/extraction/test/categorize-llm.test.ts` verbatim; implement until it passes, do not edit it:

```ts
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/llm/client';
import {
  buildCategorizeRequest,
  CATEGORIZE_PROMPT_VERSION,
  CategorizeParseError,
  type CategorizeRequestInput,
  parseCategorizeOutput,
  runCategorize,
} from '../src/index';

const CATS = [
  { code: 'exp_cleaning', direction: 'in' as const, taxEffect: 'deductible_expense', label: 'Cleaning', explanation: 'Cleaning services.' },
  { code: 'exp_platform_commission', direction: 'in' as const, taxEffect: 'deductible_expense', label: 'Platform commission', explanation: 'Booking, Airbnb commission.' },
  { code: 'exp_payment_fees', direction: 'in' as const, taxEffect: 'deductible_expense', label: 'Payment fees', explanation: 'Card and payment service fees.' },
];
const CODES = CATS.map((c) => c.code);

function input(over: Partial<CategorizeRequestInput> = {}): CategorizeRequestInput {
  return {
    model: 'claude-haiku-5-5',
    document: { class: 'received_invoice', direction: 'in', supplier: { name: 'Booking.com B.V.', country: 'NL', vatPayer: null, nace: null }, taxDocStatus: 'foreign_document', currency: 'CZK', issueDate: '2026-08-03', servicePeriod: ['2026-07-01', '2026-07-31'] },
    business: { activities: ['short-term apartment rental'], nace: '55.20', vatStatus: 'identifikovana_osoba' },
    lines: [
      { position: 1, description: 'Commission', gross: '12990.12', lineType: 'item' },
      { position: 2, description: 'Payments service fee', gross: '709.65', lineType: 'fee' },
    ],
    resolved: { '1': null, '2': null },
    categories: CATS,
    ...over,
  };
}

function wire(lines: unknown[] = [
  { position: 1, category_code: 'exp_platform_commission', alternative_category_code: null, confidence: 0.95, supply_kind: 'service', asset_candidate: false, mixed_use_item: false, place_of_supply_abroad: false, reason_cs: 'Platform commission' },
  { position: 2, category_code: 'exp_payment_fees', alternative_category_code: null, confidence: 0.9, supply_kind: 'service', asset_candidate: false, mixed_use_item: false, place_of_supply_abroad: false, reason_cs: 'Payment fee' },
]) {
  return { document: { subject_cs: 'Booking.com commission', dominant_category_code: 'exp_platform_commission', business_likelihood: 'business', personal_reason_cs: null }, lines };
}

function fakeLlm(answers: unknown[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const json = answers[requests.length - 1];
      if (json instanceof Error) throw json;
      return { model: request.model, stopReason: 'end_turn', text: JSON.stringify(json), json, usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, latencyMs: 5 } satisfies LlmResponse;
    },
  };
}

describe('buildCategorizeRequest', () => {
  it('asks only for the unresolved positions with an enum of the given codes', () => {
    const built = buildCategorizeRequest(input({ resolved: { '1': 'exp_platform_commission', '2': null } }));
    expect(built.positions).toEqual([2]);
    expect(built.codes).toEqual(CODES);
    expect(built.request.promptVersion).toBe(CATEGORIZE_PROMPT_VERSION);
    expect(built.request.effort).toBe('low');
    expect(built.request.system[0]?.cache).toBe(true);
    expect(built.request.system[0]?.text).toContain('exp_payment_fees | in | deductible_expense | Payment fees');
    expect(JSON.stringify(built.request.output?.schema)).toContain('"exp_cleaning"');
    const user = JSON.parse(built.request.messages[0]?.content[0]?.type === 'text' ? built.request.messages[0].content[0].text : '{}');
    expect(user.lines).toHaveLength(2);
    expect(user.resolved).toEqual({ '1': 'exp_platform_commission', '2': null });
    expect(built.request.messages[0]?.content.every((b) => b.type === 'text')).toBe(true);
  });

  it('truncates descriptions to 200 chars and caps at 60 lines by grouping identical descriptions', () => {
    const lines = Array.from({ length: 70 }, (_, i) => ({ position: i + 1, description: i < 65 ? 'Same item' : 'x'.repeat(300), gross: '1.00', lineType: 'item' }));
    const resolved = Object.fromEntries(lines.map((l) => [String(l.position), null]));
    const built = buildCategorizeRequest(input({ lines, resolved }));
    const user = JSON.parse((built.request.messages[0]?.content[0] as { text: string }).text);
    expect(user.lines.length).toBeLessThanOrEqual(60);
    for (const l of user.lines) expect(l.description.length).toBeLessThanOrEqual(200);
  });

  it('throws on an empty category list', () => {
    expect(() => buildCategorizeRequest(input({ categories: [] }))).toThrow(RangeError);
  });
});

describe('parseCategorizeOutput', () => {
  it('maps a valid answer and drops unknown positions', () => {
    const out = parseCategorizeOutput(wire([...wire().lines, { position: 9, category_code: 'exp_cleaning', alternative_category_code: null, confidence: 0.5, supply_kind: 'goods', asset_candidate: false, mixed_use_item: false, place_of_supply_abroad: false, reason_cs: 'x' }]), CODES, [1, 2]);
    expect(out.lines.map((l) => l.position)).toEqual([1, 2]);
    expect(out.lines[0]).toMatchObject({ categoryCode: 'exp_platform_commission', supplyKind: 'service', confidence: 0.95 });
    expect(out.subject).toBe('Booking.com commission');
    expect(out.businessLikelihood).toBe('business');
  });

  it('rejects a code outside the enum, a schema violation and an empty result', () => {
    const bad = wire([{ ...(wire().lines[0] as object), category_code: 'exp_not_a_code' }]);
    expect(() => parseCategorizeOutput(bad, CODES, [1])).toThrow(CategorizeParseError);
    try { parseCategorizeOutput(bad, CODES, [1]); } catch (e) { expect((e as CategorizeParseError).reason).toBe('code'); }
    expect(() => parseCategorizeOutput({ document: {}, lines: [] }, CODES, [1])).toThrow(CategorizeParseError);
    try { parseCategorizeOutput(wire([]), CODES, [1]); } catch (e) { expect((e as CategorizeParseError).reason).toBe('empty'); }
    expect(() => parseCategorizeOutput('not json object', CODES, [1])).toThrow(CategorizeParseError);
  });
});

describe('runCategorize', () => {
  it('returns the output on the first valid answer with one attempt recorded', async () => {
    const llm = fakeLlm([wire()]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ ok: true, attempt: 1, promptVersion: CATEGORIZE_PROMPT_VERSION, usage: { inputTokens: 100 } });
  });

  it('retries once on an invalid code and then succeeds', async () => {
    const bad = wire([{ ...(wire().lines[0] as object), category_code: 'nope' }, wire().lines[1]]);
    const llm = fakeLlm([bad, wire()]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(llm.requests).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0]?.error).toBe('parse');
  });

  it('gives up after two invalid answers and never returns a partial output', async () => {
    const llm = fakeLlm([{ nope: 1 }, { nope: 2 }]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(llm.requests).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('parse');
    expect(result.attempts).toHaveLength(2);
  });

  it('re-throws a provider error after recording the attempt', async () => {
    const boom = Object.assign(new Error('503'), { name: 'AnthropicHttpError' });
    const llm = fakeLlm([boom]);
    await expect(runCategorize(llm, buildCategorizeRequest(input()))).rejects.toBe(boom);
  });

});
```
   Command: `pnpm --filter @shoebox/extraction test -- categorize-llm 2>&1 | tail -30` → all pass.

5. Run `pnpm eval --quick 2>&1 | tail -30` (M01–M05 change) → unchanged result from before your change (record the last lines).

## 5. Do not touch

`packages/extraction/src/proto/*`, `llm/*`, `isdoc/*` (lane B), `packages/domain`, `apps/*`, `packages/db`. Hard rules 2 (AI output is a suggestion: this package never writes), 4 (no document content in logs: never log request or response text), 7 (no new dependency).

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- categorize-llm 2>&1 | tail -30`
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`
- `pnpm eval --quick 2>&1 | tail -30`

## 7. Acceptance

- [ ] All tests in §4.4 pass; typecheck 0 errors; eval quick unchanged.
- [ ] `CATEGORIZE_SYSTEM_PROMPT` contains the nine rules of M04 §4.3 in English and no Czech sentence.
- [ ] The prompt version string is `m04-categorize-v1`.

## 8. Stop and ask

Per TEMPLATE §8. Cassette replay of this prompt is wired by the eval runner (`packages/testkit/src/eval`), not by this brief.

## 9. Report

`docs/tasks/0315-report.md` per TEMPLATE §9.

## Risk list

`categorize/schema.ts` (enum must come only from the caller's codes), `run.ts` (exactly two attempts, nothing persisted here).

## Owner steps

None.
