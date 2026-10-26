import { createHash } from 'node:crypto';
import { filePath } from '@shoebox/platform';

export const UPLOAD_MEDIA_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/xml', // .isdoc and .xml: the worker reads ISDOC data without AI
  'application/x-isdocx', // .isdocx (a ZIP holding the ISDOC)
];

/**
 * The media type we store. Browsers send "" or a generic type for ISDOC files, so the extension
 * decides for .isdoc, .isdocx and .xml; every other file keeps the type the browser sent.
 */
export function uploadMediaTypeOf(name: string, type: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'isdoc' || ext === 'xml') return 'application/xml';
  if (ext === 'isdocx') return 'application/x-isdocx';
  return type;
}
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 50;

export interface UploadFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface SourceFileInsert {
  readonly orgId: string;
  readonly sha256: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly originalFilename: string;
  readonly filenameNfc: string;
  readonly uploadedBy: string;
}

export interface UploadDeps {
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>; // an existing object is not an error
  insertSourceFile(row: SourceFileInsert): Promise<{ id: string; created: boolean }>; // created false = same org+sha256 existed
  findDocumentBySource(sourceFileId: string): Promise<string | null>;
  /** Restarts the read when the existing document could not be read; true when it did. */
  restartIfFailed(orgId: string, documentId: string): Promise<boolean>;
  insertDocument(row: {
    orgId: string;
    sourceFileId: string;
    uploadBatchId: string;
    receivedDate: string;
  }): Promise<string>;
  /** Queues the sorting job for the drop (doc.split). */
  enqueueSort(orgId: string, batchId: string): Promise<void>;
  newBatchId(): string;
  today(): string; // Prague date YYYY-MM-DD
}

export type UploadItem =
  | {
      readonly fileName: string;
      readonly status: 'accepted' | 'duplicate';
      readonly documentId: string;
    }
  | {
      readonly fileName: string;
      readonly status: 'rejected';
      readonly reason: 'type' | 'size' | 'empty';
    };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function uploadDocuments(
  deps: UploadDeps,
  ctx: { orgId: string; userId: string },
  files: readonly UploadFile[],
): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  const batchId = deps.newBatchId();
  let queued = 0;
  for (const file of files) {
    if (file.bytes.byteLength === 0) {
      items.push({ fileName: file.name, status: 'rejected', reason: 'empty' });
      continue;
    }
    const mimeType = uploadMediaTypeOf(file.name, file.type);
    if (!UPLOAD_MEDIA_TYPES.includes(mimeType)) {
      items.push({ fileName: file.name, status: 'rejected', reason: 'type' });
      continue;
    }
    if (file.bytes.byteLength > UPLOAD_MAX_BYTES) {
      items.push({ fileName: file.name, status: 'rejected', reason: 'size' });
      continue;
    }
    const sha256 = sha256Hex(file.bytes);
    const storagePath = filePath(ctx.orgId, sha256);
    await deps.putFile(storagePath, file.bytes, mimeType);
    const source = await deps.insertSourceFile({
      orgId: ctx.orgId,
      sha256,
      storagePath,
      mimeType,
      byteSize: file.bytes.byteLength,
      originalFilename: file.name,
      filenameNfc: file.name.normalize('NFC'),
      uploadedBy: ctx.userId,
    });
    if (!source.created) {
      const existing = await deps.findDocumentBySource(source.id);
      if (existing !== null) {
        const restarted = await deps.restartIfFailed(ctx.orgId, existing);
        items.push({
          fileName: file.name,
          status: restarted ? 'accepted' : 'duplicate',
          documentId: existing,
        });
        continue;
      }
    }
    const documentId = await deps.insertDocument({
      orgId: ctx.orgId,
      sourceFileId: source.id,
      uploadBatchId: batchId,
      receivedDate: deps.today(),
    });
    queued += 1;
    items.push({ fileName: file.name, status: 'accepted', documentId });
  }
  if (queued > 0) {
    try {
      await deps.enqueueSort(ctx.orgId, batchId);
    } catch {
      // The queue is down: the documents stay `received` and are still accepted.
    }
  }
  return items;
}
