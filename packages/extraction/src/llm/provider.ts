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

/** The configured client. Throws `LlmKeyMissingError` when the provider's key is not set. */
export function createLlmClientFromEnv(
  env: Env,
  options: CreateLlmClientOptions = {},
): { client: LlmClient; config: LlmEnvConfig } {
  const config = resolveLlmEnv(env);
  const apiKey = env[config.keyEnv]?.trim() ?? '';
  if (apiKey === '') throw new LlmKeyMissingError(config.keyEnv);
  const clientOptions = options.fetch === undefined ? { apiKey } : { apiKey, fetch: options.fetch };
  if (config.provider === 'anthropic') {
    return { client: createAnthropicClient(clientOptions), config };
  }
  return { client: createGeminiClient(clientOptions), config };
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
