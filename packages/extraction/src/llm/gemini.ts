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
