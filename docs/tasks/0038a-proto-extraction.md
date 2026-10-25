# 0038a: Prototype extraction: Gemini client (fetch), provider seam, M02 proto schema

Status: review
Ticket: PROTO-01 (owner decision 2026-10-18, "page + score" MVP; part a of a/b/c/d) | Depends on: none | Base commit: 71b75fa (head of phase/0) | Branch: task/proto-scanner | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/extraction` gets a working LLM path for the prototype: `createGeminiClient()` (plain `fetch` to `generateContent`, file as `inline_data`, JSON through `responseSchema`, 429/5xx retry), a provider seam `createLlmClientFromEnv()` (`SHOEBOX_LLM_PROVIDER` gemini | anthropic, `SHOEBOX_LLM_MODEL`, key from `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`, `.env.local` loader), an Anthropic stub that rejects with "not configured yet", and the reduced M02 wire schema `m02-proto-v1` with `buildProtoRequest()` and `parseProtoExtraction()`. Everything is tested with a fake `fetch`: no network, no key.

## 2. Context

Rules (AGENTS.md, rules.md), pasted:

- Owner decision 2026-10-18 [proto] (decisions.md): Phase 0 paused; MVP "page + score". Extraction via Google Gemini `gemini-3.8-flash` through plain `fetch` on the owner's free-tier key, prototype only; Claude stays the production target behind a provider seam. Vendor exception granted by the owner. No SDK, no new dependency (hard rule 7): `packages/extraction/package.json` is not touched (it has no dependencies; zod is not available here, so the response is normalized by hand).
- Hard rule 4: no document content in logs. `LlmHttpError` carries the HTTP status and the provider's `error.message` (200 chars at most), never the request. Tests use synthetic bytes (`JVBERi0=`) and the key placeholder `gemini-key-placeholder`.
- Hard rule 1: amounts stay decimal strings in the wire format (M02 §4.5.4: "Numbers are decimal strings (no floats)"); `Money` enters in 0038b.
- M02 §4.5.4 conventions kept: `""` = not printed, dates `YYYY-MM-DD`, every property required, no unions. The prototype schema is a subset (supplier, document, dates, currency, vat_recap, totals, payment, flags) under prompt version `m02-proto-v1`; names follow 04 (`supplier`, `duzp`, `variable_symbol`, `vat_recap`, `totals.gross`).
- Gemini API (ai.google.dev, Gemini API reference): `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`, body `{ systemInstruction: { parts }, contents: [{ role: 'user' | 'model', parts: [{ text } | { inline_data: { mime_type, data } }] }], generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens, temperature } }`; response `candidates[0].content.parts[].text`, `finishReason` (`STOP`, `MAX_TOKENS`, `SAFETY`, …), `usageMetadata.promptTokenCount / candidatesTokenCount / thoughtsTokenCount / cachedContentTokenCount`, `modelVersion`. The brief writer ran this request shape against the real API on 2026-10-18 (golden-v1, 18 documents): it works as written.
- ADR-011 (03): `LlmClient` is provider-agnostic; `LlmRequest` is the cassette key in `@shoebox/testkit` (`cassettePath(request)`), so the new `document` block is a plain data field.
- `tsconfig.base.json`: `exactOptionalPropertyTypes` is on, so optional fields are only set when defined (see `createLlmClientFromEnv`).

Anchor (`origin/phase/0`), `packages/extraction/src/llm/client.ts` line 22 (step 1):

```ts
export type LlmContentBlock = LlmTextBlock | LlmImageBlock;
```

All code below was run by the brief writer on `origin/phase/0` (71b75fa): `tsc` clean for extraction, `biome ci` clean, `pnpm --filter @shoebox/extraction test` 21 passed (4 files), `pnpm depcruise` clean, `pii_guard` OK.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/llm/client.ts` | edit | `LlmDocumentBlock` |
| `packages/extraction/src/llm/gemini.ts` | create | Gemini adapter |
| `packages/extraction/src/llm/anthropic.ts` | create | stub |
| `packages/extraction/src/llm/provider.ts` | create | env seam, dotenv |
| `packages/extraction/src/proto/schema.ts` | create | schema, prompt, parser |
| `packages/extraction/src/index.ts` | replace | exports |
| `packages/extraction/test/gemini.test.ts` | create | 7 tests |
| `packages/extraction/test/provider.test.ts` | create | 6 tests |
| `packages/extraction/test/proto-schema.test.ts` | create | 7 tests |

No other file may change.

## 4. Steps

Line map (read only the range of the step you are on):
- Step 1 code: lines 65–76
- Step 2 code: lines 82–285
- Step 3 code: lines 293–447
- Step 4 code: lines 453–857
- Step 5 code: lines 865–1354
- Step 6: commands only

Setup: `git fetch origin phase/0 && git checkout -B task/proto-scanner origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`.

Rules for every step: write each new file with **one Write call**, contents exactly as given (they are Biome-formatted; do not reformat). Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0038a step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: edit `packages/extraction/src/llm/client.ts`

Find the anchor with `grep -nF "export type LlmContentBlock = LlmTextBlock | LlmImageBlock;" packages/extraction/src/llm/client.ts` (one hit, line 22). Replace that one line with:

```ts
export type LlmDocumentMediaType = 'application/pdf';

/** A whole document (PDF) as one block. `dataBase64` has no `data:` prefix. */
export interface LlmDocumentBlock {
  type: 'document';
  mediaType: LlmDocumentMediaType;
  dataBase64: string;
}

export type LlmContentBlock = LlmTextBlock | LlmImageBlock | LlmDocumentBlock;
```

Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 2: create `packages/extraction/src/llm/gemini.ts`

```ts
/**
 * Google Gemini adapter for `LlmClient` (prototype, decisions 2026-10-18 [proto]). Plain `fetch`,
 * no SDK. One request = one `POST models/{model}:generateContent` with the file as `inline_data`
 * and structured JSON through `generationConfig.responseSchema`. Errors carry the HTTP status and
 * the provider's error message only, never the request (hard rule 4: no document content in logs).
 */
import type {
  LlmClient,
  LlmContentBlock,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmUsage,
} from './client';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
/** Free-tier friendly: 4 attempts, 15 s × attempt between them, on 429 and 5xx. */
export const GEMINI_DEFAULT_MAX_ATTEMPTS = 4;
export const GEMINI_DEFAULT_RETRY_DELAY_MS = 15_000;
export const GEMINI_DEFAULT_TIMEOUT_MS = 120_000;

export class LlmHttpError extends Error {
  readonly provider = 'gemini';
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`gemini: HTTP ${status}${detail === '' ? '' : `: ${detail}`}`);
    this.name = 'LlmHttpError';
    this.status = status;
  }
}

export class LlmResponseShapeError extends Error {
  constructor(detail: string) {
    super(`gemini: unexpected response: ${detail}`);
    this.name = 'LlmResponseShapeError';
  }
}

export interface GeminiClientOptions {
  apiKey: string;
  /** Injected in tests; defaults to the Node global. */
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponseBody {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
}

function toPart(block: LlmContentBlock): GeminiPart {
  if (block.type === 'text') return { text: block.text };
  return { inline_data: { mime_type: block.mediaType, data: block.dataBase64 } };
}

/** The JSON body of `generateContent` for an `LlmRequest`. Exported for tests. */
export function geminiRequestBody(request: LlmRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: request.maxTokens,
    temperature: 0,
  };
  if (request.output !== undefined) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = request.output.schema;
  }
  return {
    systemInstruction: { parts: request.system.map((block) => ({ text: block.text })) },
    contents: request.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: message.content.map(toPart),
    })),
    generationConfig,
  };
}

function stopReasonOf(finishReason: string | undefined, blocked: boolean): LlmStopReason {
  if (finishReason === 'STOP') return 'end_turn';
  if (finishReason === 'MAX_TOKENS') return 'max_tokens';
  if (finishReason === undefined && !blocked) return 'end_turn';
  return 'refusal';
}

/** Maps a `generateContent` body to `LlmResponse`. Exported for tests. */
export function geminiResponseOf(
  body: unknown,
  request: LlmRequest,
  latencyMs: number,
): LlmResponse {
  if (body === null || typeof body !== 'object') {
    throw new LlmResponseShapeError('body is not an object');
  }
  const parsed = body as GeminiResponseBody;
  const candidate = parsed.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
  let json: unknown = null;
  if (request.output !== undefined && text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const meta = parsed.usageMetadata ?? {};
  const usage: LlmUsage = {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
    cacheReadInputTokens: meta.cachedContentTokenCount ?? 0,
    cacheCreationInputTokens: 0,
  };
  return {
    model: parsed.modelVersion ?? request.model,
    stopReason: stopReasonOf(
      candidate?.finishReason,
      parsed.promptFeedback?.blockReason !== undefined,
    ),
    text,
    json,
    usage,
    latencyMs,
  };
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body.error?.message;
    return typeof message === 'string' ? message.slice(0, 200) : '';
  } catch {
    return '';
  }
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createGeminiClient(options: GeminiClientOptions): LlmClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? GEMINI_BASE_URL;
  const timeoutMs = options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? GEMINI_DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? GEMINI_DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const url = `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`;
      const body = JSON.stringify(geminiRequestBody(request));
      const started = Date.now();
      let lastError: Error = new LlmHttpError(0, 'no attempt made');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastError = new LlmHttpError(0, error instanceof Error ? error.name : 'network error');
          if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
          continue;
        }
        if (response.ok) {
          return geminiResponseOf(await response.json(), request, Date.now() - started);
        }
        lastError = new LlmHttpError(response.status, await errorDetail(response));
        if (!retryable(response.status)) throw lastError;
        if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
      }
      throw lastError;
    },
  };
}
```

Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 3: create `packages/extraction/src/llm/anthropic.ts` and `packages/extraction/src/llm/provider.ts`

`packages/extraction/src/llm/anthropic.ts`:

```ts
/**
 * Anthropic Claude adapter: the production target (decisions 2026-10-18 [stack]). The prototype
 * extracts with Gemini (decisions 2026-10-18 [proto]); this stub keeps the provider seam so the
 * Messages API via `fetch` can be added here without touching callers.
 */
import type { LlmClient } from './client';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

export class LlmProviderNotConfiguredError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`${provider}: LLM provider not configured yet (set SHOEBOX_LLM_PROVIDER=gemini)`);
    this.name = 'LlmProviderNotConfiguredError';
    this.provider = provider;
  }
}

/** Every call rejects with `LlmProviderNotConfiguredError` until the adapter is written. */
export function createAnthropicClient(): LlmClient {
  return {
    complete: () => Promise.reject(new LlmProviderNotConfiguredError('anthropic')),
  };
}
```

`packages/extraction/src/llm/provider.ts`:

```ts
/**
 * Provider seam (decisions 2026-10-18 [proto]): `SHOEBOX_LLM_PROVIDER` picks the adapter
 * (default `gemini`), `SHOEBOX_LLM_MODEL` the model, and the key comes from the provider's env
 * variable. `.env.local` at the repo root is read by `loadDotEnvFile` without overriding the shell.
 */
import { readFileSync } from 'node:fs';
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicClient } from './anthropic';
import type { LlmClient } from './client';
import { createGeminiClient, GEMINI_DEFAULT_MODEL } from './gemini';

export const LLM_PROVIDERS = ['gemini', 'anthropic'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_ENV = 'SHOEBOX_LLM_PROVIDER';
export const LLM_MODEL_ENV = 'SHOEBOX_LLM_MODEL';
export const LLM_KEY_ENV: Readonly<Record<LlmProvider, string>> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
export const LLM_DEFAULT_MODEL: Readonly<Record<LlmProvider, string>> = {
  gemini: GEMINI_DEFAULT_MODEL,
  anthropic: ANTHROPIC_DEFAULT_MODEL,
};

export type Env = Readonly<Record<string, string | undefined>>;

export interface LlmEnvConfig {
  readonly provider: LlmProvider;
  readonly model: string;
  /** Name of the env variable that holds the key (for messages; the key itself is never printed). */
  readonly keyEnv: string;
  readonly hasKey: boolean;
}

export class LlmProviderError extends Error {
  constructor(value: string) {
    super(`${LLM_PROVIDER_ENV}=${value} is not one of ${LLM_PROVIDERS.join(', ')}`);
    this.name = 'LlmProviderError';
  }
}

export class LlmKeyMissingError extends Error {
  readonly keyEnv: string;

  constructor(keyEnv: string) {
    super(`${keyEnv} is not set`);
    this.name = 'LlmKeyMissingError';
    this.keyEnv = keyEnv;
  }
}

function isProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

export function resolveLlmEnv(env: Env): LlmEnvConfig {
  const rawProvider = env[LLM_PROVIDER_ENV]?.trim();
  const provider = rawProvider === undefined || rawProvider === '' ? 'gemini' : rawProvider;
  if (!isProvider(provider)) throw new LlmProviderError(provider);
  const rawModel = env[LLM_MODEL_ENV]?.trim();
  const model = rawModel === undefined || rawModel === '' ? LLM_DEFAULT_MODEL[provider] : rawModel;
  const keyEnv = LLM_KEY_ENV[provider];
  const key = env[keyEnv]?.trim();
  return { provider, model, keyEnv, hasKey: key !== undefined && key !== '' };
}

export interface CreateLlmClientOptions {
  fetch?: typeof fetch;
}

/** The configured client. Throws `LlmKeyMissingError` for gemini without a key; anthropic is a stub. */
export function createLlmClientFromEnv(
  env: Env,
  options: CreateLlmClientOptions = {},
): { client: LlmClient; config: LlmEnvConfig } {
  const config = resolveLlmEnv(env);
  if (config.provider === 'anthropic') return { client: createAnthropicClient(), config };
  const apiKey = env[config.keyEnv]?.trim() ?? '';
  if (apiKey === '') throw new LlmKeyMissingError(config.keyEnv);
  const geminiOptions = options.fetch === undefined ? { apiKey } : { apiKey, fetch: options.fetch };
  return { client: createGeminiClient(geminiOptions), config };
}

/** `KEY=value` lines; `#` comments; optional single or double quotes; `export ` prefix allowed. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] ?? '';
    let value = (match[2] ?? '').trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted !== null) {
      value = quoted[2] ?? '';
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** Loads `path` into `env` for keys not already set. Returns the keys it set; a missing file sets none. */
export function loadDotEnvFile(path: string, env: Record<string, string | undefined>): string[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (env[key] === undefined) {
      env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
```

Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 4: create `packages/extraction/src/proto/schema.ts`

```ts
/**
 * Prototype extraction (decisions 2026-10-18 [proto]): the M02 §4.5.4 wire conventions on the
 * fields the "page + score" MVP needs. "" = not printed, amounts are decimal strings, dates are
 * YYYY-MM-DD. Names follow 04 (supplier, duzp, variable_symbol, vat_recap, totals.gross).
 */
import type { LlmImageMediaType, LlmRequest } from '../llm/client';

export const PROTO_PROMPT_VERSION = 'm02-proto-v1';
export const PROTO_MAX_TOKENS = 4096;

export type ProtoMediaType = 'application/pdf' | LlmImageMediaType;

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ProtoMediaType>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Media type by file extension (case-insensitive), or null when the file is not a PDF or image. */
export function protoMediaTypeOf(fileName: string): ProtoMediaType | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_MEDIA_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export function isProtoMediaType(value: string): value is ProtoMediaType {
  return Object.values(EXTENSION_MEDIA_TYPES).includes(value as ProtoMediaType);
}

export const PROTO_KIND_HINTS = [
  'invoice',
  'tax_invoice',
  'simplified_receipt',
  'card_slip',
  'credit_note',
  'proforma',
  'advance_tax_document',
  'order_confirmation',
  'statement',
  'government_filing',
  'other',
] as const;
export type ProtoKindHint = (typeof PROTO_KIND_HINTS)[number];

/** Document classes of 04 that the prototype can tell apart. */
export type ProtoDocumentClass =
  | 'received_invoice'
  | 'received_receipt'
  | 'received_credit_note'
  | 'received_proforma'
  | 'received_advance_tax_doc'
  | 'order_confirmation'
  | 'settlement_statement'
  | 'government_filing'
  | 'unknown';

const KIND_TO_CLASS: Readonly<Record<ProtoKindHint, ProtoDocumentClass>> = {
  invoice: 'received_invoice',
  tax_invoice: 'received_invoice',
  simplified_receipt: 'received_receipt',
  card_slip: 'received_receipt',
  credit_note: 'received_credit_note',
  proforma: 'received_proforma',
  advance_tax_document: 'received_advance_tax_doc',
  order_confirmation: 'order_confirmation',
  statement: 'settlement_statement',
  government_filing: 'government_filing',
  other: 'unknown',
};

export function documentClassOf(kind: ProtoKindHint): ProtoDocumentClass {
  return KIND_TO_CLASS[kind];
}

const S = { type: 'string' } as const;
const DEC = {
  type: 'string',
  description: 'Decimal string with a dot, no spaces or currency; "" if not printed',
};
const DATE = { type: 'string', description: 'YYYY-MM-DD; "" if not printed' };

/** OpenAPI-subset schema for `generationConfig.responseSchema` (Gemini) and the tool schema (Claude). */
export const PROTO_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind_hint: { type: 'string', enum: [...PROTO_KIND_HINTS] },
    supplier: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Supplier (issuer) legal name as printed' },
        ico: { type: 'string', description: 'Czech IČO, 8 digits; "" if not printed' },
        dic: { type: 'string', description: 'Czech DIČ starting with CZ; "" if not printed' },
        vat_id: { type: 'string', description: 'Foreign VAT ID; "" if not printed' },
        country: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 of the supplier; "" if unknown',
        },
      },
      required: ['name', 'ico', 'dic', 'vat_id', 'country'],
    },
    document: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Document (invoice/receipt) number' },
        variable_symbol: { type: 'string', description: 'Variabilní symbol' },
      },
      required: ['number', 'variable_symbol'],
    },
    dates: {
      type: 'object',
      properties: { issue_date: DATE, duzp: DATE, due_date: DATE },
      required: ['issue_date', 'duzp', 'due_date'],
    },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. CZK; "" if not printed' },
    vat_recap: {
      type: 'array',
      description:
        'One row per VAT rate from the VAT summary; empty if no VAT breakdown is printed',
      items: {
        type: 'object',
        properties: {
          rate_pct: { type: 'string', description: 'Rate in percent, e.g. "21"' },
          base: DEC,
          vat: DEC,
        },
        required: ['rate_pct', 'base', 'vat'],
      },
    },
    totals: {
      type: 'object',
      properties: { net: DEC, vat: DEC, gross: DEC },
      required: ['net', 'vat', 'gross'],
    },
    payment: {
      type: 'object',
      properties: {
        account_number: { type: 'string', description: 'Czech account number without bank code' },
        bank_code: { type: 'string', description: 'Czech 4-digit bank code' },
        iban: S,
      },
      required: ['account_number', 'bank_code', 'iban'],
    },
    flags: {
      type: 'object',
      properties: {
        not_tax_document_text: {
          type: 'boolean',
          description: 'The document states it is not a tax document (e.g. "není daňový doklad")',
        },
        non_vat_payer_text: {
          type: 'boolean',
          description: 'The supplier states it is not a VAT payer (e.g. "neplátce DPH")',
        },
        reverse_charge_text: {
          type: 'boolean',
          description: 'Reverse charge wording is printed',
        },
      },
      required: ['not_tax_document_text', 'non_vat_payer_text', 'reverse_charge_text'],
    },
  },
  required: [
    'kind_hint',
    'supplier',
    'document',
    'dates',
    'currency',
    'vat_recap',
    'totals',
    'payment',
    'flags',
  ],
};

export const PROTO_SYSTEM_PROMPT = [
  'Jsi přesný extraktor údajů z českých a zahraničních účetních dokladů (faktury, účtenky, dobropisy, výpisy, podání).',
  'Vrať pouze JSON podle schématu. Nic nedopočítávej a nic si nedomýšlej: opisuj jen to, co je na dokladu vytištěno.',
  'Hodnota, která na dokladu není, je prázdný řetězec "".',
  'Částky zapisuj jako desetinný řetězec s tečkou, bez mezer a bez měny (např. "1234.56"). Záporné částky se znaménkem minus.',
  'Data zapisuj jako YYYY-MM-DD. Sazby DPH v procentech jako řetězec (např. "21", "12", "0").',
  'supplier je dodavatel (ten, kdo doklad vystavil), nikdy odběratel. ico je české IČO (8 číslic), dic je české DIČ (začíná CZ), vat_id je zahraniční DIČ/VAT ID.',
  'duzp je datum uskutečnění zdanitelného plnění; pokud není vytištěno, nech "" (nepřebírej datum vystavení).',
  'vat_recap je rekapitulace DPH po sazbách; pokud doklad žádný rozpis DPH neobsahuje, vrať prázdné pole.',
  'kind_hint: tax_invoice = faktura - daňový doklad; invoice = faktura bez rozpisu DPH nebo od neplátce; simplified_receipt = zjednodušený daňový doklad / účtenka; card_slip = jen stvrzenka z terminálu; order_confirmation = potvrzení objednávky; statement = vyúčtování nebo výpis; government_filing = podání nebo hlášení úřadu; other = jiné.',
].join('\n');

export const PROTO_USER_PROMPT = 'Vytěž údaje z přiloženého dokladu.';

export interface ProtoFile {
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
}

export interface BuildProtoRequestOptions {
  readonly model: string;
  readonly file: ProtoFile;
  readonly maxTokens?: number;
}

/** The `LlmRequest` for one file: system prompt, the file as a document or image block, the schema. */
export function buildProtoRequest(options: BuildProtoRequestOptions): LlmRequest {
  const dataBase64 = Buffer.from(options.file.bytes).toString('base64');
  const fileBlock =
    options.file.mediaType === 'application/pdf'
      ? { type: 'document' as const, mediaType: options.file.mediaType, dataBase64 }
      : { type: 'image' as const, mediaType: options.file.mediaType, dataBase64 };
  return {
    model: options.model,
    promptVersion: PROTO_PROMPT_VERSION,
    maxTokens: options.maxTokens ?? PROTO_MAX_TOKENS,
    system: [{ type: 'text', text: PROTO_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROTO_USER_PROMPT }] }],
    output: { type: 'json_schema', name: PROTO_PROMPT_VERSION, schema: PROTO_RESPONSE_SCHEMA },
  };
}

export interface ProtoVatLine {
  readonly rate_pct: string;
  readonly base: string;
  readonly vat: string;
}

/** Normalized output: "" became null, invalid decimals and dates became null and are listed in `issues`. */
export interface ProtoExtraction {
  readonly schema_version: typeof PROTO_PROMPT_VERSION;
  readonly kind_hint: ProtoKindHint;
  readonly document_class: ProtoDocumentClass;
  readonly supplier: {
    readonly name: string | null;
    readonly ico: string | null;
    readonly dic: string | null;
    readonly vat_id: string | null;
    readonly country: string | null;
  };
  readonly document: { readonly number: string | null; readonly variable_symbol: string | null };
  readonly dates: {
    readonly issue_date: string | null;
    readonly duzp: string | null;
    readonly due_date: string | null;
  };
  readonly currency: string | null;
  readonly vat_recap: readonly ProtoVatLine[];
  readonly totals: {
    readonly net: string | null;
    readonly vat: string | null;
    readonly gross: string | null;
  };
  readonly payment: {
    readonly account_number: string | null;
    readonly bank_code: string | null;
    readonly iban: string | null;
  };
  readonly flags: {
    readonly not_tax_document_text: boolean;
    readonly non_vat_payer_text: boolean;
    readonly reverse_charge_text: boolean;
  };
  /** Derived: the document says so, or the supplier is not a VAT payer. */
  readonly not_tax_document: boolean;
  /** Paths whose value did not match the wire format and were dropped. */
  readonly issues: readonly string[];
}

export class ProtoParseError extends Error {
  constructor(detail: string) {
    super(`proto extraction: ${detail}`);
    this.name = 'ProtoParseError';
  }
}

const DECIMAL_RE = /^-?\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

type Json = Record<string, unknown>;

function objectAt(parent: Json, key: string): Json {
  const value = parent[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function textAt(parent: Json, key: string): string | null {
  const value = parent[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeDecimal(text: string): string {
  // Tolerate "1 234,56", "1234,56" and "1.234,56": spaces out, a comma decimal becomes a dot.
  const compact = text.replace(/[\s ]/g, '');
  if (compact.includes(',')) return compact.replace(/\./g, '').replace(',', '.');
  return compact;
}

function decimalAt(parent: Json, key: string, path: string, issues: string[]): string | null {
  const text = textAt(parent, key);
  if (text === null) return null;
  const normalized = normalizeDecimal(text);
  if (DECIMAL_RE.test(normalized)) return normalized;
  issues.push(path);
  return null;
}

function dateAt(parent: Json, key: string, path: string, issues: string[]): string | null {
  const text = textAt(parent, key);
  if (text === null) return null;
  if (DATE_RE.test(text)) return text;
  issues.push(path);
  return null;
}

function boolAt(parent: Json, key: string): boolean {
  return parent[key] === true;
}

/** Validates and normalizes the model's JSON. Throws `ProtoParseError` only when it is not an object. */
export function parseProtoExtraction(json: unknown): ProtoExtraction {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new ProtoParseError('response is not a JSON object');
  }
  const root = json as Json;
  const issues: string[] = [];
  const rawKind = textAt(root, 'kind_hint');
  let kind: ProtoKindHint = 'other';
  if (rawKind !== null && (PROTO_KIND_HINTS as readonly string[]).includes(rawKind)) {
    kind = rawKind as ProtoKindHint;
  } else if (rawKind !== null) {
    issues.push('kind_hint');
  }
  const supplier = objectAt(root, 'supplier');
  const document = objectAt(root, 'document');
  const dates = objectAt(root, 'dates');
  const totals = objectAt(root, 'totals');
  const payment = objectAt(root, 'payment');
  const flags = objectAt(root, 'flags');
  const rawCurrency = textAt(root, 'currency')?.toUpperCase() ?? null;
  let currency: string | null = null;
  if (rawCurrency !== null && CURRENCY_RE.test(rawCurrency)) {
    currency = rawCurrency;
  } else if (rawCurrency !== null) {
    issues.push('currency');
  }
  const vatRecap: ProtoVatLine[] = [];
  const rawRecap = Array.isArray(root.vat_recap) ? (root.vat_recap as unknown[]) : [];
  rawRecap.forEach((row, index) => {
    const line = row !== null && typeof row === 'object' ? (row as Json) : {};
    const path = `vat_recap[${index}]`;
    const ratePct = decimalAt(line, 'rate_pct', `${path}.rate_pct`, issues);
    const base = decimalAt(line, 'base', `${path}.base`, issues);
    const vat = decimalAt(line, 'vat', `${path}.vat`, issues);
    if (ratePct !== null && base !== null && vat !== null) {
      vatRecap.push({ rate_pct: ratePct, base, vat });
    } else {
      issues.push(path);
    }
  });
  const parsedFlags = {
    not_tax_document_text: boolAt(flags, 'not_tax_document_text'),
    non_vat_payer_text: boolAt(flags, 'non_vat_payer_text'),
    reverse_charge_text: boolAt(flags, 'reverse_charge_text'),
  };
  return {
    schema_version: PROTO_PROMPT_VERSION,
    kind_hint: kind,
    document_class: documentClassOf(kind),
    supplier: {
      name: textAt(supplier, 'name'),
      ico: textAt(supplier, 'ico')?.replace(/\s/g, '') ?? null,
      dic: textAt(supplier, 'dic')?.replace(/\s/g, '').toUpperCase() ?? null,
      vat_id: textAt(supplier, 'vat_id')?.replace(/\s/g, '').toUpperCase() ?? null,
      country: textAt(supplier, 'country')?.toUpperCase() ?? null,
    },
    document: {
      number: textAt(document, 'number'),
      variable_symbol: textAt(document, 'variable_symbol'),
    },
    dates: {
      issue_date: dateAt(dates, 'issue_date', 'dates.issue_date', issues),
      duzp: dateAt(dates, 'duzp', 'dates.duzp', issues),
      due_date: dateAt(dates, 'due_date', 'dates.due_date', issues),
    },
    currency,
    vat_recap: vatRecap,
    totals: {
      net: decimalAt(totals, 'net', 'totals.net', issues),
      vat: decimalAt(totals, 'vat', 'totals.vat', issues),
      gross: decimalAt(totals, 'gross', 'totals.gross', issues),
    },
    payment: {
      account_number: textAt(payment, 'account_number'),
      bank_code: textAt(payment, 'bank_code'),
      iban: textAt(payment, 'iban')?.replace(/\s/g, '').toUpperCase() ?? null,
    },
    flags: parsedFlags,
    not_tax_document: parsedFlags.not_tax_document_text || parsedFlags.non_vat_payer_text,
    issues,
  };
}
```

Command: `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -3` → no errors. Commit.

### Step 5: replace `packages/extraction/src/index.ts` and create the three test files

`packages/extraction/src/index.ts` (replace the whole 2-line file):

```ts
export const packageName = '@shoebox/extraction' as const;
export * from './llm/anthropic';
export * from './llm/client';
export * from './llm/gemini';
export * from './llm/provider';
export * from './proto/schema';
```

`packages/extraction/test/gemini.test.ts`:

```ts
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
```

`packages/extraction/test/provider.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLlmClientFromEnv,
  LlmKeyMissingError,
  LlmProviderError,
  LlmProviderNotConfiguredError,
  loadDotEnvFile,
  parseDotEnv,
  resolveLlmEnv,
} from '../src/index';

// Placeholders only: never a real key (hard rule 4, .gitleaks).
const KEY = 'gemini-key-placeholder';

describe('resolveLlmEnv', () => {
  it('defaults to gemini-3.8-flash with GEMINI_API_KEY', () => {
    expect(resolveLlmEnv({})).toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      keyEnv: 'GEMINI_API_KEY',
      hasKey: false,
    });
    expect(resolveLlmEnv({ GEMINI_API_KEY: KEY, SHOEBOX_LLM_MODEL: ' gemini-x ' })).toMatchObject({
      model: 'gemini-x',
      hasKey: true,
    });
  });

  it('switches to anthropic and rejects an unknown provider', () => {
    expect(resolveLlmEnv({ SHOEBOX_LLM_PROVIDER: 'anthropic' })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      keyEnv: 'ANTHROPIC_API_KEY',
      hasKey: false,
    });
    expect(() => resolveLlmEnv({ SHOEBOX_LLM_PROVIDER: 'openai' })).toThrow(LlmProviderError);
  });
});

describe('createLlmClientFromEnv', () => {
  it('needs the gemini key and uses the injected fetch', async () => {
    expect(() => createLlmClientFromEnv({})).toThrow(LlmKeyMissingError);
    const urls: string[] = [];
    const fetchFn = ((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(
        Response.json({
          candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }],
        }),
      );
    }) as typeof fetch;
    const { client, config } = createLlmClientFromEnv({ GEMINI_API_KEY: KEY }, { fetch: fetchFn });
    expect(config.provider).toBe('gemini');
    const response = await client.complete({
      model: 'gemini-3.8-flash',
      promptVersion: 'p',
      maxTokens: 10,
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(response.text).toBe('x');
    expect(urls[0]).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('returns the anthropic stub, which rejects with a clear error', async () => {
    const { client } = createLlmClientFromEnv({ SHOEBOX_LLM_PROVIDER: 'anthropic' });
    await expect(
      client.complete({ model: 'm', promptVersion: 'p', maxTokens: 1, system: [], messages: [] }),
    ).rejects.toBeInstanceOf(LlmProviderNotConfiguredError);
  });
});

describe('dotenv', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('parses KEY=value, quotes, export and comments', () => {
    const text = [
      '# comment',
      '',
      'A=1',
      'export B = two words # trailing',
      'C="quoted # not a comment"',
      "D='single'",
      'not a pair',
    ].join('\n');
    expect(parseDotEnv(text)).toEqual({
      A: '1',
      B: 'two words',
      C: 'quoted # not a comment',
      D: 'single',
    });
  });

  it('loads a file without overriding set variables, and ignores a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'shoebox-dotenv-'));
    const path = join(dir, '.env.local');
    await writeFile(path, `GEMINI_API_KEY=${KEY}\nSHOEBOX_LLM_MODEL=from-file\n`, 'utf8');
    const env: Record<string, string | undefined> = { SHOEBOX_LLM_MODEL: 'from-shell' };
    expect(loadDotEnvFile(path, env)).toEqual(['GEMINI_API_KEY']);
    expect(env).toEqual({ SHOEBOX_LLM_MODEL: 'from-shell', GEMINI_API_KEY: KEY });
    expect(loadDotEnvFile(join(dir, 'missing'), env)).toEqual([]);
  });
});
```

`packages/extraction/test/proto-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildProtoRequest,
  documentClassOf,
  isProtoMediaType,
  PROTO_PROMPT_VERSION,
  PROTO_RESPONSE_SCHEMA,
  ProtoParseError,
  parseProtoExtraction,
  protoMediaTypeOf,
} from '../src/index';

// Synthetic values only (hard rule 4).
function wire(): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Synthetic s.r.o.',
      ico: '12 34 56 78',
      dic: 'cz12345678',
      vat_id: '',
      country: 'cz',
    },
    document: { number: 'SYN-1', variable_symbol: '1' },
    dates: { issue_date: '2026-09-12', duzp: '', due_date: '2026-09-26' },
    currency: 'czk',
    vat_recap: [{ rate_pct: '21', base: '100.00', vat: '21.00' }],
    totals: { net: '100.00', vat: '21.00', gross: '121.00' },
    payment: { account_number: '123', bank_code: '0100', iban: 'cz00 test iban' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false },
  };
}

describe('protoMediaTypeOf', () => {
  it('maps extensions and rejects other files', () => {
    expect(protoMediaTypeOf('a.PDF')).toBe('application/pdf');
    expect(protoMediaTypeOf('a.jpg')).toBe('image/jpeg');
    expect(protoMediaTypeOf('a.jpeg')).toBe('image/jpeg');
    expect(protoMediaTypeOf('a.png')).toBe('image/png');
    expect(protoMediaTypeOf('a.txt')).toBeNull();
    expect(protoMediaTypeOf('noext')).toBeNull();
    expect(isProtoMediaType('image/png')).toBe(true);
    expect(isProtoMediaType('text/plain')).toBe(false);
  });
});

describe('buildProtoRequest', () => {
  it('sends a PDF as a document block and an image as an image block, with the schema', () => {
    const pdf = buildProtoRequest({
      model: 'gemini-3.8-flash',
      file: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mediaType: 'application/pdf' },
    });
    expect(pdf.model).toBe('gemini-3.8-flash');
    expect(pdf.promptVersion).toBe(PROTO_PROMPT_VERSION);
    expect(pdf.maxTokens).toBe(4096);
    expect(pdf.messages[0]?.content[0]).toEqual({
      type: 'document',
      mediaType: 'application/pdf',
      dataBase64: 'JVBERg==',
    });
    expect(pdf.output?.schema).toBe(PROTO_RESPONSE_SCHEMA);
    const png = buildProtoRequest({
      model: 'm',
      file: { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      maxTokens: 99,
    });
    expect(png.maxTokens).toBe(99);
    expect(png.messages[0]?.content[0]).toMatchObject({ type: 'image', mediaType: 'image/png' });
  });

  it('schema requires every top-level field and has no nullable types', () => {
    const required = PROTO_RESPONSE_SCHEMA.required as string[];
    expect(required).toEqual(Object.keys(PROTO_RESPONSE_SCHEMA.properties as object));
    expect(JSON.stringify(PROTO_RESPONSE_SCHEMA)).not.toContain('nullable');
  });
});

describe('parseProtoExtraction', () => {
  it('normalizes "" to null, trims identifiers and derives the class', () => {
    const out = parseProtoExtraction(wire());
    expect(out.document_class).toBe('received_invoice');
    expect(out.supplier).toEqual({
      name: 'Synthetic s.r.o.',
      ico: '12345678',
      dic: 'CZ12345678',
      vat_id: null,
      country: 'CZ',
    });
    expect(out.dates).toEqual({ issue_date: '2026-09-12', duzp: null, due_date: '2026-09-26' });
    expect(out.currency).toBe('CZK');
    expect(out.payment.iban).toBe('CZ00TESTIBAN');
    expect(out.vat_recap).toEqual([{ rate_pct: '21', base: '100.00', vat: '21.00' }]);
    expect(out.not_tax_document).toBe(false);
    expect(out.issues).toEqual([]);
  });

  it('drops invalid decimals and dates into issues and tolerates Czech number formats', () => {
    const raw = wire();
    raw.dates = { issue_date: '12.9.2026', duzp: '2026-08-31', due_date: '' };
    raw.totals = { net: '1 234,50', vat: 'abc', gross: '1.234,50' };
    raw.vat_recap = [{ rate_pct: '21', base: 'x', vat: '1.00' }, 'junk'];
    raw.currency = 'Kč';
    raw.kind_hint = 'mystery';
    const out = parseProtoExtraction(raw);
    expect(out.dates).toEqual({ issue_date: null, duzp: '2026-08-31', due_date: null });
    expect(out.totals).toEqual({ net: '1234.50', vat: null, gross: '1234.50' });
    expect(out.vat_recap).toEqual([]);
    expect(out.currency).toBeNull();
    expect(out.kind_hint).toBe('other');
    expect(out.document_class).toBe('unknown');
    expect(out.issues).toEqual([
      'kind_hint',
      'currency',
      'vat_recap[0].base',
      'vat_recap[0]',
      'vat_recap[1]',
      'dates.issue_date',
      'totals.vat',
    ]);
  });

  it('derives not_tax_document from either flag and rejects non-objects', () => {
    const raw = wire();
    raw.flags = {
      not_tax_document_text: false,
      non_vat_payer_text: true,
      reverse_charge_text: false,
    };
    expect(parseProtoExtraction(raw).not_tax_document).toBe(true);
    expect(parseProtoExtraction({}).document_class).toBe('unknown');
    expect(() => parseProtoExtraction(null)).toThrow(ProtoParseError);
    expect(() => parseProtoExtraction([])).toThrow(ProtoParseError);
  });

  it('maps every kind hint to a class of 04', () => {
    expect(documentClassOf('simplified_receipt')).toBe('received_receipt');
    expect(documentClassOf('card_slip')).toBe('received_receipt');
    expect(documentClassOf('statement')).toBe('settlement_statement');
    expect(documentClassOf('government_filing')).toBe('government_filing');
    expect(documentClassOf('order_confirmation')).toBe('order_confirmation');
    expect(documentClassOf('credit_note')).toBe('received_credit_note');
    expect(documentClassOf('proforma')).toBe('received_proforma');
    expect(documentClassOf('advance_tax_document')).toBe('received_advance_tax_doc');
  });
});
```

Command: `pnpm exec biome ci packages/extraction 2>&1 | tail -3` → `No fixes applied`, no errors; `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -3` → no errors; `pnpm --filter @shoebox/extraction test 2>&1 | tail -6` → `Test Files  4 passed (4)` and `Tests  21 passed (21)`. Commit.

### Step 6: repo guards, push

Command: `pnpm depcruise 2>&1 | tail -2` → `no dependency violations found`; `python3 scripts/pii_guard.py --all packages/extraction/src/llm/gemini.ts packages/extraction/src/llm/anthropic.ts packages/extraction/src/llm/provider.ts packages/extraction/src/proto/schema.ts packages/extraction/test/gemini.test.ts packages/extraction/test/provider.test.ts packages/extraction/test/proto-schema.test.ts 2>&1 | tail -1` → `pii_guard: OK`; `grep -c "dependencies" packages/extraction/package.json` → `1` (only `devDependencies`; nothing added). Nothing to commit. Write the report (§9) and push: `git push -u origin task/proto-scanner 2>&1 | tail -3`. No PR yet: 0038b, c and d continue on this branch and 0038d opens the one PR.

## 5. Do not touch

`packages/extraction/package.json`, `packages/extraction/vitest.config.ts`, `packages/extraction/test/smoke.test.ts`, `packages/testkit/**` (its cassette tests keep passing: the new block type is additive), `packages/validation/**` (0038b), `scripts/**` (0038c/d), `pnpm-lock.yaml`, `.env*`, `docs/v3/**`, `.github/**`. Hard rules 4, 7, 8. Never put a real key anywhere; tests use `gemini-key-placeholder`.

## 6. Commands

```
pnpm --filter @shoebox/extraction test 2>&1 | tail -30                                   # 21 passed (4 files)
pnpm --filter @shoebox/extraction exec vitest run test/gemini.test.ts 2>&1 | tail -6     # 7 passed
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30                              # exit 0
pnpm exec biome ci packages/extraction 2>&1 | tail -30                                   # No fixes applied, no errors
pnpm depcruise 2>&1 | tail -3                                                            # no dependency violations found
python3 scripts/pii_guard.py --all packages/extraction/src/llm/*.ts packages/extraction/src/proto/schema.ts packages/extraction/test/*.test.ts 2>&1 | tail -3   # pii_guard: OK
```

## 7. Acceptance

- [ ] `packages/extraction/test/gemini.test.ts`: 7 passed; it pins the URL `…/v1beta/models/gemini-3.8-flash:generateContent`, the `x-goog-api-key` header, `inline_data` for the PDF block, `responseMimeType` + `responseSchema`, usage mapping (`thoughtsTokenCount` counted as output), 429 → retry with 10 ms then 20 ms, 400 → no retry.
- [ ] `packages/extraction/test/provider.test.ts`: 6 passed; defaults `gemini` / `gemini-3.8-flash` / `GEMINI_API_KEY`; `LlmKeyMissingError` without a key; anthropic stub rejects with `LlmProviderNotConfiguredError`; `.env.local` never overrides the shell.
- [ ] `packages/extraction/test/proto-schema.test.ts`: 7 passed; `""` → `null`, `"1 234,50"` → `"1234.50"`, invalid values land in `issues`, schema has no `nullable`.
- [ ] `grep -c "LlmDocumentBlock" packages/extraction/src/llm/client.ts` → `2`; `git diff --stat origin/phase/0 -- packages/extraction/package.json pnpm-lock.yaml` → empty.
- [ ] `grep -rn "AQ\.\|AIza" packages/extraction` → no output (no real key).

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0038a-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`gemini.ts`: the request body shape (`systemInstruction`, `contents[].parts`, `inline_data.mime_type/data`, `generationConfig.responseSchema`), `role: 'model'` for assistant turns, thought parts filtered out of `text`, output tokens = candidates + thoughts, retry only on 429/5xx/network with `retryDelayMs × attempt`, `AbortSignal.timeout(120 s)`, error detail capped at 200 chars and never the request. `provider.ts`: default provider `gemini`, unknown provider throws, `.env.local` does not override the shell, no value is ever printed. `schema.ts`: `""` → `null`, decimals tolerant to `1 234,56` and `1.234,56`, dates strict `YYYY-MM-DD`, `not_tax_document = not_tax_document_text || non_vat_payer_text` (the golden set labels non-VAT-payer invoices as `not_tax_document`), `kind_hint → document_class` map against 04. `responseSchema` is the OpenAPI subset (no `nullable`, no `additionalProperties`); the brief writer verified it is accepted by `gemini-3.8-flash`. The free tier may use inputs to improve Google products: only anonymized golden-v1 files go through this client (decisions 2026-10-18 [proto]).

## Owner steps

None for this brief. The key is needed first in 0038c (`GEMINI_API_KEY` in `.env.local`); 0038d lists the click-by-click steps.
