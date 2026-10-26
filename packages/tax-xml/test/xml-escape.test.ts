import { describe, expect, it } from 'vitest';
import { escapeAttr, textAttr } from '../src/xml';

describe('escapeAttr', () => {
  it('escapes markup characters and quotes', () => {
    expect(escapeAttr('<a & "b" > c')).toBe('&lt;a &amp; &quot;b&quot; &gt; c');
  });
  it('writes tab, LF and CR as numeric references so attribute normalisation keeps them', () => {
    expect(escapeAttr('a\tb\nc\rd')).toBe('a&#9;b&#10;c&#13;d');
  });
  it('drops other control characters below 0x20', () => {
    expect(escapeAttr('x\u0001y\u001fz\u0000')).toBe('xyz');
  });
  it('leaves ordinary Czech text untouched', () => {
    expect(escapeAttr('Vinohradská 1, Praha')).toBe('Vinohradská 1, Praha');
  });
});

describe('textAttr', () => {
  it('returns null for missing values', () => {
    expect(textAttr(null)).toBeNull();
    expect(textAttr(undefined)).toBeNull();
  });
  it('trims and returns the text, or null when only whitespace is left', () => {
    expect(textAttr('  Praha \n')).toBe('Praha');
    expect(textAttr('   ')).toBeNull();
    expect(textAttr('')).toBeNull();
  });
});
