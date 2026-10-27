import { describe, expect, it } from 'vitest';
import {
  applyRegisterFilter,
  parseRegisterFilter,
  type RegisterRow,
  registerFileName,
  registerRowOf,
  registerSheet,
} from '../src/documents/register-data';

const raw = {
  id: '33333333-3333-4333-8333-333333333333',
  status: 'ready',
  class: 'received_invoice',
  entry_mode: 'captured',
  source_file_id: '44444444-4444-4444-8444-444444444444',
  partner_snapshot: { name: 'Úklid Praha s.r.o.', ico: '27082440', dic: 'CZ27082440' },
  document_number: '2026-0412',
  variable_symbol: '20260412',
  issue_date: '2026-09-30',
  duzp: '2026-09-30',
  due_date: '2026-10-14',
  currency: 'CZK',
  total_net: '6735.54',
  total_vat: '1414.46',
  total_gross: '8150.00',
  is_paid_per_document: null,
  paid_at: null,
  created_at: '2026-10-01T08:00:00Z',
};

const row = registerRowOf(raw) as RegisterRow;
const manual = registerRowOf({
  ...raw,
  id: '55555555-5555-4555-8555-555555555555',
  entry_mode: 'manual',
  source_file_id: null,
  partner_snapshot: { name: 'Parkoviště' },
  document_number: null,
  variable_symbol: null,
  issue_date: '2025-12-09',
  duzp: null,
  total_net: null,
  total_vat: null,
  total_gross: '350.00',
  is_paid_per_document: true,
}) as RegisterRow;

describe('registerRowOf', () => {
  it('maps a read invoice', () => {
    expect(row).toMatchObject({
      date: '2026-09-30',
      partner: 'Úklid Praha s.r.o.',
      ico: '27082440',
      number: '2026-0412',
      gross: '8150.00',
      paid: 'unpaid',
      hasFile: true,
      manual: false,
    });
  });
  it('a manual cash receipt is paid and has no file', () => {
    expect(manual).toMatchObject({ paid: 'paid', hasFile: false, manual: true, ico: null });
  });
  it('falls back to the date of supply, and rejects a row without id', () => {
    expect(registerRowOf({ ...raw, issue_date: null })?.date).toBe('2026-09-30');
    expect(registerRowOf({ ...raw, id: null })).toBeNull();
  });
  it('a document without an amount has paid none', () => {
    expect(registerRowOf({ ...raw, total_gross: null })?.paid).toBe('none');
  });
});

describe('parseRegisterFilter', () => {
  it('reads year, paid and search text, and ignores junk', () => {
    expect(parseRegisterFilter(new URLSearchParams('year=2026&paid=unpaid&q=%20alza%20'))).toEqual({
      year: 2026,
      paid: 'unpaid',
      q: 'alza',
    });
    expect(parseRegisterFilter(new URLSearchParams('year=26&paid=x'))).toEqual({
      year: null,
      paid: 'all',
      q: '',
    });
  });
});

describe('applyRegisterFilter', () => {
  const rows = [row, manual];
  it('filters by year', () => {
    expect(applyRegisterFilter(rows, { year: 2025, paid: 'all', q: '' })).toEqual([manual]);
  });
  it('filters by paid', () => {
    expect(applyRegisterFilter(rows, { year: null, paid: 'unpaid', q: '' })).toEqual([row]);
  });
  it('searches partner, number, VS and IČO, ignoring case', () => {
    for (const q of ['úklid', '0412', '20260412', '27082440'])
      expect(applyRegisterFilter(rows, { year: null, paid: 'all', q }), q).toEqual([row]);
  });
});

describe('registerSheet', () => {
  it('has a header and one row per document, money as numbers', () => {
    const sheet = registerSheet([row, manual], '2026-10-10');
    expect(sheet).toHaveLength(3);
    expect(sheet[0]?.[0]).toBe('Date');
    expect(sheet[0]).toHaveLength(14);
    expect(sheet[1]?.[6]).toEqual({ num: '8150.00' });
    expect(sheet[1]?.[12]).toBe('Not paid yet');
    expect(registerSheet([row], '2026-10-27')[1]?.[12]).toBe('Unknown');
    expect(sheet[2]?.[7]).toBeNull();
    expect(sheet[2]?.[13]).toBe('Typed in');
  });
});

describe('registerFileName', () => {
  it('names the file by year', () => {
    expect(registerFileName({ year: 2026, paid: 'all', q: '' })).toBe('sysel-documents-2026.xlsx');
    expect(registerFileName({ year: null, paid: 'all', q: '' })).toBe('sysel-documents.xlsx');
  });
});
