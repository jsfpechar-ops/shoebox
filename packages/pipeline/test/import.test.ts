import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  findHeaderRow,
  headerSignature,
  parseImportRow,
  readSpreadsheet,
  suggestMapping,
} from '../src/index';

// Synthetic values only (hard rule 4).
const CP1250: Record<string, number> = { Č: 0xc8, í: 0xed, á: 0xe1, ř: 0xf8, ě: 0xec };
function cp1250(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => CP1250[c] ?? c.charCodeAt(0)));
}

const CSV = [
  'Moje evidence 2025;;;;;;',
  'Datum;Dodavatel;IČO;Číslo faktury;Částka;DPH;Zaplaceno',
  '1. 3. 2025;Testovací s.r.o.;25596641;2025-0001;1 210,00 Kč;210,00;ano',
  '02.03.2025;Jiná firma;00006947;2025-0002;117,00;;ne',
  ';;;;;;',
  ';Bez data;;X;50;;',
].join('\r\n');

describe('readSpreadsheet', () => {
  it('reads a windows-1250 CSV with ; delimiter', async () => {
    const r = await readSpreadsheet(cp1250(CSV), 'evidence-2025.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[1]).toEqual([
      'Datum',
      'Dodavatel',
      'IČO',
      'Číslo faktury',
      'Částka',
      'DPH',
      'Zaplaceno',
    ]);
    expect(findHeaderRow(r.rows)).toBe(1);
  });

  it('reads UTF-8 with a BOM and quoted commas', async () => {
    const text = '﻿Datum,Firma,Částka\n2025-03-01,"Firma, s.r.o.","1 234,50"\n';
    const r = await readSpreadsheet(new TextEncoder().encode(text), 'a.csv');
    expect(r.ok && r.rows[1]).toEqual(['2025-03-01', 'Firma, s.r.o.', '1 234,50']);
  });

  it('reads the first sheet of an XLSX, dates as ISO', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Doklady');
    ws.addRow(['Datum', 'Dodavatel', 'Celkem']);
    ws.addRow([new Date(Date.UTC(2025, 2, 1)), 'Testovací s.r.o.', 1210.5]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await readSpreadsheet(bytes, 'a.xlsx');
    expect(r.ok && r.rows).toEqual([
      ['Datum', 'Dodavatel', 'Celkem'],
      ['2025-03-01', 'Testovací s.r.o.', '1210.5'],
    ]);
  });

  it('refuses .xls and oversized files', async () => {
    expect(await readSpreadsheet(new Uint8Array([0xd0, 0xcf]), 'old.xls')).toEqual({
      ok: false,
      reason: 'xls_unsupported',
    });
    expect(await readSpreadsheet(new Uint8Array(5 * 1024 * 1024 + 1), 'big.csv')).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });
});

describe('suggestMapping', () => {
  const headers = ['Datum', 'Dodavatel', 'IČO', 'Číslo faktury', 'Částka', 'DPH', 'Zaplaceno'];
  it('maps all 7 columns from the headers', () => {
    expect(suggestMapping(headers, [])).toEqual({
      issue_date: 0,
      partner_name: 1,
      partner_ico: 2,
      document_number: 3,
      total_gross: 4,
      total_vat: 5,
      paid: 6,
    });
  });
  it('sniffs an unnamed date column and an IČO column', () => {
    const m = suggestMapping(
      ['Kdy', 'Komu', 'Id', 'Celkem'],
      [
        ['1.3.2025', 'A', '25596641', '10'],
        ['2.3.2025', 'B', '00006947', '20'],
      ],
    );
    expect(m).toEqual({ issue_date: 0, partner_ico: 2, total_gross: 3 });
  });
  it('signature ignores case and diacritics', () => {
    expect(headerSignature(['Částka', 'DPH'])).toBe(headerSignature(['castka', 'dph']));
    expect(headerSignature(['Částka', 'DPH'])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseImportRow', () => {
  const m = {
    issue_date: 0,
    partner_name: 1,
    partner_ico: 2,
    document_number: 3,
    total_gross: 4,
    total_vat: 5,
    paid: 6,
  };
  it('parses a full row', () => {
    expect(
      parseImportRow(
        ['1. 3. 2025', 'Testovací s.r.o.', '25596641', '2025-0001', '1 210,00 Kč', '210,00', 'ano'],
        m,
      ),
    ).toEqual({
      ok: true,
      value: {
        issue_date: '2025-03-01',
        total_gross: '1210.00',
        currency: 'CZK',
        partner_name: 'Testovací s.r.o.',
        partner_ico: '25596641',
        document_number: '2025-0001',
        total_vat: '210.00',
        total_net: null,
        variable_symbol: null,
        due_date: null,
        description: null,
        paid: true,
        paid_on: null,
      },
    });
  });
  it.each([
    ['1.234,50', '1234.50'],
    ['1234.5', '1234.50'],
    ['1234,5', '1234.50'],
    ['1.234', '1234.00'],
    ['-99,90', '-99.90'],
    ['12,50 €', '12.50'],
  ])('amount %s → %s', (raw, out) => {
    const r = parseImportRow(['2025-03-01', '', '', '', raw, '', ''], m);
    expect(r?.ok && r.value.total_gross).toBe(out);
  });
  it('reads EUR from the amount and dates from Excel serials and paid dates', () => {
    const r = parseImportRow(['45717', '', '', '', '12,50 €', '', '15.03.2025'], m);
    expect(r?.ok && r.value).toMatchObject({
      issue_date: '2025-03-01',
      currency: 'EUR',
      paid: true,
      paid_on: '2025-03-15',
    });
  });
  it('skips rows with a reason and ignores empty rows', () => {
    expect(parseImportRow(['', 'Bez data', '', 'X', '50', '', ''], m)).toEqual({
      ok: false,
      reason: 'missing_issue_date',
    });
    expect(parseImportRow(['2025-03-01', 'A', '', '', '', '', ''], m)).toEqual({
      ok: false,
      reason: 'missing_total',
    });
    expect(parseImportRow(['2025-03-01', 'A', '', '', 'abc', '', ''], m)).toEqual({
      ok: false,
      reason: 'bad_amount',
    });
    expect(parseImportRow(['31.02.2025', 'A', '', '', '10', '', ''], m)).toEqual({
      ok: false,
      reason: 'bad_date',
    });
    expect(parseImportRow(['', '', '', '', '', '', ''], m)).toBeNull();
  });
});
