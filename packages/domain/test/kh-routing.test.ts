import { describe, expect, it } from 'vitest';
import type { VatTreatment } from '../src/enums/index';
import { Money } from '../src/money/index';
import {
  CZ_KH_ROUTING,
  type KhRoutingInput,
  KhRoutingSchema,
  parseKhRouting,
  resolveKhSection,
} from '../src/rules/cz/epo';
import { createCzRules } from '../src/rules/index';

const czk = (s: string) => Money.parse(s, 'CZK');
const LIMIT = createCzRules().at('2026-10-26').get('vat.kh_document_limit');

function input(over: Partial<KhRoutingInput> = {}): KhRoutingInput {
  return {
    vatStatus: 'platce',
    treatment: 'rcv_domestic_vat',
    docTotalCzk: czk('12960.84'),
    counterpartyCzDic: true,
    taxDocStatus: 'full_tax_document',
    limitCzk: LIMIT,
    ...over,
  };
}
const kh = (over: Partial<KhRoutingInput> = {}) => resolveKhSection(input(over), CZ_KH_ROUTING);

describe('resolveKhSection (M05 §4.2 step 8, CTF §1.3.1)', () => {
  it('received domestic: B2 above 10 000 Kč incl. VAT with CZ DIČ and a full tax document, else B3', () => {
    expect(kh()).toBe('B2');
    expect(kh({ docTotalCzk: czk('10000.00') })).toBe('B3');
    expect(kh({ docTotalCzk: czk('10000.01') })).toBe('B2');
    expect(kh({ docTotalCzk: czk('10000.01'), counterpartyCzDic: false })).toBe('B3');
    expect(kh({ docTotalCzk: czk('10000.01'), taxDocStatus: 'simplified_tax_document' })).toBe(
      'B3',
    );
    expect(kh({ docTotalCzk: czk('-10000.01') })).toBe('B2');
    expect(kh({ docTotalCzk: czk('-10000.00') })).toBe('B3');
  });

  it('issued domestic: A4 above the limit with a CZ DIČ customer, else A5 (B2C → A5)', () => {
    expect(kh({ treatment: 'iss_domestic_vat' })).toBe('A4');
    expect(kh({ treatment: 'iss_domestic_vat', docTotalCzk: czk('10000.00') })).toBe('A5');
    expect(kh({ treatment: 'iss_domestic_vat', counterpartyCzDic: false })).toBe('A5');
    expect(
      kh({
        treatment: 'iss_domestic_vat',
        docTotalCzk: czk('10000.01'),
        taxDocStatus: 'simplified_tax_document',
      }),
    ).toBe('A4');
  });

  it('self-assessed → A2, reverse charge → B1 / A1, the rest null', () => {
    for (const t of [
      'rcv_eu_service_reverse_charge',
      'rcv_non_eu_service_reverse_charge',
      'rcv_eu_goods_acquisition',
    ] as const) {
      expect(kh({ treatment: t, docTotalCzk: czk('1.00') })).toBe('A2');
    }
    expect(kh({ treatment: 'rcv_domestic_reverse_charge' })).toBe('B1');
    expect(kh({ treatment: 'iss_domestic_reverse_charge' })).toBe('A1');
    const none: VatTreatment[] = [
      'rcv_import_customs',
      'iss_eu_service',
      'iss_eu_goods',
      'iss_non_eu_service',
      'iss_export_goods',
      'iss_exempt',
      'rcv_domestic_no_vat',
      'rcv_foreign_vat_charged',
      'rcv_out_of_scope',
      'iss_no_vat',
    ];
    for (const t of none) expect(kh({ treatment: t }), t).toBeNull();
  });

  it('only payers file a control statement', () => {
    expect(kh({ vatStatus: 'identifikovana_osoba' })).toBeNull();
    expect(kh({ vatStatus: 'neplatce' })).toBeNull();
  });

  it('the limit is an input, not a constant', () => {
    expect(kh({ docTotalCzk: czk('15000.00'), limitCzk: 20_000 })).toBe('B3');
  });

  it('seed integrity and parsing', () => {
    expect(KhRoutingSchema.safeParse(CZ_KH_ROUTING).success).toBe(true);
    expect(parseKhRouting(CZ_KH_ROUTING)).toEqual(CZ_KH_ROUTING);
    expect(() =>
      parseKhRouting({ version: 1, rules: [{ treatments: ['iss_domestic_vat'], section: 'C9' }] }),
    ).toThrow();
    expect(resolveKhSection(input(), parseKhRouting({ version: 1, rules: [] }))).toBeNull();
  });
});
