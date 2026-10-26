import { describe, expect, it } from 'vitest';
import { buildProtoRequest, PROTO_USER_PROMPT } from '../src/proto/schema';
import { buildPartsRequest, PARTS_PAGES_HINT, partsRegionHint } from '../src/sort/read-parts';

const pdf = { bytes: new Uint8Array([1]), mediaType: 'application/pdf' as const, region: '' };
const jpg = { bytes: new Uint8Array([2]), mediaType: 'image/jpeg' as const, region: '' };

describe('buildPartsRequest', () => {
  it('sends every part in order, then the hint and the prompt', () => {
    const request = buildPartsRequest({ model: 'm', parts: [pdf, jpg] });
    const content = request.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['document', 'image', 'text', 'text']);
    expect(content[2]).toEqual({ type: 'text', text: PARTS_PAGES_HINT });
    expect(content[3]).toEqual({ type: 'text', text: PROTO_USER_PROMPT });
  });

  it('keeps everything else of the reader request', () => {
    const one = buildProtoRequest({ model: 'm', file: pdf });
    const request = buildPartsRequest({ model: 'm', parts: [pdf] });
    expect({ ...request, messages: [] }).toEqual({ ...one, messages: [] });
    expect(request.messages[0]?.content).toEqual(one.messages[0]?.content);
  });

  it('names the region when a page holds several documents', () => {
    const request = buildPartsRequest({ model: 'm', parts: [{ ...jpg, region: 'bottom' }] });
    const content = request.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(content[1]).toEqual({ type: 'text', text: partsRegionHint('bottom') });
  });

  it('needs at least one part', () => {
    expect(() => buildPartsRequest({ model: 'm', parts: [] })).toThrow(RangeError);
  });
});
