import {
  buildEpoHeader,
  computeDphdp3,
  computeKh,
  computeShv,
  createCzRules,
  type EpoTaxpayerProfile,
  parseLegalDate,
} from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { serializeKh, serializeShv } from '../src/index';

const rules = createCzRules();
const d = parseLegalDate;
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

function header(form: 'DPHKH1' | 'DPHSHV') {
  const r = buildEpoHeader(PROFILE, {
    form,
    kind: 'radne',
    period: { start: START, end: d('2026-09-30'), kind: 'month' },
    preparedOn: d('2026-10-20'),
    appVersion: '0.0.0',
  });
  if (!r.ok) throw new Error('header');
  return r.header;
}

describe('serializeKh / serializeShv guards and empty periods', () => {
  it('rejects a header of the other form', () => {
    expect(() =>
      serializeKh(
        computeKh([], computeDphdp3([], 'platce', rules, START), () => undefined),
        header('DPHSHV'),
        { verzePis: '03.01' },
      ),
    ).toThrow(/form mismatch/);
    expect(() =>
      serializeShv(computeShv([], rules, START), header('DPHKH1'), { verzePis: '02.01' }),
    ).toThrow(/form mismatch/);
  });

  it('empty SHV has VetaD and VetaP only', () => {
    const xml = serializeShv(computeShv([], rules, START), header('DPHSHV'), { verzePis: '02.01' });
    expect(xml.match(/<Veta/g)).toHaveLength(2);
    expect(xml).toContain('shvies_forma="R"');
  });
});
