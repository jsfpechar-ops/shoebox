import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmClient, LlmRequest, LlmResponse } from '@shoebox/extraction';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  cassettePath,
  createCassetteClient,
  fsCassetteStore,
  MISSING_CASSETTE_MESSAGE,
  MissingCassetteError,
  memoryCassetteStore,
  requestHash,
} from '../src/index';

// Synthetic only (hard rule 4): no real document content, no personal data.
function syntheticRequest(): LlmRequest {
  return {
    model: 'claude-haiku-5-5',
    promptVersion: 'm02-v1',
    maxTokens: 4096,
    effort: 'low',
    system: [
      { type: 'text', text: 'SYNTHETIC SYSTEM PROMPT' },
      { type: 'text', text: 'SYNTHETIC FEW-SHOT', cache: true },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Synthetic invoice SYN-0001, total 121.00 CZK' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' },
        ],
      },
    ],
    output: {
      type: 'json_schema',
      name: 'synthetic_v1',
      schema: {
        type: 'object',
        properties: { total: { type: 'string' } },
        required: ['total'],
        additionalProperties: false,
      },
    },
  };
}

const RESPONSE: LlmResponse = {
  model: 'claude-haiku-5-5',
  stopReason: 'end_turn',
  text: '{"total":"121.00"}',
  json: { total: '121.00' },
  usage: {
    inputTokens: 1200,
    outputTokens: 40,
    cacheReadInputTokens: 1000,
    cacheCreationInputTokens: 0,
  },
  latencyMs: 850,
};

function fakeLive(): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    complete: (request) => {
      calls.push(request);
      return Promise.resolve(RESPONSE);
    },
  };
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonicalJson and requestHash', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('drops undefined object values', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('hash is independent of object key order', () => {
    const request = syntheticRequest();
    const reordered = reverseKeys(request) as LlmRequest;
    expect(Object.keys(reordered)[0]).toBe('output');
    expect(requestHash(reordered)).toBe(requestHash(request));
  });

  it('hash is 64 hex chars and changes when a value changes', () => {
    const request = syntheticRequest();
    expect(requestHash(request)).toMatch(/^[0-9a-f]{64}$/);
    expect(requestHash({ ...request, maxTokens: 8192 })).not.toBe(requestHash(request));
  });
});

describe('cassettePath', () => {
  it('is {model}/{prompt_version}/{sha256}.json', () => {
    const request = syntheticRequest();
    expect(cassettePath(request)).toBe(`claude-haiku-5-5/m02-v1/${requestHash(request)}.json`);
  });

  it('rejects a path segment that could leave the cassette folder', () => {
    expect(() => cassettePath({ ...syntheticRequest(), model: '../x' })).toThrow(
      /invalid cassette path segment/,
    );
    expect(() => cassettePath({ ...syntheticRequest(), promptVersion: 'a/b' })).toThrow(
      /invalid cassette path segment/,
    );
  });
});

describe('createCassetteClient', () => {
  it('replay fails loudly when the cassette is missing', async () => {
    expect(MISSING_CASSETTE_MESSAGE).toBe('missing cassette, run `pnpm eval --record`');
    const client = createCassetteClient({ mode: 'replay', store: memoryCassetteStore() });
    const call = client.complete(syntheticRequest());
    await expect(call).rejects.toBeInstanceOf(MissingCassetteError);
    await expect(client.complete(syntheticRequest())).rejects.toThrow(MISSING_CASSETTE_MESSAGE);
  });

  it('record calls the live client and writes {model}/{prompt_version}/{sha256}.json without the request', async () => {
    const store = memoryCassetteStore();
    const live = fakeLive();
    const client = createCassetteClient({ mode: 'record', store, live });
    const request = syntheticRequest();

    await expect(client.complete(request)).resolves.toEqual(RESPONSE);
    expect(live.calls).toHaveLength(1);

    const path = `claude-haiku-5-5/m02-v1/${requestHash(request)}.json`;
    expect([...store.files.keys()]).toEqual([path]);
    const body = store.files.get(path) ?? '';
    expect(JSON.parse(body)).toEqual({
      version: 1,
      model: 'claude-haiku-5-5',
      prompt_version: 'm02-v1',
      request_sha256: requestHash(request),
      response: RESPONSE,
    });
    expect(body).not.toContain('SYN-0001');
    expect(body).not.toContain('iVBORw0KGgo=');
  });

  it('replay returns the recorded response and makes no network call', async () => {
    const store = memoryCassetteStore();
    await createCassetteClient({ mode: 'record', store, live: fakeLive() }).complete(
      syntheticRequest(),
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const live = fakeLive();
    const client = createCassetteClient({ mode: 'replay', store, live });

    await expect(client.complete(reverseKeys(syntheticRequest()) as LlmRequest)).resolves.toEqual(
      RESPONSE,
    );
    expect(live.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('live calls the live client and writes nothing', async () => {
    const store = memoryCassetteStore();
    const live = fakeLive();
    const client = createCassetteClient({ mode: 'live', store, live });
    await expect(client.complete(syntheticRequest())).resolves.toEqual(RESPONSE);
    expect(live.calls).toHaveLength(1);
    expect(store.files.size).toBe(0);
  });

  it('record and live need a live client', () => {
    expect(() => createCassetteClient({ mode: 'record', store: memoryCassetteStore() })).toThrow(
      /needs a live LlmClient/,
    );
    expect(() => createCassetteClient({ mode: 'live', store: memoryCassetteStore() })).toThrow(
      /needs a live LlmClient/,
    );
  });
});

describe('fsCassetteStore', () => {
  it('records to disk under the root and replays from it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shoebox-cassettes-'));
    try {
      const store = fsCassetteStore(root);
      const request = syntheticRequest();
      await createCassetteClient({ mode: 'record', store, live: fakeLive() }).complete(request);

      const onDisk = await readFile(
        join(root, 'claude-haiku-5-5', 'm02-v1', `${requestHash(request)}.json`),
        'utf8',
      );
      expect(JSON.parse(onDisk).request_sha256).toBe(requestHash(request));

      const replay = createCassetteClient({ mode: 'replay', store });
      await expect(replay.complete(request)).resolves.toEqual(RESPONSE);
      await expect(replay.complete({ ...request, promptVersion: 'm02-v2' })).rejects.toBeInstanceOf(
        MissingCassetteError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
