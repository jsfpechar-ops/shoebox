import type { ImportRunRecord, TenantTx } from '@shoebox/db';
import type { ImportSpreadsheetRunPayload } from '@shoebox/pipeline';
import { icoChecksumValid } from '@shoebox/validation';
import { describe, expect, it } from 'vitest';
import { createImportRunHandler, type ImportRunStore } from '../src/import-run/handler';
import { createImportUndoHandler } from '../src/import-run/undo';

const ORG = '11111111-1111-4111-8111-111111111111';
const IMPORT = '55555555-5555-4555-8555-555555555555';
const USER = '66666666-6666-4666-8666-666666666666';
const tx = {} as TenantTx;
const ctx = { tx, attempt: 1, jobId: 'job-1', signal: new AbortController().signal };

/** A synthetic IČO that passes the checksum (no real partner). */
const VALID_ICO = (() => {
  for (let n = 10_000_000; ; n++) {
    if (icoChecksumValid(String(n))) return String(n);
  }
})();

const MAPPING = {
  issue_date: 0,
  document_number: 1,
  total_gross: 2,
  partner_name: 3,
  partner_ico: 4,
};

function csvBytes(rows: string[][]): Uint8Array {
  const text = ['date;number;amount;supplier;ico', ...rows.map((r) => r.join(';'))].join('\n');
  return new TextEncoder().encode(text);
}

function runRecord(overrides: Partial<ImportRunRecord> = {}): ImportRunRecord {
  return {
    state: 'importing',
    storagePath: 'imports/test.csv',
    fileName: 'test.csv',
    mapping: MAPPING,
    options: { direction_mode: 'all_expense', header_row: 0 },
    createdBy: USER,
    importedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    skippedRows: [],
    orgIco: null,
    orgDic: null,
    ...overrides,
  };
}

function fakeStore(run: ImportRunRecord | null) {
  const inserted: Array<{ row: number; gross: string; direction: string }> = [];
  const counts: unknown[] = [];
  const finished: Array<{
    imported: number;
    skipped: number;
    duplicates: number;
    skippedRows: ReadonlyArray<{ row: number; reason: string }>;
  }> = [];
  const store: ImportRunStore = {
    load: async () => run,
    addCounts: async (_tx, input) => {
      counts.push(input);
    },
    finish: async (_tx, input) => {
      finished.push(input);
    },
    insertRow: async (_tx, input) => {
      inserted.push({
        row: input.row,
        gross: input.values.total_gross,
        direction: input.direction,
      });
      return { documentId: `doc-${input.row}`, status: 'ready', created: true };
    },
  };
  return { store, inserted, counts, finished };
}

function handlerFor(
  store: ImportRunStore,
  bytes: Uint8Array | null,
  enqueued: ImportSpreadsheetRunPayload[],
) {
  return createImportRunHandler({
    blobs: {
      get: async () => {
        if (bytes === null) throw new Error('blob must not be read');
        return bytes;
      },
    },
    clock: { now: () => Date.parse('2026-10-26T10:00:00Z') },
    enqueueNext: async (payload) => {
      enqueued.push(payload);
    },
    store,
  });
}

const payload = (fromRow: number): ImportSpreadsheetRunPayload => ({
  orgId: ORG,
  importId: IMPORT,
  fromRow,
});

describe('import.spreadsheet.run handler', () => {
  it('imports the valid row and skips a missing total and an in-file repeat', async () => {
    const rows = [
      ['2026-10-01', 'FV-1', '1500.00', 'Alfa s.r.o.', VALID_ICO],
      ['2026-10-02', 'FV-2', '', 'Beta s.r.o.', ''],
      ['2026-10-01', 'FV-1', '1500.00', 'Alfa s.r.o.', VALID_ICO],
    ];
    const { store, inserted, finished } = fakeStore(runRecord());
    const enqueued: ImportSpreadsheetRunPayload[] = [];
    await handlerFor(store, csvBytes(rows), enqueued)(payload(0), ctx);

    expect(inserted.map((i) => i.row)).toEqual([2]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ imported: 1, skipped: 2, duplicates: 0 });
    expect(finished[0]?.skippedRows).toEqual([
      { row: 3, reason: 'missing_total' },
      { row: 4, reason: 'duplicate_in_file' },
    ]);
    expect(enqueued).toEqual([]);
  });

  it('imports 200 rows per run and enqueues the next run', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => [
      `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      `FV-${i}`,
      '100.00',
      `Dodavatel ${i}`,
      '',
    ]);
    const { store, inserted, counts, finished } = fakeStore(runRecord());
    const enqueued: ImportSpreadsheetRunPayload[] = [];
    await handlerFor(store, csvBytes(rows), enqueued)(payload(0), ctx);

    expect(inserted).toHaveLength(200);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ imported: 200, skipped: 0 });
    expect(finished).toHaveLength(0);
    expect(enqueued).toEqual([{ orgId: ORG, importId: IMPORT, fromRow: 200 }]);
  });

  it('carries the start nonce to the next run so its job key stays unique', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => [
      '2026-10-01',
      `FV-${i}`,
      '100.00',
      `D ${i}`,
      '',
    ]);
    const { store } = fakeStore(runRecord());
    const enqueued: ImportSpreadsheetRunPayload[] = [];
    await handlerFor(store, csvBytes(rows), enqueued)({ ...payload(0), nonce: 7 }, ctx);
    expect(enqueued).toEqual([{ orgId: ORG, importId: IMPORT, fromRow: 200, nonce: 7 }]);
  });

  it('finishes the import with the counts summed over runs on the last run', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => [
      `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      `FV-${i}`,
      '100.00',
      `Dodavatel ${i}`,
      '',
    ]);
    const { store, inserted, finished } = fakeStore(runRecord({ importedCount: 200 }));
    const enqueued: ImportSpreadsheetRunPayload[] = [];
    await handlerFor(store, csvBytes(rows), enqueued)(payload(400), ctx);

    expect(inserted).toHaveLength(50);
    expect(enqueued).toEqual([]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ imported: 250, skipped: 0 });
  });

  it('does nothing unless the import is importing', async () => {
    const { store, inserted, counts, finished } = fakeStore(runRecord({ state: 'done' }));
    const enqueued: ImportSpreadsheetRunPayload[] = [];
    await handlerFor(store, null, enqueued)(payload(0), ctx);

    expect(inserted).toHaveLength(0);
    expect(counts).toHaveLength(0);
    expect(finished).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });
});

describe('import undo job', () => {
  it('calls undoImport with the org, the import and the clock time', async () => {
    const calls: { orgId: string; importId: string; now: Date }[] = [];
    const handler = createImportUndoHandler({
      clock: { now: () => Date.parse('2026-10-26T10:00:00Z') },
      undo: async (_tx, input) => {
        calls.push(input);
        return { removed: 2, kept: 1 };
      },
    });
    await handler({ orgId: ORG, importId: IMPORT }, ctx);
    expect(calls).toEqual([
      { orgId: ORG, importId: IMPORT, now: new Date('2026-10-26T10:00:00Z') },
    ]);
  });
});
