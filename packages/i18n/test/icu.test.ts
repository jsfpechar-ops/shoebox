import { describe, expect, it } from 'vitest';
import { formatMessage, IcuSyntaxError, parse } from '../src/icu';

const DOKLADY = '{n, plural, one {# doklad} few {# doklady} many {# dokladu} other {# dokladů}}';

describe('formatMessage', () => {
  it('renders text and arguments, numbers in the locale format', () => {
    expect(formatMessage('Otázka {n} ze {total}', 'cs', { n: 2, total: 5 })).toBe('Otázka 2 ze 5');
    expect(formatMessage('Sedí {field}?', 'cs', { field: 'DUZP' })).toBe('Sedí DUZP?');
    expect(formatMessage('sazba {rate} %', 'cs', { rate: 1.5 })).toBe('sazba 1,5 %');
  });

  it('renders Czech plurals one / few / many / other', () => {
    expect(formatMessage(DOKLADY, 'cs', { n: 1 })).toBe('1 doklad');
    expect(formatMessage(DOKLADY, 'cs', { n: 2 })).toBe('2 doklady');
    expect(formatMessage(DOKLADY, 'cs', { n: 5 })).toBe('5 dokladů');
    expect(formatMessage(DOKLADY, 'cs', { n: 0 })).toBe('0 dokladů');
    expect(formatMessage(DOKLADY, 'cs', { n: 1.5 })).toBe('1,5 dokladu');
  });

  it('prefers an exact =N option', () => {
    const message = '{n, plural, =0 {žádný doklad} other {# dokladů}}';
    expect(formatMessage(message, 'cs', { n: 0 })).toBe('žádný doklad');
    expect(formatMessage(message, 'cs', { n: 7 })).toBe('7 dokladů');
  });

  it('renders English plurals', () => {
    const message = '{n, plural, one {# document} other {# documents}}';
    expect(formatMessage(message, 'en', { n: 1 })).toBe('1 document');
    expect(formatMessage(message, 'en', { n: 2 })).toBe('2 documents');
  });

  it('renders select with an other fallback', () => {
    const message = '{kind, select, business {Firemní} other {Soukromé}}';
    expect(formatMessage(message, 'cs', { kind: 'business' })).toBe('Firemní');
    expect(formatMessage(message, 'cs', { kind: 'private' })).toBe('Soukromé');
  });

  it('keeps # literal outside a plural', () => {
    expect(formatMessage('Doklad # {id}', 'cs', { id: 'A1' })).toBe('Doklad # A1');
  });

  it('throws on a missing parameter', () => {
    expect(() => formatMessage('Sedí {field}?', 'cs', {})).toThrow('missing parameter "field"');
  });

  it('throws when a plural argument is not a number', () => {
    expect(() => formatMessage(DOKLADY, 'cs', { n: '1' })).toThrow(TypeError);
  });
});

describe('parse rejects invalid ICU', () => {
  it.each([
    ['Ahoj {name', 'unclosed "{"'],
    ['Ahoj name}', 'unexpected "}"'],
    ['{n, plural, one {a', 'unclosed "{"'],
    ['{n, plural, one {# doklad}}', 'missing "other"'],
    ['{n, number}', 'unsupported argument type'],
    ['{n, plural, single {x} other {y}}', 'invalid selector'],
    ['{n, plural, one {a} one {b} other {c}}', 'duplicate selector'],
    ['{}', 'invalid argument name'],
    ['{n plural}', 'invalid argument name'],
  ])('%s', (message, reason) => {
    expect(() => parse(message)).toThrow(IcuSyntaxError);
    expect(() => parse(message)).toThrow(reason);
  });
});
