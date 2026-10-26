import type { SplitBatchFile } from '@shoebox/db';
import type { PageItem, SortPiece, SortResult } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { planSort } from '../src/doc-split/plan';

const ORG = '11111111-1111-4111-8111-111111111111';
const BATCH = '44444444-4444-4444-8444-444444444444';

function file(n: number): SplitBatchFile {
  return {
    documentId: `doc-${n}`,
    sourceFileId: `sf-${n}`,
    storagePath: `p/${n}`,
    mimeType: 'application/pdf',
    receivedDate: '2026-10-26',
    status: 'received',
  };
}

const item = (over: Partial<PageItem> = {}): PageItem => ({
  where: '',
  kind: 'invoice',
  supplierName: 'Supplier X',
  supplierIco: '11111111',
  docNumber: 'N1',
  labelN: null,
  labelOf: null,
  hasTotals: true,
  startsDocument: true,
  ...over,
});

const piece = (fileIndex: number, filePage: number, over: Partial<PageItem> = {}): SortPiece => ({
  fileIndex,
  filePage,
  region: over.where ?? '',
  item: item(over),
});

describe('planSort', () => {
  it('joins two files into the first file’s document and removes the second row', () => {
    const result: SortResult = {
      groups: [
        [piece(0, 1, { hasTotals: false }), piece(1, 1, { supplierIco: '', docNumber: '' })],
      ],
      skipped: [],
      questions: [],
    };
    const plan = planSort(ORG, BATCH, [file(0), file(1)], result, []);
    expect(plan.documents).toEqual([
      {
        documentId: 'doc-0',
        sourceFileId: 'sf-0',
        receivedDate: '2026-10-26',
        pages: [
          {
            sourceFileId: 'sf-0',
            filePage: 1,
            region: '',
            supplierKey: '11111111',
            docNumber: 'N1',
            labelN: null,
            labelOf: null,
            hasTotals: false,
            startsDocument: true,
          },
          {
            sourceFileId: 'sf-1',
            filePage: 1,
            region: '',
            supplierKey: 'supplierx',
            docNumber: '',
            labelN: null,
            labelOf: null,
            hasTotals: true,
            startsDocument: true,
          },
        ],
      },
    ]);
    expect(plan.deleteDocumentIds).toEqual(['doc-1']);
    expect(plan).toMatchObject({ orgId: ORG, batchId: BATCH, questions: [], runs: [] });
  });

  it('splits one file into new documents after the first', () => {
    const result: SortResult = {
      groups: [
        [piece(0, 1), piece(0, 2)],
        [piece(0, 3, { docNumber: 'N2' })],
        [piece(0, 4, { where: 'top' })],
      ],
      skipped: [],
      questions: [[1, 2]],
    };
    const plan = planSort(ORG, BATCH, [file(0)], result, []);
    expect(plan.documents.map((d) => [d.documentId, d.sourceFileId, d.pages.length])).toEqual([
      ['doc-0', 'sf-0', 2],
      [null, 'sf-0', 1],
      [null, 'sf-0', 1],
    ]);
    expect(plan.documents[2]?.pages[0]?.region).toBe('top');
    expect(plan.deleteDocumentIds).toEqual([]);
    expect(plan.questions).toEqual([[1, 2]]);
  });

  it('removes the row of a file that had only blank pages and keeps runs', () => {
    const run = {
      model: 'claude-haiku-5-5',
      promptVersion: 'm01-sort-v1',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 300,
    };
    const result: SortResult = {
      groups: [[piece(1, 1)]],
      skipped: [{ fileIndex: 0, filePage: 1 }],
      questions: [],
    };
    const plan = planSort(ORG, BATCH, [file(0), file(1)], result, [run]);
    expect(plan.documents.map((d) => d.documentId)).toEqual(['doc-1']);
    expect(plan.deleteDocumentIds).toEqual(['doc-0']);
    expect(plan.runs).toEqual([run]);
  });
});
