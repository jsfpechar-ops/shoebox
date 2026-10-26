# 0503: Page look-over: the request and its parser

Status: in-progress
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0502 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Before reading, Haiku takes one quick look at every page of an upload drop and says what is on it: blank or not, the supplier, the invoice number, "page 1 of 2", whether the totals are there, whether the page starts a document, and how many documents are on it. This brief builds that request and a strict parser. The grouping (0504) uses the result.

## 2. Context

- `packages/extraction/src/llm/client.ts` types: `LlmRequest { model; promptVersion; maxTokens; effort?; system: LlmTextBlock[]; messages: LlmMessage[]; output?: { type: 'json_schema'; name; schema } }`, content blocks `{ type: 'text', text }`, `{ type: 'image', mediaType, dataBase64 }`, `{ type: 'document', mediaType: 'application/pdf', dataBase64 }`.
- `packages/extraction/src/proto/schema.ts` exports `type ProtoMediaType = 'application/pdf' | LlmImageMediaType` and builds blocks like this (copy the pattern):

```ts
  const dataBase64 = Buffer.from(options.file.bytes).toString('base64');
  const fileBlock =
    options.file.mediaType === 'application/pdf'
      ? { type: 'document' as const, mediaType: options.file.mediaType, dataBase64 }
      : { type: 'image' as const, mediaType: options.file.mediaType, dataBase64 };
```

- The Anthropic client makes the JSON schema strict itself (`strictJsonSchema`), so the schema here is a plain JSON Schema object with `required` lists, as `PROTO_RESPONSE_SCHEMA` is.
- Rule 2: this is a suggestion only. The grouping decides, and when it is unsure it asks the user. Rule 4: the parser's errors never quote the model's text.
- `packages/extraction/src/index.ts` ends `export * from './proto/schema';` (0502 added `./pdf/pages` above it).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/src/sort/page-map.ts` | new | given below |
| `packages/extraction/test/page-map.test.ts` | new | given below |
| `packages/extraction/src/index.ts` | edit | export it |

No other file may change.

## 4. Steps

1. New `packages/extraction/src/sort/page-map.ts`. The constants, prompt and schema are given in full. Implement the two functions until step 2's tests pass:

```ts
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

/**
 * The look-over request: for each part a text block "Strana N:" (one page) or "Strany N–M:"
 * (several; an en dash), then its document or image block; then SORT_USER_PROMPT.
 */
export function buildSortRequest(options: {
  readonly model: string;
  readonly parts: readonly SortPart[];
}): LlmRequest;

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
export function parsePageMap(json: unknown, expectedPages: readonly number[]): PageMapPage[];

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
```

(`UNKNOWN_ITEM` may sit above the functions. Order the file so it compiles.) `buildSortRequest` returns `{ model, promptVersion: SORT_PROMPT_VERSION, maxTokens: SORT_MAX_TOKENS, system: [{ type: 'text', text: SORT_SYSTEM_PROMPT }], messages: [{ role: 'user', content }], output: { type: 'json_schema', name: SORT_PROMPT_VERSION, schema: SORT_RESPONSE_SCHEMA } }`.

2. New `packages/extraction/test/page-map.test.ts` (do not edit it):

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSortRequest,
  parsePageMap,
  SORT_PROMPT_VERSION,
  SortParseError,
  UNKNOWN_ITEM,
} from '../src/sort/page-map';

const item = (overrides: Record<string, unknown> = {}) => ({
  where: '',
  kind: 'invoice',
  supplier_name: 'Supplier A s.r.o.',
  supplier_ico: '12345678',
  doc_number: 'FV-1',
  page_label: '',
  has_totals: true,
  starts_document: true,
  ...overrides,
});

describe('buildSortRequest', () => {
  it('labels each part with its first page and keeps the order', () => {
    const request = buildSortRequest({
      model: 'claude-haiku-5-5',
      parts: [
        { bytes: new Uint8Array([1]), mediaType: 'application/pdf', firstPage: 1, pageCount: 3 },
        { bytes: new Uint8Array([2]), mediaType: 'image/jpeg', firstPage: 4, pageCount: 1 },
      ],
    });
    expect(request.promptVersion).toBe(SORT_PROMPT_VERSION);
    expect(request.output?.name).toBe(SORT_PROMPT_VERSION);
    const content = request.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['text', 'document', 'text', 'image', 'text']);
    expect(content[0]).toEqual({ type: 'text', text: 'Strany 1–3:' });
    expect(content[2]).toEqual({ type: 'text', text: 'Strana 4:' });
    expect(content[3]).toMatchObject({ type: 'image', mediaType: 'image/jpeg', dataBase64: 'Ag==' });
  });
});

describe('parsePageMap', () => {
  it('reads pages, labels and items', () => {
    const pages = parsePageMap(
      {
        pages: [
          { page: 1, blank: false, items: [item({ page_label: '1 / 2', has_totals: false })] },
          { page: 2, blank: false, items: [item({ page_label: '2/2', starts_document: false })] },
        ],
      },
      [1, 2],
    );
    expect(pages[0]?.items[0]).toEqual({
      where: '',
      kind: 'invoice',
      supplierName: 'Supplier A s.r.o.',
      supplierIco: '12345678',
      docNumber: 'FV-1',
      labelN: 1,
      labelOf: 2,
      hasTotals: false,
      startsDocument: true,
    });
    expect(pages[1]?.items[0]).toMatchObject({ labelN: 2, labelOf: 2, startsDocument: false });
  });

  it('keeps two receipts on one page apart', () => {
    const [page] = parsePageMap(
      {
        pages: [
          {
            page: 1,
            blank: false,
            items: [item({ where: 'top', kind: 'receipt' }), item({ where: 'bottom', kind: 'receipt' })],
          },
        ],
      },
      [1],
    );
    expect(page?.items.map((i) => i.where)).toEqual(['top', 'bottom']);
  });

  it('returns blank pages without items', () => {
    const [page] = parsePageMap({ pages: [{ page: 1, blank: true, items: [item()] }] }, [1]);
    expect(page).toEqual({ page: 1, blank: true, items: [] });
  });

  it('fills a page the model left out with a safe unknown item', () => {
    const pages = parsePageMap({ pages: [{ page: 1, blank: false, items: [item()] }] }, [1, 2]);
    expect(pages[1]).toEqual({ page: 2, blank: false, items: [UNKNOWN_ITEM] });
  });

  it('cleans odd values', () => {
    const [page] = parsePageMap(
      {
        pages: [
          {
            page: 3,
            blank: false,
            items: [
              item({
                kind: 'poster',
                supplier_ico: '123 45 678',
                page_label: 'Strana 2',
                has_totals: 'yes',
                starts_document: null,
                doc_number: '  FV-9 ',
              }),
            ],
          },
          { page: 3, blank: true, items: [] },
          { page: 9, blank: true, items: [] },
        ],
      },
      [3],
    );
    expect(page?.items[0]).toMatchObject({
      kind: 'other_document',
      supplierIco: '12345678',
      labelN: null,
      labelOf: null,
      hasTotals: false,
      startsDocument: true,
      docNumber: 'FV-9',
    });
  });

  it('drops an ICO that is not 8 digits and a label where n > m', () => {
    const [page] = parsePageMap(
      { pages: [{ page: 1, blank: false, items: [item({ supplier_ico: '1234', page_label: '3/2' })] }] },
      [1],
    );
    expect(page?.items[0]).toMatchObject({ supplierIco: '', labelN: null, labelOf: null });
  });

  it('rejects a reply without pages', () => {
    expect(() => parsePageMap({}, [1])).toThrow(SortParseError);
    expect(() => parsePageMap('x', [1])).toThrow(SortParseError);
  });
});
```

Run `pnpm --filter @shoebox/extraction test -- page-map 2>&1 | tail -30` (expect 8 passed).

3. `index.ts`: add `export * from './sort/page-map';` after `export * from './proto/schema';`. Run the typecheck.

## 5. Do not touch

`packages/extraction/src/proto/*` (lane B owns reading), other packages. Rules 2, 4.

## 6. Commands

- `pnpm --filter @shoebox/extraction test -- page-map 2>&1 | tail -30`
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`
- `pnpm eval --quick 2>&1 | tail -30`
- `pnpm exec biome check packages/extraction 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0503-report.md` (600 tokens at most) and set `Status: review`.
