import { readFileSync } from 'node:fs';
import {
  buildEpoHeader,
  computeDphdp3,
  computeKh,
  computeShv,
  createCzRules,
  type EpoTaxpayerProfile,
  Money,
  parseLegalDate,
  type VatLedgerEntryDraft,
  vatForRate,
} from '@shoebox/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serializeKh, serializeShv, validateXml } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const START = d('2026-09-01');
const golden = (name: string) =>
  readFileSync(
    new URL(`../../../testdata/golden-v1/expected/vat/${name}`, import.meta.url),
    'utf8',
  );
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
function header(form: 'DPHKH1' | 'DPHSHV', kind: 'radne' | 'nasledne' = 'radne') {
  const r = buildEpoHeader(PROFILE, {
    form,
    kind,
    period: { start: START, end: d('2026-09-30'), kind: 'month' },
    preparedOn: d('2026-10-20'),
    ...(kind === 'nasledne' ? { discoveredOn: d('2026-11-02') } : {}),
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
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: '2026-0001',
    vatPointDate: d('2026-09-10'),
  }),
  e('inv-b', ['1'], '8264.46', '1735.54', {
    vatTreatment: 'iss_domestic_vat',
    khSection: 'A5',
    counterpartyVatId: 'CZ12345678',
    evidenceNumber: '2026-0002',
    vatPointDate: d('2026-09-11'),
  }),
  e('inv-c', ['1'], '8264.47', '1735.54', {
    vatTreatment: 'iss_domestic_vat',
    khSection: 'A4',
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
    counterpartyVatId: 'CZ87654321',
    evidenceNumber: '2026090001',
    vatPointDate: d('2026-09-02'),
  }),
  e('ikea', ['40'], '990.08', '207.92', {
    vatTreatment: 'rcv_domestic_vat',
    khSection: 'B3',
    evidenceNumber: 'R-0757',
  }),
  e('credit', ['40'], '-9917.36', '-2082.64', {
    vatTreatment: 'rcv_domestic_vat',
    khSection: 'B2',
    counterpartyVatId: 'CZ87654321',
    evidenceNumber: 'DOB-7',
    vatPointDate: d('2026-09-15'),
  }),
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
    counterpartyVatId: 'ATU12345678',
    vatPointDate: d('2026-09-21'),
  }),
];
const lookup = (id: string) =>
  ({
    manager: { duzp: d('2026-09-02'), partnerCountry: 'CZ' },
    credit: { duzp: d('2026-09-15'), partnerCountry: 'CZ' },
  })[id];

describe('serializeKh / serializeShv golden', () => {
  it('DPHKH1 byte-matches and validates', async () => {
    const xml = serializeKh(
      computeKh(SEP, computeDphdp3(SEP, 'platce', rules, START), lookup),
      header('DPHKH1'),
      { verzePis: '03.01' },
    );
    expect(xml).toBe(golden('dphkh1-payer-2026-09.xml'));
    const v = await validateXml(xml, 'DPHKH1', '03.01.15');
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });
  it('DPHSHV byte-matches and validates', async () => {
    const xml = serializeShv(computeShv(SEP, rules, START), header('DPHSHV'), {
      verzePis: '02.01',
    });
    expect(xml).toBe(golden('dphshv-payer-2026-09.xml'));
    expect((await validateXml(xml, 'DPHSHV', '02.01.05')).valid).toBe(true);
  });
  it('následné KH writes N and d_zjist; empty KH has VetaD/VetaP only', () => {
    const xml = serializeKh(
      computeKh(SEP, computeDphdp3(SEP, 'platce', rules, START), lookup),
      header('DPHKH1', 'nasledne'),
      { verzePis: '03.01' },
    );
    expect(xml).toContain(
      'khdph_forma="N" rok="2026" mesic="9" d_poddp="20.10.2026" d_zjist="02.11.2026"',
    );
    const empty = serializeKh(
      computeKh([], computeDphdp3([], 'platce', rules, START), lookup),
      header('DPHKH1'),
      { verzePis: '03.01' },
    );
    expect(empty.match(/<Veta/g)).toHaveLength(2);
  });
});

describe('P9: every generated payer period is structurally valid (200 runs)', () => {
  type Kind = 'iss_domestic' | 'rcv_domestic' | 'eu_service' | 'eu_goods_out' | 'eu_service_out';
  const docArb = (idx: number) =>
    fc.record({
      kind: fc.constantFrom<Kind>(
        'iss_domestic',
        'rcv_domestic',
        'eu_service',
        'eu_goods_out',
        'eu_service_out',
      ),
      rate: fc.constantFrom<'standard' | 'reduced'>('standard', 'reduced'),
      cents: fc.integer({ min: 1, max: 1_500_000 }),
      sign: fc.constantFrom<1 | -1>(1, 1, 1, -1),
      big: fc.boolean(),
      idx: fc.constant(idx),
      evid: fc.stringMatching(/^[A-Za-z0-9ěščřžýáíé<&"' -]{1,20}$/),
    });
  const periodArb = fc
    .integer({ min: 0, max: 40 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => docArb(i))));
  function toEntry(x: {
    kind: Kind;
    rate: 'standard' | 'reduced';
    cents: number;
    sign: 1 | -1;
    big: boolean;
    idx: number;
    evid: string;
  }): VatLedgerEntryDraft {
    const base = czk(((x.cents * x.sign) / 100).toFixed(2));
    const pct = x.rate === 'standard' ? '21' : '12';
    const day = d(`2026-09-${String(1 + (x.idx % 28)).padStart(2, '0')}`);
    const common = {
      documentId: `doc-${x.idx}`,
      vatRateType: x.rate,
      vatRatePct: Number.parseInt(pct, 10),
      evidenceNumber: x.evid,
      vatPointDate: day,
    } as const;
    switch (x.kind) {
      case 'iss_domestic':
        return e(
          common.documentId,
          [x.rate === 'standard' ? '1' : '2'],
          base.toFixed2(),
          vatForRate(base, pct).toFixed2(),
          {
            ...common,
            vatTreatment: 'iss_domestic_vat',
            khSection: x.big ? 'A4' : 'A5',
            counterpartyVatId: 'CZ12345678',
          },
        );
      case 'rcv_domestic':
        return e(
          common.documentId,
          [x.rate === 'standard' ? '40' : '41'],
          base.toFixed2(),
          vatForRate(base, pct).toFixed2(),
          {
            ...common,
            vatTreatment: 'rcv_domestic_vat',
            khSection: x.big ? 'B2' : 'B3',
            counterpartyVatId: 'CZ87654321',
          },
        );
      case 'eu_service':
        return e(
          common.documentId,
          x.rate === 'standard' ? ['5', '43'] : ['6', '44'],
          base.toFixed2(),
          vatForRate(base, pct).toFixed2(),
          { ...common, khSection: 'A2', counterpartyVatId: 'DE123456789' },
        );
      case 'eu_goods_out':
        return e(common.documentId, ['20'], base.toFixed2(), '0.00', {
          ...common,
          vatTreatment: 'iss_eu_goods',
          shvCode: 0,
          counterpartyVatId: 'ATU12345678',
        });
      case 'eu_service_out':
        return e(common.documentId, ['21'], base.toFixed2(), '0.00', {
          ...common,
          vatTreatment: 'iss_eu_service',
          shvCode: 3,
          counterpartyVatId: 'FR12345678901',
        });
    }
  }
  it('KH and SH', async () => {
    await fc.assert(
      fc.asyncProperty(periodArb, async (docs) => {
        const entries = docs.map(toEntry);
        const dp3 = computeDphdp3(entries, 'platce', rules, START);
        const kh = await validateXml(
          serializeKh(
            computeKh(entries, dp3, () => undefined),
            header('DPHKH1'),
            { verzePis: '03.01' },
          ),
          'DPHKH1',
          '03.01.15',
        );
        expect(kh.valid, JSON.stringify(kh.errors)).toBe(true);
        const sh = await validateXml(
          serializeShv(computeShv(entries, rules, START), header('DPHSHV'), { verzePis: '02.01' }),
          'DPHSHV',
          '02.01.05',
        );
        expect(sh.valid, JSON.stringify(sh.errors)).toBe(true);
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
