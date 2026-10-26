import type { LlmRequest } from '../llm/client';
import { buildProtoRequest, PROTO_USER_PROMPT, type ProtoMediaType } from '../proto/schema';

/** One file or PDF cut to read, in order. `region` '' = the whole page. */
export interface ReadPart {
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
  readonly region: string;
}

export const PARTS_PAGES_HINT =
  'Doklad má více stran. Jsou přiložené ve správném pořadí. Vytěž z nich jeden doklad.';

export function partsRegionHint(region: string): string {
  return `Na stránce je více dokladů. Vytěž jen doklad, který je na stránce zde: ${region}.`;
}

/**
 * The reading request for a document made of several parts: buildProtoRequest's request with the
 * user content replaced by [each part's document/image block, in order], then PARTS_PAGES_HINT when
 * there are 2+ parts, then partsRegionHint(region) for the first part with a non-empty region,
 * then PROTO_USER_PROMPT. Throws RangeError for no parts.
 */
export function buildPartsRequest(options: {
  readonly model: string;
  readonly parts: readonly ReadPart[];
}): LlmRequest {
  const [first] = options.parts;
  if (!first) throw new RangeError('buildPartsRequest needs at least one part');
  const blocks = options.parts.map((part) => {
    const block = buildProtoRequest({ model: options.model, file: part }).messages[0]?.content[0];
    if (!block) throw new RangeError('buildProtoRequest returned no file block');
    return block;
  });
  const hints: { type: 'text'; text: string }[] = [];
  if (options.parts.length > 1) hints.push({ type: 'text', text: PARTS_PAGES_HINT });
  const region = options.parts.find((part) => part.region !== '')?.region;
  if (region) hints.push({ type: 'text', text: partsRegionHint(region) });
  hints.push({ type: 'text', text: PROTO_USER_PROMPT });
  const base = buildProtoRequest({ model: options.model, file: first });
  return { ...base, messages: [{ role: 'user', content: [...blocks, ...hints] }] };
}
