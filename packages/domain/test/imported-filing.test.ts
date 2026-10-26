import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { compareWithImported, parseImportedFilingFields } from '../src/vat/imported';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const d = parseLegalDate;
const rules = createCzRules();
const FIELDS = [
  { key: 'filing.form_code', value: 'DPHDP3' },
  { key: 'filing.period_start', value: '2026-08' },
  { key: 'filing.kind', value: 'radne' },
  { key: 'filing.filer_dic', value: 'CZ7801011229' },
  { key: 'filing.rows.5.base', value: '13 700' },
  { key: 'filing.rows.5.tax', value: '2877' },
  { key: 'filing.rows.62.tax', value: '2877' },
  { key: 'filing.rows.64.tax', value: '2877' },
];
const booking: VatLedgerEntryDraft = {
  periodStart: d('2026-08-01'),
  periodEnd: d('2026-08-31'),
  vatPointDate: d('2026-08-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId: 'b',
  vatTreatment: 'rcv_eu_service_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: Money.parse('13699.77', 'CZK'),
  vatCzk: Money.parse('2876.95', 'CZK'),
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: ['5'],
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: 'NL805734958B01',
  evidenceNumber: '1634188207',
};

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

describe('imported filing (M05 §9 #1)', () => {
  it('parses the P4 decoy fields', () => {
    expect(parseImportedFilingFields(FIELDS)).toEqual({
      formCode: 'DPHDP3',
      periodStart: '2026-08-01',
      kind: 'radne',
      filerDicDigits: '7801011229',
      rows: { '5': { base: 13700, tax: 2877 }, '62': { tax: 2877 }, '64': { tax: 2877 } },
    });
    expect(
      parseImportedFilingFields(FIELDS.filter((f) => f.key !== 'filing.period_start')),
    ).toBeNull();
    expect(
      parseImportedFilingFields([
        { key: 'filing.form_code', value: 'DPHDP3' },
        { key: 'filing.period_start', value: '2026-08-01' },
      ])?.kind,
    ).toBe('radne');
  });
  it('August computation matches the filed return; a different base does not', () => {
    const ours = computeDphdp3([booking], 'identifikovana_osoba', rules, d('2026-08-01'));
    const imported = must(parseImportedFilingFields(FIELDS));
    expect(compareWithImported(ours, imported)).toEqual({ matches: true });
    const off = { ...imported, rows: { ...imported.rows, '5': { base: 13701, tax: 2877 } } };
    expect(compareWithImported(ours, off)).toEqual({
      matches: false,
      differences: [{ row: '5', attr: 'base', filed: 13701, ours: 13700 }],
    });
    const extra = { ...imported, rows: { ...imported.rows, '12': { base: 100, tax: 21 } } };
    expect(compareWithImported(ours, extra)).toMatchObject({ matches: false });
  });
});
