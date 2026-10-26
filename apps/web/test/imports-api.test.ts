import { describe, expect, it } from 'vitest';
import {
  createImport,
  getImport,
  type ImportDeps,
  type ImportRecord,
  previewImport,
  startImport,
  undoImport,
} from '../src/imports/handlers';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const USER = '66666666-6666-4666-8666-666666666666';
const IMPORT = '55555555-5555-4555-8555-555555555555';
const AUTH = { orgId: ORG, userId: USER };
const MB = 1024 * 1024;

// Synthetic rows only (no real partner or person).
const CSV = [
  'Datum,Cislo,Castka,Dodavatel',
  '1. 3. 2026,FV-1,1210,Alfa s.r.o.',
  '2. 3. 2026,FV-2,500,Beta s.r.o.',
].join('\n');
const FULL = { issue_date: 0, document_number: 1, total_gross: 2, partner_name: 3 };
const OPTIONS = { direction_mode: 'all_expense', header_row: 0 } as const;

function record(over: Partial<ImportRecord> = {}): ImportRecord {
  return {
    id: IMPORT,
    orgId: ORG,
    state: 'parsed',
    sourceFileId: 'src-1',
    storagePath: `${ORG}/file`,
    fileName: 'import.csv',
    rowCount: 2,
    importedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function fakeDeps(
  init: {
    record?: ImportRecord | null;
    created?: boolean;
    prior?: { createdAt: string } | null;
  } = {},
) {
  const enqueued: unknown[] = [];
  const deps: ImportDeps = {
    putFile: async () => {},
    download: async () => new TextEncoder().encode(CSV),
    insertSourceFile: async () => ({ id: 'src-1', created: init.created ?? true }),
    findImportBySource: async () => init.prior ?? null,
    insertImport: async () => IMPORT,
    loadImport: async () => (init.record === undefined ? record() : init.record),
    findSavedMapping: async () => null,
    saveMapping: async () => 'map-1',
    markStarted: async () => true,
    enqueueRun: async (orgId, importId, fromRow) => {
      enqueued.push(['run', orgId, importId, fromRow]);
    },
    enqueueUndo: async (orgId, importId) => {
      enqueued.push(['undo', orgId, importId]);
    },
  };
  return { deps, enqueued };
}

const csvFile = (name = 'import.csv') => ({
  name,
  type: 'text/csv',
  bytes: new TextEncoder().encode(CSV),
});

describe('POST /api/v1/imports', () => {
  it('returns 413 for a file over 5 MiB', async () => {
    const { deps } = fakeDeps();
    const result = await createImport(deps, AUTH, {
      name: 'big.csv',
      type: 'text/csv',
      bytes: new Uint8Array(5 * MB + 1),
    });
    expect(result.status).toBe(413);
    expect(result.body.error).toBe('import.too_large');
  });

  it('returns 409 with importedAt when the org already imported this file', async () => {
    const { deps } = fakeDeps({
      created: false,
      prior: { createdAt: '2026-10-01T00:00:00.000Z' },
    });
    const result = await createImport(deps, AUTH, csvFile());
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: 'import.already',
      importedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('returns 422 for a file that is not a readable workbook', async () => {
    const { deps } = fakeDeps();
    const result = await createImport(deps, AUTH, {
      name: 'broken.xlsx',
      type: '',
      bytes: new TextEncoder().encode('not a workbook'),
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('import.unreadable');
  });

  it('returns 201 with id, headers, mapping, options and preview', async () => {
    const { deps } = fakeDeps();
    const result = await createImport(deps, AUTH, csvFile());
    expect(result.status).toBe(201);
    expect(Object.keys(result.body).sort()).toEqual(
      ['headers', 'id', 'mapping', 'options', 'preview'].sort(),
    );
    expect(result.body.id).toBe(IMPORT);
  });
});

describe('POST /api/v1/imports/{id}/preview', () => {
  it('returns the preview for the given mapping with the first rows', async () => {
    const { deps } = fakeDeps();
    const result = await previewImport(deps, AUTH, IMPORT, { mapping: FULL, options: OPTIONS });
    expect(result.status).toBe(200);
    const preview = result.body.preview as { rows: unknown[]; counts: { valid: number } };
    expect(preview.rows).toHaveLength(2);
    expect(preview.counts).toHaveProperty('valid');
  });

  it('returns 404 for an import of another org', async () => {
    const { deps } = fakeDeps({ record: record({ orgId: OTHER_ORG }) });
    const result = await previewImport(deps, AUTH, IMPORT, { mapping: FULL, options: OPTIONS });
    expect(result.status).toBe(404);
  });
});

describe('POST /api/v1/imports/{id}/start', () => {
  it('returns 422 when a required target is not mapped', async () => {
    const { deps, enqueued } = fakeDeps();
    const result = await startImport(deps, AUTH, IMPORT, {
      mapping: { issue_date: 0 },
      options: OPTIONS,
    });
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('import.missing_targets');
    expect(enqueued).toEqual([]);
  });

  it('returns 409 when the import is not parsed', async () => {
    const { deps, enqueued } = fakeDeps({ record: record({ state: 'done' }) });
    const result = await startImport(deps, AUTH, IMPORT, { mapping: FULL, options: OPTIONS });
    expect(result.status).toBe(409);
    expect(enqueued).toEqual([]);
  });

  it('queues the run from row 0 and returns 202', async () => {
    const { deps, enqueued } = fakeDeps();
    const result = await startImport(deps, AUTH, IMPORT, { mapping: FULL, options: OPTIONS });
    expect(result.status).toBe(202);
    expect(enqueued).toEqual([['run', ORG, IMPORT, 0]]);
  });
});

describe('POST /api/v1/imports/{id}/undo', () => {
  it('returns 410 after 30 days and queues nothing', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const { deps, enqueued } = fakeDeps({ record: record({ createdAt: old }) });
    const result = await undoImport(deps, AUTH, IMPORT);
    expect(result.status).toBe(410);
    expect(result.body.error).toBe('import.undo_expired');
    expect(enqueued).toEqual([]);
  });

  it('queues the undo and returns 202', async () => {
    const { deps, enqueued } = fakeDeps();
    const result = await undoImport(deps, AUTH, IMPORT);
    expect(result.status).toBe(202);
    expect(enqueued).toEqual([['undo', ORG, IMPORT]]);
  });
});

describe('GET /api/v1/imports/{id}', () => {
  it('returns the state and the counts', async () => {
    const { deps } = fakeDeps({ record: record({ state: 'undone', importedCount: 2 }) });
    const result = await getImport(deps, AUTH, IMPORT);
    expect(result.status).toBe(200);
    expect(result.body.state).toBe('undone');
    expect(result.body.importedCount).toBe(2);
  });
});
