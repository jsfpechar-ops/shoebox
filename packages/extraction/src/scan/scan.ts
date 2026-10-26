import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type ReaderOptions, readBarcodes } from 'zxing-wasm/reader';

export interface DocumentScan {
  /** PDF text layer, rows joined by "\n", pages by "\n\f\n"; null for images. */
  readonly text: string | null;
  /** ≥ 30 non-space chars, ≥ 10 digits, and the PDF was not made by a scanner/OCR tool. */
  readonly textGood: boolean;
  /** Text of every valid QR code, deduplicated, in the order found. */
  readonly qrTexts: readonly string[];
}

const QR_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  maxNumberOfSymbols: 4,
};
const OCR_PRODUCER = /scan|ocr|abbyy|finereader|tesseract|readiris/i;
const MAX_IMAGES = 12;

function pickPages(n: number): number[] {
  return [...new Set([1, 2, n].filter((p) => p >= 1 && p <= n))];
}

// pdfjs image kinds: 1 = 1 bit gray, 2 = RGB 24 bit, 3 = RGBA 32 bit.
interface PdfImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
  kind: number;
}

function toRgba(img: PdfImage): Uint8ClampedArray | null {
  const { width, height, kind } = img;
  const data = (i: number): number => img.data[i] ?? 0;
  const n = width * height;
  if (kind === 3) return new Uint8ClampedArray(img.data);
  const out = new Uint8ClampedArray(n * 4);
  if (kind === 2) {
    for (let p = 0; p < n; p++) {
      out[p * 4] = data(p * 3);
      out[p * 4 + 1] = data(p * 3 + 1);
      out[p * 4 + 2] = data(p * 3 + 2);
      out[p * 4 + 3] = 255;
    }
    return out;
  }
  if (kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = ((data(y * rowBytes + (x >> 3)) >> (7 - (x & 7))) & 1) === 1 ? 255 : 0;
        const i = (y * width + x) * 4;
        out[i] = v;
        out[i + 1] = v;
        out[i + 2] = v;
        out[i + 3] = 255;
      }
    return out;
  }
  return null;
}

/** Upscales a small image (nearest neighbour, ≥ 240 px) and adds a white border: QR images in PDFs often have neither. */
export function withQuietZone(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const s = Math.max(1, Math.ceil(240 / Math.min(width, height)));
  const b = Math.ceil(Math.max(width, height) * s * 0.1);
  const w2 = width * s + 2 * b;
  const h2 = height * s + 2 * b;
  const out = new Uint8ClampedArray(w2 * h2 * 4).fill(255);
  for (let y = 0; y < height * s; y++)
    for (let x = 0; x < width * s; x++) {
      const si = (((y / s) | 0) * width + ((x / s) | 0)) * 4;
      const di = ((y + b) * w2 + x + b) * 4;
      out[di] = rgba[si] ?? 0;
      out[di + 1] = rgba[si + 1] ?? 0;
      out[di + 2] = rgba[si + 2] ?? 0;
    }
  return { data: out, width: w2, height: h2 };
}

async function qrTextsOf(
  input: Uint8Array | { data: Uint8ClampedArray; width: number; height: number },
): Promise<string[]> {
  const found = await readBarcodes(input, QR_OPTIONS);
  return found.filter((r) => r.isValid).map((r) => r.text);
}

export async function scanDocument(bytes: Uint8Array, mediaType: string): Promise<DocumentScan> {
  try {
    if (mediaType !== 'application/pdf') {
      return { text: null, textGood: false, qrTexts: [...new Set(await qrTextsOf(bytes))] };
    }
    return await scanPdf(bytes);
  } catch {
    return { text: null, textGood: false, qrTexts: [] };
  }
}

async function scanPdf(bytes: Uint8Array): Promise<DocumentScan> {
  const task = getDocument({
    data: bytes.slice(),
    verbosity: 0,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Producer?: string; Creator?: string };
    const producer = `${info.Producer ?? ''} ${info.Creator ?? ''}`;
    const pageTexts: string[] = [];
    const qr = new Set<string>();
    let images = 0;
    for (const n of pickPages(doc.numPages)) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const rows: { y: number; items: { x: number; s: string }[] }[] = [];
      for (const it of content.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        const x = it.transform[4] as number;
        const y = it.transform[5] as number;
        let row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (row === undefined) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      pageTexts.push(
        rows
          .map((r) =>
            r.items
              .sort((a, b) => a.x - b.x)
              .map((i) => i.s)
              .join(' '),
          )
          .join('\n'),
      );
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length && images < MAX_IMAGES; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        images++;
        const img = (await new Promise<unknown>((resolve) =>
          page.objs.get(ops.argsArray[i][0], resolve),
        )) as PdfImage;
        // narrow img to { width, height, data, kind }; skip when smaller than 15 px either way
        const rgba = toRgba(img);
        if (rgba === null) continue;
        for (const t of await qrTextsOf(withQuietZone(rgba, img.width, img.height))) qr.add(t);
      }
    }
    const text = pageTexts.join('\n\f\n').normalize('NFC');
    const digits = (text.match(/\d/g) ?? []).length;
    const textGood =
      text.replace(/\s/g, '').length >= 30 && digits >= 10 && !OCR_PRODUCER.test(producer);
    return { text, textGood, qrTexts: [...qr] };
  } finally {
    await task.destroy();
  }
}
