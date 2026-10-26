import { describe, expect, it } from 'vitest';
import { groupPages, type SortPage, sameSupplier, supplierKeyOf } from '../src/sort/group';
import type { PageItem } from '../src/sort/page-map';

const X = { supplierName: 'Supplier X spol. s r.o.', supplierIco: '11111111' };
const Y = { supplierName: 'Supplier Y a.s.', supplierIco: '22222222' };

function item(overrides: Partial<PageItem> = {}): PageItem {
  return {
    where: '',
    kind: 'invoice',
    supplierName: '',
    supplierIco: '',
    docNumber: '',
    labelN: null,
    labelOf: null,
    hasTotals: false,
    startsDocument: true,
    ...overrides,
  };
}

function page(fileIndex: number, filePage: number, ...items: PageItem[]): SortPage {
  return { fileIndex, filePage, blank: false, items };
}

function blank(fileIndex: number, filePage: number): SortPage {
  return { fileIndex, filePage, blank: true, items: [] };
}

/** "file:page" or "file:page:region" per piece, per group. */
function shape(pages: SortPage[]): string[][] {
  return groupPages(pages).groups.map((g) =>
    g.map((p) => `${p.fileIndex}:${p.filePage}${p.region === '' ? '' : `:${p.region}`}`),
  );
}

describe('supplier helpers', () => {
  it('keys by ICO, else by the plain name', () => {
    expect(supplierKeyOf(item(X))).toBe('11111111');
    expect(supplierKeyOf(item({ supplierName: 'Pekařství Žák, s.r.o.' }))).toBe('pekarstvizaksro');
    expect(supplierKeyOf(item())).toBe('');
  });

  it('compares ICOs first, then names, else unknown', () => {
    expect(sameSupplier(item(X), item({ ...X, supplierName: '' }))).toBe('yes');
    expect(sameSupplier(item(X), item(Y))).toBe('no');
    expect(sameSupplier(item(X), item({ supplierName: 'Supplier X' }))).toBe('yes');
    expect(
      sameSupplier(item({ supplierName: 'Supplier X' }), item({ supplierName: 'Other' })),
    ).toBe('no');
    expect(sameSupplier(item(X), item())).toBe('unknown');
  });
});

describe('groupPages', () => {
  it('keeps one page as one document', () => {
    expect(shape([page(0, 1, item({ ...X, hasTotals: true }))])).toEqual([['0:1']]);
  });

  it('joins an invoice sent as two files: details first, totals second (owner test 2026-10-26)', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'FV-1' })),
      page(1, 1, item({ supplierName: X.supplierName, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1', '1:1']]);
    expect(groupPages(pages).questions).toEqual([]);
  });

  it('splits one 12-page scan holding 6 two-page invoices', () => {
    const pages: SortPage[] = [];
    for (let k = 0; k < 6; k += 1) {
      const supplier = { supplierName: `Supplier ${k}`, supplierIco: `3333333${k}` };
      pages.push(
        page(0, 2 * k + 1, item({ ...supplier, docNumber: `N${k}`, labelN: 1, labelOf: 2 })),
      );
      pages.push(
        page(
          0,
          2 * k + 2,
          item({ ...supplier, docNumber: `N${k}`, labelN: 2, labelOf: 2, hasTotals: true }),
        ),
      );
    }
    expect(shape(pages)).toEqual([
      ['0:1', '0:2'],
      ['0:3', '0:4'],
      ['0:5', '0:6'],
      ['0:7', '0:8'],
      ['0:9', '0:10'],
      ['0:11', '0:12'],
    ]);
  });

  it('puts pages uploaded in the wrong order back in order', () => {
    const pages = [
      page(
        0,
        1,
        item({
          ...X,
          docNumber: 'N',
          labelN: 2,
          labelOf: 2,
          hasTotals: true,
          startsDocument: false,
        }),
      ),
      page(1, 1, item({ ...X, docNumber: 'N', labelN: 1, labelOf: 2 })),
    ];
    expect(shape(pages)).toEqual([['1:1', '0:1']]);
  });

  it('joins by page labels when there is no number', () => {
    const pages = [
      page(0, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(1, 1, item({ ...X, labelN: 2, labelOf: 2, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1', '1:1']]);
  });

  it('leaves blank pages out', () => {
    const pages = [
      page(0, 1, item({ ...X, hasTotals: true })),
      blank(0, 2),
      page(0, 3, item({ ...Y, hasTotals: true })),
    ];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['0:3']]);
    expect(result.skipped).toEqual([{ fileIndex: 0, filePage: 2 }]);
  });

  it('keeps terms and conditions with the invoice before them', () => {
    const pages = [
      page(0, 1, item({ ...X, hasTotals: true })),
      page(0, 2, item({ kind: 'attachment', startsDocument: false })),
    ];
    expect(shape(pages)).toEqual([['0:1', '0:2']]);
  });

  it('joins a continuation page without a header to the page before it', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'N' })),
      page(0, 2, item({ startsDocument: false, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1', '0:2']]);
  });

  it('reads two receipts on one photo as two documents', () => {
    const pages = [
      page(
        0,
        1,
        item({ ...X, kind: 'receipt', where: 'top', hasTotals: true }),
        item({ ...Y, kind: 'receipt', where: 'bottom', hasTotals: true }),
      ),
    ];
    expect(shape(pages)).toEqual([['0:1:top'], ['0:1:bottom']]);
  });

  it('keeps two complete invoices from the same supplier apart, without asking', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'N1', hasTotals: true })),
      page(1, 1, item({ ...X, docNumber: 'N2', hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1'], ['1:1']]);
    expect(groupPages(pages).questions).toEqual([]);
  });

  it('never joins pages of different suppliers, even a page without a header', () => {
    const pages = [
      page(0, 1, item({ ...X })),
      page(0, 2, item({ ...Y, startsDocument: false, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1'], ['0:2']]);
  });

  it('never joins a page that is not a document', () => {
    const pages = [
      page(0, 1, item({ ...X, hasTotals: true })),
      page(1, 1, item({ kind: 'not_document', startsDocument: false })),
      page(2, 1, item({ ...Y, hasTotals: true })),
    ];
    expect(shape(pages)).toEqual([['0:1'], ['1:1'], ['2:1']]);
  });

  it('asks when two pages of one supplier might be one invoice', () => {
    const pages = [page(0, 1, item({ ...X })), page(1, 1, item({ ...X }))];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['1:1']]);
    expect(result.questions).toEqual([[0, 1]]);
  });

  it('asks instead of guessing when a page 2 fits two page 1s', () => {
    const pages = [
      page(0, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(1, 1, item({ ...X, labelN: 1, labelOf: 2 })),
      page(2, 1, item({ ...X, labelN: 2, labelOf: 2, hasTotals: true })),
    ];
    const result = groupPages(pages);
    expect(shape(pages)).toEqual([['0:1'], ['1:1'], ['2:1']]);
    expect(result.questions).toEqual([
      [1, 2],
      [0, 1],
    ]);
  });

  it('joins pages with the same number across files and keeps a third invoice apart', () => {
    const pages = [
      page(0, 1, item({ ...X, docNumber: 'FV 2025/1' })),
      page(1, 1, item({ ...Y, docNumber: 'B7', hasTotals: true })),
      page(2, 1, item({ ...X, docNumber: 'fv2025/1', hasTotals: true, startsDocument: false })),
    ];
    expect(shape(pages)).toEqual([['0:1', '2:1'], ['1:1']]);
  });
});
