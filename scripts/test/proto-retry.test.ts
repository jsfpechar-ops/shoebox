import { parseLegalDate } from '@shoebox/domain';
import {
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  PROTO_RESPONSE_SCHEMA,
} from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { ProtoRunError, runProtoDocument } from '../proto/pipeline';

/** A schema-valid answer built from the schema itself, so the test survives schema versions. */
function blank(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === 'object') {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, blank(value)]));
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  return '';
}

function wire(ico: string): unknown {
  const answer = blank(PROTO_RESPONSE_SCHEMA) as { supplier: { ico: string } };
  answer.supplier.ico = ico;
  return answer;
}

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function answer(json: unknown, stopReason: LlmResponse['stopReason'] = 'end_turn'): LlmResponse {
  return { model: 'fake', stopReason, text: '', json, usage, latencyMs: 1 };
}

function scripted(answers: LlmResponse[]): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    async complete(request) {
      requests.push(request);
      const next = answers.shift();
      if (next === undefined) throw new Error('no more scripted answers');
      return next;
    },
  };
  return { client, requests };
}

const INPUT = {
  model: 'fake',
  bytes: new Uint8Array([1]),
  mediaType: 'image/png' as const,
  today: parseLegalDate('2026-10-25'),
};

describe('runProtoDocument retries', () => {
  it('retries once when the answer has no JSON, and sums the usage', async () => {
    const { client, requests } = scripted([answer(null, 'max_tokens'), answer(wire('12345679'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345679');
    expect(requests).toHaveLength(2);
    expect(result.attempts).toBe(2);
    expect(result.response.usage.inputTokens).toBe(20);
  });

  it('gives up after one retry without JSON', async () => {
    const { client, requests } = scripted([answer(null, 'max_tokens'), answer(null, 'max_tokens')]);
    await expect(runProtoDocument(client, INPUT)).rejects.toThrow(ProtoRunError);
    expect(requests).toHaveLength(2);
  });

  it('never retries a refusal', async () => {
    const { client, requests } = scripted([answer(null, 'refusal')]);
    await expect(runProtoDocument(client, INPUT)).rejects.toThrow('refused');
    expect(requests).toHaveLength(1);
  });

  it('retries with a hint when the IČO check digit fails and keeps a valid second IČO', async () => {
    const { client, requests } = scripted([answer(wire('12345678')), answer(wire('12345679'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345679');
    expect(result.attempts).toBe(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain('Kontrolní číslice IČO');
    expect(JSON.stringify(requests[0]?.messages)).not.toContain('Kontrolní číslice IČO');
  });

  it('accepts an empty IČO from the retry', async () => {
    const { client } = scripted([answer(wire('12345678')), answer(wire(''))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBeNull();
  });

  it('keeps the first answer when the retry is still invalid', async () => {
    const { client, requests } = scripted([answer(wire('12345678')), answer(wire('12345677'))]);
    const result = await runProtoDocument(client, INPUT);
    expect(result.extraction.supplier.ico).toBe('12345678');
    expect(requests).toHaveLength(2);
  });

  it('does not retry a valid or an empty IČO', async () => {
    const valid = scripted([answer(wire('12345679'))]);
    await runProtoDocument(valid.client, INPUT);
    expect(valid.requests).toHaveLength(1);
    const empty = scripted([answer(wire(''))]);
    const result = await runProtoDocument(empty.client, INPUT);
    expect(empty.requests).toHaveLength(1);
    expect(result.attempts).toBe(1);
  });
});
