import {
  buildEpoHeader,
  computeDphdp3,
  computeKh,
  createCzRules,
  type EpoTaxpayerProfile,
  type KhDocumentInfo,
  Money,
  parseLegalDate,
  type VatLedgerEntryDraft,
} from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { serializeKh, validateXml } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const START = d('2026-09-01');
const PROFILE: EpoTaxpayerProfile = {
  vatStatus: 'platce',
  dic: 'CZ7801011229',
  firstName: 'Jan',
  lastName: 'Novák',
  title: null,
  address: {
    street: 'Vinohradská',
    house_number: '1',
    orientation_number: null,
    city: 'Praha',
    zip: '130 00',
  },
  fuCode: '451',
  ufoCode: '2003',
  mainActivityNace: '5520',
  filingEmail: 'jan@example.com',
  filingPhone: null,
};
function header() {
  const r = buildEpoHeader(PROFILE, {
    form: 'DPHKH1',
    kind: 'radne',
    period: { start: START, end: d('2026-09-30'), kind: 'month' },
    preparedOn: d('2026-10-20'),
    appVersion: '0.0.0',
  });
  if (!r.ok) throw new Error('header');
  return r.header;
}
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: START,
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
  'out-1': { duzp: d('2026-09-20'), partnerCountry: 'CZ', rcCommodityCodes: ['4'] },
};
const ENTRIES: VatLedgerEntryDraft[] = [
  e('sub-1', ['10', '43'], '100000.00', '21000.00', {
    khSection: 'B1',
    khDocumentTotalCzk: czk('100000.00'),
    evidenceNumber: 'S-1',
  }),
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

describe('serializeKh § 92a', () => {
  it('writes VetaA1, VetaB1 and the věta C reverse-charge attributes; validates against DPHKH1 03.01.15', async () => {
    const kh = computeKh(ENTRIES, computeDphdp3(ENTRIES, 'platce', rules, START), (id) => DOCS[id]);
    const xml = serializeKh(kh, header(), { verzePis: '03.01' });
    expect(xml).toContain(
      '<VetaA1 c_radku="1" dic_odb="12345678" c_evid_dd="F-9" duzp="20.09.2026" zakl_dane1="250000.00" kod_pred_pl="4"',
    );
    expect(xml).toContain(
      '<VetaB1 c_radku="1" dic_dod="27082440" c_evid_dd="S-1" duzp="10.09.2026" zakl_dane1="100000.00" dan1="21000.00" kod_pred_pl="4"',
    );
    expect(xml).toMatch(/<VetaC [^>]*pln_rez_pren="250000.00"/);
    expect(xml).toMatch(/<VetaC [^>]*rez_pren23="100000.00"/);
    expect(xml).not.toContain('rez_pren5=');
    expect(xml.indexOf('<VetaA1')).toBeLessThan(xml.indexOf('<VetaB1'));
    expect(xml.indexOf('<VetaB1')).toBeLessThan(xml.indexOf('<VetaC'));
    const v = await validateXml(xml, 'DPHKH1', '03.01.15');
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });
});
