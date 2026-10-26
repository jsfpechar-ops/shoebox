import { CZ_DPHDP3_ROW_MAP, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  checkStructure,
  dateAttr,
  dec2Attr,
  escapeAttr,
  FORM_RULES,
  intAttr,
  parseEpoXml,
  parseXmllintStderr,
  readManifest,
  validateXml,
  writePisemnost,
  XmllintMissingError,
  xsdAvailable,
} from '../src/index';

const czk = (s: string) => Money.parse(s, 'CZK');
const AUG = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Pisemnost nazevSW="Shoebox" verzeSW="0.0.0">',
  '  <DPHDP3 verzePis="03.01">',
  '    <VetaD dokument="DP3" k_uladis="DPH" dapdph_forma="B" typ_platce="I" rok="2026" mesic="8" trans="A" c_okec="552000" d_poddp="20.09.2026"/>',
  '    <VetaP c_ufo="451" c_pracufo="2003" dic="7801011229" typ_ds="F" jmeno="Jan" prijmeni="Novák" ulice="Vinohradská" c_pop="1" naz_obce="Praha" psc="13000" stat="ČESKÁ REPUBLIKA" email="jan@example.com"/>',
  '    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>',
  '    <Veta6 dan_zocelk="2877" dano_da="2877"/>',
  '  </DPHDP3>',
  '</Pisemnost>',
  '',
].join('\n');

describe('xml writer', () => {
  it('writes the August golden byte for byte, dropping null attributes', () => {
    const out = writePisemnost({
      form: 'DPHDP3',
      verzePis: '03.01',
      appVersion: '0.0.0',
      vety: [
        {
          name: 'VetaD',
          attrs: [
            ['dokument', 'DP3'],
            ['k_uladis', 'DPH'],
            ['dapdph_forma', 'B'],
            ['typ_platce', 'I'],
            ['rok', '2026'],
            ['mesic', '8'],
            ['ctvrt', null],
            ['trans', 'A'],
            ['c_okec', '552000'],
            ['d_poddp', dateAttr(parseLegalDate('2026-09-20'))],
            ['d_zjist', null],
          ],
        },
        {
          name: 'VetaP',
          attrs: [
            ['c_ufo', '451'],
            ['c_pracufo', '2003'],
            ['dic', '7801011229'],
            ['typ_ds', 'F'],
            ['jmeno', 'Jan'],
            ['prijmeni', 'Novák'],
            ['titul', null],
            ['ulice', 'Vinohradská'],
            ['c_pop', '1'],
            ['c_orient', null],
            ['naz_obce', 'Praha'],
            ['psc', '13000'],
            ['stat', 'ČESKÁ REPUBLIKA'],
            ['email', 'jan@example.com'],
            ['c_telef', null],
          ],
        },
        {
          name: 'Veta1',
          attrs: [
            ['obrat23', intAttr(czk('0.00'))],
            ['p_sl23_e', intAttr(czk('13700.00'))],
            ['dan_psl23_e', intAttr(czk('2877.00'))],
          ],
        },
        {
          name: 'Veta6',
          attrs: [
            ['dan_zocelk', '2877'],
            ['odp_zocelk', intAttr(czk('0'))],
            ['dano_da', '2877'],
            ['dano_no', null],
          ],
        },
      ],
    });
    expect(out).toBe(AUG);
  });
  it('attribute helpers', () => {
    expect(escapeAttr('A&B <"x">')).toBe('A&amp;B &lt;&quot;x&quot;&gt;');
    expect(dec2Attr(czk('-9917.36'))).toBe('-9917.36');
    expect(dec2Attr(czk('0.00'))).toBeNull();
    expect(intAttr(czk('-120.00'))).toBe('-120');
    expect(() => intAttr(czk('1.50'))).toThrow();
    expect(dateAttr(parseLegalDate('2026-01-05'))).toBe('05.01.2026');
  });
});

describe('structure rules', () => {
  it('every row-map attribute exists on a DPHDP3 Věta (stand-in for the XSD attribute-existence test)', () => {
    const all = new Set(FORM_RULES.DPHDP3.flatMap((v) => v.attrs ?? []));
    for (const row of CZ_DPHDP3_ROW_MAP)
      for (const a of row.attrs ?? []) expect(all.has(a), `${row.row}:${a}`).toBe(true);
  });
  it('parses and accepts the golden; rejects a bad attribute, a missing required one, a decimal in DPHDP3 and wrong Věta order', () => {
    const doc = parseEpoXml(AUG);
    expect(doc.form).toBe('DPHDP3');
    expect(doc.vety.map((v) => v.name)).toEqual(['VetaD', 'VetaP', 'Veta1', 'Veta6']);
    expect(doc.vety[1]?.attrs.stat).toBe('ČESKÁ REPUBLIKA');
    expect(checkStructure(doc, 'DPHDP3')).toEqual([]);
    const bad = AUG.replace('p_sl23_e="13700"', 'foo="1" p_sl23_e="137.00"').replace(
      ' dic="7801011229"',
      '',
    );
    const errors = checkStructure(parseEpoXml(bad), 'DPHDP3');
    expect(errors.map((e) => [e.line, e.element])).toEqual(
      expect.arrayContaining([
        [6, 'Veta1'],
        [5, 'VetaP'],
      ]),
    );
    expect(errors.map((e) => e.message).join('\n')).toMatch(/foo.*not allowed/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/dic/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/p_sl23_e/);
    const swapped = AUG.replace(
      '    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>\n    <Veta6 dan_zocelk="2877" dano_da="2877"/>',
      '    <Veta6 dan_zocelk="2877" dano_da="2877"/>\n    <Veta1 p_sl23_e="13700" dan_psl23_e="2877"/>',
    );
    expect(
      checkStructure(parseEpoXml(swapped), 'DPHDP3').some((e) => /order/.test(e.message)),
    ).toBe(true);
    expect(checkStructure(doc, 'DPHKH1').some((e) => /DPHKH1/.test(e.message))).toBe(true);
  });
  it('KH needs two-decimal amounts and digits-only DIČ; a second VetaA5 is too many', () => {
    const kh = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Pisemnost nazevSW="Shoebox" verzeSW="0"><DPHKH1 verzePis="03.01">',
      '<VetaD dokument="KH1" k_uladis="DPH" khdph_forma="B" rok="2026" mesic="9" d_poddp="20.10.2026"/>',
      '<VetaP c_ufo="451" dic="CZ7801011229"/>',
      '<VetaA5 zakl_dane1="8264.46" dan1="1735.54"/>',
      '<VetaA5 zakl_dane1="1" dan1="0.21"/>',
      '</DPHKH1></Pisemnost>',
    ].join('\n');
    const msgs = checkStructure(parseEpoXml(kh), 'DPHKH1')
      .map((e) => e.message)
      .join('\n');
    expect(msgs).toMatch(/dic/);
    expect(msgs).toMatch(/zakl_dane1/);
    expect(msgs).toMatch(/VetaA5/);
  });
});

describe('validateXml', () => {
  it('manifests exist for the three forms without an XSD yet', () => {
    expect(readManifest('DPHDP3', '03.01.04')?.main).toBe('dphdp3_epo2.xsd');
    expect(readManifest('DPHKH1', '03.01.15')?.verze_pis).toBe('03.01');
    expect(readManifest('DPHSHV', '02.01.05')?.source_url).toMatch(/dphshv_epo2\.xsd$/);
    expect(readManifest('DPHDP3', '99.99.99')).toBeNull();
  });
  it('structural errors win; without the XSD the method is structural', async () => {
    const ok = await validateXml(AUG, 'DPHDP3', '03.01.04', {
      exec: async () => ({ code: 0, stderr: '' }),
    });
    expect(ok.valid).toBe(true);
    expect(ok.method).toBe(xsdAvailable('DPHDP3', '03.01.04') ? 'xsd' : 'structural');
    const bad = await validateXml(AUG.replace('mesic="8"', 'mesic="13"'), 'DPHDP3', '03.01.04');
    expect(bad.valid).toBe(false);
    expect(bad.errors[0]).toMatchObject({ line: 4, element: 'VetaD' });
  });
  it('parses xmllint stderr and fails loudly when xmllint is missing (only when the XSD is vendored)', async () => {
    expect(
      parseXmllintStderr(
        "/tmp/dp3.xml:4: element Veta1: Schemas validity error : Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.\n/tmp/dp3.xml fails to validate\n",
      ),
    ).toEqual([
      {
        line: 4,
        element: 'Veta1',
        message: "Element 'Veta1', attribute 'foo': The attribute 'foo' is not allowed.",
      },
    ]);
    if (xsdAvailable('DPHDP3', '03.01.04')) {
      const enoent = Object.assign(new Error('spawn xmllint ENOENT'), { code: 'ENOENT' });
      await expect(
        validateXml(AUG, 'DPHDP3', '03.01.04', {
          exec: async () => ({ code: null, stderr: '', error: enoent }),
        }),
      ).rejects.toBeInstanceOf(XmllintMissingError);
      const real = await validateXml(AUG, 'DPHDP3', '03.01.04');
      expect(real.method).toBe('xsd');
      expect(real.valid, JSON.stringify(real.errors)).toBe(true); // [verify] once the official XSD is vendored
    }
  });
});
