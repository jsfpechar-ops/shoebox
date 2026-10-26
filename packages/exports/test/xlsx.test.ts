import { describe, expect, it } from 'vitest';
import { columnName, createXlsx, escapeXml } from '../src';

const dec = new TextDecoder();

function part(zip: Uint8Array, wanted: string): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const name = dec.decode(zip.subarray(p + 30, p + 30 + nameLength));
    if (name === wanted) return dec.decode(zip.subarray(p + 30 + nameLength, p + 30 + nameLength + size));
    p += 30 + nameLength + size;
  }
  throw new Error(`no part ${wanted}`);
}

describe('xlsx helpers', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('escapes XML and drops forbidden control characters', () => {
    expect(escapeXml('a<b & "c"\u0001')).toBe('a&lt;b &amp; &quot;c&quot;');
  });
});

describe('createXlsx', () => {
  const zip = createXlsx(
    'Documents 2026',
    [
      ['Date', 'Partner', 'Amount'],
      ['2026-09-30', 'Úklid & spol.', { num: '8150.00' }],
      ['2026-09-10', null, { num: 'n/a' }],
    ],
    new Date(Date.UTC(2026, 9, 26)),
  );

  it('has the five parts a spreadsheet app needs', () => {
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ])
      expect(part(zip, name).startsWith('<?xml')).toBe(true);
    expect(part(zip, 'xl/workbook.xml')).toContain('name="Documents 2026"');
  });

  it('writes text inline, decimal strings as numbers, skips empty cells', () => {
    const sheet = part(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Úklid &amp; spol.</t></is></c>');
    expect(sheet).toContain('<c r="C2"><v>8150.00</v></c>');
    expect(sheet).not.toContain('r="B3"');
    expect(sheet).toContain('<c r="C3" t="inlineStr"><is><t xml:space="preserve">n/a</t></is></c>');
  });
});
