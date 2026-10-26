import { buildIsdoc, buildPohodaDataPack } from '@shoebox/exports';
import { describe, expect, it } from 'vitest';
import {
  type FormatDoc,
  type FormatOrg,
  isdocInputOf,
  pohodaDocumentOf,
  pohodaProfileOf,
} from '../src/documents/export-formats';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const org: FormatOrg = {
  name: 'Firma Test',
  ico: '12345678',
  dic: 'CZ12345678',
  vatStatus: 'platce',
};

const received: FormatDoc = {
  id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  cls: 'received_invoice',
  direction: 'in',
  taxDocStatus: 'tax_document',
  partner: {
    name: 'Dodavatel s.r.o.',
    ico: '87654321',
    dic: 'CZ87654321',
    country: 'CZ',
    street: 'Hlavni 1',
    city: 'Praha',
    zip: '11000',
  },
  number: 'FV-2026-001',
  variableSymbol: '2026001',
  issueDate: '2026-07-10',
  duzp: '2026-07-10',
  receivedDate: '2026-07-12',
  vatPointDate: '2026-07-10',
  dueDate: '2026-07-24',
  summary: null,
  currency: 'CZK',
  totalGross: '1210.00',
  paymentMethod: 'bank_transfer',
  payToAccount: { account: '2000145399', bankCode: '2010', iban: null },
  lines: [
    {
      net: '1000.00',
      vat: '210.00',
      gross: '1210.00',
      vatRateType: 'standard',
      vatRatePct: '21.00',
      vatTreatment: 'rcv_domestic_vat',
      categoryCode: 'office_supplies',
    },
  ],
  vatSummary: [{ vatRateType: 'standard', vatRatePct: '21.00', base: '1000.00', vat: '210.00' }],
};

describe('isdocInputOf', () => {
  it('maps a received invoice with money strings unchanged', () => {
    const input = isdocInputOf(ORG_ID, org, received);
    expect(input).not.toBeNull();
    if (input === null) return;
    expect(input.documentType).toBe('1');
    expect(input.supplier.name).toBe('Dodavatel s.r.o.');
    expect(input.customer.name).toBe('Firma Test');
    expect(input.vatRows).toEqual([{ ratePct: '21.00', base: '1000.00', vat: '210.00' }]);
    expect(input.totalGross).toBe('1210.00');
    const xml = buildIsdoc(input);
    expect(xml).toContain('FV-2026-001');
  });

  it('swaps parties for an issued invoice and skips other classes', () => {
    const issued = isdocInputOf(ORG_ID, org, {
      ...received,
      cls: 'issued_invoice',
      direction: 'out',
    });
    expect(issued?.supplier.name).toBe('Firma Test');
    expect(issued?.customer.name).toBe('Dodavatel s.r.o.');
    expect(isdocInputOf(ORG_ID, org, { ...received, cls: 'contract' })).toBeNull();
  });
});

describe('pohodaDocumentOf', () => {
  it('keeps strings and the partner address, and builds a data pack', () => {
    const doc = pohodaDocumentOf(received);
    expect(doc).not.toBeNull();
    if (doc === null) return;
    expect(doc.lines[0]?.gross).toBe('1210.00');
    expect(doc.vatSummary[0]?.base).toBe('1000.00');
    expect(doc.partner?.street).toBe('Hlavni 1');
    expect(doc.partner?.city).toBe('Praha');
    const result = buildPohodaDataPack(
      { periodLabel: '2026-Q3', version: 1, documents: [doc] },
      pohodaProfileOf(org, new Map()),
    );
    expect(result.xml).toContain('FV-2026-001');
    expect(result.warnings.some((w) => w.code.startsWith('unmapped_'))).toBe(true);
  });
});
