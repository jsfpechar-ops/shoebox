/**
 * M04 §4.3 LLM classifier: prompt, output JSON schema and strict output validation (`m04-categorize-v1`).
 * Pure: no DB, no clock, no dependency. Validation is hand-rolled like `proto/schema.ts`.
 * TODO(i18n-cs): the prompt asks for English copy (owner 2026-10-25); the `_cs` key names are kept from 05.
 */

export const CATEGORIZE_PROMPT_VERSION = 'm04-categorize-v1' as const;
export const CATEGORIZE_MAX_TOKENS = 2048;
export const CATEGORIZE_MAX_LINES = 60;
export const CATEGORIZE_DESCRIPTION_MAX = 200;

export const CATEGORIZE_SYSTEM_PROMPT = [
  'You classify the line items of one business document for a small self-employed business.',
  'You are NOT deciding taxes. You choose a spending/income category from a fixed list, say whether each',
  'line is a service or goods, and judge whether the purchase looks business or personal for THIS business.',
  '',
  'Rules:',
  '1. Use ONLY category codes from <categories> whose direction equals <document.direction>.',
  "2. Read each category's explanation; pick the most specific one. Prefer the business's own activities",
  '   (<business.activities>) when interpreting ambiguous items (e.g. bed linen for a short-term rental is business).',
  '3. Never invent amounts, dates or suppliers. Do not output VAT rows or tax advice.',
  '4. confidence: your probability (0-1) that category_code is what a Czech accountant would choose.',
  '   Below 0.6, also give alternative_category_code.',
  '5. asset_candidate = true for durable items used > 1 year (laptops, phones, furniture, tools, machines).',
  '   mixed_use_item = true for items commonly used both privately and for business (laptop, phone, car, camera, TV).',
  '6. business_likelihood: "personal" only for items with no plausible link to <business.activities>',
  '   (clothing, sports gear, toys, groceries, cosmetics, alcohol); "mixed" for mixed_use items; else "business".',
  '7. subject_cs: 2-5 words, nominative, no supplier name unless it is the product (e.g. "Booking.com commission"),',
  '   describing what was bought or sold, e.g. "Apartment cleaning", "Property management", "Domain renewal",',
  '   "AI tool subscription", "Laptop MacBook Air", "Backpack".',
  '8. reason_cs: at most 12 words, plain language, why this category.',
  '9. place_of_supply_abroad = true only for services physically consumed outside the Czech Republic',
  '   (hotel, restaurant, event ticket, local transport abroad).',
  'Return JSON matching the schema. No prose.',
].join('\n');

export interface CategorizeCategory {
  readonly code: string;
  readonly direction: 'in' | 'out' | 'both';
  readonly taxEffect: string;
  readonly label: string;
  readonly explanation: string;
}

const BUSINESS_LIKELIHOODS = ['business', 'personal', 'mixed', 'unknown'] as const;
const SUPPLY_KINDS = ['service', 'goods', 'mixed', 'not_applicable'] as const;
const DOCUMENT_KEYS = [
  'subject_cs',
  'dominant_category_code',
  'business_likelihood',
  'personal_reason_cs',
] as const;
const LINE_KEYS = [
  'position',
  'category_code',
  'alternative_category_code',
  'confidence',
  'supply_kind',
  'asset_candidate',
  'mixed_use_item',
  'place_of_supply_abroad',
  'reason_cs',
] as const;

/** The M04 §4.3 schema with `{{codes}}` expanded. Throws RangeError on an empty list. */
export function buildCategorizeJsonSchema(codes: readonly string[]): Record<string, unknown> {
  if (codes.length === 0) throw new RangeError('categorize: the category list is empty');
  const enumCodes = [...codes];
  const nullableCodes = [...codes, null];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['document', 'lines'],
    properties: {
      document: {
        type: 'object',
        additionalProperties: false,
        required: ['subject_cs', 'dominant_category_code', 'business_likelihood'],
        properties: {
          subject_cs: { type: 'string', minLength: 2, maxLength: 60 },
          dominant_category_code: { type: 'string', enum: enumCodes },
          business_likelihood: { type: 'string', enum: [...BUSINESS_LIKELIHOODS] },
          personal_reason_cs: { type: ['string', 'null'], maxLength: 120 },
        },
      },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...LINE_KEYS],
          properties: {
            position: { type: 'integer', minimum: 1 },
            category_code: { type: 'string', enum: enumCodes },
            alternative_category_code: { type: ['string', 'null'], enum: nullableCodes },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            supply_kind: { type: 'string', enum: [...SUPPLY_KINDS] },
            asset_candidate: { type: 'boolean' },
            mixed_use_item: { type: 'boolean' },
            place_of_supply_abroad: { type: 'boolean' },
            reason_cs: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
  };
}

export type BusinessLikelihood = (typeof BUSINESS_LIKELIHOODS)[number];
export type LlmSupplyKind = (typeof SUPPLY_KINDS)[number];

export interface CategorizeLineOutput {
  readonly position: number;
  readonly categoryCode: string;
  readonly alternativeCategoryCode: string | null;
  readonly confidence: number;
  readonly supplyKind: LlmSupplyKind;
  readonly assetCandidate: boolean;
  readonly mixedUseItem: boolean;
  readonly placeOfSupplyAbroad: boolean;
  readonly reason: string;
}

export interface CategorizeOutput {
  readonly subject: string;
  readonly dominantCategoryCode: string;
  readonly businessLikelihood: BusinessLikelihood;
  readonly personalReason: string | null;
  readonly lines: readonly CategorizeLineOutput[];
}

export class CategorizeParseError extends Error {
  readonly reason: 'schema' | 'code' | 'empty';

  constructor(reason: 'schema' | 'code' | 'empty', message: string) {
    super(message);
    this.name = 'CategorizeParseError';
    this.reason = reason;
  }
}

type Obj = Record<string, unknown>;

// Messages carry key names only, never values (hard rule 4).
function fail(reason: 'schema' | 'code' | 'empty', message: string): never {
  throw new CategorizeParseError(reason, message);
}

function asObject(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('schema', `${path}: object expected`);
  return value as Obj;
}

function checkKeys(
  obj: Obj,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj))
    if (!allowed.includes(key)) fail('schema', `${path}: unknown key`);
  for (const key of required) if (!(key in obj)) fail('schema', `${path}: missing ${key}`);
}

function reqString(obj: Obj, key: string, min: number, max: number): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length < min || v.length > max)
    fail('schema', `${key}: string expected`);
  return v;
}

function optNullableString(obj: Obj, key: string, max: number): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  return reqString({ [key]: v }, key, 0, max);
}

function reqNumber(obj: Obj, key: string, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail('schema', `${key}: number expected`);
  return v;
}

function reqPosition(obj: Obj, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    fail('schema', `${key}: integer expected`);
  return v;
}

function reqBool(obj: Obj, key: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') fail('schema', `${key}: boolean expected`);
  return v;
}

function reqEnum<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    fail('schema', 'enum value expected');
  return v as T;
}

function reqCode(v: unknown, codes: readonly string[]): string {
  if (typeof v !== 'string') fail('schema', 'code: string expected');
  if (!codes.includes(v)) fail('code', 'code outside the enum');
  return v;
}

function parseLine(raw: unknown, codes: readonly string[]): CategorizeLineOutput {
  const o = asObject(raw, 'line');
  checkKeys(o, LINE_KEYS, LINE_KEYS, 'line');
  return {
    position: reqPosition(o, 'position'),
    categoryCode: reqCode(o.category_code, codes),
    alternativeCategoryCode:
      o.alternative_category_code === null ? null : reqCode(o.alternative_category_code, codes),
    confidence: reqNumber(o, 'confidence', 0, 1),
    supplyKind: reqEnum(o.supply_kind, SUPPLY_KINDS),
    assetCandidate: reqBool(o, 'asset_candidate'),
    mixedUseItem: reqBool(o, 'mixed_use_item'),
    placeOfSupplyAbroad: reqBool(o, 'place_of_supply_abroad'),
    reason: reqString(o, 'reason_cs', 0, 100),
  };
}

/**
 * Validates the raw JSON (strict: unknown keys rejected), rejects any code outside `codes` (reason 'code'),
 * drops lines whose position is not in `positions`, throws 'empty' when nothing remains although positions were requested.
 */
export function parseCategorizeOutput(
  json: unknown,
  codes: readonly string[],
  positions: readonly number[],
): CategorizeOutput {
  const top = asObject(json, 'output');
  checkKeys(top, ['document', 'lines'], ['document', 'lines'], 'output');
  const doc = asObject(top.document, 'document');
  checkKeys(doc, DOCUMENT_KEYS, DOCUMENT_KEYS.slice(0, 3), 'document');
  const subject = reqString(doc, 'subject_cs', 2, 60);
  const dominant = reqCode(doc.dominant_category_code, codes);
  const businessLikelihood = reqEnum(doc.business_likelihood, BUSINESS_LIKELIHOODS);
  const personalReason = optNullableString(doc, 'personal_reason_cs', 120);
  if (!Array.isArray(top.lines)) fail('schema', 'lines: array expected');
  const parsed = (top.lines as unknown[]).map((raw) => parseLine(raw, codes));
  const wanted = new Set(positions);
  const lines = parsed.filter((l) => wanted.has(l.position));
  if (lines.length === 0 && positions.length > 0) fail('empty', 'no requested position answered');
  return {
    subject,
    dominantCategoryCode: dominant,
    businessLikelihood,
    personalReason,
    lines,
  };
}
