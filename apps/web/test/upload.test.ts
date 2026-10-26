import { describe, expect, it } from 'vitest';
import {
  type SourceFileInsert,
  sha256Hex,
  UPLOAD_MAX_BYTES,
  type UploadDeps,
  uploadDocuments,
  uploadMediaTypeOf,
} from '../src/documents/upload';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const pdf = (text: string) => ({
  name: 'Faktura ř.pdf',
  type: 'application/pdf',
  bytes: new TextEncoder().encode(text),
});

function fakeDeps(options: { failEnqueue?: boolean; failedDocs?: string[] } = {}) {
  const puts: string[] = [];
  const sources = new Map<string, { id: string; row: SourceFileInsert }>();
  const docs = new Map<string, string>();
  const enqueued: string[] = [];
  const statements: string[] = [];
  let batches = 0;
  const inserted: { sourceFileId: string; uploadBatchId: string }[] = [];
  let n = 0;
  const deps: UploadDeps = {
    async putFile(path) {
      puts.push(path);
    },
    async insertSourceFile(row) {
      const existing = sources.get(row.sha256);
      if (existing) return { id: existing.id, created: false };
      const id = `sf-${++n}`;
      sources.set(row.sha256, { id, row });
      return { id, created: true };
    },
    async findDocumentBySource(id) {
      return docs.get(id) ?? null;
    },
    async restartIfFailed(_org, documentId) {
      return options.failedDocs?.includes(documentId) ?? false;
    },
    async insertDocument(row) {
      const id = `doc-${++n}`;
      docs.set(row.sourceFileId, id);
      inserted.push({ sourceFileId: row.sourceFileId, uploadBatchId: row.uploadBatchId });
      return id;
    },
    async enqueueSort(_org, batchId) {
      if (options.failEnqueue) throw new Error('down');
      enqueued.push(batchId);
    },
    async enqueueStatement(_org, sourceFileId) {
      statements.push(sourceFileId);
    },
    newBatchId: () => `batch-${++batches}`,
    today: () => '2026-10-25',
  };
  return { deps, puts, sources, enqueued, inserted, statements };
}

describe('sha256Hex', () => {
  it('hashes bytes to 64 hex chars', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('uploadDocuments', () => {
  it('stores, records and queues a new file', async () => {
    const { deps, puts, sources, enqueued } = fakeDeps();
    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const sha = sha256Hex(new TextEncoder().encode('a'));
    expect(puts).toEqual([`org/${ORG}/files/${sha}`]);
    expect(items).toEqual([
      { fileName: 'Faktura ř.pdf', status: 'accepted', documentId: expect.any(String) },
    ]);
    expect(enqueued).toHaveLength(1);
    expect(sources.get(sha)?.row).toMatchObject({
      orgId: ORG,
      sha256: sha,
      storagePath: `org/${ORG}/files/${sha}`,
      mimeType: 'application/pdf',
      byteSize: 1,
      uploadedBy: USER,
      filenameNfc: 'Faktura ř.pdf'.normalize('NFC'),
    });
  });

  it('shows the same file once', async () => {
    const { deps, enqueued } = fakeDeps();
    const [first] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const [second] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(second).toEqual({
      fileName: 'Faktura ř.pdf',
      status: 'duplicate',
      documentId: (first as { documentId: string }).documentId,
    });
    expect(enqueued).toHaveLength(1);
  });

  it('rejects empty, wrong type and too large files without storing them', async () => {
    const { deps, puts } = fakeDeps();
    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [
      { name: 'e.pdf', type: 'application/pdf', bytes: new Uint8Array() },
      {
        name: 'x.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: new Uint8Array([1]),
      },
      { name: 'big.pdf', type: 'application/pdf', bytes: new Uint8Array(UPLOAD_MAX_BYTES + 1) },
    ]);
    expect(items.map((i) => (i.status === 'rejected' ? i.reason : i.status))).toEqual([
      'empty',
      'type',
      'size',
    ]);
    expect(puts).toEqual([]);
  });

  it('accepts ISDOC files whatever type the browser sends, and stores the type by extension', async () => {
    const { deps, sources } = fakeDeps();
    const bytes = (text: string) => new TextEncoder().encode(text);
    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [
      { name: 'faktura.isdoc', type: '', bytes: bytes('<Invoice/>') },
      { name: 'faktura.ISDOCX', type: 'application/octet-stream', bytes: bytes('PK') },
      { name: 'data.xml', type: 'text/xml', bytes: bytes('<x/>') },
      { name: 'archive.zip', type: 'application/zip', bytes: bytes('PK2') },
    ]);
    expect(items.map((i) => i.status)).toEqual(['accepted', 'accepted', 'accepted', 'rejected']);
    expect([...sources.values()].map((s) => s.row.mimeType)).toEqual([
      'application/xml',
      'application/x-isdocx',
      'application/xml',
    ]);
  });

  it('keeps the type the browser sent for other files', () => {
    expect(uploadMediaTypeOf('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(uploadMediaTypeOf('noext', 'image/png')).toBe('image/png');
  });

  it('keeps the document when the queue is down', async () => {
    const { deps } = fakeDeps({ failEnqueue: true });
    const [item] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('b')]);
    expect(item?.status).toBe('accepted');
  });

  it('restarts the read when the same file comes again after it could not be read', async () => {
    const { deps } = fakeDeps({ failedDocs: ['doc-2'] });
    const [first] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const [second] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(first?.status).toBe('accepted');
    expect(second).toEqual({ fileName: 'Faktura ř.pdf', status: 'accepted', documentId: 'doc-2' });
  });

  it('puts the files of one upload in one batch and queues one sorting job', async () => {
    const { deps, enqueued, inserted } = fakeDeps();
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a'), pdf('b')]);
    expect(enqueued).toHaveLength(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.uploadBatchId).toBe(enqueued[0]);
    expect(inserted[1]?.uploadBatchId).toBe(enqueued[0]);
  });

  it('queues nothing when every file was a duplicate', async () => {
    const { deps, enqueued } = fakeDeps();
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(enqueued).toHaveLength(1);
  });
});

describe('bank statements in the upload', () => {
  const gpc = `074${'0'.repeat(6)}2400123455${'SYSEL TEST'.padEnd(20)}${'0'.repeat(89)}`;
  const file = (name: string, text: string, type = '') => ({
    name,
    type,
    bytes: new TextEncoder().encode(text),
  });

  it('sends a GPC or MT940 file to bank import instead of making a document', async () => {
    const f = fakeDeps();
    const sta = ':20:S\n:25:2400123455/2010\n:61:260915C5,00NTRF//R1\n';
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [
      file('vypis.gpc', gpc),
      file('vypis.sta', sta, 'application/octet-stream'),
    ]);
    expect(items).toEqual([
      { fileName: 'vypis.gpc', status: 'statement' },
      { fileName: 'vypis.sta', status: 'statement' },
    ]);
    expect(f.statements).toEqual(['sf-1', 'sf-2']);
    expect(f.inserted).toEqual([]);
    expect(f.enqueued).toEqual([]);
  });

  it('sends a CAMT.053 XML to bank import but keeps ISDOC XML a document', async () => {
    const f = fakeDeps();
    const camt =
      '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>';
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [
      file('vypis.xml', camt, 'text/xml'),
      file('faktura.isdoc', '<Invoice xmlns="http://isdoc.cz/namespace/2013"/>'),
    ]);
    expect(items.map((i) => i.status)).toEqual(['statement', 'accepted']);
    expect(f.statements).toHaveLength(1);
    expect(f.inserted).toHaveLength(1);
  });

  it('rejects a text file that is not a statement', async () => {
    const f = fakeDeps();
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [
      file('notes.gpc', 'hello'),
    ]);
    expect(items).toEqual([{ fileName: 'notes.gpc', status: 'rejected', reason: 'type' }]);
  });
});
