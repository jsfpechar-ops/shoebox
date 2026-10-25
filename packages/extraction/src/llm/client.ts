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

export type LlmDocumentMediaType = 'application/pdf';

/** A whole document (PDF) as one block. `dataBase64` has no `data:` prefix. */
export interface LlmDocumentBlock {
  type: 'document';
  mediaType: LlmDocumentMediaType;
  dataBase64: string;
}

export type LlmContentBlock = LlmTextBlock | LlmImageBlock | LlmDocumentBlock;

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
