import {
  CZK,
  computeFlatRateComparison,
  createCzRules,
  type MemberRole,
  Money,
} from '@shoebox/domain';
import { serializeDpfdp7Partial } from '@shoebox/tax-xml';
import { describe, expect, it } from 'vitest';
import {
  buildPartialFilingTotals,
  decidePartialXml,
  type PartialXmlContext,
  partialXmlLogFields,
  toDpfHeader,
} from '../src/podklady/dpfdp7';

const RC = '780101/1229';
const RC_DIGITS = '7801011229';
const rules = createCzRules();
const s3 = computeFlatRateComparison(
  Money.parse('3500000.00', CZK),
  Money.parse('2900000.00', CZK),
  60,
  rules,
  2026,
);

const ctx = (over: Partial<PartialXmlContext> = {}): PartialXmlContext => ({
  role: 'owner',
  flagOn: true,
  xsdAvailable: true,
  partialXmlEligible: true,
  flatRate: s3,
  body: { rodneCislo: RC },
  ...over,
});

describe('decidePartialXml', () => {
  it('member/accountant/viewer → 403 forbidden even when everything else qualifies', () => {
    for (const role of ['member', 'accountant', 'viewer'] as MemberRole[]) {
      expect(decidePartialXml(ctx({ role }))).toEqual({
        ok: false,
        status: 403,
        error: 'forbidden',
      });
    }
  });
  it('flag off → 404; xsd missing → 404; not eligible → 404; flatRate null → 404', () => {
    const nf = { ok: false, status: 404, error: 'not_found' };
    expect(decidePartialXml(ctx({ flagOn: false }))).toEqual(nf);
    expect(decidePartialXml(ctx({ xsdAvailable: false }))).toEqual(nf);
    expect(decidePartialXml(ctx({ partialXmlEligible: false }))).toEqual(nf);
    expect(decidePartialXml(ctx({ flatRate: null }))).toEqual(nf);
  });
  it('rodneCislo missing or malformed → 422; valid with slash → ok normalized; bad checksum → ok false', () => {
    const bad = { ok: false, status: 422, error: 'rodne_cislo_format' };
    expect(decidePartialXml(ctx({ body: null }))).toEqual(bad);
    expect(decidePartialXml(ctx({ body: {} }))).toEqual(bad);
    expect(decidePartialXml(ctx({ body: { rodneCislo: 'abc' } }))).toEqual(bad);
    expect(decidePartialXml(ctx())).toEqual({ ok: true, rodneCislo: RC_DIGITS, checksumOk: true });
    expect(decidePartialXml(ctx({ body: { rodneCislo: '7801011228' } }))).toEqual({
      ok: true,
      rodneCislo: '7801011228',
      checksumOk: false,
    });
  });
});

describe('toDpfHeader / totals / log fields', () => {
  it('maps the profile columns; empty strings become null', () => {
    const h = toDpfHeader({
      fuCode: '451',
      ufoCode: '',
      firstName: 'Jana',
      lastName: 'Test',
      title: '',
      filingEmail: 'j@example.test',
      filingPhone: '',
      mainActivityNace: '620100',
      address: { city: 'Praha', street: '', house_number: '1', zip: '11000' },
    });
    expect(h).toMatchObject({
      fuCode: '451',
      ufoCode: null,
      title: null,
      phone: null,
      email: 'j@example.test',
      nace: '620100',
      address: { city: 'Praha', street: null, number: '1', zip: '11000', country: null },
    });
  });
  it('totals carry kc_prij7, kc_vyd7, rate, ledgerHash only (S3)', () => {
    expect(buildPartialFilingTotals(s3, 'abc123')).toEqual({
      kc_prij7: '3500000.00',
      kc_vyd7: '1200000.00',
      rate: 60,
      ledgerHash: 'abc123',
    });
  });
  it('log fields contain no rodneCislo key and no 9-10 digit token', () => {
    const fields = partialXmlLogFields('a1b2c3d4-e5f6-4a7b-8c9d-abcdefabcdef', 2026, null, null);
    expect(Object.keys(fields).some((k) => /rodne|rod_c/i.test(k))).toBe(false);
    expect(JSON.stringify(fields)).not.toMatch(/\d{9,10}/);
  });
});

describe('general 5 at the unit level', () => {
  it('JSON of the filing totals and log fields does not contain 7801011229', () => {
    const decision = decidePartialXml(ctx());
    expect(decision.ok).toBe(true);
    const insert = {
      type: 'DPFDP7_PARTIAL',
      totals: buildPartialFilingTotals(s3, 'abc123'),
      inputs: {},
      xmlPath: null,
      log: partialXmlLogFields('a1b2c3d4-e5f6-4a7b-8c9d-abcdefabcdef', 2026, 'f1', null),
    };
    const json = JSON.stringify(insert);
    expect(json).not.toContain(RC_DIGITS);
    expect(json).not.toContain(RC);
    if (decision.ok) {
      // the number reaches only the XML
      const xml = serializeDpfdp7Partial(
        {
          year: 2026,
          header: toDpfHeader({
            fuCode: null,
            ufoCode: null,
            firstName: null,
            lastName: null,
            title: null,
            filingEmail: null,
            filingPhone: null,
            mainActivityNace: null,
            address: null,
          }),
          income: s3.incomeKc,
          flat: s3.flat,
          rate: s3.rate,
          appVersion: 'test',
        },
        decision.rodneCislo,
        rules,
      );
      expect(xml).toContain(RC_DIGITS);
    }
  });
});
