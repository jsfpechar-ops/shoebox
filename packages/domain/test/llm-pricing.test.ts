import { describe, expect, it } from 'vitest';
import { llmCostUsd } from '../src/llm-pricing';

const usage = (i: number, o: number, r = 0, w = 0) => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: r,
  cacheWriteTokens: w,
});

describe('llmCostUsd', () => {
  it('prices a Haiku call with cache tokens to 5 decimals', () => {
    // 1000×0.10 + 200×0.50 + 5000×0.01 + 2000×0.20 per MTok = 0.00065 USD
    expect(llmCostUsd('claude-haiku-5-5', usage(1000, 200, 5000, 2000))).toBe('0.00065');
  });

  it('prices Sonnet and matches a dated model id by prefix', () => {
    // 10000×2 + 1000×10 per MTok = 0.03 USD
    expect(llmCostUsd('claude-sonnet-5-5-20261001', usage(10000, 1000))).toBe('0.03000');
  });

  it('rounds half up at the fifth decimal', () => {
    // 50 input tokens of Haiku = 5000 nano-USD = 0.000005 → 0.00001
    expect(llmCostUsd('claude-haiku-5-5', usage(50, 0))).toBe('0.00001');
    expect(llmCostUsd('claude-haiku-5-5', usage(49, 0))).toBe('0.00000');
  });

  it('is null without a model or for an unknown one', () => {
    expect(llmCostUsd(null, usage(1, 1))).toBeNull();
    expect(llmCostUsd('claude-haiku-5', usage(1, 1))).toBeNull();
  });
});
