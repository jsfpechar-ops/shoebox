import { describe, expect, it } from 'vitest';
import type { VatRateType, VatStatus, VatTreatment } from '../src/enums/index';
import {
  CZ_DPHDP3_ROW_MAP,
  Dphdp3RowMapSchema,
  parseDphdp3RowMap,
  resolveDphdp3Rows,
} from '../src/rules/cz/epo';

// M04 §4.10 table, one case per row for platce (P) and identifikovana_osoba (I), with deduction
// allowed unless stated. Row numbers appear here and in the seed only.
type Case = [VatTreatment, VatRateType, string[], string[]];
const CASES: Case[] = [
  ['rcv_domestic_vat', 'standard', ['40'], []],
  ['rcv_domestic_vat', 'reduced', ['41'], []],
  ['rcv_eu_service_reverse_charge', 'standard', ['5', '43'], ['5']],
  ['rcv_eu_service_reverse_charge', 'reduced', ['6', '44'], ['6']],
  ['rcv_non_eu_service_reverse_charge', 'standard', ['12', '43'], ['12']],
  ['rcv_non_eu_service_reverse_charge', 'reduced', ['13', '44'], ['13']],
  ['rcv_eu_goods_acquisition', 'standard', ['3', '43'], []],
  ['rcv_eu_goods_acquisition', 'reduced', ['4', '44'], []],
  ['rcv_domestic_reverse_charge', 'standard', ['10', '43'], []],
  ['rcv_domestic_reverse_charge', 'reduced', ['11', '44'], []],
  ['rcv_import_customs', 'standard', ['42'], []],
  ['rcv_import_customs', 'none', ['42'], []],
  ['iss_domestic_vat', 'standard', ['1'], []],
  ['iss_domestic_vat', 'reduced', ['2'], []],
  ['iss_eu_service', 'none', ['21'], []],
  ['iss_eu_goods', 'none', ['20'], []],
  ['iss_non_eu_service', 'none', ['26'], []],
  ['iss_export_goods', 'none', ['22'], []],
  ['iss_domestic_reverse_charge', 'none', ['25'], []],
  ['iss_exempt', 'none', ['50'], []],
  ['rcv_domestic_no_vat', 'none', [], []],
  ['rcv_foreign_vat_charged', 'standard', [], []],
  ['rcv_out_of_scope', 'none', [], []],
  ['iss_no_vat', 'none', [], []],
];

describe('resolveDphdp3Rows (M04 §4.10, M05 §4.6)', () => {
  it.each(CASES)('%s %s → P %j, I %j', (treatment, rate, p, i) => {
    expect(resolveDphdp3Rows(treatment, rate, 'platce', true, CZ_DPHDP3_ROW_MAP)).toEqual(p);
    expect(
      resolveDphdp3Rows(treatment, rate, 'identifikovana_osoba', true, CZ_DPHDP3_ROW_MAP),
    ).toEqual(i);
    expect(resolveDphdp3Rows(treatment, rate, 'neplatce', true, CZ_DPHDP3_ROW_MAP)).toEqual([]);
  });

  it('a payer without the right to deduct gets no deduction row (and no 40/41/42 at all)', () => {
    expect(
      resolveDphdp3Rows('rcv_domestic_vat', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP),
    ).toEqual([]);
    expect(
      resolveDphdp3Rows('rcv_import_customs', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP),
    ).toEqual([]);
    expect(
      resolveDphdp3Rows(
        'rcv_eu_service_reverse_charge',
        'standard',
        'platce',
        false,
        CZ_DPHDP3_ROW_MAP,
      ),
    ).toEqual(['5']);
    expect(
      resolveDphdp3Rows('rcv_eu_goods_acquisition', 'reduced', 'platce', false, CZ_DPHDP3_ROW_MAP),
    ).toEqual(['4']);
    expect(
      resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', false, CZ_DPHDP3_ROW_MAP),
    ).toEqual(['1']);
  });

  it('zero/none rates have no domestic row; a rate-specific row never fires on "any"', () => {
    expect(
      resolveDphdp3Rows('rcv_domestic_vat', 'zero', 'platce', true, CZ_DPHDP3_ROW_MAP),
    ).toEqual([]);
    expect(
      resolveDphdp3Rows('rcv_eu_service_reverse_charge', 'none', 'platce', true, CZ_DPHDP3_ROW_MAP),
    ).toEqual([]);
  });

  it('rows come only from the map: an empty map yields nothing; a map with another number yields that number', () => {
    expect(resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', true, [])).toEqual([]);
    const custom = parseDphdp3RowMap([
      {
        row: '99',
        treatment: 'iss_domestic_vat',
        rate: 'standard',
        statuses: ['platce'],
        side: 'output',
        confirmed: false,
      },
    ]);
    expect(resolveDphdp3Rows('iss_domestic_vat', 'standard', 'platce', true, custom)).toEqual([
      '99',
    ]);
  });

  it('seed integrity: strict schema, unique (row, rate), official attrs confirmed, derived rows absent', () => {
    expect(Dphdp3RowMapSchema.safeParse(CZ_DPHDP3_ROW_MAP).success).toBe(true);
    const keys = CZ_DPHDP3_ROW_MAP.map((r) => `${r.row}:${r.rate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      CZ_DPHDP3_ROW_MAP.map((r) => r.row).sort((a, b) =>
        a.localeCompare(b, 'en', { numeric: true }),
      ),
    ).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '10',
      '11',
      '12',
      '13',
      '20',
      '21',
      '22',
      '25',
      '26',
      '40',
      '41',
      '42',
      '50',
    ]);
    for (const r of CZ_DPHDP3_ROW_MAP) {
      expect(r.statuses.length).toBeGreaterThan(0);
      if (r.confirmed) expect(r.attrs?.length ?? 0).toBeGreaterThan(0);
      if (r.deduction_row !== undefined) expect(['43', '44']).toContain(r.deduction_row);
    }
    expect(CZ_DPHDP3_ROW_MAP.filter((r) => !r.confirmed).map((r) => r.row)).toEqual([
      '40',
      '41',
      '42',
      '50',
    ]);
    expect(
      CZ_DPHDP3_ROW_MAP.filter((r) => r.statuses.includes('identifikovana_osoba')).map(
        (r) => r.row,
      ),
    ).toEqual(['5', '6', '12', '13']);
  });

  it('parseDphdp3RowMap rejects an unknown treatment or a missing status list', () => {
    expect(() =>
      parseDphdp3RowMap([
        {
          row: '1',
          treatment: 'nope',
          rate: 'standard',
          statuses: ['platce'],
          side: 'output',
          confirmed: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      parseDphdp3RowMap([
        {
          row: '1',
          treatment: 'iss_domestic_vat',
          rate: 'standard',
          statuses: [],
          side: 'output',
          confirmed: true,
        },
      ]),
    ).toThrow();
  });

  it('the resolver is status-typed: every VatStatus value is handled', () => {
    const statuses: VatStatus[] = ['neplatce', 'identifikovana_osoba', 'platce'];
    for (const s of statuses) {
      expect(
        Array.isArray(
          resolveDphdp3Rows('iss_domestic_vat', 'standard', s, true, CZ_DPHDP3_ROW_MAP),
        ),
      ).toBe(true);
    }
  });
});
