# 0042a: prototype retries (no JSON, wrong IČO check digit)

Status: review
Ticket: PROTO-05 (owner, 2026-10-25: learnings from the real-scan test) | Depends on: 0041c | Base commit: cdb803f (head of phase/0; re-check the anchors after 0041c merges) | Branch: task/0042a-proto-retries | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On real scans Haiku sometimes returned no JSON (2 of 93 pages) and about 1 IČO in 5 failed the check digit because one scanned digit was misread. Retry once for each case, so the 100-document test measures the model and not a transient failure, and the page shows the better of the two answers.

## 2. Context

- Rule 2 (AGENTS.md): AI output is a suggestion; the deterministic check `ico_checksum` already flags a bad IČO. The retry never bypasses it: the second answer replaces the first only when its IČO is empty or passes the check digit.
- A refusal is never retried.
- The retry sends the same request plus one extra text block (a Czech hint). A model that cannot read the IČO must answer `""`, never guess.
- Cost: at most one extra call per document. Usage of both attempts is summed in `response.usage`.
- IČO check digit (for the test): weights 8..2 on the first 7 digits, remainder r of the sum mod 11, check digit = 1 when r is 0 or 10, 0 when r is 1, else 11 − r. `12345679` is valid, `12345678` and `12345677` are not.

Anchor in `scripts/proto/pipeline.ts` (must be found verbatim, else STOP): the function

```ts
export async function runProtoDocument(
  client: LlmClient,
  input: ProtoRunInput,
): Promise<ProtoRunResult> {
```

with the body lines `const response = await client.complete(request);`, `if (response.stopReason === 'refusal') throw new ProtoRunError('model refused the document');` and `if (response.json === null) {`, and the interface `ProtoRunResult` with the members `extraction`, `checks`, `response`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/test/proto-retry.test.ts` | new | the tests below |
| `scripts/proto/pipeline.ts` | edit | retries inside `runProtoDocument`, `attempts` on the result |

No other file may change.

## 4. Steps

1. **Test first.** Create `scripts/test/proto-retry.test.ts` with exactly:

```ts
import { parseLegalDate } from '@shoebox/domain';
import {
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  PROTO_RESPONSE_SCHEMA,
} from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { ProtoRunError, runProtoDocument } from '../proto/pipeline';

/** A schema-valid answer built from the schema itself, so the test survives schema versions. */
function blank(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === 'object') {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, blank(value)]));
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  return '';
}

function wire(ico: string): unknown {
  const answer = blank(PROTO_RESPONSE_SCHEMA) as { supplier: { ico: string } };
  answer.supplier.ico = ico;
  return answer;
}

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function answer(json: unknown, stopReason: LlmResponse['stopReason'] = 'end_turn'): LlmResponse {
  return { model: 'fake', stopReason, text: '', json, usage, latencyMs: 1 };
}

function scripted(answers: LlmResponse[]): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    async complete(request) {
      requests.push(request);
      const next = answers.shift();
      if (next === undefined) throw new Error('no more scripted answers');
      return next;
    },
  };
  return { client, requests };
}

const INPUT = {
  model: 'fake',
  bytes: new Uint8Array([1]),
  mediaType: 'image/png' as const,
  today: parseLegalDate('2026-10-25'),
};

describe('runProtoDocument retries', () => {
  it('retries once when the answer has no JSON, and sums the usage', async () => {
    const { client, requests } = scripted([answer(null, 'max_tokens'), answer(wire('12345679'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345679');
    expect(requests).toHaveLength(2);
    expect(result.attempts).toBe(2);
    expect(result.response.usage.inputTokens).toBe(20);
  });

  it('gives up after one retry without JSON', async () => {
    const { client, requests } = scripted([answer(null, 'max_tokens'), answer(null, 'max_tokens')]);
    await expect(runProtoDocument(client, INPUT)).rejects.toThrow(ProtoRunError);
    expect(requests).toHaveLength(2);
  });

  it('never retries a refusal', async () => {
    const { client, requests } = scripted([answer(null, 'refusal')]);
    await expect(runProtoDocument(client, INPUT)).rejects.toThrow('refused');
    expect(requests).toHaveLength(1);
  });

  it('retries with a hint when the IČO check digit fails and keeps a valid second IČO', async () => {
    const { client, requests } = scripted([answer(wire('12345678')), answer(wire('12345679'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345679');
    expect(result.attempts).toBe(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain('Kontrolní číslice IČO');
    expect(JSON.stringify(requests[0]?.messages)).not.toContain('Kontrolní číslice IČO');
  });

  it('accepts an empty IČO from the retry', async () => {
    const { client } = scripted([answer(wire('12345678')), answer(wire(''))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBeNull();
  });

  it('keeps the first answer when the retry is still invalid', async () => {
    const { client, requests } = scripted([answer(wire('12345678')), answer(wire('12345677'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345678');
    expect(requests).toHaveLength(2);
  });

  it('does not retry a valid or an empty IČO', async () => {
    const valid = scripted([answer(wire('12345679'))]);
    await runProtoDocument(valid.client, INPUT);
    expect(valid.requests).toHaveLength(1);
    const empty = scripted([answer(wire(''))]);
    const result = await runProtoDocument(empty.client, INPUT);
    expect(empty.requests).toHaveLength(1);
    expect(result.attempts).toBe(1);
  });
});
```

   Run `pnpm exec vitest run --project unit scripts/test/proto-retry.test.ts 2>&1 | tail -30`. Expected: fails (no `attempts`, no retries).

2. **Edit `scripts/proto/pipeline.ts`.** Do not edit the test file.
   - Add `readonly attempts: number;` to `ProtoRunResult`.
   - Add above `runProtoDocument`:

```ts
export const ICO_RETRY_HINT =
  'Kontrolní číslice IČO dodavatele nesedí. Znovu pečlivě opiš číslice IČO z dokladu. Nic nedomýšlej: pokud IČO na dokladu není nebo ho nepřečteš, vrať "".';

const icoCheckFailed = (checks: readonly RenderedProtoCheck[]): boolean =>
  checks.some((check) => check.id === 'ico_checksum' && check.severity === 'fail');

function withHint(request: LlmRequest, hint: string): LlmRequest {
  const [first, ...rest] = request.messages;
  if (first === undefined) return request;
  return {
    ...request,
    messages: [{ ...first, content: [...first.content, { type: 'text', text: hint }] }, ...rest],
  };
}
```

   (Add `type LlmRequest` to the existing import from `@shoebox/extraction`. If `first.content` is not an array in the current type, STOP.)
   - Rewrite the body of `runProtoDocument`: build `request` as now; `let response = await client.complete(request)`; if `response.json === null` and `response.stopReason !== 'refusal'`, call `client.complete(request)` once more and sum the usage with `addUsage`; then keep the existing refusal and no-JSON errors; then parse and render the checks as now into `first` (extraction, checks). If `first.extraction.supplier.ico !== null` and `icoCheckFailed(first.checks)`, call `client.complete(withHint(request, ICO_RETRY_HINT))`; when that answer has JSON, parse and render it; use it instead of `first` only when its IČO is `null` or `icoCheckFailed` is false for it. Sum the usage of every call into the returned `response.usage` (the returned response is the chosen answer's, with the summed usage). Return `attempts` = the number of calls made. A thrown error in the hinted retry keeps `first`.

3. Run the commands in §6.

## 5. Do not touch

The test file after step 1, `packages/`, `render.yaml`, any other script. Hard rules 1, 2, 4 (no document content in logs or output) apply.

## 6. Commands

- `pnpm exec vitest run --project unit scripts/test/proto-retry.test.ts 2>&1 | tail -30`: 7 tests pass.
- `pnpm exec biome ci scripts 2>&1 | tail -30`: clean.
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` and `pnpm exec tsc -p scripts/proto/tsconfig.json --noEmit 2>&1 | tail -30`: clean.

## 7. Acceptance

- [ ] The 7 tests pass, and the test file is unchanged after step 1.
- [ ] `pnpm proto:score` still prints its table (no key needed for the typecheck; do not run it).
- [ ] The returned `usage` is the sum of all attempts; `attempts` is 1 when no retry happened.
- [ ] No other file changed (`git status --short | tail -30`).

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found (0041c may have moved it: say which);
- a test fails twice, or a test seems wrong;
- you reach 25 tool calls or about 50k tokens;
- `first.content` is not an array, or `RenderedProtoCheck` has no `id`;
- a new dependency seems needed or a file outside §3 needs a change.
