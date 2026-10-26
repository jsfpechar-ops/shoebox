import type { LlmContentBlock, LlmRequest } from '../llm/client';
import type { ProtoMediaType } from '../proto/schema';

export const SORT_PROMPT_VERSION = 'm01-sort-v1';
export const SORT_MAX_TOKENS = 8192;
/** Pages per look-over call; a bigger drop is looked over in several calls (0506). */
export const SORT_MAX_PAGES_PER_CALL = 20;

export const PAGE_KINDS = [
  'invoice',
  'receipt',
  'credit_note',
  'other_document',
  'attachment',
  'not_document',
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** One document, or one part of a document, seen on a page. */
export interface PageItem {
  readonly where: string; // '' = the whole page; else 'top', 'bottom', 'left', ...
  readonly kind: PageKind;
  readonly supplierName: string; // '' when not on this page
  readonly supplierIco: string; // 8 digits, or ''
  readonly docNumber: string; // '' when not on this page
  readonly labelN: number | null; // printed "page n of m"
  readonly labelOf: number | null;
  readonly hasTotals: boolean;
  readonly startsDocument: boolean;
}

export interface PageMapPage {
  readonly page: number; // global page number in the call, from 1
  readonly blank: boolean;
  readonly items: readonly PageItem[]; // empty when blank
}

/** One file, or a cut of one PDF, in a look-over call. Its pages are firstPage..firstPage+pageCount-1. */
export interface SortPart {
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
  readonly firstPage: number;
  readonly pageCount: number;
}

export class SortParseError extends Error {
  constructor(detail: string) {
    super(`page map: ${detail}`);
    this.name = 'SortParseError';
  }
}

export const SORT_SYSTEM_PROMPT = [
  'Třídíš naskenované nebo vyfocené stránky účetních dokladů. Doklady podrobně nečti, jen urči, co je na každé straně.',
  'Strany jsou očíslované v pořadí: před každým souborem je napsáno, kterým číslem strany začíná. U PDF s více stranami má každá strana další číslo v pořadí.',
  'Pro každou stranu vrať právě jeden záznam v pages, se stejným číslem page.',
  'blank = strana je prázdná, je na ní jen šum, nebo je to zadní strana bez textu. Pak items = [].',
  'items = doklady nebo jejich části na straně, obvykle jeden. Když jsou na jedné fotce dvě účtenky, vrať dvě položky a do where napiš, kde jsou (top, bottom, left, right). Jinak where = "".',
  'kind: invoice = faktura nebo její strana; receipt = účtenka nebo pokladní doklad; credit_note = dobropis; other_document = jiný účetní doklad (výpis, vyúčtování, objednávka, samostatný dodací list); attachment = příloha bez vlastní hlavičky (obchodní podmínky, pokračování rozpisu položek, průvodní dopis); not_document = reklama, obálka, nic účetního.',
  'supplier_name a supplier_ico: dodavatel (kdo doklad vystavil), jen jak je vytištěn na této straně; když tu není, "". Nikdy ne odběratel.',
  'doc_number: číslo dokladu vytištěné na této straně, jinak "".',
  'page_label: vytištěné číslování stran („Strana 1/2“, „1 z 3“, „Page 2 of 2“) zapiš jako "1/2"; když není, "".',
  'has_totals = na straně je celková částka k úhradě nebo rekapitulace DPH.',
  'starts_document = strana začíná doklad: nahoře má hlavičku (název dokladu, dodavatele nebo číslo dokladu). Pokračovací strana bez hlavičky = false.',
  'Nic si nedomýšlej: co na straně není vidět, nech prázdné.',
].join('\n');

export const SORT_USER_PROMPT = 'Urči obsah každé strany.';

export const SORT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          blank: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                where: { type: 'string' },
                kind: { type: 'string', enum: [...PAGE_KINDS] },
                supplier_name: { type: 'string' },
                supplier_ico: { type: 'string' },
                doc_number: { type: 'string' },
                page_label: { type: 'string', description: '"n/m" or ""' },
                has_totals: { type: 'boolean' },
                starts_document: { type: 'boolean' },
              },
              required: [
                'where',
                'kind',
                'supplier_name',
                'supplier_ico',
                'doc_number',
                'page_label',
                'has_totals',
                'starts_document',
              ],
            },
          },
        },
        required: ['page', 'blank', 'items'],
      },
    },
  },
  required: ['pages'],
};

export const UNKNOWN_ITEM: PageItem = {
  where: '',
  kind: 'other_document',
  supplierName: '',
  supplierIco: '',
  docNumber: '',
  labelN: null,
  labelOf: null,
  hasTotals: false,
  startsDocument: true,
};

/**
 * The look-over request: for each part a text block "Strana N:" (one page) or "Strany N–M:"
 * (several; an en dash), then its document or image block; then SORT_USER_PROMPT.
 */
export function buildSortRequest(options: {
  readonly model: string;
  readonly parts: readonly SortPart[];
}): LlmRequest {
  const content: LlmContentBlock[] = [];
  for (const part of options.parts) {
    const last = part.firstPage + part.pageCount - 1;
    const label =
      part.pageCount === 1 ? `Strana ${part.firstPage}:` : `Strany ${part.firstPage}–${last}:`;
    const dataBase64 = Buffer.from(part.bytes).toString('base64');
    content.push({ type: 'text', text: label });
    content.push(
      part.mediaType === 'application/pdf'
        ? { type: 'document', mediaType: part.mediaType, dataBase64 }
        : { type: 'image', mediaType: part.mediaType, dataBase64 },
    );
  }
  content.push({ type: 'text', text: SORT_USER_PROMPT });
  return {
    model: options.model,
    promptVersion: SORT_PROMPT_VERSION,
    maxTokens: SORT_MAX_TOKENS,
    system: [{ type: 'text', text: SORT_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content }],
    output: { type: 'json_schema', name: SORT_PROMPT_VERSION, schema: SORT_RESPONSE_SCHEMA },
  };
}

/**
 * Parses the model's JSON into exactly one PageMapPage per number in `expectedPages`, in that order.
 * - Not an object, or `pages` not an array → SortParseError.
 * - A page number the model left out → `{ page, blank: false, items: [UNKNOWN_ITEM] }` (safe: it stays its own document).
 * - A page returned twice → the first one wins. Pages not in `expectedPages` are ignored.
 * - blank: true → items []. blank: false with no valid items → [UNKNOWN_ITEM].
 * - Strings are trimmed. An unknown kind → 'other_document'. supplier_ico keeps digits only and is '' unless that is 8 digits.
 * - page_label "n/m" (spaces allowed) with 1 ≤ n ≤ m ≤ 999 → labelN, labelOf; anything else → null, null.
 * - A non-boolean has_totals → false; a non-boolean starts_document → true.
 */
export function parsePageMap(json: unknown, expectedPages: readonly number[]): PageMapPage[] {
  if (!isRecord(json) || !Array.isArray(json.pages)) {
    throw new SortParseError('reply has no pages list');
  }
  const byPage = new Map<number, PageMapPage>();
  for (const entry of json.pages) {
    if (!isRecord(entry) || typeof entry.page !== 'number' || !Number.isInteger(entry.page)) {
      continue;
    }
    if (byPage.has(entry.page)) continue;
    byPage.set(entry.page, readPage(entry, entry.page));
  }
  return expectedPages.map(
    (page) => byPage.get(page) ?? { page, blank: false, items: [UNKNOWN_ITEM] },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPage(entry: Record<string, unknown>, page: number): PageMapPage {
  const blank = entry.blank === true;
  if (blank) return { page, blank: true, items: [] };
  const raw = Array.isArray(entry.items) ? entry.items.filter(isRecord) : [];
  const items = raw.map(readItem);
  return { page, blank: false, items: items.length > 0 ? items : [UNKNOWN_ITEM] };
}

function readItem(raw: Record<string, unknown>): PageItem {
  const kindText = text(raw.kind);
  const kind = (PAGE_KINDS as readonly string[]).includes(kindText)
    ? (kindText as PageKind)
    : 'other_document';
  const digits = text(raw.supplier_ico).replace(/\D/g, '');
  const label = readLabel(text(raw.page_label));
  return {
    where: text(raw.where),
    kind,
    supplierName: text(raw.supplier_name),
    supplierIco: digits.length === 8 ? digits : '',
    docNumber: text(raw.doc_number),
    labelN: label?.n ?? null,
    labelOf: label?.of ?? null,
    hasTotals: typeof raw.has_totals === 'boolean' ? raw.has_totals : false,
    startsDocument: typeof raw.starts_document === 'boolean' ? raw.starts_document : true,
  };
}

function readLabel(value: string): { n: number; of: number } | null {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (!match) return null;
  const n = Number(match[1]);
  const of = Number(match[2]);
  return n >= 1 && n <= of && of <= 999 ? { n, of } : null;
}
