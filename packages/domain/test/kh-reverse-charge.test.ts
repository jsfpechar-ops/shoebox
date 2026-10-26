import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh, type KhDocumentInfo } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: d('2026-09-01'),
  periodEnd: d('2026-09-30'),
  vatPointDate: d('2026-09-03'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_domestic_reverse_charge',
  vatRateType: 'standard',
  vatRatePct: 21,
  baseCzk: czk(base),
  vatCzk: czk(vat),
  deductionPct: '100',
  currency: 'CZK',
  baseForeign: null,
  fxRate: null,
  fxAmount: null,
  fxRateDate: null,
  dphdp3Rows: rows,
  khSection: null,
  khDocumentTotalCzk: null,
  shvCode: null,
  counterpartyVatId: 'CZ27082440',
  evidenceNumber: documentId,
  ...o,
});
const DOCS: Record<string, KhDocumentInfo> = {
  'sub-1': { duzp: d('2026-09-10'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
  'sub-2': { duzp: d('2026-09-05'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
  'out-1': { duzp: d('2026-09-20'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
};
const lookup = (id: string) => DOCS[id];

// Accountant review 2026-10-26 V4: § 92a (stavební práce, code 4) in KH A.1 / B.1 and věta C.
const ENTRIES: VatLedgerEntryDraft[] = [
  // Subcontractor invoices received (rows 10 + 43), one at 80 % business share.
  e('sub-1', ['10', '43'], '100000.00', '21000.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('100000.00'),
    evidenceNumber: 'S-1',
  }),
  e('sub-2', ['10', '43'], '10000.00', '2100.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('10000.00'),
    evidenceNumber: 'S-2',
    deductionPct: '80',
  }),
  // Own invoice issued to a payer under § 92a (row 25, no tax).
  e('out-1', ['25'], '250000.00', '0.00', {
    vatTreatment: 'iss_domestic_reverse_charge',
    vatRateType: 'none',
    vatRatePct: 0,
    khSection: 'A1',
    khDocumentTotalCzk: czk('250000.00'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: 'F-9',
  }),
];

describe('computeKh § 92a sections', () => {
  const dp3 = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  const kh = computeKh(ENTRIES, dp3, lookup);
  it('B.1: one row per document sorted by duzp, dic without CZ, kod_pred_pl 4, proportional amounts', () => {
    expect(kh.b1.map((r) => [r.cRadku, r.cEvidDd, r.dicDod, String(r.duzp), r.kodPredPl])).toEqual([
      [1, 'S-2', '27082440', '2026-09-05', '4'],
      [2, 'S-1', '27082440', '2026-09-10', '4'],
    ]);
    expect(kh.b1[0]?.zaklDane1.toFixed2()).toBe('8000.00');
    expect(kh.b1[0]?.dan1.toFixed2()).toBe('1680.00');
    expect(kh.b1[1]?.zaklDane1.toFixed2()).toBe('100000.00');
    expect(kh.b1[1]?.dan1.toFixed2()).toBe('21000.00');
  });
  it('A.1: the issued document with its base only', () => {
    expect(kh.a1.map((r) => [r.cRadku, r.cEvidDd, r.dicOdb, String(r.duzp), r.kodPredPl])).toEqual([
      [1, 'F-9', '12345678', '2026-09-20', '4'],
    ]);
    expect(kh.a1[0]?.zaklDane1.toFixed2()).toBe('250000.00');
  });
  it('věta C: rez_pren23 = ř. 10 base 110 000, pln_rez_pren = ř. 25 base 250 000, rez_pren5 = 0', () => {
    expect(kh.c.rezPren23.toFixed2()).toBe('110000.00');
    expect(kh.c.rezPren5.toFixed2()).toBe('0.00');
    expect(kh.c.plnRezPren.toFixed2()).toBe('250000.00');
  });
  it('the return: ř. 62 = 23 100, ř. 43 = 108 000 / 22 680, ř. 25 = 250 000', () => {
    expect(dp3.row62.toFixed2()).toBe('23100.00');
    expect(dp3.rows['43']?.base.toFixed2()).toBe('108000.00');
    expect(dp3.rows['43']?.tax.toFixed2()).toBe('22680.00');
    expect(dp3.rows['25']?.base.toFixed2()).toBe('250000.00');
  });
  it('a § 92a document without a code throws (the classifier must have refused it)', () => {
    const noCode = (id: string): KhDocumentInfo | undefined =>
      id === 'sub-1' ? { duzp: d('2026-09-10'), partnerCountry: 'CZ', rcCommodityCodes: [] } : DOCS[id];
    expect(() => computeKh(ENTRIES, dp3, noCode)).toThrow(/kod_pred_pl/);
  });
});
