import { readFileSync } from 'node:fs';
import {
  buildEpoHeader,
  computeDphdp3,
  createCzRules,
  type EpoTaxpayerProfile,
  Money,
  parseLegalDate,
  type VatLedgerEntryDraft,
} from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { serializeDphdp3, validateXml, vetaOfRow } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const golden = (name: string) =>
  readFileSync(
    new URL(`../../../testdata/golden-v1/expected/vat/${name}`, import.meta.url),
    'utf8',
  );
const PROFILE: EpoTaxpayerProfile = {
  vatStatus: 'identifikovana_osoba',
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
const e = (
  documentId: string,
  rows: string[],
  base: string,
  vat: string,
  o: Partial<VatLedgerEntryDraft> = {},
): VatLedgerEntryDraft => ({
  periodStart: d('2026-08-01'),
  periodEnd: d('2026-08-31'),
  vatPointDate: d('2026-08-03'),
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
function header(
  status: 'identifikovana_osoba' | 'platce',
  start: string,
  end: string,
  preparedOn: string,
) {
  const r = buildEpoHeader(
    { ...PROFILE, vatStatus: status },
    {
      form: 'DPHDP3',
      kind: 'radne',
      period: { start: d(start), end: d(end), kind: 'month' },
      preparedOn: d(preparedOn),
      appVersion: '0.0.0',
    },
  );
  if (!r.ok) throw new Error('header');
  return r.header;
}
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing case');
  return v;
};
const V = { verzePis: '03.01' };
const cases = [
  {
    file: 'dphdp3-2026-08.xml',
    status: 'identifikovana_osoba' as const,
    start: '2026-08-01',
    end: '2026-08-31',
    prepared: '2026-09-20',
    entries: [e('booking-jul', ['5'], '13699.77', '2876.95')],
  },
  {
    file: 'dphdp3-2026-09.xml',
    status: 'identifikovana_osoba' as const,
    start: '2026-09-01',
    end: '2026-09-30',
    prepared: '2026-10-20',
    entries: [e('booking-aug', ['5'], '11549.94', '2425.49')],
  },
  {
    file: 'dphdp3-2026-10.xml',
    status: 'identifikovana_osoba' as const,
    start: '2026-10-01',
    end: '2026-10-31',
    prepared: '2026-11-20',
    entries: [
      e('cloudflare', ['12'], '245.35', '51.52', {
        vatTreatment: 'rcv_non_eu_service_reverse_charge',
      }),
      e('anthropic', ['5'], '2212.20', '464.56'),
    ],
  },
  {
    file: 'dphdp3-payer-2026-09.xml',
    status: 'platce' as const,
    start: '2026-09-01',
    end: '2026-09-30',
    prepared: '2026-10-20',
    entries: [
      e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat' }),
      e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
      e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
      e('booking-aug', ['5', '43'], '11549.94', '2425.49'),
      e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat' }),
      e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat' }),
      e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat' }),
    ],
  },
];

describe('serializeDphdp3 golden (M05 §9 #1–#3, #6)', () => {
  for (const c of cases) {
    it(`${c.file} byte-matches and validates`, async () => {
      const comp = computeDphdp3(c.entries, c.status, rules, d(c.start));
      const xml = serializeDphdp3(comp, header(c.status, c.start, c.end, c.prepared), V);
      expect(xml).toBe(golden(c.file));
      const v = await validateXml(xml, 'DPHDP3', '03.01.04');
      expect(v.valid, JSON.stringify(v.errors)).toBe(true);
    });
  }
  it('August: Veta1 p_sl23_e/dan_psl23_e, Veta6 dan_zocelk, no Veta4, no Veta2', () => {
    const xml = golden('dphdp3-2026-08.xml');
    expect(xml).toContain('p_sl23_e="13700" dan_psl23_e="2877"');
    expect(xml).toContain('dan_zocelk="2877"');
    expect(xml).not.toContain('<Veta4');
    expect(xml).not.toContain('<Veta2');
    expect(xml).toContain('typ_platce="I"');
  });
  it('P7: entry permutation gives identical bytes', () => {
    const c = must(cases[3]);
    const a = serializeDphdp3(
      computeDphdp3(c.entries, 'platce', rules, d(c.start)),
      header('platce', c.start, c.end, c.prepared),
      V,
    );
    const b = serializeDphdp3(
      computeDphdp3([...c.entries].reverse(), 'platce', rules, d(c.start)),
      header('platce', c.start, c.end, c.prepared),
      V,
    );
    expect(a).toBe(b);
  });
  it('nil payer return keeps Veta6 with dano_da="0"; dodatecne writes D and d_zjist and dano', () => {
    const nil = serializeDphdp3(
      computeDphdp3([], 'platce', rules, d('2026-09-01')),
      header('platce', '2026-09-01', '2026-09-30', '2026-10-20'),
      V,
    );
    expect(nil).toContain('<Veta6 dano_da="0"/>');
    expect(nil).toContain('trans="N"');
    const hd = buildEpoHeader(
      { ...PROFILE, vatStatus: 'platce' },
      {
        form: 'DPHDP3',
        kind: 'dodatecne',
        period: { start: d('2026-09-01'), end: d('2026-09-30'), kind: 'month' },
        preparedOn: d('2026-12-01'),
        discoveredOn: d('2026-11-30'),
        appVersion: '0.0.0',
      },
    );
    if (!hd.ok) throw new Error('header');
    const dod = serializeDphdp3(
      computeDphdp3(must(cases[3]).entries, 'platce', rules, d('2026-09-01')),
      hd.header,
      { ...V, row66: czk('100.00') },
    );
    expect(dod).toContain('dapdph_forma="D"');
    expect(dod).toContain('d_zjist="30.11.2026"');
    expect(dod).toContain('dano_da="5196" dano="100"');
  });
  it('vetaOfRow and header guards', () => {
    expect(['1', '21', '40', '50', '62'].map(vetaOfRow)).toEqual([
      'Veta1',
      'Veta2',
      'Veta4',
      'Veta5',
      'Veta6',
    ]);
    const h = {
      ...header('platce', '2026-09-01', '2026-09-30', '2026-10-20'),
      form: 'DPHKH1' as const,
    };
    expect(() =>
      serializeDphdp3(computeDphdp3([], 'platce', rules, d('2026-09-01')), h, V),
    ).toThrow(/mismatch/);
  });
});
