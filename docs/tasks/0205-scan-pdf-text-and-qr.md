# 0205: Scan a file for its text layer and QR codes

Status: review
Ticket: P1-EXT-02 (QR decode) + P1-EXT-03 (text layer) | Depends on: 0201 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0205-report.md

## 1. Objective

`scanDocument(bytes, mediaType)` returns the PDF text layer (first 2 pages and the last) and the text of every QR code found in a photo or in an image inside the PDF. The worker uses it (0207) to read exact payment data and identifiers before trusting the AI.

## 2. Context

Dependencies (ADR in 03 architecture names both: "`pdfium` via `pdfjs-dist`", "QR (zxing-wasm) decoder"; owner line added to decisions by the orchestrator): `pdfjs-dist@6.4.299`, `zxing-wasm@3.1.5`. Both run in Node without native code; zxing-wasm loads its wasm from node_modules (no network). The orchestrator ran the code below against both versions on 2026-10-26 and both tests passed.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/extraction/package.json`, `pnpm-lock.yaml` | edit | the two dependencies (via `pnpm add`) |
| `packages/extraction/src/scan/scan.ts` | new | code below |
| `packages/extraction/test/helpers/pdf.ts` | new | code below |
| `packages/extraction/test/scan.test.ts` | new | code below, verbatim |
| `packages/extraction/src/index.ts` | edit | `export * from './scan/scan';` |

No other file may change.

## 4. Steps

1. `pnpm --filter @shoebox/extraction add pdfjs-dist@6.4.299 zxing-wasm@3.1.5 2>&1 | tail -5` (exact versions, no caret: then edit `package.json` to remove any `^`, and run `pnpm install 2>&1 | tail -3`).

2. `packages/extraction/src/scan/scan.ts`. Keep this logic; fix only TypeScript types (use narrow local interfaces or `unknown` casts, never `any`):

```ts
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';

export interface DocumentScan {
  /** PDF text layer, rows joined by "\n", pages by "\n\f\n"; null for images. */
  readonly text: string | null;
  /** ≥ 30 non-space chars, ≥ 10 digits, and the PDF was not made by a scanner/OCR tool. */
  readonly textGood: boolean;
  /** Text of every valid QR code, deduplicated, in the order found. */
  readonly qrTexts: readonly string[];
}

const QR_OPTIONS: ReaderOptions = { formats: ['QRCode'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 4 };
const OCR_PRODUCER = /scan|ocr|abbyy|finereader|tesseract|readiris/i;
const MAX_IMAGES = 12;

function pickPages(n: number): number[] {
  return [...new Set([1, 2, n].filter((p) => p >= 1 && p <= n))];
}

// pdfjs image kinds: 1 = 1 bit gray, 2 = RGB 24 bit, 3 = RGBA 32 bit.
function toRgba(img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray; kind: number }): Uint8ClampedArray | null {
  const { width, height, data, kind } = img;
  const n = width * height;
  if (kind === 3) return new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(n * 4);
  if (kind === 2) {
    for (let p = 0; p < n; p++) { out[p * 4] = data[p * 3]; out[p * 4 + 1] = data[p * 3 + 1]; out[p * 4 + 2] = data[p * 3 + 2]; out[p * 4 + 3] = 255; }
    return out;
  }
  if (kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = ((data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) === 1 ? 255 : 0;
      const i = (y * width + x) * 4; out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
    return out;
  }
  return null;
}

/** Upscales a small image (nearest neighbour, ≥ 240 px) and adds a white border: QR images in PDFs often have neither. */
export function withQuietZone(rgba: Uint8ClampedArray, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
  const s = Math.max(1, Math.ceil(240 / Math.min(width, height)));
  const b = Math.ceil(Math.max(width, height) * s * 0.1);
  const w2 = width * s + 2 * b;
  const h2 = height * s + 2 * b;
  const out = new Uint8ClampedArray(w2 * h2 * 4).fill(255);
  for (let y = 0; y < height * s; y++) for (let x = 0; x < width * s; x++) {
    const si = (((y / s) | 0) * width + ((x / s) | 0)) * 4;
    const di = ((y + b) * w2 + x + b) * 4;
    out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2];
  }
  return { data: out, width: w2, height: h2 };
}

async function qrTextsOf(input: Uint8Array | { data: Uint8ClampedArray; width: number; height: number }): Promise<string[]> {
  const found = await readBarcodes(input, QR_OPTIONS);
  return found.filter((r) => r.isValid).map((r) => r.text);
}

export async function scanDocument(bytes: Uint8Array, mediaType: string): Promise<DocumentScan> {
  if (mediaType !== 'application/pdf') {
    return { text: null, textGood: false, qrTexts: [...new Set(await qrTextsOf(bytes))] };
  }
  const task = getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false, useSystemFonts: false });
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
        if (row === undefined) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      pageTexts.push(rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')).join('\n'));
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length && images < MAX_IMAGES; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        images++;
        const img = await new Promise<unknown>((resolve) => page.objs.get(ops.argsArray[i][0], resolve));
        // narrow img to { width, height, data, kind }; skip when smaller than 15 px either way
        const rgba = toRgba(img);
        if (rgba === null) continue;
        for (const t of await qrTextsOf(withQuietZone(rgba, img.width, img.height))) qr.add(t);
      }
    }
    const text = pageTexts.join('\n\f\n').normalize('NFC');
    const digits = (text.match(/\d/g) ?? []).length;
    const textGood = text.replace(/\s/g, '').length >= 30 && digits >= 10 && !OCR_PRODUCER.test(producer);
    return { text, textGood, qrTexts: [...qr] };
  } finally {
    await task.destroy();
  }
}
```

   A PDF that pdfjs cannot open must not crash the worker: wrap the PDF branch so any throw returns `{ text: null, textGood: false, qrTexts: [] }`.

3. `packages/extraction/test/helpers/pdf.ts`:

```ts
/** A one-page PDF with Helvetica text lines and an optional 8-bit gray image. Test-only. */
export function buildPdf(lines: readonly string[], image?: { width: number; height: number; gray: Uint8Array }): Uint8Array {
  const content =
    lines.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${l}) Tj ET`).join('\n') +
    (image ? '\nq 150 0 0 150 50 300 cm /Im1 Do Q' : '');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >>${image ? ' /XObject << /Im1 6 0 R >>' : ''} >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let len = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  const push = (b: Buffer): void => { chunks.push(b); len += b.length; };
  objs.forEach((o, i) => { offsets.push(len); push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)); });
  if (image) {
    offsets.push(len);
    push(Buffer.from(`6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.gray.length} >>\nstream\n`));
    push(Buffer.from(image.gray));
    push(Buffer.from('\nendstream\nendobj\n'));
  }
  const xref = len;
  const n = offsets.length + 1;
  push(Buffer.from(`xref\n0 ${n}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(chunks));
}
```

4. `packages/extraction/test/scan.test.ts`, verbatim:

```ts
import { describe, expect, it } from 'vitest';
import { writeBarcode } from 'zxing-wasm/full';
import { scanDocument } from '../src/index';
import { buildPdf } from './helpers/pdf';

// Synthetic values only (hard rule 4).
const PAYLOAD = 'SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK*X-VS:2026001';

async function qr(): Promise<{ png: Uint8Array; width: number; height: number; gray: Uint8Array }> {
  const w = await writeBarcode(PAYLOAD, { format: 'QRCode', scale: 4 });
  if (w.image === null || w.symbol === null) throw new Error(w.error);
  return {
    png: new Uint8Array(await w.image.arrayBuffer()),
    width: w.symbol.width,
    height: w.symbol.height,
    gray: new Uint8Array(w.symbol.data),
  };
}

describe('scanDocument', () => {
  it('reads a QR code from a PNG photo', async () => {
    const { png } = await qr();
    expect(await scanDocument(png, 'image/png')).toEqual({ text: null, textGood: false, qrTexts: [PAYLOAD] });
  });

  it('reads the text layer and a QR image inside a PDF', async () => {
    const { width, height, gray } = await qr();
    const pdf = buildPdf(
      ['Faktura 2026001', 'Dodavatel ICO: 25596641 DIC: CZ25596641', 'Celkem k uhrade 1 210,00 Kc'],
      { width, height, gray },
    );
    const scan = await scanDocument(pdf, 'application/pdf');
    expect(scan.text).toBe('Faktura 2026001\nDodavatel ICO: 25596641 DIC: CZ25596641\nCelkem k uhrade 1 210,00 Kc');
    expect(scan.textGood).toBe(true);
    expect(scan.qrTexts).toEqual([PAYLOAD]);
  });

  it('marks a near-empty text layer as not good', async () => {
    const scan = await scanDocument(buildPdf(['x']), 'application/pdf');
    expect(scan).toEqual({ text: 'x', textGood: false, qrTexts: [] });
  });

  it('never throws on a broken PDF', async () => {
    const scan = await scanDocument(new TextEncoder().encode('%PDF-1.4 garbage'), 'application/pdf');
    expect(scan).toEqual({ text: null, textGood: false, qrTexts: [] });
  });
});
```

   If `writeBarcode`'s returned `symbol.data` is not 1 byte per pixel in this version, STOP (§8). Implement until these tests pass; do not edit the test file.

## 5. Do not touch

Everything outside §3. Hard rule 4: no real documents in tests; log no document text.

## 6. Commands

```
pnpm --filter @shoebox/extraction test 2>&1 | tail -30
pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm exec biome check --write packages/extraction 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes (biome may reformat the test file: formatting only is fine).

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0205-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`package.json` versions exact; `scan.ts` never throws.
