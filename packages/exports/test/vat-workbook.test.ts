import { describe, expect, it } from 'vitest';
import {
  buildVatWorkbook,
  type VatWorkbookInput,
  vatWorkbookSheets,
  type WorkbookEntry,
} from '../src/vat-workbook';

const eur: WorkbookEntry = {
  documentId: 'a',
  documentNumber: 'INV-2026-0001',
  partnerName: 'Anthropic',
  partnerVatId: null,
  partnerCountry: 'IE',
  issueDate: '2026-09-30',
  duzp: '2026-09-30',
  receivedDate: '2026-10-01',
  vatPointDate: '2026-09-30',
  vatTreatment: 'standard',
  vatRatePct: 21,
  currency: 'EUR',
  baseForeign: '100.00',
  fxRate: '24.580000',
  fxRateDate: '2026-09-29',
  baseCzk: '2458.00',
  vatCzk: '516.18',
  dphdp3Rows: ['5'],
  khSection: null,
  shvCode: null,
};

const czk: WorkbookEntry = {
  ...eur,
  documentId: 'b',
  documentNumber: 'BK-77',
  partnerName: 'Booking',
  partnerCountry: 'NL',
  vatRatePct: 12,
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxRateDate: null,
  baseCzk: '11160.00',
  vatCzk: '1339.20',
  dphdp3Rows: ['2'],
};

const input: VatWorkbookInput = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  profile: { legalName: 'Test Taxpayer', dic: 'CZ00000000', vatStatus: 'platce' },
  verdict: 'needs_accountant',
  checks: [
    {
      code: 'S_IO_OUTPUT_VAT',
      outcome: 'needs_accountant',
      documentIds: ['b'],
      params: { count: 1 },
    },
  ],
  rows: { '5': { base: '13700.00', tax: '2877.00' } },
  result: { row62: '0.00', row63: '0.00', row64: '0.00', row65: '0.00' },
  entries: [eur, czk],
  documentNumbers: { a: 'INV-2026-0001', b: 'BK-77' },
};

const sheetsOf = (sheets: ReturnType<typeof vatWorkbookSheets>, name: string) =>
  sheets.find((s) => s.name === name)?.rows ?? [];

describe('vat workbook sheets', () => {
  const sheets = vatWorkbookSheets(input);

  it('has the four English sheets in order', () => {
    expect(sheets.map((s) => s.name)).toEqual([
      'Summary',
      'VAT ledger',
      'Documents to resolve',
      'CNB rates',
    ]);
  });

  it('labels the provisional totals as unverified and keeps decimal strings', () => {
    const summary = sheetsOf(sheets, 'Summary');
    expect(summary).toContainEqual(['Unverified computation']);
    expect(summary).toContainEqual(['5', { num: '13700.00' }, { num: '2877.00' }]);
  });

  it('writes one ledger row per entry with the FX rate', () => {
    const ledger = sheetsOf(sheets, 'VAT ledger');
    expect(ledger).toHaveLength(3);
    const eurRow = ledger.find((row) => row[0] === 'a');
    expect(eurRow).toBeDefined();
    expect(eurRow).toContainEqual({ num: '24.580000' });
  });

  it('lists each failed check with its document', () => {
    const resolve = sheetsOf(sheets, 'Documents to resolve');
    expect(resolve).toHaveLength(2);
    expect(resolve[1]).toEqual(['S_IO_OUTPUT_VAT', 'needs_accountant', 'b', 'BK-77', 'count=1']);
  });

  it('lists each distinct rate once', () => {
    expect(sheetsOf(sheets, 'CNB rates')).toHaveLength(2);
  });

  it('builds a zip with four worksheet parts', () => {
    const bytes = buildVatWorkbook(input, new Date(0));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('xl/worksheets/sheet4.xml');
  });
});
