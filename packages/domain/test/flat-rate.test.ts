import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeFlatRateComparison, FLAT_RATE_CAVEAT_KEYS } from '../src/income-tax/flat-rate';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, CZK);
const cmp = (income: string, actual: string, rate: 80 | 60 | 40 | 30, r = rules) =>
  computeFlatRateComparison(czk(income), czk(actual), rate, r, 2026);
const f = (m: Money) => m.toFixed2();

describe('computeFlatRateComparison golden (M06 §9)', () => {
  it('S2: 80 % on 1 400 000 → flat 1 120 000, bases 280 000 vs 880 000, flat better by 600 000', () => {
    const c = cmp('1400000.00', '520000.00', 80);
    expect([f(c.incomeKc), f(c.capKc), f(c.flatRaw), f(c.flat), c.capReached]).toEqual([
      '1400000.00',
      '1600000.00',
      '1120000.00',
      '1120000.00',
      false,
    ]);
    expect([f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual([
      '280000.00',
      '880000.00',
      'flat',
      '600000.00',
    ]);
    expect(c.caveatKeys).toEqual([...FLAT_RATE_CAVEAT_KEYS]);
  });
  it('S2b: 2 300 000 at 80 % hits the 1 600 000 cap', () => {
    const c = cmp('2300000.00', '520000.00', 80);
    expect([f(c.flatRaw), f(c.flat), c.capReached, f(c.baseFlat)]).toEqual([
      '1840000.00',
      '1600000.00',
      true,
      '700000.00',
    ]);
  });
  it('S3: 3 500 000 at 60 % capped at 1 200 000; actual 2 900 000 is better by 1 700 000', () => {
    const c = cmp('3500000.00', '2900000.00', 60);
    expect([
      f(c.flatRaw),
      f(c.flat),
      c.capReached,
      f(c.baseFlat),
      f(c.baseActual),
      c.better,
      f(c.difference),
    ]).toEqual([
      '2100000.00',
      '1200000.00',
      true,
      '2300000.00',
      '600000.00',
      'actual',
      '1700000.00',
    ]);
  });
  it('S4: 240 000 at 60 % → flat 144 000; actual 98 459,81 rounds to 98 460 → base 141 540; difference 45 540', () => {
    const c = cmp('240000.00', '98459.81', 60);
    expect([f(c.flat), f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual([
      '144000.00',
      '96000.00',
      '141540.00',
      'flat',
      '45540.00',
    ]);
  });
  it('rounding: income half-up, flat-rate expense floored; equal bases → equal', () => {
    const c = cmp('1000.50', '600.00', 60); // 1 001 × 0,6 = 600,6 → 600
    expect([
      f(c.incomeKc),
      f(c.flat),
      f(c.baseFlat),
      f(c.baseActual),
      c.better,
      f(c.difference),
    ]).toEqual(['1001.00', '600.00', '401.00', '401.00', 'equal', '0.00']);
    expect(f(cmp('0.00', '0.00', 40).flat)).toBe('0.00');
  });
  it('general 7: an override row on pausalni_vydaje.rates_caps changes S2b without a deploy', () => {
    const overridden = createCzRules([
      {
        key: 'pausalni_vydaje.rates_caps',
        layer: 'override',
        valid_from: '2026-01-01',
        valid_to: null,
        source: 'test',
        verified_at: '2026-10-26',
        value: { '80': 1_900_000, '60': 1_200_000, '40': 800_000, '30': 600_000 },
      },
    ]);
    const c = cmp('2300000.00', '520000.00', 80, overridden);
    expect([f(c.capKc), f(c.flat), c.capReached]).toEqual(['1900000.00', '1840000.00', false]);
  });
});

describe('properties (M06 §9 general 4)', () => {
  it('flat ≤ cap and flat ≤ income × rate / 100; baseFlat + flat = incomeKc', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000_000 }),
        fc.integer({ min: 0, max: 500_000_000 }),
        fc.constantFrom(80, 60, 40, 30),
        (inc, act, rate) => {
          const c = computeFlatRateComparison(
            Money.fromDecimal(czk(String(inc)).toDecimal().div(100), CZK),
            Money.fromDecimal(czk(String(act)).toDecimal().div(100), CZK),
            rate as 80 | 60 | 40 | 30,
            rules,
            2026,
          );
          expect(c.flat.compare(c.capKc) <= 0).toBe(true);
          expect(c.flat.toDecimal().lte(c.incomeKc.toDecimal().times(rate).div(100))).toBe(true);
          expect(f(c.baseFlat.add(c.flat))).toBe(f(c.incomeKc));
          expect(c.difference.compare(Money.zero(CZK)) >= 0).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
