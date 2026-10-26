import { describe, expect, it } from 'vitest';
import {
  buildCategorizeRequest,
  CATEGORIZE_PROMPT_VERSION,
  CategorizeParseError,
  type CategorizeRequestInput,
  parseCategorizeOutput,
  runCategorize,
} from '../src/index';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/llm/client';

const CATS = [
  {
    code: 'exp_cleaning',
    direction: 'in' as const,
    taxEffect: 'deductible_expense',
    label: 'Cleaning',
    explanation: 'Cleaning services.',
  },
  {
    code: 'exp_platform_commission',
    direction: 'in' as const,
    taxEffect: 'deductible_expense',
    label: 'Platform commission',
    explanation: 'Booking, Airbnb commission.',
  },
  {
    code: 'exp_payment_fees',
    direction: 'in' as const,
    taxEffect: 'deductible_expense',
    label: 'Payment fees',
    explanation: 'Card and payment service fees.',
  },
];
const CODES = CATS.map((c) => c.code);

function input(over: Partial<CategorizeRequestInput> = {}): CategorizeRequestInput {
  return {
    model: 'claude-haiku-5-5',
    document: {
      class: 'received_invoice',
      direction: 'in',
      supplier: { name: 'Booking.com B.V.', country: 'NL', vatPayer: null, nace: null },
      taxDocStatus: 'foreign_document',
      currency: 'CZK',
      issueDate: '2026-08-03',
      servicePeriod: ['2026-07-01', '2026-07-31'],
    },
    business: {
      activities: ['short-term apartment rental'],
      nace: '55.20',
      vatStatus: 'identifikovana_osoba',
    },
    lines: [
      { position: 1, description: 'Commission', gross: '12990.12', lineType: 'item' },
      { position: 2, description: 'Payments service fee', gross: '709.65', lineType: 'fee' },
    ],
    resolved: { '1': null, '2': null },
    categories: CATS,
    ...over,
  };
}

function wire(
  lines: unknown[] = [
    {
      position: 1,
      category_code: 'exp_platform_commission',
      alternative_category_code: null,
      confidence: 0.95,
      supply_kind: 'service',
      asset_candidate: false,
      mixed_use_item: false,
      place_of_supply_abroad: false,
      reason_cs: 'Platform commission',
    },
    {
      position: 2,
      category_code: 'exp_payment_fees',
      alternative_category_code: null,
      confidence: 0.9,
      supply_kind: 'service',
      asset_candidate: false,
      mixed_use_item: false,
      place_of_supply_abroad: false,
      reason_cs: 'Payment fee',
    },
  ],
) {
  return {
    document: {
      subject_cs: 'Booking.com commission',
      dominant_category_code: 'exp_platform_commission',
      business_likelihood: 'business',
      personal_reason_cs: null,
    },
    lines,
  };
}

function fakeLlm(answers: unknown[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const json = answers[requests.length - 1];
      if (json instanceof Error) throw json;
      return {
        model: request.model,
        stopReason: 'end_turn',
        text: JSON.stringify(json),
        json,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        latencyMs: 5,
      } satisfies LlmResponse;
    },
  };
}

describe('buildCategorizeRequest', () => {
  it('asks only for the unresolved positions with an enum of the given codes', () => {
    const built = buildCategorizeRequest(
      input({ resolved: { '1': 'exp_platform_commission', '2': null } }),
    );
    expect(built.positions).toEqual([2]);
    expect(built.codes).toEqual(CODES);
    expect(built.request.promptVersion).toBe(CATEGORIZE_PROMPT_VERSION);
    expect(built.request.effort).toBe('low');
    expect(built.request.system[0]?.cache).toBe(true);
    expect(built.request.system[0]?.text).toContain(
      'exp_payment_fees | in | deductible_expense | Payment fees',
    );
    expect(JSON.stringify(built.request.output?.schema)).toContain('"exp_cleaning"');
    const user = JSON.parse(
      built.request.messages[0]?.content[0]?.type === 'text'
        ? built.request.messages[0].content[0].text
        : '{}',
    );
    expect(user.lines).toHaveLength(2);
    expect(user.resolved).toEqual({ '1': 'exp_platform_commission', '2': null });
    expect(built.request.messages[0]?.content.every((b) => b.type === 'text')).toBe(true);
  });

  it('truncates descriptions to 200 chars and caps at 60 lines by grouping identical descriptions', () => {
    const lines = Array.from({ length: 70 }, (_, i) => ({
      position: i + 1,
      description: i < 65 ? 'Same item' : 'x'.repeat(300),
      gross: '1.00',
      lineType: 'item',
    }));
    const resolved = Object.fromEntries(lines.map((l) => [String(l.position), null]));
    const built = buildCategorizeRequest(input({ lines, resolved }));
    const user = JSON.parse(
      (built.request.messages[0]?.content[0] as { text: string } | undefined)?.text ?? '{}',
    );
    expect(user.lines.length).toBeLessThanOrEqual(60);
    for (const l of user.lines) expect(l.description.length).toBeLessThanOrEqual(200);
  });

  it('throws on an empty category list', () => {
    expect(() => buildCategorizeRequest(input({ categories: [] }))).toThrow(RangeError);
  });
});

describe('parseCategorizeOutput', () => {
  it('maps a valid answer and drops unknown positions', () => {
    const out = parseCategorizeOutput(
      wire([
        ...wire().lines,
        {
          position: 9,
          category_code: 'exp_cleaning',
          alternative_category_code: null,
          confidence: 0.5,
          supply_kind: 'goods',
          asset_candidate: false,
          mixed_use_item: false,
          place_of_supply_abroad: false,
          reason_cs: 'x',
        },
      ]),
      CODES,
      [1, 2],
    );
    expect(out.lines.map((l) => l.position)).toEqual([1, 2]);
    expect(out.lines[0]).toMatchObject({
      categoryCode: 'exp_platform_commission',
      supplyKind: 'service',
      confidence: 0.95,
    });
    expect(out.subject).toBe('Booking.com commission');
    expect(out.businessLikelihood).toBe('business');
  });

  it('rejects a code outside the enum, a schema violation and an empty result', () => {
    const bad = wire([{ ...(wire().lines[0] as object), category_code: 'exp_not_a_code' }]);
    expect(() => parseCategorizeOutput(bad, CODES, [1])).toThrow(CategorizeParseError);
    try {
      parseCategorizeOutput(bad, CODES, [1]);
    } catch (e) {
      expect((e as CategorizeParseError).reason).toBe('code');
    }
    expect(() => parseCategorizeOutput({ document: {}, lines: [] }, CODES, [1])).toThrow(
      CategorizeParseError,
    );
    try {
      parseCategorizeOutput(wire([]), CODES, [1]);
    } catch (e) {
      expect((e as CategorizeParseError).reason).toBe('empty');
    }
    expect(() => parseCategorizeOutput('not json object', CODES, [1])).toThrow(
      CategorizeParseError,
    );
  });
});

describe('runCategorize', () => {
  it('returns the output on the first valid answer with one attempt recorded', async () => {
    const llm = fakeLlm([wire()]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      ok: true,
      attempt: 1,
      promptVersion: CATEGORIZE_PROMPT_VERSION,
      usage: { inputTokens: 100 },
    });
  });

  it('retries once on an invalid code and then succeeds', async () => {
    const bad = wire([{ ...(wire().lines[0] as object), category_code: 'nope' }, wire().lines[1]]);
    const llm = fakeLlm([bad, wire()]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(llm.requests).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0]?.error).toBe('parse');
  });

  it('gives up after two invalid answers and never returns a partial output', async () => {
    const llm = fakeLlm([{ nope: 1 }, { nope: 2 }]);
    const result = await runCategorize(llm, buildCategorizeRequest(input()));
    expect(llm.requests).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('parse');
    expect(result.attempts).toHaveLength(2);
  });

  it('re-throws a provider error after recording the attempt', async () => {
    const boom = Object.assign(new Error('503'), { name: 'AnthropicHttpError' });
    const llm = fakeLlm([boom]);
    await expect(runCategorize(llm, buildCategorizeRequest(input()))).rejects.toBe(boom);
  });
});
