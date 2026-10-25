# 0040a: Claude adapter for the prototype (Messages API via fetch)

Status: review
Ticket: PROTO-03 | Depends on: none (0039 merged, #73) | Base commit: cba65e2 | Branch: task/0040a-anthropic-adapter | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The owner will test the prototype on ~100 real invoices, receipts and spam e-mails. Real documents must not go to the free Gemini tier, so he chose Claude (decisions 2026-10-18 [proto-eval]). Replace the Anthropic stub with a working `LlmClient` over plain `fetch`, so `SHOEBOX_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` works in `proto:score` and `proto:serve`.

## 2. Context

- ADR-011 / `packages/extraction/src/llm/client.ts`: "No provider SDK is imported here." Plain `fetch`, like `gemini.ts`. No new dependency (hard rule 7).
- Hard rule 4: errors carry the HTTP status and the provider's error message only, never the request body.
- Claude Messages API (checked 2026-10-18 against the claude-api skill):
  - `POST https://api.anthropic.com/v1/messages`, headers `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
  - Body: `model`, `max_tokens`, `system` (array of `{type:'text', text, cache_control?}`), `messages` (role `user`/`assistant`, content blocks).
  - PDF block: `{type:'document', source:{type:'base64', media_type:'application/pdf', data}}`. Image block: `{type:'image', source:{type:'base64', media_type, data}}`. Put the file block before the text block (the proto request already does).
  - JSON output: `output_config: { format: { type: 'json_schema', schema } }`. Every object in the schema needs `additionalProperties: false`; `minimum`/`maximum`/`minLength`/`maxLength` are not supported.
  - Effort: `output_config.effort` = `low|medium|high` (send only when `request.effort` is set). Thinking stays default (adaptive on current models); never send `thinking: {type:'disabled'}` (400 on Sonnet 5.5).
  - Response: `content[]` blocks; take only `type:'text'` blocks (skip `thinking`). `stop_reason` ∈ `end_turn|max_tokens|stop_sequence|tool_use|pause_turn|refusal`. `usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. `model` is the answering model id.
  - Error body: `{type:'error', error:{type, message}}`. Retry on 429, 529 and 5xx.
- Model ids: `claude-sonnet-5-5` (default, already `ANTHROPIC_DEFAULT_MODEL`), `claude-haiku-5-5`.

Current stub, `packages/extraction/src/llm/anthropic.ts` (whole file, 25 lines): the `LlmProviderNotConfiguredError` class and `createAnthropicClient()` that always rejects.

`packages/extraction/src/llm/provider.ts` lines 74–81:

```ts
  const config = resolveLlmEnv(env);
  if (config.provider === 'anthropic') return { client: createAnthropicClient(), config };
  const apiKey = env[config.keyEnv]?.trim() ?? '';
  if (apiKey === '') throw new LlmKeyMissingError(config.keyEnv);
  const geminiOptions = options.fetch === undefined ? { apiKey } : { apiKey, fetch: options.fetch };
  return { client: createGeminiClient(geminiOptions), config };
```

`packages/extraction/test/provider.test.ts` line 68 starts the test `'returns the anthropic stub, which rejects with a clear error'`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/llm/anthropic.ts` | replace | the adapter |
| `packages/extraction/test/anthropic.test.ts` | create | the spec below |
| `packages/extraction/src/llm/provider.ts` | edit | wire the key |
| `packages/extraction/test/provider.test.ts` | edit | replace the stub test |

No other file may change.

## 4. Steps

1. **Write `packages/extraction/test/anthropic.test.ts`** exactly as below. Commit `0040a step 1`.

```ts
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_API_URL,
  AnthropicHttpError,
  anthropicRequestBody,
  anthropicResponseOf,
  createAnthropicClient,
  strictJsonSchema,
} from '../src/llm/anthropic';
import type { LlmRequest } from '../src/llm/client';

const request: LlmRequest = {
  model: 'claude-sonnet-5-5',
  promptVersion: 'm02-proto-v1',
  maxTokens: 4096,
  system: [{ type: 'text', text: 'SYS', cache: true }],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'document', mediaType: 'application/pdf', dataBase64: 'UERG' },
        { type: 'text', text: 'go' },
      ],
    },
  ],
  output: {
    type: 'json_schema',
    name: 'x',
    schema: {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } } } },
      },
      required: ['a', 'b'],
    },
  },
};

const ok = {
  type: 'message',
  model: 'claude-sonnet-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"a":"1","b":[]}' },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 0,
  },
};

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('no more responses');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('strictJsonSchema', () => {
  it('adds additionalProperties:false to every object, recursively, without mutating', () => {
    const schema = request.output?.schema ?? {};
    const strict = strictJsonSchema(schema) as Record<string, any>;
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.b.items.additionalProperties).toBe(false);
    expect((schema as Record<string, any>).additionalProperties).toBeUndefined();
  });
});

describe('anthropicRequestBody', () => {
  it('maps system, document blocks, cache marks and the JSON schema', () => {
    const body = anthropicRequestBody(request) as Record<string, any>;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages[0].content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' },
    });
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'go' });
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it('maps an image block and an effort', () => {
    const body = anthropicRequestBody({
      ...request,
      effort: 'low',
      output: undefined,
      messages: [
        { role: 'user', content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA' }] },
      ],
    }) as Record<string, any>;
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
    });
    expect(body.output_config).toEqual({ effort: 'low' });
  });
});

describe('anthropicResponseOf', () => {
  it('keeps text blocks only, parses JSON and maps usage', () => {
    const res = anthropicResponseOf(ok, request, 42);
    expect(res).toEqual({
      model: 'claude-sonnet-5-5',
      stopReason: 'end_turn',
      text: '{"a":"1","b":[]}',
      json: { a: '1', b: [] },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 0,
      },
      latencyMs: 42,
    });
  });

  it('maps refusal and pause_turn, and leaves json null on bad JSON', () => {
    expect(anthropicResponseOf({ ...ok, stop_reason: 'refusal' }, request, 1).stopReason).toBe(
      'refusal',
    );
    expect(anthropicResponseOf({ ...ok, stop_reason: 'pause_turn' }, request, 1).stopReason).toBe(
      'end_turn',
    );
    const bad = { ...ok, content: [{ type: 'text', text: 'not json' }] };
    expect(anthropicResponseOf(bad, request, 1).json).toBeNull();
  });

  it('throws on a body that is not a message', () => {
    expect(() => anthropicResponseOf(null, request, 1)).toThrow(/unexpected response/);
  });
});

describe('createAnthropicClient', () => {
  it('posts with the key headers and returns the mapped response', async () => {
    const { fetchFn, calls } = fakeFetch([{ status: 200, body: ok }]);
    const client = createAnthropicClient({ apiKey: 'k', fetch: fetchFn, sleep: async () => {} });
    const res = await client.complete(request);
    expect(res.json).toEqual({ a: '1', b: [] });
    expect(calls[0]?.url).toBe(ANTHROPIC_API_URL);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('retries 429 and 529, then succeeds', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } },
      { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } },
      { status: 200, body: ok },
    ]);
    const client = createAnthropicClient({ apiKey: 'k', fetch: fetchFn, sleep: async () => {} });
    await client.complete(request);
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 400 and reports status and message only', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad schema' } } },
    ]);
    const client = createAnthropicClient({ apiKey: 'k', fetch: fetchFn, sleep: async () => {} });
    await expect(client.complete(request)).rejects.toThrow(AnthropicHttpError);
    await expect(
      createAnthropicClient({
        apiKey: 'k',
        fetch: fakeFetch([
          { status: 400, body: { type: 'error', error: { type: 'x', message: 'bad schema' } } },
        ]).fetchFn,
      }).complete(request),
    ).rejects.toThrow('anthropic: HTTP 400: bad schema');
    expect(calls).toHaveLength(1);
  });
});
```

Run `pnpm --filter @shoebox/extraction test -- anthropic 2>&1 | tail -30`. Expected: fails (exports missing).

2. **Replace `packages/extraction/src/llm/anthropic.ts`.** Model it on `gemini.ts` (same option names, retry loop, timeout, `errorDetail` slicing to 200 chars). Exports:

```ts
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_DEFAULT_MAX_ATTEMPTS = 4;
export const ANTHROPIC_DEFAULT_RETRY_DELAY_MS = 5_000;
export const ANTHROPIC_DEFAULT_TIMEOUT_MS = 180_000;
export class AnthropicHttpError extends Error { readonly provider = 'anthropic'; readonly status: number; } // message `anthropic: HTTP ${status}${detail ? `: ${detail}` : ''}`
export class AnthropicResponseShapeError extends Error {} // message `anthropic: unexpected response: ${detail}`
export interface AnthropicClientOptions { apiKey: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number; maxAttempts?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; }
export function strictJsonSchema(schema: Record<string, unknown>): Record<string, unknown>;
export function anthropicRequestBody(request: LlmRequest): Record<string, unknown>;
export function anthropicResponseOf(body: unknown, request: LlmRequest, latencyMs: number): LlmResponse;
export function createAnthropicClient(options: AnthropicClientOptions): LlmClient;
```

Rules: `cache: true` → `cache_control: {type:'ephemeral'}`. Stop reasons: `max_tokens`, `refusal`, `stop_sequence`, `tool_use` map to themselves; everything else to `end_turn`. Retry when status is 429 or ≥ 500 (529 included), and on a network error; sleep `retryDelayMs × attempt`. `baseUrl` replaces the whole URL. Delete `LlmProviderNotConfiguredError`. Its only other user is `provider.test.ts` (step 4 removes it); if `grep -rn LlmProviderNotConfiguredError packages scripts` finds any other file, STOP.

Run the step 1 command. Expected: all pass. Commit `0040a step 2`.

3. **Edit `provider.ts`.** Replace the anchor in §2 with:

```ts
  const config = resolveLlmEnv(env);
  const apiKey = env[config.keyEnv]?.trim() ?? '';
  if (apiKey === '') throw new LlmKeyMissingError(config.keyEnv);
  const clientOptions = options.fetch === undefined ? { apiKey } : { apiKey, fetch: options.fetch };
  if (config.provider === 'anthropic') {
    return { client: createAnthropicClient(clientOptions), config };
  }
  return { client: createGeminiClient(clientOptions), config };
```

Update the doc comment above the function to `/** The configured client. Throws \`LlmKeyMissingError\` when the provider's key is not set. */`. Commit `0040a step 3`.

4. **Edit `provider.test.ts`.** Replace the whole test that starts at line 68 (`'returns the anthropic stub, which rejects with a clear error'`) with:

```ts
  it('builds the anthropic client and requires its key', async () => {
    expect(() => createLlmClientFromEnv({ SHOEBOX_LLM_PROVIDER: 'anthropic' })).toThrow(
      LlmKeyMissingError,
    );
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          model: 'claude-sonnet-5-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const { client, config } = createLlmClientFromEnv(
      { SHOEBOX_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' },
      { fetch: fetchFn },
    );
    expect(config.model).toBe('claude-sonnet-5-5');
    const res = await client.complete({
      model: config.model,
      promptVersion: 'v',
      maxTokens: 10,
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect(res.text).toBe('hi');
  });
```

In the import block at the top of the file, delete the line `  LlmProviderNotConfiguredError,` (`LlmKeyMissingError` is already imported). Run `pnpm --filter @shoebox/extraction test -- provider anthropic 2>&1 | tail -30`. Expected: all pass. Commit `0040a step 4`.

## 5. Do not touch

`gemini.ts`, `client.ts`, `proto/schema.ts`, `scripts/`, `render.yaml`. Hard rules 4 (no request body or document text in errors or logs) and 7 (no `@anthropic-ai/sdk`).

## 6. Commands

```
pnpm --filter @shoebox/extraction test -- anthropic provider 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm eval --quick 2>&1 | tail -30
```

## 7. Acceptance

- [ ] `anthropic.test.ts` and `provider.test.ts` pass; typecheck clean; `pnpm eval --quick` unchanged.
- [ ] `grep -rn "anthropic-ai" packages/extraction/package.json` prints nothing.

## 8. Stop and ask

As in the [template](TEMPLATE.md) §8.

## 9. Report

`docs/tasks/0040a-report.md`, as in the template §9. Set `Status: review`, open one PR to `phase/0`.

## Risk list (for the reviewer)

`packages/extraction/src/llm/anthropic.ts` (sends documents to a third party; error messages must not carry the body).

## Owner steps

None for this brief (the key goes in with 0040b).
