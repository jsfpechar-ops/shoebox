import type { OpenPageDocument } from '@shoebox/db';
import type { PageItem, SortPiece, SortResult } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { matchLatePages } from '../src/doc-split/late';

function piece(over: Partial<PageItem>): SortPiece {
  return {
    fileIndex: 0,
    filePage: 1,
    region: '',
    item: {
      kind: 'invoice',
      where: '',
      supplierName: '',
      supplierIco: '',
      docNumber: '',
      labelN: null,
      labelOf: null,
      hasTotals: false,
      startsDocument: true,
      ...over,
    } as PageItem,
  };
}

const result = (...groups: SortPiece[][]): SortResult =>
  ({ groups, questions: [], skipped: [] }) as SortResult;

describe('matchLatePages', () => {
  it('matches a continuation page with the same IČO to the open document', () => {
    const r = result([piece({ supplierIco: '12345678', startsDocument: false, hasTotals: true })]);
    const open: OpenPageDocument[] = [{ documentId: 'd1', supplierKey: '12345678', docNumber: '' }];
    expect(matchLatePages(r, open)).toEqual([{ group: 0, otherDocumentId: 'd1' }]);
  });

  it('does not match a page that starts a document', () => {
    const r = result([piece({ supplierIco: '12345678', startsDocument: true })]);
    const open: OpenPageDocument[] = [{ documentId: 'd1', supplierKey: '12345678', docNumber: '' }];
    expect(matchLatePages(r, open)).toEqual([]);
  });

  it('does not match a different IČO or a different number', () => {
    const open: OpenPageDocument[] = [
      { documentId: 'd1', supplierKey: '12345678', docNumber: 'N1' },
    ];
    const otherIco = result([piece({ supplierIco: '87654321', startsDocument: false })]);
    const otherNumber = result([
      piece({ supplierIco: '12345678', docNumber: 'N2', startsDocument: false }),
    ]);
    expect(matchLatePages(otherIco, open)).toEqual([]);
    expect(matchLatePages(otherNumber, open)).toEqual([]);
  });

  it('prefers the open document with the same number over the newer one without', () => {
    const r = result([piece({ docNumber: 'N1', startsDocument: false })]);
    const open: OpenPageDocument[] = [
      { documentId: 'newer', supplierKey: '', docNumber: '' },
      { documentId: 'same-number', supplierKey: '', docNumber: 'N1' },
    ];
    expect(matchLatePages(r, open)).toEqual([{ group: 0, otherDocumentId: 'same-number' }]);
  });
});
