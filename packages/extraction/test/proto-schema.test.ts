import { describe, expect, it } from 'vitest';
import {
  buildProtoRequest,
  documentClassOf,
  isProtoMediaType,
  PROTO_PROMPT_VERSION,
  PROTO_RESPONSE_SCHEMA,
  PROTO_SYSTEM_PROMPT,
  ProtoParseError,
  parseProtoExtraction,
  protoMediaTypeOf,
} from '../src/index';

// Synthetic values only (hard rule 4).
function wire(): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Synthetic s.r.o.',
      ico: '12 34 56 78',
      dic: 'cz12345678',
      vat_id: '',
      country: 'cz',
    },
    buyer: { name: 'Odběratel s.r.o.', ico: '87 65 43 21', dic: 'cz87654321' },
    document: { number: 'SYN-1', variable_symbol: '1' },
    dates: { issue_date: '2026-09-12', duzp: '', due_date: '2026-09-26' },
    currency: 'czk',
    vat_recap: [{ rate_pct: '21', base: '100.00', vat: '21.00' }],
    totals: { net: '100.00', vat: '21.00', gross: '121.00' },
    payment: { account_number: '123', bank_code: '0100', iban: 'cz00 test iban', method: 'card' },
    flags: {
      not_tax_document_text: false,
      non_vat_payer_text: false,
      reverse_charge_text: false,
      paid_text: true,
    },
  };
}

describe('protoMediaTypeOf', () => {
  it('maps extensions and rejects other files', () => {
    expect(protoMediaTypeOf('a.PDF')).toBe('application/pdf');
    expect(protoMediaTypeOf('a.jpg')).toBe('image/jpeg');
    expect(protoMediaTypeOf('a.jpeg')).toBe('image/jpeg');
    expect(protoMediaTypeOf('a.png')).toBe('image/png');
    expect(protoMediaTypeOf('a.txt')).toBeNull();
    expect(protoMediaTypeOf('noext')).toBeNull();
    expect(isProtoMediaType('image/png')).toBe(true);
    expect(isProtoMediaType('text/plain')).toBe(false);
  });
});

describe('buildProtoRequest', () => {
  it('sends a PDF as a document block and an image as an image block, with the schema', () => {
    const pdf = buildProtoRequest({
      model: 'gemini-3.8-flash',
      file: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mediaType: 'application/pdf' },
    });
    expect(pdf.model).toBe('gemini-3.8-flash');
    expect(pdf.promptVersion).toBe(PROTO_PROMPT_VERSION);
    expect(pdf.maxTokens).toBe(4096);
    expect(pdf.messages[0]?.content[0]).toEqual({
      type: 'document',
      mediaType: 'application/pdf',
      dataBase64: 'JVBERg==',
    });
    expect(pdf.output?.schema).toBe(PROTO_RESPONSE_SCHEMA);
    const png = buildProtoRequest({
      model: 'm',
      file: { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      maxTokens: 99,
    });
    expect(png.maxTokens).toBe(99);
    expect(png.messages[0]?.content[0]).toMatchObject({ type: 'image', mediaType: 'image/png' });
  });

  it('schema requires every top-level field and has no nullable types', () => {
    const required = PROTO_RESPONSE_SCHEMA.required as string[];
    expect(required).toEqual(Object.keys(PROTO_RESPONSE_SCHEMA.properties as object));
    expect(JSON.stringify(PROTO_RESPONSE_SCHEMA)).not.toContain('nullable');
  });
});

describe('parseProtoExtraction', () => {
  it('normalizes "" to null, trims identifiers and derives the class', () => {
    const out = parseProtoExtraction(wire());
    expect(out.document_class).toBe('received_invoice');
    expect(out.supplier).toEqual({
      name: 'Synthetic s.r.o.',
      ico: '12345678',
      dic: 'CZ12345678',
      vat_id: null,
      country: 'CZ',
    });
    expect(out.dates).toEqual({ issue_date: '2026-09-12', duzp: null, due_date: '2026-09-26' });
    expect(out.currency).toBe('CZK');
    expect(out.payment.iban).toBe('CZ00TESTIBAN');
    expect(out.buyer).toEqual({ name: 'Odběratel s.r.o.', ico: '87654321', dic: 'CZ87654321' });
    expect(out.payment.method).toBe('card');
    expect(out.flags.paid_text).toBe(true);
    expect(out.vat_recap).toEqual([{ rate_pct: '21', base: '100.00', vat: '21.00' }]);
    expect(out.not_tax_document).toBe(false);
    expect(out.issues).toEqual([]);
  });

  it('drops invalid decimals and dates into issues and tolerates Czech number formats', () => {
    const raw = wire();
    raw.dates = { issue_date: '12.9.2026', duzp: '2026-08-31', due_date: '' };
    raw.totals = { net: '1 234,50', vat: 'abc', gross: '1.234,50' };
    raw.vat_recap = [{ rate_pct: '21', base: 'x', vat: '1.00' }, 'junk'];
    raw.currency = 'Kč';
    raw.kind_hint = 'mystery';
    const out = parseProtoExtraction(raw);
    expect(out.dates).toEqual({ issue_date: null, duzp: '2026-08-31', due_date: null });
    expect(out.totals).toEqual({ net: '1234.50', vat: null, gross: '1234.50' });
    expect(out.vat_recap).toEqual([]);
    expect(out.currency).toBeNull();
    expect(out.kind_hint).toBe('other');
    expect(out.document_class).toBe('unknown');
    expect(out.issues).toEqual([
      'kind_hint',
      'currency',
      'vat_recap[0].base',
      'vat_recap[0]',
      'vat_recap[1]',
      'dates.issue_date',
      'totals.vat',
    ]);
  });

  it('derives not_tax_document from either flag and rejects non-objects', () => {
    const raw = wire();
    raw.flags = {
      not_tax_document_text: false,
      non_vat_payer_text: true,
      reverse_charge_text: false,
    };
    expect(parseProtoExtraction(raw).not_tax_document).toBe(true);
    expect(parseProtoExtraction({}).document_class).toBe('unknown');
    expect(() => parseProtoExtraction(null)).toThrow(ProtoParseError);
    expect(() => parseProtoExtraction([])).toThrow(ProtoParseError);
  });

  it('maps every kind hint to a class of 04', () => {
    expect(documentClassOf('simplified_receipt')).toBe('received_receipt');
    expect(documentClassOf('card_slip')).toBe('received_receipt');
    expect(documentClassOf('statement')).toBe('settlement_statement');
    expect(documentClassOf('government_filing')).toBe('government_filing');
    expect(documentClassOf('order_confirmation')).toBe('order_confirmation');
    expect(documentClassOf('credit_note')).toBe('received_credit_note');
    expect(documentClassOf('proforma')).toBe('received_proforma');
    expect(documentClassOf('advance_tax_document')).toBe('received_advance_tax_doc');
  });

  it('v3 reads the buyer, the payment method, a paid stamp and unreadable documents', () => {
    expect(PROTO_PROMPT_VERSION).toBe('m02-proto-v3');
    expect(documentClassOf('non_document')).toBe('non_document');
    expect(documentClassOf('unreadable')).toBe('unreadable');
    expect(documentClassOf('other')).toBe('unknown');
    expect(PROTO_SYSTEM_PROMPT).toContain('non_document = ');
    expect(PROTO_SYSTEM_PROMPT).toContain('unreadable = ');
    expect(PROTO_SYSTEM_PROMPT).toContain('Sazbu DPH nikdy neodhaduj');
    const raw = wire();
    raw.payment = { account_number: '', bank_code: '', iban: '', method: 'bitcoin' };
    raw.buyer = null;
    const out = parseProtoExtraction(raw);
    expect(out.payment.method).toBeNull();
    expect(out.issues).toEqual(['payment.method']);
    expect(out.buyer).toEqual({ name: null, ico: null, dic: null });
    expect(parseProtoExtraction({}).flags.paid_text).toBe(false);
  });
});
