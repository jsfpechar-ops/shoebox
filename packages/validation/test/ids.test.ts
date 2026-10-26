import { describe, expect, it } from 'vitest';
import {
  czAccountToIban,
  czAccountValid,
  czDicValid,
  ibanValid,
  icoRepairCandidates,
} from '../src/index';

describe('czAccountValid', () => {
  it('accepts a valid prefix and number', () => {
    expect(czAccountValid('19', '2000145399', '0800')).toBe(true);
    expect(czAccountValid(null, '2000145399', '0800')).toBe(true);
  });
  it('rejects a bad check, a bad bank code, too few non-zero digits', () => {
    expect(czAccountValid('19', '2000145398', '0800')).toBe(false);
    expect(czAccountValid('19', '2000145399', '800')).toBe(false);
    expect(czAccountValid(null, '0000000011', '0800')).toBe(false);
    expect(czAccountValid('1234567', '2000145399', '0800')).toBe(false);
  });
});

describe('IBAN', () => {
  it('validates mod 97 and length', () => {
    expect(ibanValid('CZ65 0800 0000 1920 0014 5399')).toBe(true);
    expect(ibanValid('cz6508000000192000145399')).toBe(true);
    expect(ibanValid('CZ6508000000192000145398')).toBe(false);
    expect(ibanValid('CZ650800000019200014539')).toBe(false);
    expect(ibanValid('DE89370400440532013000')).toBe(true);
  });
  it('builds a CZ IBAN from an account', () => {
    expect(czAccountToIban('19', '2000145399', '0800')).toBe('CZ6508000000192000145399');
    expect(czAccountToIban('19', '2000145398', '0800')).toBeNull();
  });
});

describe('czDicValid', () => {
  it.each([
    ['CZ25596641', true],
    ['CZ 25596641', true],
    ['CZ25596642', false],
    ['CZ7103192745', true],
    ['CZ7103192746', false],
    ['CZ6995012345', true],
    ['CZ510101123', true],
    ['SK2020123456', false],
    ['CZ123', false],
  ])('%s → %s', (dic, ok) => {
    expect(czDicValid(dic)).toBe(ok);
  });
});

describe('icoRepairCandidates', () => {
  it('finds the swapped digits and every single-digit fix', () => {
    expect(icoRepairCandidates('25596614')).toEqual([
      '25556614',
      '25591614',
      '25596314',
      '25596616',
      '25596624',
      '25596641',
      '25996614',
      '55596614',
    ]);
  });
  it('never returns the input and ignores bad shapes', () => {
    expect(icoRepairCandidates('25596641')).not.toContain('25596641');
    expect(icoRepairCandidates('2559664')).toEqual([]);
    expect(icoRepairCandidates('2559664a')).toEqual([]);
  });
});
