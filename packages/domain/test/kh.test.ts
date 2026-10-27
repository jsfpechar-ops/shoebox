import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3 } from '../src/vat/dphdp3';
import { computeKh, type KhDocumentInfo, vatIdParts } from '../src/vat/kh';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';
import { computeShv } from '../src/vat/shv';

const must = <T>(v: T | null | undefined): T => {
  if (v === null || v === undefined) throw new Error('missing value');
  return v;
};

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const f2 = (m: Money) => m.toFixed2();
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
const SEP: VatLedgerEntryDraft[] = [
  e('inv-a', ['1'], '10000.00', '2100.00', {
    vatTreatment: 'iss_domestic_vat',
    khSection: 'A4',
    khDocumentTotalCzk: czk('12100.00'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: '2026-0001',
    vatPointDate: d('2026-09-10'),
  }),
  e('inv-b', ['1'], '8264.46', '1735.54', {
    vatTreatment: 'iss_domestic_vat',
    khSection: 'A5',
    khDocumentTotalCzk: czk('10000.00'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: '2026-0002',
    vatPointDate: d('2026-09-11'),
  }),
  e('inv-c', ['1'], '8264.47', '1735.54', {
    vatTreatment: 'iss_domestic_vat',
    khSection: 'A4',
    khDocumentTotalCzk: czk('10000.01'),
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: '2026-0003',
    vatPointDate: d('2026-09-12'),
  }),
  e('booking-aug', ['5', '43'], '11549.94', '2425.49', {
    khSection: 'A2',
    counterpartyVatId: 'NL805734958B01',
    evidenceNumber: '1637922054',
  }),
  e('manager', ['40'], '10711.44', '2249.40', {
    vatTreatment: 'rcv_domestic_vat',
    khSection: 'B2',
    khDocumentTotalCzk: czk('12960.84'),
    counterpartyVatId: 'CZ87654321',
    evidenceNumber: '2026090001',
    vatPointDate: d('2026-09-02'),
  }),
  e('ikea', ['40'], '990.08', '207.92', {
    vatTreatment: 'rcv_domestic_vat',
    khSection: 'B3',
    khDocumentTotalCzk: czk('1198.00'),
    counterpartyVatId: null,
    evidenceNumber: 'R-0757',
  }),
  e('credit', ['40'], '-9917.36', '-2082.64', {
    vatTreatment: 'rcv_domestic_vat',
    khSection: 'B2',
    khDocumentTotalCzk: czk('-12000.00'),
    counterpartyVatId: 'CZ87654321',
    evidenceNumber: 'DOB-7',
    vatPointDate: d('2026-09-15'),
  }),
];
const DOCS: Record<string, KhDocumentInfo> = {
  manager: { duzp: d('2026-09-02'), partnerCountry: 'CZ', rcCommodityCodes: [] },
  credit: { duzp: d('2026-09-15'), partnerCountry: 'CZ', rcCommodityCodes: [] },
  'booking-aug': { duzp: null, partnerCountry: 'NL', rcCommodityCodes: [] },
};
const lookup = (id: string) => DOCS[id];
const dp3 = computeDphdp3(SEP, 'platce', rules, d('2026-09-01'));

describe('computeKh (M05 §4.5, §9 #8)', () => {
  const kh = computeKh(SEP, dp3, lookup);
  it('A4 boundary: 10 000,00 → A5 aggregate, 10 000,01 → A4; rows sorted by dppd with c_radku', () => {
    expect(
      kh.a4.map((r) => [
        r.cRadku,
        r.dicOdb,
        r.cEvidDd,
        r.dppd,
        f2(r.zaklDane1),
        f2(r.dan1),
        r.kodRezimPl,
        r.zdph44,
      ]),
    ).toEqual([
      [1, '12345678', '2026-0001', '2026-09-10', '10000.00', '2100.00', '0', 'N'],
      [2, '12345678', '2026-0003', '2026-09-12', '8264.47', '1735.54', '0', 'N'],
    ]);
    expect(kh.a5).toMatchObject({ documentIds: ['inv-b'] });
    const a5 = must(kh.a5);
    expect([f2(a5.zaklDane1), f2(a5.dan1), f2(a5.zaklDane2), f2(a5.dan2)]).toEqual([
      '8264.46',
      '1735.54',
      '0.00',
      '0.00',
    ]);
  });
  it('A2 from the EU supplier with k_stat/vatid split and dppd = vat point date', () => {
    expect(
      kh.a2.map((r) => ({
        ...r,
        zaklDane1: f2(r.zaklDane1),
        dan1: f2(r.dan1),
        zaklDane2: f2(r.zaklDane2),
        dan2: f2(r.dan2),
      })),
    ).toEqual([
      {
        cRadku: 1,
        kStat: 'NL',
        vatidDod: '805734958B01',
        cEvidDd: '1637922054',
        dppd: '2026-09-03',
        zaklDane1: '11549.94',
        dan1: '2425.49',
        zaklDane2: '0.00',
        dan2: '0.00',
        documentId: 'booking-aug',
      },
    ]);
  });
  it('B2 credit note −12 000 is negative; B3 aggregate; dppd = duzp', () => {
    expect(
      kh.b2.map((r) => [
        r.cRadku,
        r.dicDod,
        r.cEvidDd,
        r.dppd,
        f2(r.zaklDane1),
        f2(r.dan1),
        r.pomer,
        r.zdph44,
      ]),
    ).toEqual([
      [1, '87654321', '2026090001', '2026-09-02', '10711.44', '2249.40', 'N', 'N'],
      [2, '87654321', 'DOB-7', '2026-09-15', '-9917.36', '-2082.64', 'N', 'N'],
    ]);
    const b3 = must(kh.b3);
    expect([f2(b3.zaklDane1), f2(b3.dan1)]).toEqual(['990.08', '207.92']);
    expect(kh.entryCount).toBe(7);
  });
  it('Věta C mirrors the DPHDP3 (P1)', () => {
    expect(Object.fromEntries(Object.entries(kh.c).map(([k, m]) => [k, f2(m)]))).toEqual({
      obrat23: '26529.00',
      obrat5: '0.00',
      pln23: '1784.00',
      pln5: '0.00',
      plnRezPren: '0.00',
      rezPren23: '0.00',
      rezPren5: '0.00',
      celkZdA2: '11550.00',
    });
  });
  it('two rates of one document land in one row (buckets 1 and 2); permutation gives identical output (P7)', () => {
    const two = [
      e('x', ['1'], '100.00', '21.00', {
        vatTreatment: 'iss_domestic_vat',
        khSection: 'A4',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: 'X-1',
      }),
      e('x', ['2'], '50.00', '6.00', {
        vatTreatment: 'iss_domestic_vat',
        vatRateType: 'reduced',
        vatRatePct: 12,
        khSection: 'A4',
        counterpartyVatId: 'CZ12345678',
        evidenceNumber: 'X-1',
      }),
    ];
    const a = computeKh(two, computeDphdp3(two, 'platce', rules, d('2026-09-01')), lookup);
    const b = computeKh(
      [...two].reverse(),
      computeDphdp3([...two].reverse(), 'platce', rules, d('2026-09-01')),
      lookup,
    );
    expect(a.a4).toHaveLength(1);
    const a4first = must(a.a4[0]);
    expect([
      f2(a4first.zaklDane1),
      f2(a4first.dan1),
      f2(a4first.zaklDane2),
      f2(a4first.dan2),
    ]).toEqual(['100.00', '21.00', '50.00', '6.00']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('empty sections are null/empty; vatIdParts', () => {
    const none = computeKh([], computeDphdp3([], 'platce', rules, d('2026-09-01')), lookup);
    expect([none.a2, none.a4, none.a5, none.b2, none.b3]).toEqual([[], [], null, [], null]);
    expect(vatIdParts('EL123456789')).toEqual({ kStat: 'EL', number: '123456789' });
    expect(vatIdParts(null)).toBeNull();
  });
});

describe('computeShv', () => {
  it('groups by country, VAT ID and code; Σ 1 000,10 + 2 000,20 = 3 000,30 → ceil 3 001; pln_pocet 2', () => {
    const sh = computeShv(
      [
        e('s1', ['21'], '1000.10', '0.00', {
          vatTreatment: 'iss_eu_service',
          shvCode: 3,
          counterpartyVatId: 'DE123456789',
          vatPointDate: d('2026-09-05'),
        }),
        e('s2', ['21'], '2000.20', '0.00', {
          vatTreatment: 'iss_eu_service',
          shvCode: 3,
          counterpartyVatId: 'DE123456789',
          vatPointDate: d('2026-09-20'),
        }),
        e('g1', ['20'], '500.00', '0.00', {
          vatTreatment: 'iss_eu_goods',
          shvCode: 0,
          counterpartyVatId: 'AT U12345678',
          vatPointDate: d('2026-09-21'),
        }),
        e('old', ['21'], '999.00', '0.00', {
          vatTreatment: 'iss_eu_service',
          shvCode: 3,
          counterpartyVatId: 'DE123456789',
          vatPointDate: d('2026-08-31'),
        }),
      ],
      rules,
      d('2026-09-01'),
    );
    expect(
      sh.rows.map((r) => [
        r.cRad,
        r.kStat,
        r.cVat,
        r.kPlnEu,
        f2(r.plnHodnota),
        r.plnPocet,
        r.porCStran,
      ]),
    ).toEqual([
      [1, 'AT', 'U12345678', 0, '500.00', 1, 1],
      [2, 'DE', '123456789', 3, '3001.00', 2, 1],
    ]);
    expect(f2(sh.total)).toBe('3501.00');
    expect(must(sh.rows[1]).documentIds).toEqual(['s1', 's2']);
  });
  it('no SH entries → no rows', () => {
    expect(computeShv([e('x', ['1'], '1.00', '0.21')], rules, d('2026-09-01')).rows).toEqual([]);
  });
});
