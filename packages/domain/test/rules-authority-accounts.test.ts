import { describe, expect, it } from 'vitest';
import { createCzRules } from '../src/rules/cz/index';

const rules = createCzRules();

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

describe('bank.authority_accounts (M07 §4.7.4, A12)', () => {
  it.each(['2025-06-01', '2026-06-01'])('resolves on %s with FÚ prefixes 705 and 2866', (date) => {
    const value = rules.at(date).get('bank.authority_accounts') as Record<
      string,
      Record<string, unknown>
    >;
    expect(value.fu).toMatchObject({ bank_code: '0710', vat_refund_category: 'income_vat_refund' });
    const prefixMap = must(value.fu).prefix_map as Record<string, string>;
    expect(prefixMap['705']).toBe('tax_vat_payment');
    expect(prefixMap['2866']).toBe('tax_pausal_advance');
    expect(Object.keys(prefixMap).sort()).toEqual(['2866', '705']);
  });
  it('keeps unverified lists empty and names the categories', () => {
    const value = rules.at('2026-06-01').get('bank.authority_accounts') as Record<
      string,
      Record<string, unknown>
    >;
    for (const group of ['cssz', 'insurers', 'municipalities']) {
      expect(must(value[group]).accounts).toEqual([]);
      expect(typeof must(value[group]).category).toBe('string');
    }
    const hints = value.name_hints as Record<string, string>;
    expect(hints['FINANCNI URAD']).toBe('tax_other_fees');
    expect(hints.OSSZ).toBe('ins_social_own');
    expect(hints['ZDRAVOTNI POJISTOVNA']).toBe('ins_health_own');
    expect(Object.keys(hints).every((k) => k === k.toUpperCase() && !/[^A-Z ]/.test(k))).toBe(true);
  });
  it('is sourced and dated', () => {
    const entry = rules.at('2026-06-01').resolve('bank.authority_accounts');
    expect(entry.source.startsWith('https://financnisprava.gov.cz/')).toBe(true);
    expect(entry.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
