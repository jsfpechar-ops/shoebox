import { describe, expect, it } from 'vitest';
import {
  createGeminiClient,
  GEMINI_BASE_URL,
  geminiRequestBody,
  geminiResponseOf,
  LlmHttpError,
  type LlmRequest,
  LlmResponseShapeError,
} from '../src/index';

// Synthetic only (hard rule 4): no real document, no real key.
const API_KEY = 'gemini-key-placeholder';

function syntheticRequest(): LlmRequest {
  return {
    model: 'gemini-3.8-flash',
    promptVersion: 'm02-proto-v1',
    maxTokens: 1024,
    system: [{ type: 'text', text: 'SYNTHETIC SYSTEM' }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', mediaType: 'application/pdf', dataBase64: 'JVBERi0=' },
          { type: 'text', text: 'SYNTHETIC USER' },
        ],
      },
    ],
    output: {
      type: 'json_schema',
      name: 'synthetic',
      schema: { type: 'object', properties: { total: { type: 'string' } }, required: ['total'] },
    },
  };
}

function okBody(text: string, finishReason = 'STOP'): Record<string, unknown> {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 30, thoughtsTokenCount: 20 },
    modelVersion: 'gemini-3.8-flash-001',
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (next === undefined) throw new Error('no fake response left');
    return Promise.resolve(next);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe('geminiRequestBody', () => {
  it('maps system, blocks and the response schema', () => {
    const body = geminiRequestBody(syntheticRequest());
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYNTHETIC SYSTEM' }] });
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: 'JVBERi0=' } },
          { text: 'SYNTHETIC USER' },
        ],
      },
    ]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 1024,
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { total: { type: 'string' } },
        required: ['total'],
      },
    });
  });

  it('maps an image block and an assistant turn without an output schema', () => {
    const request: LlmRequest = {
      ...syntheticRequest(),
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      ],
    };
    delete (request as { output?: unknown }).output;
    const body = geminiRequestBody(request);
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' } }] },
      { role: 'model', parts: [{ text: 'ok' }] },
    ]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 1024, temperature: 0 });
  });
});

describe('geminiResponseOf', () => {
  it('joins non-thought text parts, parses JSON and sums output tokens with thoughts', () => {
    const body = okBody('{"total":"121.00"}');
    (body.candidates as { content: { parts: unknown[] } }[])[0]?.content.parts.unshift({
      text: 'thinking…',
      thought: true,
    });
    const response = geminiResponseOf(body, syntheticRequest(), 7);
    expect(response).toEqual({
      model: 'gemini-3.8-flash-001',
      stopReason: 'end_turn',
      text: '{"total":"121.00"}',
      json: { total: '121.00' },
      usage: {
        inputTokens: 1200,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      latencyMs: 7,
    });
  });

  it('maps MAX_TOKENS, safety blocks and unparsable JSON', () => {
    const request = syntheticRequest();
    const cut = okBody('{"total":"12', 'MAX_TOKENS');
    expect(geminiResponseOf(cut, request, 1)).toMatchObject({
      stopReason: 'max_tokens',
      json: null,
    });
    const blocked = { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: {} };
    expect(geminiResponseOf(blocked, request, 1)).toMatchObject({
      stopReason: 'refusal',
      text: '',
      json: null,
      model: 'gemini-3.8-flash',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(() => geminiResponseOf('nope', request, 1)).toThrow(LlmResponseShapeError);
  });
});

describe('createGeminiClient', () => {
  it('posts to generateContent with the key header and returns the mapped response', async () => {
    const { fetch, calls } = fakeFetch([Response.json(okBody('{"total":"121.00"}'))]);
    const client = createGeminiClient({ apiKey: API_KEY, fetch });
    const response = await client.complete(syntheticRequest());
    expect(response.json).toEqual({ total: '121.00' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GEMINI_BASE_URL}/models/gemini-3.8-flash:generateContent`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': API_KEY,
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(geminiRequestBody(syntheticRequest()));
  });

  it('retries 429 with a growing delay, then succeeds', async () => {
    const slept: number[] = [];
    const { fetch, calls } = fakeFetch([
      Response.json({ error: { message: 'quota' } }, { status: 429 }),
      Response.json({ error: { message: 'busy' } }, { status: 503 }),
      Response.json(okBody('{"total":"1.00"}')),
    ]);
    const client = createGeminiClient({
      apiKey: API_KEY,
      fetch,
      retryDelayMs: 10,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await expect(client.complete(syntheticRequest())).resolves.toMatchObject({
      text: '{"total":"1.00"}',
    });
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([10, 20]);
  });

  it('gives up after maxAttempts with the last status, and never retries a 400', async () => {
    const { fetch: fetch429 } = fakeFetch([
      Response.json({ error: { message: 'quota' } }, { status: 429 }),
      Response.json({ error: { message: 'quota' } }, { status: 429 }),
    ]);
    const client = createGeminiClient({
      apiKey: API_KEY,
      fetch: fetch429,
      maxAttempts: 2,
      sleep: () => Promise.resolve(),
    });
    await expect(client.complete(syntheticRequest())).rejects.toMatchObject({
      name: 'LlmHttpError',
      status: 429,
      message: 'gemini: HTTP 429: quota',
    });
    const { fetch: fetch400, calls } = fakeFetch([new Response('bad', { status: 400 })]);
    const strict = createGeminiClient({ apiKey: API_KEY, fetch: fetch400 });
    await expect(strict.complete(syntheticRequest())).rejects.toBeInstanceOf(LlmHttpError);
    expect(calls).toHaveLength(1);
  });
});
