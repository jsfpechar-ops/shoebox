import { describe, expect, it } from 'vitest';
import { type DocumentScan, PRECHECK_MAX_BYTES, precheckDocument } from '../src/index';

const scan = (text: string | null, qrTexts: string[] = []): DocumentScan => ({
  text,
  textGood: text !== null,
  qrTexts,
});
const check = (text: string | null, more: { pageCount?: number | null; bytes?: number; qr?: string[] } = {}) =>
  precheckDocument({
    byteLength: more.bytes ?? 50_000,
    pageCount: more.pageCount ?? 1,
    scan: scan(text, more.qr),
  });

describe('precheckDocument', () => {
  it('reads an invoice', () => {
    expect(check('FAKTURA - DAŇOVÝ DOKLAD č. 2026001 Celkem 1 210,00 Kč')).toEqual({ kind: 'read' });
  });

  it('skips a bank statement, even when a line says faktura', () => {
    expect(check('VÝPIS Z ÚČTU 1. 9. 2026 - 30. 9. 2026 úhrada faktura 2026001')).toMatchObject({
      kind: 'skip',
      reason: 'bank_statement',
      documentClass: 'bank_statement',
      status: 'supporting',
    });
    expect(check('Počáteční zůstatek 1 000,00 Konečný zůstatek 2 000,00')).toMatchObject({
      reason: 'bank_statement',
    });
  });

  it('skips a local fee report', () => {
    expect(check('Měsíční hlášení k místnímu poplatku z pobytu za období Leden 2026')).toMatchObject({
      kind: 'skip',
      reason: 'government_filing',
      status: 'supporting',
    });
  });

  it('skips a newsletter but reads an invoice e-mail with an unsubscribe line', () => {
    expect(check('Novinky tohoto týdne -50 % Odhlásit odběr')).toMatchObject({
      reason: 'not_invoice',
      documentClass: 'non_document',
    });
    expect(check('Faktura 2026001 je v příloze. Odhlásit odběr')).toEqual({ kind: 'read' });
  });

  it('reads whenever a payment QR code is found', () => {
    expect(check('VÝPIS Z ÚČTU', { qr: ['SPD*1.0*ACC:CZ0000000000000000000000'] })).toEqual({ kind: 'read' });
  });

  it('reads images and scans without a text layer (the model decides)', () => {
    expect(check(null, { pageCount: null })).toEqual({ kind: 'read' });
  });

  it('reads unknown text', () => {
    expect(check('Předávací protokol 12 34 56 78 90')).toEqual({ kind: 'read' });
  });

  it('skips too many pages and too large files', () => {
    expect(check('Faktura', { pageCount: 21 })).toMatchObject({ reason: 'too_many_pages', status: 'needs_review' });
    expect(check('Faktura', { pageCount: 20 })).toEqual({ kind: 'read' });
    expect(check('Faktura', { bytes: PRECHECK_MAX_BYTES + 1 })).toMatchObject({ reason: 'too_large' });
  });
});
