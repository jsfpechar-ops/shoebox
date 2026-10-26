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
    expect(await scanDocument(png, 'image/png')).toEqual({
      text: null,
      textGood: false,
      qrTexts: [PAYLOAD],
    });
  });

  it('reads the text layer and a QR image inside a PDF', async () => {
    const { width, height, gray } = await qr();
    const pdf = buildPdf(
      ['Faktura 2026001', 'Dodavatel ICO: 25596641 DIC: CZ25596641', 'Celkem k uhrade 1 210,00 Kc'],
      { width, height, gray },
    );
    const scan = await scanDocument(pdf, 'application/pdf');
    expect(scan.text).toBe(
      'Faktura 2026001\nDodavatel ICO: 25596641 DIC: CZ25596641\nCelkem k uhrade 1 210,00 Kc',
    );
    expect(scan.textGood).toBe(true);
    expect(scan.qrTexts).toEqual([PAYLOAD]);
  });

  it('marks a near-empty text layer as not good', async () => {
    const scan = await scanDocument(buildPdf(['x']), 'application/pdf');
    expect(scan).toEqual({ text: 'x', textGood: false, qrTexts: [] });
  });

  it('never throws on a broken PDF', async () => {
    const scan = await scanDocument(
      new TextEncoder().encode('%PDF-1.4 garbage'),
      'application/pdf',
    );
    expect(scan).toEqual({ text: null, textGood: false, qrTexts: [] });
  });
});
