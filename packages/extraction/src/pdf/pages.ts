import { PDFDocument } from 'pdf-lib';

/** Thrown when bytes are not a PDF pdf-lib can open. The message never holds document content. */
export class PdfPagesError extends Error {
  constructor() {
    super('pdf: cannot open');
    this.name = 'PdfPagesError';
  }
}

async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new PdfPagesError();
  }
}

/** The number of pages of a PDF (encrypted files are opened without decrypting, only to count). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await openPdf(bytes);
  return doc.getPageCount();
}

/**
 * A new PDF holding only `pages` (1-based, in the given order; a page may repeat).
 * Throws RangeError for a page outside 1..count, PdfPagesError for bytes that are not a PDF.
 */
export async function pdfPickPages(bytes: Uint8Array, pages: readonly number[]): Promise<Uint8Array> {
  const src = await openPdf(bytes);
  const count = src.getPageCount();
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > count) {
      throw new RangeError('page');
    }
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    pages.map((p) => p - 1),
  );
  for (const page of copied) out.addPage(page);
  return out.save();
}
