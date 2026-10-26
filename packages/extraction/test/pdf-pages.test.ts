import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfPagesError, pdfPageCount, pdfPickPages } from '../src/pdf/pages';

/** A PDF whose page i (1-based) is 100 + i points wide, so a test can tell pages apart. */
async function pdfOf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= count; i += 1) doc.addPage([100 + i, 200]);
  return doc.save();
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe('pdfPageCount', () => {
  it('counts pages', async () => {
    expect(await pdfPageCount(await pdfOf(12))).toBe(12);
  });

  it('throws PdfPagesError for bytes that are not a PDF', async () => {
    await expect(pdfPageCount(new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(
      PdfPagesError,
    );
  });
});

describe('pdfPickPages', () => {
  it('keeps the asked pages in the asked order', async () => {
    const picked = await pdfPickPages(await pdfOf(5), [4, 2]);
    expect(await widths(picked)).toEqual([104, 102]);
  });

  it('keeps a single page', async () => {
    expect(await widths(await pdfPickPages(await pdfOf(3), [3]))).toEqual([103]);
  });

  it('rejects a page outside the file', async () => {
    const bytes = await pdfOf(2);
    await expect(pdfPickPages(bytes, [3])).rejects.toBeInstanceOf(RangeError);
    await expect(pdfPickPages(bytes, [0])).rejects.toBeInstanceOf(RangeError);
    await expect(pdfPickPages(bytes, [1.5])).rejects.toBeInstanceOf(RangeError);
  });
});
