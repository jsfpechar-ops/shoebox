/**
 * Anthropic Claude adapter for `LlmClient` (decisions 2026-10-18 [proto-eval]). Plain `fetch`,
 * no SDK. One request = one `POST /v1/messages`. Errors carry the HTTP status and the provider's
 * error message only, never the request (hard rule 4: no document content in logs).
 */
import type {
  LlmClient,
  LlmContentBlock,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmTextBlock,
  LlmUsage,
} from './client';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';
/** 4 attempts, retry delay × attempt, on 429 and 5xx (529 included). */
export const ANTHROPIC_DEFAULT_MAX_ATTEMPTS = 4;
export const ANTHROPIC_DEFAULT_RETRY_DELAY_MS = 5_000;
export const ANTHROPIC_DEFAULT_TIMEOUT_MS = 180_000;

export class AnthropicHttpError extends Error {
  readonly provider = 'anthropic';
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`anthropic: HTTP ${status}${detail === '' ? '' : `: ${detail}`}`);
    this.name = 'AnthropicHttpError';
    this.status = status;
  }
}

export class AnthropicResponseShapeError extends Error {
  constructor(detail: string) {
    super(`anthropic: unexpected response: ${detail}`);
    this.name = 'AnthropicResponseShapeError';
  }
}

export interface AnthropicClientOptions {
  apiKey: string;
  /** Injected in tests; defaults to the Node global. */
  fetch?: typeof fetch;
  /** Replaces the whole endpoint URL. */
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface AnthropicBlock {
  type?: string;
  text?: unknown;
}

interface AnthropicMessageBody {
  model?: unknown;
  stop_reason?: unknown;
  content?: AnthropicBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Every object gets `additionalProperties: false` (required by structured output). Does not mutate. */
export function strictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strictNode(schema) as Record<string, unknown>;
}

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = strictNode(value);
  }
  if (source.type === 'object') out.additionalProperties = false;
  return out;
}

function systemBlock(block: LlmTextBlock): Record<string, unknown> {
  return block.cache === true
    ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } }
    : { type: 'text', text: block.text };
}

function contentBlock(block: LlmContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { type: 'text', text: block.text };
  return {
    type: block.type,
    source: { type: 'base64', media_type: block.mediaType, data: block.dataBase64 },
  };
}

/** The JSON body of `POST /v1/messages` for an `LlmRequest`. Exported for tests. */
export function anthropicRequestBody(request: LlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system.map(systemBlock),
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content.map(contentBlock),
    })),
  };
  const outputConfig: Record<string, unknown> = {};
  if (request.output !== undefined) {
    outputConfig.format = {
      type: 'json_schema',
      schema: strictJsonSchema(request.output.schema),
    };
  }
  if (request.effort !== undefined) outputConfig.effort = request.effort;
  if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
  return body;
}

function stopReasonOf(reason: unknown): LlmStopReason {
  if (
    reason === 'max_tokens' ||
    reason === 'refusal' ||
    reason === 'stop_sequence' ||
    reason === 'tool_use'
  ) {
    return reason;
  }
  return 'end_turn';
}

/** Maps a `/v1/messages` body to `LlmResponse`. Exported for tests. */
export function anthropicResponseOf(
  body: unknown,
  request: LlmRequest,
  latencyMs: number,
): LlmResponse {
  if (body === null || typeof body !== 'object') {
    throw new AnthropicResponseShapeError('body is not an object');
  }
  const parsed = body as AnthropicMessageBody;
  if (!Array.isArray(parsed.content)) {
    throw new AnthropicResponseShapeError('content is not an array');
  }
  const text = parsed.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  let json: unknown = null;
  if (request.output !== undefined && text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const meta = parsed.usage ?? {};
  const usage: LlmUsage = {
    inputTokens: meta.input_tokens ?? 0,
    outputTokens: meta.output_tokens ?? 0,
    cacheReadInputTokens: meta.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: meta.cache_creation_input_tokens ?? 0,
  };
  return {
    model: typeof parsed.model === 'string' ? parsed.model : request.model,
    stopReason: stopReasonOf(parsed.stop_reason),
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

export function createAnthropicClient(options: AnthropicClientOptions): LlmClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = options.baseUrl ?? ANTHROPIC_API_URL;
  const timeoutMs = options.timeoutMs ?? ANTHROPIC_DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? ANTHROPIC_DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? ANTHROPIC_DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const body = JSON.stringify(anthropicRequestBody(request));
      const started = Date.now();
      let lastError: Error = new AnthropicHttpError(0, 'no attempt made');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': options.apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastError = new AnthropicHttpError(
            0,
            error instanceof Error ? error.name : 'network error',
          );
          if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
          continue;
        }
        if (response.ok) {
          return anthropicResponseOf(await response.json(), request, Date.now() - started);
        }
        lastError = new AnthropicHttpError(response.status, await errorDetail(response));
        if (!retryable(response.status)) throw lastError;
        if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
      }
      throw lastError;
    },
  };
}
