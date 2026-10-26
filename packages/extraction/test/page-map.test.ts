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
    expect(content[3]).toMatchObject({
      type: 'image',
      mediaType: 'image/jpeg',
      dataBase64: 'Ag==',
    });
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
            items: [
              item({ where: 'top', kind: 'receipt' }),
              item({ where: 'bottom', kind: 'receipt' }),
            ],
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
      {
        pages: [
          { page: 1, blank: false, items: [item({ supplier_ico: '1234', page_label: '3/2' })] },
        ],
      },
      [1],
    );
    expect(page?.items[0]).toMatchObject({ supplierIco: '', labelN: null, labelOf: null });
  });

  it('rejects a reply without pages', () => {
    expect(() => parsePageMap({}, [1])).toThrow(SortParseError);
    expect(() => parsePageMap('x', [1])).toThrow(SortParseError);
  });
});
