import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';
import { buildPeriodPreview } from '../src/vat/preview';
import { computeShv } from '../src/vat/shv';

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
  periodStart: d('2026-10-01'),
  periodEnd: d('2026-10-31'),
  vatPointDate: d('2026-10-15'),
  vatPointRule: 'issue_date',
  lineId: null,
  documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge',
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
  counterpartyVatId: null,
  evidenceNumber: documentId,
  ...o,
});
const OCT = [
  e('anthropic', ['5'], '2212.20', '464.56', {
    currency: 'EUR',
    baseForeign: Money.parse('90.00', 'EUR'),
    fxRate: '24.580000',
    fxAmount: 1,
    fxRateDate: d('2026-10-15'),
    counterpartyVatId: 'IE3797893MH',
    evidenceNumber: 'INV-90',
  }),
  e('cloudflare', ['12'], '245.35', '51.52', {
    vatTreatment: 'rcv_non_eu_service_reverse_charge',
    currency: 'USD',
    baseForeign: Money.parse('10.46', 'USD'),
    fxRate: '23.456000',
    fxAmount: 1,
    fxRateDate: d('2026-10-02'),
    vatPointDate: d('2026-10-03'),
  }),
];
const META = new Map([
  ['anthropic', { partnerName: 'Anthropic Ireland, Limited', documentNumber: 'INV-90' }],
  ['cloudflare', { partnerName: 'Cloudflare, Inc.', documentNumber: null }],
]);

describe('buildPeriodPreview (M05 §4.9, §9 #2/#3)', () => {
  it('DPHDP3 rows carry raw → rounded and their entries with FX data', () => {
    const dp3 = computeDphdp3(OCT, 'identifikovana_osoba', rules, d('2026-10-01'));
    const p = buildPeriodPreview('DPHDP3', OCT, META, dp3, null, null);
    expect(p.rows.map((r) => r.row)).toEqual(['5', '12']);
    expect(p.rows[0]).toMatchObject({
      labelKey: 'vat.row.5.label',
      raw: { base: '2212.20', tax: '464.56' },
      rounded: { base: '2212.00', tax: '465.00' },
    });
    expect(p.rows[0]?.entries).toEqual([
      {
        documentId: 'anthropic',
        partnerName: 'Anthropic Ireland, Limited',
        documentNumber: 'INV-90',
        vatPointDate: '2026-10-15',
        currency: 'EUR',
        amountForeign: '90.00',
        fxRate: '24.580000',
        fxRateDate: '2026-10-15',
        baseCzk: '2212.20',
        vatCzk: '464.56',
      },
    ]);
    expect(p.rows[1]?.entries[0]).toMatchObject({
      partnerName: 'Cloudflare, Inc.',
      documentNumber: null,
      currency: 'USD',
      amountForeign: '10.46',
    });
    expect(p.result).toEqual({ row62: '517.00', row63: '0.00', row64: '517.00', row65: '0.00' });
    expect(p.khSections).toBeNull();
  });
  it('payer: derived rows have no raw; KH sections and SH groups list entries', () => {
    const sep = [
      e('inv-a', ['1'], '10000.00', '2100.00', {
        vatTreatment: 'iss_domestic_vat',
        khSection: 'A4',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: '2026-0001',
      }),
      e('booking', ['5', '43'], '11549.94', '2425.49', {
        khSection: 'A2',
        counterpartyVatId: 'NL805734958B01',
      }),
      e('s1', ['21'], '1000.10', '0.00', {
        vatTreatment: 'iss_eu_service',
        shvCode: 3,
        counterpartyVatId: 'DE123456789',
      }),
    ];
    const dp3 = computeDphdp3(sep, 'platce', rules, d('2026-10-01'));
    const kh = computeKh(sep, dp3, () => undefined);
    const p = buildPeriodPreview(
      'DPHKH1',
      sep,
      new Map(),
      dp3,
      kh,
      computeShv(sep, rules, d('2026-10-01')),
    );
    expect(p.rows.find((r) => r.row === '43')).toMatchObject({
      raw: null,
      rounded: { base: '11550.00', tax: '2425.00' },
      entries: [],
    });
    expect(p.khSections?.map((s) => [s.section, s.rows.length])).toEqual([
      ['A2', 1],
      ['A4', 1],
    ]);
    expect(p.khSections?.[1]?.rows[0]).toMatchObject({
      counterparty: '12345678',
      evidenceNumber: '2026-0001',
      zaklDane1: '10000.00',
      dan1: '2100.00',
    });
    expect(p.shvRows).toEqual([
      expect.objectContaining({
        kStat: 'DE',
        cVat: '123456789',
        code: 3,
        labelKey: 'vat.shv.code.3',
        plnHodnota: '1001.00',
        plnPocet: 1,
      }),
    ]);
  });
});
