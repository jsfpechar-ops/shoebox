import { describe, expect, it } from 'vitest';
import { checkStructure, parseEpoXml } from '../src/forms';

function epo(body: string, form = 'DPHDP3'): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Pisemnost nazevSW="Shoebox" verzeSW="0">',
    `<${form} verzePis="03.01">`,
    body,
    `</${form}>`,
    '</Pisemnost>',
  ].join('\n');
}

const VETA_D =
  '<VetaD dokument="DP3" k_uladis="DPH" dapdph_forma="B" typ_platce="I" rok="2026" mesic="8"/>';
const VETA_P = '<VetaP c_ufo="451" dic="7801011229" jmeno="Jan"/>';

describe('parseEpoXml entity and attribute decoding', () => {
  it('decodes hex, decimal and named entities; unknown named entities stay literal', () => {
    const xml = epo(
      '<VetaP c_ufo="451" dic="7801011229" jmeno="A&#x42;C&#68;&amp;&apos;&quot;&bogus;"/>',
    ).replace('nazevSW="Shoebox"', 'nazevSW="A&lt;B&gt;"');
    const doc = parseEpoXml(xml);
    expect(doc.rootAttrs.nazevSW).toBe('A<B>');
    // Unknown entity names are not in the decoder's table, so they stay as written.
    expect(doc.vety[0]?.attrs.jmeno).toBe('ABCD&\'"&bogus;');
    expect(doc.vety[0]?.line).toBe(4);
  });
});

describe('parseEpoXml rejects documents outside the restricted EPO shape', () => {
  it.each([
    ['no Pisemnost root', '<foo/>'],
    ['root not closed', '<Pisemnost nazevSW="x"><DPHDP3 verzePis="03.01"></DPHDP3>'],
    ['unknown form element', '<Pisemnost nazevSW="x"><FOO verzePis="1"></FOO></Pisemnost>'],
    ['form element not closed', '<Pisemnost nazevSW="x"><DPHDP3 verzePis="03.01"></Pisemnost>'],
    [
      'Věta that is not self-closing',
      '<Pisemnost nazevSW="x"><DPHDP3 verzePis="03.01"><VetaD dokument="DP3"></VetaD></DPHDP3></Pisemnost>',
    ],
  ])('%s', (_name, xml) => {
    expect(() => parseEpoXml(xml)).toThrow('tax-xml: not an EPO document');
  });
});

describe('checkStructure failure modes', () => {
  it('reports a Věta the form does not know', () => {
    const errors = checkStructure(
      parseEpoXml(epo(`${VETA_D}\n${VETA_P}\n<VetaX a="1"/>`)),
      'DPHDP3',
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ element: 'VetaX', message: 'unknown Věta VetaX in DPHDP3' }),
    );
  });

  it('requires exactly one of mesic or ctvrt', () => {
    const both = VETA_D.replace('mesic="8"', 'mesic="8" ctvrt="3"');
    const errors = checkStructure(parseEpoXml(epo(`${both}\n${VETA_P}`)), 'DPHDP3');
    expect(errors.map((e) => e.message).join('\n')).toMatch(
      /VetaD: exactly one of mesic, ctvrt is required/,
    );
  });

  it('reports an empty attribute value', () => {
    const errors = checkStructure(
      parseEpoXml(epo(`${VETA_D}\n<VetaP c_ufo="451" dic="7801011229" jmeno=""/>`)),
      'DPHDP3',
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        element: 'VetaP',
        line: 5,
        message: 'Věta VetaP: attribute jmeno is empty',
      }),
    );
  });

  it('reports a mandatory Věta that is missing', () => {
    const errors = checkStructure(parseEpoXml(epo(VETA_D)), 'DPHDP3');
    expect(errors).toContainEqual(
      expect.objectContaining({
        line: null,
        element: 'VetaP',
        message: 'Věta VetaP is missing (minimum 1)',
      }),
    );
  });

  it('rejects a document whose root form does not match the requested form', () => {
    const doc = parseEpoXml(epo(`${VETA_D}\n${VETA_P}`, 'DPHDP3'));
    expect(checkStructure(doc, 'DPHKH1')).toEqual([
      { line: null, element: 'DPHDP3', message: 'root form element is DPHDP3, expected DPHKH1' },
    ]);
  });
});
