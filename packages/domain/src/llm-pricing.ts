// LLM prices (M02 §4 `llm.pricing`), in nano-USD (1e-9 USD) per token so cost math stays integer.
// Not law: update when the provider changes prices (06 maintenance, M02 §10) and bump VERIFIED_AT.
export const LLM_PRICING_VERIFIED_AT = '2026-10-26';

export interface LlmPrice {
  readonly input: bigint;
  readonly output: bigint;
  readonly cacheWrite: bigint;
  readonly cacheRead: bigint;
}

/** Model id prefix → price. A provider id with a date suffix matches its prefix. */
export const LLM_PRICING: Readonly<Record<string, LlmPrice>> = {
  'claude-haiku-5-5': { input: 100n, output: 500n, cacheWrite: 200n, cacheRead: 10n },
  'claude-sonnet-5-5': { input: 2000n, output: 10000n, cacheWrite: 4000n, cacheRead: 100n },
};

export interface LlmTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

function priceOf(model: string): LlmPrice | null {
  for (const [prefix, price] of Object.entries(LLM_PRICING)) {
    if (model === prefix || model.startsWith(`${prefix}-`)) return price;
  }
  return null;
}

/** Cost of one call as a 5-decimal USD string (rounded half up), or null for no or an unknown model. */
export function llmCostUsd(model: string | null, usage: LlmTokenUsage): string | null {
  if (model === null) return null;
  const price = priceOf(model);
  if (price === null) return null;
  const nano =
    BigInt(usage.inputTokens) * price.input +
    BigInt(usage.outputTokens) * price.output +
    BigInt(usage.cacheWriteTokens) * price.cacheWrite +
    BigInt(usage.cacheReadTokens) * price.cacheRead;
  const units = (nano + 5000n) / 10000n; // 1 unit = 1e-5 USD
  const whole = units / 100000n;
  const frac = (units % 100000n).toString().padStart(5, '0');
  return `${whole}.${frac}`;
}
