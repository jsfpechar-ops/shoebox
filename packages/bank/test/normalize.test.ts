import { CZK, EUR, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  decodeGpcAccount,
  formatAccount,
  parseAccount,
  parseAmount,
  parseDdmmyy,
  parseSymbol,
  parseYymmdd,
  symbolsFromText,
} from '../src/normalize';

const amt = (text: string) => parseAmount(text, CZK)?.toString() ?? null;
const m = (text: string) => Money.parse(text, CZK).toString();

describe('parseAmount', () => {
  it.each([
    ['1234.56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,56', '1234.56'],
    ['1 234,5', '1234.5'],
    ["1'234.50", '1234.5'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['12.345.678,9', '12345678.9'],
    ['-1 500', '-1500'],
    ['+20,00', '20'],
    ['- 100,00', '-100'],
    ['1.234', '1234'],
    ['0,01', '0.01'],
    ['  42  ', '42'],
  ])('%s', (input, expected) => {
    expect(amt(input)).toBe(m(expected));
  });

  it.each(['', '   ', 'abc', '12a', '--5', '1 234 Kč', ','])('rejects %j', (input) => {
    expect(amt(input)).toBeNull();
  });

  it('keeps the currency', () => {
    expect(parseAmount('10,5', EUR)?.currency).toBe('EUR');
  });
});

describe('parseSymbol', () => {
  it.each([
    ['0000001234', '1234'],
    [' 12 34 ', '1234'],
    ['VS 0308', '308'],
    ['1234567890', '1234567890'],
  ])('%s', (input, expected) => {
    expect(parseSymbol(input)).toBe(expected);
  });

  it.each(['', '0000000000', '12345678901', null, undefined, 'abc'])('null for %j', (input) => {
    expect(parseSymbol(input)).toBeNull();
  });
});

describe('formatAccount', () => {
  it('drops leading zeros and an empty prefix', () => {
    expect(formatAccount('000000', '0002400123455')).toBe('2400123455');
    expect(formatAccount('001003', '1234567899')).toBe('1003-1234567899');
    expect(formatAccount(null, '0000012345')).toBe('12345');
  });
});

describe('parseAccount', () => {
  it('reads number/bank and computes the IBAN', () => {
    expect(parseAccount('2400123455/2010')).toEqual({
      account: '2400123455',
      bankCode: '2010',
      iban: 'CZ8720100000002400123455',
    });
  });

  it('reads prefix-number/bank', () => {
    expect(parseAccount('1003-1234567899/0800')).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
    });
  });

  it('reads a CZ IBAN with spaces and lower case', () => {
    expect(parseAccount('cz46 0800 0010 0312 3456 7899')).toEqual({
      account: '1003-1234567899',
      bankCode: '0800',
      iban: 'CZ4608000010031234567899',
    });
  });

  it('keeps a foreign IBAN only as iban', () => {
    expect(parseAccount('DE89 3704 0044 0532 0130 00')).toEqual({ iban: 'DE89370400440532013000' });
  });

  it.each(['2400123456/2010', '2400123455/201', 'CZ8720100000002400123456', 'hello', ''])(
    'rejects %j',
    (input) => {
      expect(parseAccount(input)).toBeNull();
    },
  );
});

describe('decodeGpcAccount', () => {
  it('splits prefix and number', () => {
    expect(decodeGpcAccount('0000002400123455')).toBe('2400123455');
    expect(decodeGpcAccount('0010031234567899')).toBe('1003-1234567899');
  });

  it('null for zeros or a wrong length', () => {
    expect(decodeGpcAccount('0000000000000000')).toBeNull();
    expect(decodeGpcAccount('123')).toBeNull();
  });
});

describe('dates', () => {
  it('reads DDMMYY and YYMMDD', () => {
    expect(parseDdmmyy('260926')).toBe('2026-09-26');
    expect(parseYymmdd('260926')).toBe('2026-09-26');
  });

  it('null for zeros and impossible dates', () => {
    expect(parseDdmmyy('000000')).toBeNull();
    expect(parseDdmmyy('310226')).toBeNull();
    expect(parseYymmdd('261340')).toBeNull();
    expect(parseYymmdd('12345')).toBeNull();
  });
});

describe('symbolsFromText', () => {
  it('reads slash-separated symbols', () => {
    expect(symbolsFromText('/VS/1234/KS/0308/SS/00042')).toEqual({ vs: '1234', ks: '308', ss: '42' });
  });

  it('reads VS: at the start', () => {
    expect(symbolsFromText('VS: 2026001 thanks')).toEqual({ vs: '2026001' });
  });

  it('ignores VS inside a word', () => {
    expect(symbolsFromText('XVS 123')).toEqual({});
  });
});
