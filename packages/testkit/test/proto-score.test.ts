import { parseProtoExtraction } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import {
  compareProtoDocument,
  type GoldenDoc,
  loadGoldenLabels,
  normalizeName,
  protoAccuracy,
  renderProtoAccuracy,
  renderProtoMismatches,
} from '../src/index';

// golden-v1 is anonymized (testdata/golden-v1/README.md); the values below are its synthetic labels.
const labels = loadGoldenLabels();

function doc(file: string): GoldenDoc {
  const found = labels.documents.find((candidate) => candidate.file === file);
  if (found === undefined) throw new Error(`no label for ${file}`);
  return found;
}

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: {
      name: 'Soukup Radek',
      ico: '20861176',
      dic: doc('Faktura_260807.pdf').partner?.dic ?? '',
      vat_id: '',
      country: 'CZ',
    },
    document: { number: '260807', variable_symbol: '260807' },
    dates: { issue_date: '2026-09-12', duzp: '2026-08-31', due_date: '2026-09-26' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21.0', base: '10711.44', vat: '2249.4' }],
    totals: { net: '10711.44', vat: '2249.40', gross: '12960.84' },
    payment: { account_number: '', bank_code: '', iban: '' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false },
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('drops diacritics, case and punctuation', () => {
    expect(normalizeName('Čistý Dům servis s.r.o.')).toBe('cisty dum servis s r o');
    expect(normalizeName('  Alza.cz a.s. ')).toBe('alza cz a s');
  });
});

describe('compareProtoDocument', () => {
  it('scores every labeled field of a domestic invoice, tolerant on name order and number format', () => {
    const results = compareProtoDocument(doc('Faktura_260807.pdf'), parseProtoExtraction(wire()));
    expect(results.map((result) => result.field)).toEqual([
      'class',
      'supplier_name',
      'supplier_ico',
      'supplier_dic',
      'document_number',
      'variable_symbol',
      'issue_date',
      'duzp',
      'due_date',
      'currency',
      'total_gross',
      'vat_lines',
      'not_tax_document',
    ]);
    const mismatches = results.filter((result) => !result.match);
    expect(mismatches.map((result) => result.field)).toEqual(['supplier_name']);
    expect(results.find((result) => result.field === 'vat_lines')).toEqual({
      field: 'vat_lines',
      expected: '21.00:10711.44:2249.40',
      actual: '21.00:10711.44:2249.40',
      match: true,
    });
  });

  it('matches a name that contains the label (or the reverse) and a null duzp to ""', () => {
    const got = parseProtoExtraction(
      wire({
        supplier: { name: 'Radek Soukup, DiS.', ico: '', dic: '', vat_id: '', country: '' },
        dates: { issue_date: '2026-09-12', duzp: '', due_date: '' },
      }),
    );
    const results = compareProtoDocument(doc('Faktura_260807.pdf'), got);
    const byField = new Map(results.map((result) => [result.field, result]));
    expect(byField.get('supplier_name')?.match).toBe(true);
    expect(byField.get('supplier_ico')).toMatchObject({
      expected: '20861176',
      actual: '',
      match: false,
    });
    expect(byField.get('duzp')).toMatchObject({ expected: '2026-08-31', actual: '', match: false });
    expect(byField.get('due_date')).toMatchObject({
      expected: '2026-09-26',
      actual: '',
      match: false,
    });
  });

  it('uses vat_id when the label has no DIČ and the flag for not_tax_document', () => {
    const anthropic = doc('Invoice-4D2A91C7-3518204.pdf');
    const got = parseProtoExtraction(
      wire({
        supplier: {
          name: 'Anthropic Ireland',
          ico: '',
          dic: '',
          vat_id: 'IE4276970QH',
          country: 'IE',
        },
        currency: 'EUR',
        vat_recap: [{ rate_pct: '0', base: '90.00', vat: '0.00' }],
        totals: { net: '90.00', vat: '0.00', gross: '90.00' },
      }),
    );
    const results = compareProtoDocument(anthropic, got);
    const byField = new Map(results.map((result) => [result.field, result]));
    expect(byField.get('supplier_dic')).toMatchObject({ expected: 'IE4276970QH', match: true });
    expect(byField.get('total_gross')).toMatchObject({
      expected: '90.00',
      actual: '90.00',
      match: true,
    });
    expect(byField.get('vat_lines')).toMatchObject({ expected: '0.00:90.00:0.00', match: true });
    expect(byField.get('not_tax_document')).toMatchObject({ expected: 'false', actual: 'false' });
    const alza = compareProtoDocument(
      doc('4021738955.pdf'),
      parseProtoExtraction(
        wire({
          flags: {
            not_tax_document_text: true,
            non_vat_payer_text: false,
            reverse_charge_text: false,
          },
        }),
      ),
    );
    expect(alza.find((result) => result.field === 'not_tax_document')).toMatchObject({
      expected: 'true',
      actual: 'true',
      match: true,
    });
  });

  it('scores only the labeled fields of a filing (class and issue date, no partner or totals)', () => {
    const results = compareProtoDocument(
      doc('DPHDP3-7801011229-20260920-141836.pdf'),
      parseProtoExtraction(wire({ kind_hint: 'government_filing' })),
    );
    expect(results.map((result) => result.field)).toEqual(['class', 'issue_date']);
    expect(results[0]).toEqual({
      field: 'class',
      expected: 'government_filing',
      actual: 'government_filing',
      match: true,
    });
  });
});

describe('protoAccuracy and rendering', () => {
  it('aggregates per field and renders a table and the mismatch lines', () => {
    const docs = [
      {
        file: 'a.pdf',
        fields: [
          {
            field: 'class' as const,
            expected: 'received_invoice',
            actual: 'received_invoice',
            match: true,
          },
          { field: 'duzp' as const, expected: '2026-08-31', actual: '', match: false },
        ],
      },
      {
        file: 'b.pdf',
        fields: [
          {
            field: 'class' as const,
            expected: 'received_receipt',
            actual: 'unknown',
            match: false,
          },
        ],
      },
    ];
    const rows = protoAccuracy(docs);
    expect(rows.find((row) => row.field === 'class')).toEqual({
      field: 'class',
      correct: 1,
      scored: 2,
      percent: 50,
    });
    expect(rows.find((row) => row.field === 'currency')).toEqual({
      field: 'currency',
      correct: 0,
      scored: 0,
      percent: null,
    });
    const table = renderProtoAccuracy(rows, 'Field | correct | scored | accuracy');
    expect(table.split('\n')[0]).toBe('Field | correct | scored | accuracy');
    expect(table).toContain('class                  1       2  50 %');
    expect(table).toContain('currency               0       0   n/a');
    expect(table.trimEnd().split('\n').at(-1)).toBe('total                  1       3  33 %');
    expect(renderProtoMismatches(docs)).toBe(
      'a.pdf: duzp expected=2026-08-31 actual=\nb.pdf: class expected=received_receipt actual=unknown\n',
    );
    expect(renderProtoMismatches([])).toBe('');
  });
});
