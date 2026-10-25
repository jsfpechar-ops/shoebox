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

// biome-ignore lint/suspicious/noExplicitAny: assertions walk untyped JSON bodies
type Json = any;

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
    const strict = strictJsonSchema(schema) as Record<string, Json>;
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.b.items.additionalProperties).toBe(false);
    expect((schema as Record<string, Json>).additionalProperties).toBeUndefined();
  });
});

describe('anthropicRequestBody', () => {
  it('maps system, document blocks, cache marks and the JSON schema', () => {
    const body = anthropicRequestBody(request) as Record<string, Json>;
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
    const { output: _unused, ...withoutOutput } = request;
    const body = anthropicRequestBody({
      ...withoutOutput,
      effort: 'low',
      messages: [
        { role: 'user', content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA' }] },
      ],
    }) as Record<string, Json>;
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
      {
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
      },
      {
        status: 529,
        body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
      },
      { status: 200, body: ok },
    ]);
    const client = createAnthropicClient({ apiKey: 'k', fetch: fetchFn, sleep: async () => {} });
    await client.complete(request);
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 400 and reports status and message only', async () => {
    const { fetchFn, calls } = fakeFetch([
      {
        status: 400,
        body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad schema' } },
      },
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
