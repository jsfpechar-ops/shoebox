import { describe, expect, it } from 'vitest';
import { applyExactData, type DocumentScan, type ProtoExtraction } from '../src/index';

// Synthetic values only (hard rule 4).
const ORG = { ico: '00006947', dic: 'CZ00006947' };
const NO_SCAN: DocumentScan = { text: null, textGood: false, qrTexts: [] };

function x(
  over: { ico?: string | null; dic?: string | null; vs?: string | null; iban?: string | null } = {},
): ProtoExtraction {
  return {
    schema_version: 'm02-proto-v3',
    kind_hint: 'invoice',
    document_class: 'received_invoice',
    supplier: {
      name: 'Test s.r.o.',
      ico: over.ico === undefined ? '25596641' : over.ico,
      dic: over.dic === undefined ? 'CZ25596641' : over.dic,
      vat_id: null,
      country: 'CZ',
    },
    buyer: { name: null, ico: '00006947', dic: 'CZ00006947' },
    document: { number: '2026001', variable_symbol: over.vs === undefined ? null : over.vs },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: null },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
    totals: { net: '1000.00', vat: '210.00', gross: '1210.00' },
    payment: {
      account_number: null,
      bank_code: null,
      iban: over.iban === undefined ? null : over.iban,
      method: 'bank_transfer',
    },
    flags: {
      not_tax_document_text: false,
      non_vat_payer_text: false,
      reverse_charge_text: false,
      paid_text: false,
    },
    not_tax_document: false,
    issues: [],
  } as ProtoExtraction;
}

const QR = 'SPD*1.0*ACC:CZ6508000000192000145399*AM:1210.00*CC:CZK*DT:20260926*X-VS:2026001';

describe('applyExactData', () => {
  it('does nothing without exact data', () => {
    const r = applyExactData(x(), NO_SCAN, ORG);
    expect(r.extraction).toEqual(x());
    expect(r.sources).toEqual({});
    expect(r.qrAmount).toBeNull();
  });

  it('takes IBAN, VS, due date and amount from the payment QR', () => {
    const r = applyExactData(x(), { ...NO_SCAN, qrTexts: [QR] }, ORG);
    expect(r.extraction.payment.iban).toBe('CZ6508000000192000145399');
    expect(r.extraction.document.variable_symbol).toBe('2026001');
    expect(r.extraction.dates.due_date).toBe('2026-09-26');
    expect(r.qrAmount).toBe('1210.00');
    expect(r.sources).toEqual({
      'payment.iban': 'qr',
      'document.variable_symbol': 'qr',
      'dates.due_date': 'qr',
    });
  });

  it('ignores QR amounts that disagree', () => {
    const other = QR.replace('AM:1210.00', 'AM:99.00');
    expect(applyExactData(x(), { ...NO_SCAN, qrTexts: [QR, other] }, ORG).qrAmount).toBeNull();
  });

  it('fixes a misread IČO and DIČ from a good text layer', () => {
    const scan: DocumentScan = {
      text: 'Dodavatel IČ: 25596641 DIČ: CZ25596641\nOdběratel IČ: 00006947',
      textGood: true,
      qrTexts: [],
    };
    const r = applyExactData(x({ ico: '25596614', dic: 'CZ25596614' }), scan, ORG);
    expect(r.extraction.supplier.ico).toBe('25596641');
    expect(r.extraction.supplier.dic).toBe('CZ25596641');
    expect(r.sources).toEqual({ 'supplier.ico': 'pdf_text', 'supplier.dic': 'pdf_text' });
  });

  it('does not trust a text layer that is not good', () => {
    const scan: DocumentScan = { text: 'IČ: 25596641', textGood: false, qrTexts: [] };
    expect(applyExactData(x({ ico: '25596614' }), scan, ORG).extraction.supplier.ico).toBe(
      '25596614',
    );
  });

  it('keeps ISDOC identifiers and only reads the QR amount', () => {
    const r = applyExactData(
      x({ ico: '25596614' }),
      { text: 'IČ: 25596641', textGood: true, qrTexts: [QR] },
      ORG,
      { keepIdentifiers: true },
    );
    expect(r.extraction.supplier.ico).toBe('25596614');
    expect(r.sources).toEqual({});
    expect(r.qrAmount).toBe('1210.00');
  });
});
