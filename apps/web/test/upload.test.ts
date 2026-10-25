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

function fakeDeps(options: { failEnqueue?: boolean } = {}) {
  const puts: string[] = [];
  const sources = new Map<string, { id: string; row: SourceFileInsert }>();
  const docs = new Map<string, string>();
  const enqueued: string[] = [];
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
    async insertDocument(row) {
      const id = `doc-${++n}`;
      docs.set(row.sourceFileId, id);
      return id;
    },
    async enqueueRead(_org, documentId) {
      if (options.failEnqueue) throw new Error('down');
      enqueued.push(documentId);
    },
    today: () => '2026-10-25',
  };
  return { deps, puts, sources, enqueued };
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
});
