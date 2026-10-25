# 0019: LlmClient interface and cassette client

Status: review
Ticket: P0-TEST-03 | Depends on: none (P0-REPO-01, P0-TEST-01 merged) | Base commit: head of phase/0 | Branch: task/0019-llm-cassette | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Define the provider-agnostic `LlmClient` interface in `@shoebox/extraction` (structured output, image input, token usage) and a cassette client in `@shoebox/testkit` with `replay`, `record` and `live` modes keyed by a SHA-256 of the canonical request. This lets every later extraction, classification and eval test run offline, free and deterministic, and fail loudly when a prompt changed but its cassettes were not re-recorded.

## 2. Context

Work mechanically: write each file with **one Write call** using the exact content below, do not re-read a file you just wrote, do not explore the repo. Commit after each step as `0019 step k`.

Spec lines (pasted; do not open `docs/v3/`):

- 03 ADR-011 (changed 2026-10-18): "Claude models via the Anthropic Claude API directly; Vertex AI `eu` as the fallback. Provider-agnostic gateway interface (`LlmClient`) with: structured output (JSON schema / tool use), image input, per-call cost accounting, retries, prompt caching of the static system prompt and few-shot examples. Raw prompts and responses are stored for 30 days only."
- M12 §4.10 Runner step 3: "LLM cassettes: `testdata/golden-v1/cassettes/{model}/{prompt_version}/{sha256(request)}.json`. `replay` fails with "missing cassette, run `pnpm eval --record`" if absent; `record` calls the live endpoint (dev budget) and writes cassettes; `live` calls without writing."
- M12 §8 edge case 11: "Cassette drift (prompt changed, cassettes missing): replay fails loudly; developer runs `pnpm eval --record` (live, dev budget) and commits cassettes with the prompt change."
- M02 §4.5.3 (request shape the interface must carry): model, max_tokens, effort, a system prompt in two text blocks where the second (few-shot) is the prompt-cached prefix, user content with text blocks and base64 images (`image/jpeg`), and a JSON-schema output format; `stop_reason` (`max_tokens`, `refusal`) is checked before parsing.

Scope decisions for this brief:

- **No provider SDK and no network code.** `@anthropic-ai/sdk` and Google/AWS SDKs are not in the approved dependency list (decisions, P0-OWN-01). The real Vertex AI client, retries, timeouts and cost-in-money come with the P1 LLM ticket. This brief defines types only in `packages/extraction` and the cassette client in `packages/testkit`.
- **Usage is token counts only** (integers). Cost in USD is computed later from these by the budget code and is never a float (hard rule 1).
- **Privacy (hard rule 4):** a cassette stores the request **hash**, model, prompt version and the response, never the request itself (no prompt text, no images, no document content). Tests use synthetic strings only (`SYN-0001`).
- **Hash:** SHA-256 hex of `canonicalJson(request)`: object keys sorted at every depth, array order kept, `undefined` object values dropped. So key order never changes the hash.
- **Test file name:** the backlog names `cassette.test.ts`; this phase uses `packages/testkit/test/llm-cassette.test.ts` so parallel testkit briefs never collide. Same tests.
- `@shoebox/extraction` is a workspace package, not a new vendor: adding it as `workspace:*` needs no decisions line. Only the `importers: packages/testkit` block of `pnpm-lock.yaml` changes (about 3 added lines, `link:../extraction`).
- `node:crypto`, `node:fs/promises`, `node:path` are already used in the repo (`packages/platform`); `@types/node` is at the root and `tsconfig.base.json` has `"types": ["node"]`.

Excerpt the step-2 edit anchors on (`packages/extraction/src/index.ts`, the whole file):

```ts
export const packageName = '@shoebox/extraction' as const;
```

Excerpt the step-3 edit anchors on (`packages/testkit/package.json`):

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*"
  },
```

Excerpt the step-7 edit anchors on (`packages/testkit/src/index.ts`, last line; other briefs may have added lines above it, that is fine):

```ts
export * from './ids';
```

If `packages/testkit/src/index.ts` has other `export * from` lines after `./ids` (from a parallel brief merged earlier), add the new line after the **last** `export * from` line instead.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/llm/client.ts` | new | `LlmClient`, `LlmRequest`, `LlmResponse`, `LlmUsage`, `LlmMode` and block types (types only) |
| `packages/extraction/src/index.ts` | edit | add `export * from './llm/client';` |
| `packages/testkit/package.json` | edit | add `"@shoebox/extraction": "workspace:*"` to `dependencies` |
| `pnpm-lock.yaml` | regenerated | by `pnpm install`; only the testkit importer changes |
| `packages/testkit/src/llm/cassette.ts` | new | `canonicalJson`, `requestHash`, `cassettePath`, stores, `createCassetteClient`, `MissingCassetteError` |
| `packages/testkit/src/llm/index.ts` | new | re-export `./cassette` |
| `packages/testkit/src/index.ts` | edit | add exactly one line `export * from './llm/index';` |
| `packages/testkit/test/llm-cassette.test.ts` | new | the acceptance tests |

No other file may change. `docs/tasks/0019-report.md` is written in §9.

## 4. Steps

0. **Setup.** `git fetch origin phase/0 && git checkout -b task/0019-llm-cassette origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`
   Expected: `Done in …`.

1. **New `packages/extraction/src/llm/client.ts`** (exact content):

```ts
/**
 * Provider-agnostic LLM gateway (03 ADR-011). Implementations: the Anthropic Claude API client (P1),
 * the Vertex AI `eu` fallback (only after a decisions line), and the cassette client in @shoebox/testkit.
 * No provider SDK is imported here. Retries, timeouts and cost in money belong to implementations.
 */

/** A text block. `cache: true` marks the end of the prompt-cached static prefix. */
export interface LlmTextBlock {
  type: 'text';
  text: string;
  cache?: boolean;
}

export type LlmImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** An image block. `dataBase64` has no `data:` prefix. */
export interface LlmImageBlock {
  type: 'image';
  mediaType: LlmImageMediaType;
  dataBase64: string;
}

export type LlmContentBlock = LlmTextBlock | LlmImageBlock;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

/** Structured output: the answer must be JSON matching `schema` (a JSON Schema object). */
export interface LlmJsonOutput {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}

export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  /** Provider model id, e.g. 'claude-haiku-5-5'. First cassette path segment. */
  model: string;
  /** Prompt version, e.g. 'm02-v1' (extraction_runs.prompt_version). Second cassette path segment. */
  promptVersion: string;
  maxTokens: number;
  effort?: LlmEffort;
  system: LlmTextBlock[];
  messages: LlmMessage[];
  output?: LlmJsonOutput;
}

export type LlmStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'tool_use';

/** Token counts (integers). Cost is derived from these by the budget code, never as a float. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface LlmResponse {
  /** The model id the provider reports as having answered. */
  model: string;
  stopReason: LlmStopReason;
  /** Raw text output (the JSON string when `output` was set). */
  text: string;
  /** Parsed JSON when `output` was set and the text parsed, else null. Validate with zod before use. */
  json: unknown;
  usage: LlmUsage;
  latencyMs: number;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** M12 §4.10 Runner step 3: replay cassettes, record them from the live endpoint, or call live without writing. */
export type LlmMode = 'replay' | 'record' | 'live';
```

   Commit `0019 step 1` (typecheck runs after step 2).

2. **Edit `packages/extraction/src/index.ts`** (anchor in §2) so the whole file reads:

```ts
export const packageName = '@shoebox/extraction' as const;
export * from './llm/client';
```

   Run `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -5`
   Expected: exit 0, no errors. Commit `0019 step 2`.

3. **Edit `packages/testkit/package.json`.** Replace the anchor (§2) with:

```json
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "@shoebox/extraction": "workspace:*"
  },
```

   If the `dependencies` block already has more entries (a parallel brief merged), keep them and insert `"@shoebox/extraction": "workspace:*"` in alphabetical order.
   Then run `pnpm install 2>&1 | tail -3 && git diff --stat 2>&1 | tail -5`
   Expected: `Done in …`; diff stat shows `packages/testkit/package.json` and `pnpm-lock.yaml` only (a few added lines each). Commit `0019 step 3`.

4. **New `packages/testkit/test/llm-cassette.test.ts`** (exact content; the tests are the spec, do not edit them later):

```ts
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
  usage: { inputTokens: 1200, outputTokens: 40, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0 },
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
    expect(() => cassettePath({ ...syntheticRequest(), model: '../x' })).toThrow(/invalid cassette path segment/);
    expect(() => cassettePath({ ...syntheticRequest(), promptVersion: 'a/b' })).toThrow(/invalid cassette path segment/);
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
    await createCassetteClient({ mode: 'record', store, live: fakeLive() }).complete(syntheticRequest());

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    const live = fakeLive();
    const client = createCassetteClient({ mode: 'replay', store, live });

    await expect(client.complete(reverseKeys(syntheticRequest()) as LlmRequest)).resolves.toEqual(RESPONSE);
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
    expect(() => createCassetteClient({ mode: 'record', store: memoryCassetteStore() })).toThrow(/needs a live LlmClient/);
    expect(() => createCassetteClient({ mode: 'live', store: memoryCassetteStore() })).toThrow(/needs a live LlmClient/);
  });
});

describe('fsCassetteStore', () => {
  it('records to disk under the root and replays from it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shoebox-cassettes-'));
    try {
      const store = fsCassetteStore(root);
      const request = syntheticRequest();
      await createCassetteClient({ mode: 'record', store, live: fakeLive() }).complete(request);

      const onDisk = await readFile(join(root, 'claude-haiku-5-5', 'm02-v1', `${requestHash(request)}.json`), 'utf8');
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
```

   Run `pnpm exec biome check --write packages/testkit/test/llm-cassette.test.ts 2>&1 | tail -5` (formats and orders imports; that is allowed, do not change test logic). Do not run the tests yet (the source does not exist). Commit `0019 step 4`.

5. **New `packages/testkit/src/llm/cassette.ts`.** Implement until the step-4 tests pass; do not edit the test file. Use this exact content:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LlmClient, LlmMode, LlmRequest, LlmResponse } from '@shoebox/extraction';

/** M12 §4.10 Runner step 3 and §8 edge case 11: replay fails loudly with this text. */
export const MISSING_CASSETTE_MESSAGE = 'missing cassette, run `pnpm eval --record`';

export class MissingCassetteError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`${MISSING_CASSETTE_MESSAGE} (${path})`);
    this.name = 'MissingCassetteError';
    this.path = path;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted at every depth; array order kept; undefined object values dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** SHA-256 hex of the canonical request: independent of object key order. */
export function requestHash(request: LlmRequest): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

/** `{model}/{prompt_version}/{sha256(request)}.json`, relative to the cassette root. */
export function cassettePath(request: LlmRequest): string {
  for (const segment of [request.model, request.promptVersion]) {
    if (!SEGMENT.test(segment)) {
      throw new Error(`invalid cassette path segment: ${segment}`);
    }
  }
  return `${request.model}/${request.promptVersion}/${requestHash(request)}.json`;
}

/** What a cassette file holds. Never the request itself (hard rule 4): only its hash. */
export interface CassetteFile {
  version: 1;
  model: string;
  prompt_version: string;
  request_sha256: string;
  response: LlmResponse;
}

export interface CassetteStore {
  /** The file body, or null when the cassette does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
}

export interface MemoryCassetteStore extends CassetteStore {
  readonly files: Map<string, string>;
}

export function memoryCassetteStore(initial: Record<string, string> = {}): MemoryCassetteStore {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, body) => {
      files.set(path, body);
      return Promise.resolve();
    },
  };
}

/** Cassettes on disk under `root`, e.g. `testdata/golden-v1/cassettes`. */
export function fsCassetteStore(root: string): CassetteStore {
  return {
    async read(path) {
      try {
        return await readFile(join(root, path), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(path, body) {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body, 'utf8');
    },
  };
}

function parseCassette(body: string, path: string): CassetteFile {
  const parsed: unknown = JSON.parse(body);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { response?: unknown }).response !== 'object'
  ) {
    throw new Error(`invalid cassette file: ${path}`);
  }
  return parsed as CassetteFile;
}

export interface CassetteClientOptions {
  mode: LlmMode;
  store: CassetteStore;
  /** The real client. Required for 'record' and 'live'; never called in 'replay'. */
  live?: LlmClient;
}

/** An `LlmClient` that replays, records or passes through, keyed by `cassettePath(request)`. */
export function createCassetteClient(options: CassetteClientOptions): LlmClient {
  const { mode, store, live } = options;
  if (mode !== 'replay' && live === undefined) {
    throw new Error(`cassette client in ${mode} mode needs a live LlmClient`);
  }
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const path = cassettePath(request);
      if (mode === 'replay') {
        const body = await store.read(path);
        if (body === null) throw new MissingCassetteError(path);
        return parseCassette(body, path).response;
      }
      if (live === undefined) {
        throw new Error(`cassette client in ${mode} mode needs a live LlmClient`);
      }
      const response = await live.complete(request);
      if (mode === 'record') {
        const file: CassetteFile = {
          version: 1,
          model: request.model,
          prompt_version: request.promptVersion,
          request_sha256: requestHash(request),
          response,
        };
        await store.write(path, `${JSON.stringify(file, null, 2)}\n`);
      }
      return response;
    },
  };
}
```

   Run `pnpm exec biome check --write packages/testkit/src/llm/cassette.ts 2>&1 | tail -5`. Commit `0019 step 5` (tests run after step 7).

6. **New `packages/testkit/src/llm/index.ts`** (exact content):

```ts
export * from './cassette';
```

   Commit `0019 step 6`.

7. **Edit `packages/testkit/src/index.ts`.** After the anchor line `export * from './ids';` (or the last `export * from` line, see §2) add exactly one line:

```ts
export * from './llm/index';
```

   Run `pnpm exec biome check --write packages/testkit/src/index.ts 2>&1 | tail -5 && pnpm --filter @shoebox/testkit test llm-cassette 2>&1 | tail -30`
   Expected: `Test Files  1 passed (1)`, `Tests  12 passed (12)`. If a test fails, fix `cassette.ts` (not the test); a test that fails twice → §8. Commit `0019 step 7`.

8. **Checks.** Run the §6 commands in order. Fix only files in §3. Commit `0019 step 8` if anything changed.

## 5. Do not touch

- Any file not in §3, in particular `packages/testkit/src/registries/**` and `packages/testkit/src/eval/**` (parallel briefs 0018 and 0020), `testdata/**` (no cassettes are committed in this brief), `.dependency-cruiser.cjs`, `biome.json`, root `package.json`.
- Hard rule 4: no real document content or personal data in tests or cassettes; synthetic strings only. Never log request content.
- Hard rule 7: add no npm dependency (no `@anthropic-ai/sdk`, no Google or AWS SDK, no `zod` in testkit). Only the workspace link to `@shoebox/extraction`.
- Hard rule 8: no real network calls; no API keys; nothing that calls the Anthropic API, Vertex AI or Bedrock.
- Hard rule 1: no money as a float; `LlmUsage` stays token counts only.

## 6. Commands

From the repo root, in order:

1. `pnpm --filter @shoebox/testkit test llm-cassette 2>&1 | tail -30` → `Tests  12 passed (12)`.
2. `pnpm --filter @shoebox/testkit test 2>&1 | tail -30` → all testkit test files pass (smoke, factories, llm-cassette, plus any merged parallel files).
3. `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30` → exit 0, no output errors.
4. `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/extraction test 2>&1 | tail -30` → exit 0; smoke test passes.
5. `pnpm depcruise 2>&1 | tail -30` → `no dependency violations found`.
6. `pnpm lint 2>&1 | tail -30` → exit 0.

`pnpm eval --quick` (test-map row for `packages/extraction`) does not exist yet (P0-EVAL-02); skip it and say so in the report.

## 7. Acceptance

Mirrors backlog P0-TEST-03 (test file named `llm-cassette.test.ts`, see §2):

- [ ] `packages/testkit/test/llm-cassette.test.ts`: hash independent of object key order (`hash is independent of object key order`).
- [ ] Missing cassette fails with "missing cassette, run `pnpm eval --record`" (`replay fails loudly when the cassette is missing`).
- [ ] Record writes `{model}/{prompt_version}/{sha256}.json` (`record calls the live client and writes …`, `fsCassetteStore …`).
- [ ] Replay makes no network call (`replay returns the recorded response and makes no network call`: live client 0 calls, `fetch` spy not called).
- [ ] `LlmClient` interface exists in `packages/extraction/src/llm/client.ts` with structured output (`LlmJsonOutput`), images (`LlmImageBlock`) and usage (`LlmUsage`), exported from `@shoebox/extraction`.
- [ ] §6 commands 1–6 pass.

Not in this ticket (later): the real Anthropic Claude API client, retries, timeouts, prompt-caching wiring, cost in money and `LlmBudget` (P1 LLM ticket); the `pnpm eval --record` CLI (P0-EVAL-02); committed cassettes (P1-EVAL-01); `submitBatch` (Later, M02 §4.10).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change (for example depcruise flags the testkit → extraction import);
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0019-report.md` (600 tokens at most), set `Status: review` in this brief, commit `0019 report`, then `git push -u origin task/0019-llm-cassette 2>&1 | tail -5`. The orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -12`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source (none expected).
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `packages/testkit/src/llm/cassette.ts`: the cassette body must contain only hash, model, prompt version and response (hard rule 4); the path-segment regex must block `..` and `/`; replay must never touch `live`.
- `packages/extraction/src/llm/client.ts`: the interface later P1 code implements; check it can carry M02 §4.5.3 (cached few-shot block, images, JSON schema, `stop_reason`).
- `packages/testkit/package.json` and `pnpm-lock.yaml`: only the workspace link added. Parallel brief 0018 may also add a dependency here; resolve the merge by keeping both lines and re-running `pnpm install`.

## Owner steps

None. No accounts, secrets or network access are needed for this brief.
