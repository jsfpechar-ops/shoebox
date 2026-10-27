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
  vatTreatment: 'rcv_domestic_vat',
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
  mac: { duzp: d('2026-09-03'), partnerCountry: 'CZ', rcCommodityCodes: [] },
  full: { duzp: d('2026-09-04'), partnerCountry: 'CZ', rcCommodityCodes: [] },
  pen: { duzp: d('2026-09-05'), partnerCountry: 'CZ', rcCommodityCodes: [] },
};
const lookup = (id: string) => DOCS[id];

// Accountant review 2026-10-26 V1: B.2/B.3 carry the amounts claimed (§ 75), pomer = A. [verify]
const ENTRIES: VatLedgerEntryDraft[] = [
  e('mac', ['40'], '22305.79', '4684.21', {
    deductionPct: '80',
    khSection: 'B2',
    khDocumentTotalCzk: czk('26990.00'),
  }),
  e('full', ['40'], '1000.00', '210.00', { khSection: 'B2', khDocumentTotalCzk: czk('1210.00') }),
  e('pen', ['40'], '100.00', '21.00', {
    deductionPct: '50',
    khSection: 'B3',
    khDocumentTotalCzk: czk('121.00'),
  }),
];

describe('computeKh with a proportional deduction (§ 75)', () => {
  const dp3 = computeDphdp3(ENTRIES, 'platce', rules, d('2026-09-01'));
  const kh = computeKh(ENTRIES, dp3, lookup);
  it('B.2: the 80 % document carries 17 844,63 / 3 747,37 with pomer A; the full one 1 000 / 210 with N', () => {
    const mac = kh.b2.find((r) => r.documentId === 'mac');
    const full = kh.b2.find((r) => r.documentId === 'full');
    expect(mac?.zaklDane1.toFixed2()).toBe('17844.63');
    expect(mac?.dan1.toFixed2()).toBe('3747.37');
    expect(mac?.pomer).toBe('A');
    expect(full?.zaklDane1.toFixed2()).toBe('1000.00');
    expect(full?.dan1.toFixed2()).toBe('210.00');
    expect(full?.pomer).toBe('N');
  });
  it('B.3 aggregate carries the 50 % part: 50,00 / 10,50', () => {
    expect(kh.b3?.zaklDane1.toFixed2()).toBe('50.00');
    expect(kh.b3?.dan1.toFixed2()).toBe('10.50');
  });
  it('věta C pln23 equals ř. 40 of the return: round0(17 844,63 + 1 000 + 50) = 18 895', () => {
    expect(kh.c.pln23.toFixed2()).toBe('18895.00');
    expect(dp3.rows['40']?.base.toFixed2()).toBe('18895.00');
  });
});
