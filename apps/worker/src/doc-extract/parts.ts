import type { DocumentPageForRead } from '@shoebox/db';
import { isProtoMediaType, pdfPickPages, type ReadPart } from '@shoebox/extraction';

/**
 * The parts to read for a sorted document. Consecutive rows of the same file and the same region
 * become one part: for a PDF, `pick(bytes, [their filePages in row order])`; for an image, its bytes.
 * Each file is fetched once. Throws TypeError('media') for a file the model cannot read.
 */
export async function partsOf(
  rows: readonly DocumentPageForRead[],
  blobs: { get(path: string): Promise<Uint8Array> },
  pick: (bytes: Uint8Array, pages: readonly number[]) => Promise<Uint8Array> = pdfPickPages,
): Promise<ReadPart[]> {
  const files = new Map<string, Promise<Uint8Array>>();
  const load = (path: string): Promise<Uint8Array> => {
    let bytes = files.get(path);
    if (!bytes) {
      bytes = blobs.get(path);
      files.set(path, bytes);
    }
    return bytes;
  };
  const parts: ReadPart[] = [];
  let i = 0;
  while (i < rows.length) {
    const first = rows[i];
    if (!first) break;
    if (!isProtoMediaType(first.mimeType)) throw new TypeError('media: unsupported type');
    let j = i + 1;
    while (
      j < rows.length &&
      rows[j]?.sourceFileId === first.sourceFileId &&
      rows[j]?.region === first.region
    ) {
      j++;
    }
    const bytes = await load(first.storagePath);
    if (first.mimeType === 'application/pdf') {
      const pages = rows.slice(i, j).map((row) => row.filePage);
      parts.push({
        bytes: await pick(bytes, pages),
        mediaType: 'application/pdf',
        region: first.region,
      });
    } else {
      parts.push({ bytes, mediaType: first.mimeType, region: first.region });
    }
    i = j;
  }
  return parts;
}
