import { readFileSync } from 'node:fs';
import { CZK, createCzRules, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  dpfdp7FileName,
  isPartialXmlAvailable,
  redactRodneCislo,
  serializeDpfdp7Partial,
  validateRodneCislo,
} from '../src/dpfdp7-partial';
import { checkStructure, parseEpoXml } from '../src/forms';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, CZK);
const RC = '7801011229';
const s3 = {
  year: 2026,
  appVersion: '0.1.0',
  income: czk('3500000.00'),
  flat: czk('1200000.00'),
  rate: 60 as const,
  header: {
    fuCode: '451',
    ufoCode: '2001',
    firstName: 'Lucie',
    lastName: 'Nováková',
    title: null,
    email: 'lucie@example.test',
    phone: '+420777000111',
    nace: '620200',
    address: { city: 'Praha 3', street: 'Vinohradská', number: '100', zip: '13000', country: 'CZ' },
  },
};

describe('serializeDpfdp7Partial S3 (M06 §9)', () => {
  const xml = serializeDpfdp7Partial(s3, '780101/1229', rules);
  it('kc_prij7=3500000, kc_vyd7=1200000, pr_sazba=60, vyd7proc set; VetaD header values; rod_c without the slash', () => {
    const doc = parseEpoXml(xml);
    expect(doc.form).toBe('DPFDP7');
    expect(doc.vety.map((v) => v.name)).toEqual(['VetaD', 'VetaP', 'VetaT']);
    expect(doc.vety[0]?.attrs).toMatchObject({
      dokument: 'DP7',
      k_uladis: 'DPF',
      rok: '2026',
      dap_typ: 'B',
      pln_moc: 'N',
      audit: 'N',
      c_ufo_cil: '451',
      c_pracufo: '2001',
    });
    expect(doc.vety[1]?.attrs).toMatchObject({
      rod_c: RC,
      jmeno: 'Lucie',
      prijmeni: 'Nováková',
      email: 'lucie@example.test',
    });
    expect(doc.vety[1]?.attrs.titul).toBeUndefined();
    expect(doc.vety[2]?.attrs).toEqual({
      c_nace: '620200',
      kc_prij7: '3500000',
      kc_vyd7: '1200000',
      pr_sazba: '60',
      vyd7proc: 'A',
    });
    expect(checkStructure(doc, 'DPFDP7')).toEqual([]);
  });
  it('matches the golden file byte for byte', () => {
    expect(xml).toBe(
      readFileSync(
        new URL(
          '../../../testdata/golden-v1/expected/income-tax/dpfdp7-partial-2026.xml',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  });
  it('never emits VetaO, VetaS, pr_prij7 or row 103+; no logging side effects (pure string)', () => {
    expect(xml).not.toMatch(/VetaO|VetaS|pr_prij7|pr_vyd7|kc_zd7/);
  });
  it('a format-invalid RČ throws; haléře in income throw', () => {
    expect(() => serializeDpfdp7Partial(s3, '12345', rules)).toThrow('dpfdp7: invalid rodné číslo');
    expect(() => serializeDpfdp7Partial({ ...s3, income: czk('3500000.50') }, RC, rules)).toThrow();
  });
});

describe('validateRodneCislo / redact / availability', () => {
  it('format and checksum', () => {
    expect(validateRodneCislo('780101/1229')).toEqual({ normalized: RC, checksumOk: true });
    expect(validateRodneCislo('7801011228')).toEqual({
      normalized: '7801011228',
      checksumOk: false,
    });
    expect(validateRodneCislo('530101123')).toEqual({ normalized: '530101123', checksumOk: true });
    expect(validateRodneCislo('12345')).toEqual({ error: 'format' });
    expect(validateRodneCislo('78010112290')).toEqual({ error: 'format' });
  });
  it('redaction masks both spellings; file name; availability follows epo.forms.DPFDP7.tax_years (empty until the XSD is vendored)', () => {
    expect(redactRodneCislo('rc 780101/1229 and 7801011229 end')).toBe('rc *** and *** end');
    expect(dpfdp7FileName(2026)).toBe('DPFDP7-2026-castecne.xml');
    expect(isPartialXmlAvailable(2026, rules)).toBe(false);
  });
});
