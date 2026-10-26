import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  buildEpoHeader,
  dicDigits,
  type EpoTaxpayerProfile,
  formaCode,
  missingVetaP,
  normalizeNace6,
} from '../src/vat/header';

const d = parseLegalDate;
const FULL: EpoTaxpayerProfile = {
  vatStatus: 'identifikovana_osoba',
  dic: 'CZ7801011229',
  firstName: ' Jan ',
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
const AUG = { start: d('2026-08-01'), end: d('2026-08-31'), kind: 'month' as const };

describe('dicDigits / normalizeNace6', () => {
  it('strips CZ and keeps leading zeros', () => {
    expect(dicDigits('CZ7801011229')).toBe('7801011229');
    expect(dicDigits('cz 012 345 678')).toBe('012345678');
    expect(dicDigits('CZ')).toBeNull();
    expect(dicDigits('12345678901')).toBeNull();
    expect(dicDigits(null)).toBeNull();
  });
  it('NACE right-pads to 6 digits', () => {
    expect(normalizeNace6('5520')).toBe('552000');
    expect(normalizeNace6('62.01')).toBe('620100');
    expect(normalizeNace6('')).toBeNull();
    expect(normalizeNace6('1234567')).toBeNull();
  });
});

describe('missingVetaP', () => {
  it('full profile → nothing missing', () => expect(missingVetaP(FULL)).toEqual([]));
  it('lists missing fields in canonical order, with format checks', () => {
    expect(
      missingVetaP({
        ...FULL,
        fuCode: '45',
        ufoCode: null,
        lastName: ' ',
        address: { city: 'Praha', zip: '1300' },
      }),
    ).toEqual(['fu_code', 'ufo_code', 'last_name', 'zip']);
    expect(missingVetaP({ ...FULL, address: null, dic: 'CZ' })).toEqual(['dic', 'city', 'zip']);
  });
});

describe('buildEpoHeader', () => {
  it('IO August DPHDP3: P4 golden header', () => {
    const r = buildEpoHeader(FULL, {
      form: 'DPHDP3',
      kind: 'radne',
      period: AUG,
      preparedOn: d('2026-09-20'),
      appVersion: '0.0.0',
    });
    expect(r).toMatchObject({
      ok: true,
      header: {
        form: 'DPHDP3',
        kind: 'radne',
        status: 'identifikovana_osoba',
        period: { year: 2026, month: 8 },
        taxpayer: {
          fuCode: '451',
          ufoCode: '2003',
          dicDigits: '7801011229',
          firstName: 'Jan',
          lastName: 'Novák',
          street: 'Vinohradská',
          houseNumber: '1',
          city: 'Praha',
          zip: '13000',
          email: 'jan@example.com',
        },
        naceCode6: '552000',
        preparedOn: '2026-09-20',
        appVersion: '0.0.0',
      },
    });
    if (r.ok) {
      expect(r.header.period.quarter).toBeUndefined();
      expect('title' in r.header.taxpayer && r.header.taxpayer.title !== undefined).toBe(false);
      expect(
        'orientationNumber' in r.header.taxpayer &&
          r.header.taxpayer.orientationNumber !== undefined,
      ).toBe(false);
    }
  });
  it('quarter period → quarter number, no month', () => {
    const r = buildEpoHeader(
      { ...FULL, vatStatus: 'platce' },
      {
        form: 'DPHKH1',
        kind: 'nasledne',
        period: { start: d('2026-07-01'), end: d('2026-09-30'), kind: 'quarter' },
        preparedOn: d('2026-10-20'),
        discoveredOn: d('2026-10-19'),
        appVersion: '1.2.3',
      },
    );
    expect(r).toMatchObject({
      ok: true,
      header: { period: { year: 2026, quarter: 3 }, discoveredOn: '2026-10-19', status: 'platce' },
    });
    if (r.ok) expect(r.header.period.month).toBeUndefined();
  });
  it('non-payer → status_unsupported before missing fields; missing fields listed', () => {
    expect(
      buildEpoHeader(
        { ...FULL, vatStatus: 'neplatce', fuCode: null },
        {
          form: 'DPHDP3',
          kind: 'radne',
          period: AUG,
          preparedOn: d('2026-09-20'),
          appVersion: '0',
        },
      ),
    ).toEqual({ ok: false, reason: 'status_unsupported' });
    expect(
      buildEpoHeader(
        { ...FULL, fuCode: null, firstName: null },
        {
          form: 'DPHDP3',
          kind: 'radne',
          period: AUG,
          preparedOn: d('2026-09-20'),
          appVersion: '0',
        },
      ),
    ).toEqual({ ok: false, missing: ['fu_code', 'first_name'] });
  });
  it('formaCode letters', () => {
    expect(formaCode('DPHDP3', 'radne')).toBe('B');
    expect(formaCode('DPHDP3', 'dodatecne')).toBe('D');
    expect(formaCode('DPHDP3', 'nasledne')).toBeNull();
    expect(formaCode('DPHKH1', 'nasledne')).toBe('N');
    expect(formaCode('DPHKH1', 'dodatecne')).toBeNull();
    expect(formaCode('DPHSHV', 'radne')).toBe('R');
    expect(formaCode('DPHSHV', 'opravne')).toBeNull();
  });
});
