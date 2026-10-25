import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  CZK,
  ceil0,
  EUR,
  floor0,
  floor100,
  InvalidVatRateError,
  Money,
  MoneyError,
  MoneyParseError,
  ROUNDING_LINE_TOLERANCE_CZK,
  round0,
  round2,
  round100,
  roundCash,
  roundingLineAllowed,
  vatForRate,
} from '../src/money/index';

// ---------- helpers and arbitraries ----------

const czk = (s: string): Money => Money.parse(s, CZK);
const eur = (s: string): Money => Money.parse(s, EUR);

/** 1..max decimal digits as a string, leading zeros allowed. */
const digits = (max: number): fc.Arbitrary<string> =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: max }).map((d) => d.join(''));

/** A decimal literal with up to 13 integer and up to 6 fraction digits: exact at 28 significant digits. */
const amountLiteral: fc.Arbitrary<string> = fc
  .tuple(fc.boolean(), digits(13), fc.option(digits(6), { nil: null }))
  .map(([negative, int, frac]) => `${negative ? '-' : ''}${int}${frac === null ? '' : `.${frac}`}`);

const anyCzk: fc.Arbitrary<Money> = amountLiteral.map(czk);
const nonNegativeCzk: fc.Arbitrary<Money> = anyCzk.map((m) => m.abs());

/** A VAT percentage literal: 0..100 with up to 2 fraction digits. */
const ratePct: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 99 }), fc.option(digits(2), { nil: null }))
  .map(([int, frac]) => (frac === null ? `${int}` : `${int}.${frac}`));

/** Independent oracle: the exact amount as a plain Decimal (28 digits, outside the Money clone). */
const exact = (m: Money): Decimal => new Decimal(m.toString());

const isWholeUnits = (m: Money): boolean => exact(m).isInteger();
const isWholeHundreds = (m: Money): boolean => exact(m).div(100).isInteger();
const fractionDigits = (m: Money): number => exact(m).decimalPlaces();

// ---------- round2 ----------

describe('round2', () => {
  it('rounds half away from zero to two decimals', () => {
    expect(round2(czk('2425.495')).toString()).toBe('2425.5');
    expect(round2(czk('21.105')).toString()).toBe('21.11');
    expect(round2(czk('0.005')).toString()).toBe('0.01');
    expect(round2(czk('-0.005')).toString()).toBe('-0.01');
    expect(round2(czk('-2.675')).toString()).toBe('-2.68');
    expect(round2(czk('1.004')).toString()).toBe('1');
    expect(round2(czk('1.0049999')).toString()).toBe('1');
    expect(round2(czk('-1.0049999')).toString()).toBe('-1');
    expect(round2(czk('0.004')).toString()).toBe('0');
    expect(round2(czk('-0.004')).toString()).toBe('0');
    expect(round2(czk('1234.56')).toString()).toBe('1234.56');
    expect(round2(czk('1234.56')).toFixed2()).toBe('1234.56');
  });

  it('keeps the currency and never changes a two-decimal amount', () => {
    expect(round2(eur('99.999')).currency).toBe(EUR);
    expect(round2(eur('99.999')).toString()).toBe('100');
    expect(round2(czk('0')).isZero()).toBe(true);
    expect(round2(czk('-5.5')).equals(czk('-5.5'))).toBe(true);
  });

  it('property: |round2(x) − x| ≤ 0.005', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        const diff = exact(round2(x)).minus(exact(x)).abs();
        expect(diff.lessThanOrEqualTo('0.005')).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('property: at most two fraction digits, idempotent, symmetric in sign', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        const r = round2(x);
        expect(fractionDigits(r)).toBeLessThanOrEqual(2);
        expect(round2(r).equals(r)).toBe(true);
        expect(round2(x.negate()).equals(r.negate())).toBe(true);
        expect(r.currency).toBe(CZK);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- round0 ----------

describe('round0', () => {
  it('M05 §8 edge case 13: 2 425,50 → 2 426, half away from zero', () => {
    expect(round0(czk('2425.50')).toString()).toBe('2426');
    expect(round0(czk('2425.49')).toString()).toBe('2425');
    expect(round0(czk('2425.499999')).toString()).toBe('2425');
    expect(round0(czk('-2425.50')).toString()).toBe('-2426');
    expect(round0(czk('-2425.49')).toString()).toBe('-2425');
    expect(round0(czk('0.5')).toString()).toBe('1');
    expect(round0(czk('-0.5')).toString()).toBe('-1');
    expect(round0(czk('0.49')).toString()).toBe('0');
    expect(round0(czk('-0.49')).toString()).toBe('0');
    expect(round0(czk('13699.77')).toString()).toBe('13700');
    expect(round0(czk('2426')).toString()).toBe('2426');
    expect(round0(eur('10.5')).currency).toBe(EUR);
  });

  it('property: whole units, |round0(x) − x| ≤ 0.5, symmetric in sign', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        const r = round0(x);
        expect(isWholeUnits(r)).toBe(true);
        expect(exact(r).minus(exact(x)).abs().lessThanOrEqualTo('0.5')).toBe(true);
        expect(round0(x.negate()).equals(r.negate())).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- floor0 / ceil0 ----------

describe('floor0 and ceil0', () => {
  it('floor0 rounds the magnitude down and keeps the sign', () => {
    expect(floor0(czk('123.99')).toString()).toBe('123');
    expect(floor0(czk('123.01')).toString()).toBe('123');
    expect(floor0(czk('0.99')).toString()).toBe('0');
    expect(floor0(czk('123')).toString()).toBe('123');
    expect(floor0(czk('-123.99')).toString()).toBe('-123');
    expect(floor0(czk('-0.99')).toString()).toBe('0');
    expect(floor0(eur('7.5')).currency).toBe(EUR);
  });

  it('ceil0 is sign-preserving: sign(x) × ceil(|x|) (M05 §4)', () => {
    expect(ceil0(czk('123.01')).toString()).toBe('124');
    expect(ceil0(czk('123.99')).toString()).toBe('124');
    expect(ceil0(czk('0.01')).toString()).toBe('1');
    expect(ceil0(czk('123')).toString()).toBe('123');
    expect(ceil0(czk('-123.01')).toString()).toBe('-124');
    expect(ceil0(czk('-0.01')).toString()).toBe('-1');
    expect(ceil0(czk('0')).toString()).toBe('0');
  });

  it('property: for x ≥ 0, floor0(x) ≤ x < floor0(x) + 1 and ceil0(x) − 1 < x ≤ ceil0(x)', () => {
    fc.assert(
      fc.property(nonNegativeCzk, (x) => {
        const f = floor0(x);
        const c = ceil0(x);
        expect(isWholeUnits(f)).toBe(true);
        expect(isWholeUnits(c)).toBe(true);
        const underflow = exact(x).minus(exact(f));
        const overflow = exact(c).minus(exact(x));
        expect(underflow.greaterThanOrEqualTo(0) && underflow.lessThan(1)).toBe(true);
        expect(overflow.greaterThanOrEqualTo(0) && overflow.lessThan(1)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('property: floor0 and ceil0 are symmetric in sign', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        expect(floor0(x.negate()).equals(floor0(x).negate())).toBe(true);
        expect(ceil0(x.negate()).equals(ceil0(x).negate())).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- round100 / floor100 ----------

describe('round100 and floor100', () => {
  it('floor100 rounds the DPFO base down to whole hundreds', () => {
    expect(floor100(czk('123456.78')).toString()).toBe('123400');
    expect(floor100(czk('123499.99')).toString()).toBe('123400');
    expect(floor100(czk('123500')).toString()).toBe('123500');
    expect(floor100(czk('199.99')).toString()).toBe('100');
    expect(floor100(czk('100')).toString()).toBe('100');
    expect(floor100(czk('99.99')).toString()).toBe('0');
    expect(floor100(czk('0')).toString()).toBe('0');
    expect(floor100(czk('-150')).toString()).toBe('-100');
    expect(floor100(eur('250')).currency).toBe(EUR);
  });

  it('round100 rounds half away from zero to whole hundreds (display only)', () => {
    expect(round100(czk('13649.99')).toString()).toBe('13600');
    expect(round100(czk('13650')).toString()).toBe('13700');
    expect(round100(czk('13749.99')).toString()).toBe('13700');
    expect(round100(czk('50')).toString()).toBe('100');
    expect(round100(czk('49.99')).toString()).toBe('0');
    expect(round100(czk('-150')).toString()).toBe('-200');
    expect(round100(czk('-149.99')).toString()).toBe('-100');
  });

  it('property: for x ≥ 0, floor100(x) is a multiple of 100 with 0 ≤ x − floor100(x) < 100', () => {
    fc.assert(
      fc.property(nonNegativeCzk, (x) => {
        const f = floor100(x);
        expect(isWholeHundreds(f)).toBe(true);
        const underflow = exact(x).minus(exact(f));
        expect(underflow.greaterThanOrEqualTo(0) && underflow.lessThan(100)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('property: round100(x) is a multiple of 100 with |round100(x) − x| ≤ 50', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        const r = round100(x);
        expect(isWholeHundreds(r)).toBe(true);
        expect(exact(r).minus(exact(x)).abs().lessThanOrEqualTo(50)).toBe(true);
        expect(round100(x.negate()).equals(r.negate())).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- vatForRate ----------

describe('vatForRate', () => {
  it('is round2(base × rate / 100), M05 §9 example: 11 549,94 × 21 % = 2 425,49', () => {
    expect(vatForRate(czk('11549.94'), '21').toString()).toBe('2425.49');
    expect(vatForRate(czk('10000'), '12').toString()).toBe('1200');
    expect(vatForRate(czk('10000'), '21').toFixed2()).toBe('2100.00');
    expect(vatForRate(czk('100.50'), '21').toString()).toBe('21.11');
    expect(vatForRate(czk('-1000'), '21').toString()).toBe('-210');
    expect(vatForRate(czk('100.50'), new Decimal('21')).toString()).toBe('21.11');
    expect(vatForRate(czk('123.45'), '0').isZero()).toBe(true);
    expect(vatForRate(czk('123.45'), '100').toString()).toBe('123.45');
    expect(vatForRate(czk('0'), '21').isZero()).toBe(true);
    expect(vatForRate(eur('90'), '21').toString()).toBe('18.9');
    expect(vatForRate(eur('90'), '21').currency).toBe(EUR);
  });

  it('rejects a rate outside 0..100 or not a decimal literal', () => {
    for (const bad of ['-1', '100.01', '101', '21%', 'abc', '', '0,21']) {
      expect(() => vatForRate(czk('100'), bad)).toThrow(InvalidVatRateError);
      expect(() => vatForRate(czk('100'), bad)).toThrow(MoneyError);
    }
    expect(() => vatForRate(czk('100'), new Decimal('-21'))).toThrow(InvalidVatRateError);
    expect(() => vatForRate(czk('100'), new Decimal('NaN'))).toThrow(InvalidVatRateError);
    try {
      vatForRate(czk('100'), '101');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidVatRateError);
      expect((error as InvalidVatRateError).value).toBe('101');
      expect((error as InvalidVatRateError).name).toBe('InvalidVatRateError');
    }
  });

  it('property: equals round2 of the exact product and is within 0.005 of it', () => {
    fc.assert(
      fc.property(anyCzk, ratePct, (base, rate) => {
        const vat = vatForRate(base, rate);
        const exactVat = exact(base).times(rate).div(100);
        expect(vat.equals(round2(Money.fromDecimal(exactVat, CZK)))).toBe(true);
        expect(exact(vat).minus(exactVat).abs().lessThanOrEqualTo('0.005')).toBe(true);
        expect(fractionDigits(vat)).toBeLessThanOrEqual(2);
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------- roundingLineAllowed ----------

describe('roundingLineAllowed', () => {
  it('allows |diff| ≤ 1.00 CZK, inclusive', () => {
    expect(ROUNDING_LINE_TOLERANCE_CZK.toString()).toBe('1');
    expect(ROUNDING_LINE_TOLERANCE_CZK.currency).toBe(CZK);
    expect(roundingLineAllowed(czk('0'))).toBe(true);
    expect(roundingLineAllowed(czk('0.01'))).toBe(true);
    expect(roundingLineAllowed(czk('0.99'))).toBe(true);
    expect(roundingLineAllowed(czk('1.00'))).toBe(true);
    expect(roundingLineAllowed(czk('-1.00'))).toBe(true);
    expect(roundingLineAllowed(czk('1.001'))).toBe(false);
    expect(roundingLineAllowed(czk('1.01'))).toBe(false);
    expect(roundingLineAllowed(czk('-1.01'))).toBe(false);
    expect(roundingLineAllowed(czk('250'))).toBe(false);
  });

  it('needs a tolerance in the currency of the difference', () => {
    expect(() => roundingLineAllowed(eur('0.50'))).toThrow(CurrencyMismatchError);
    expect(roundingLineAllowed(eur('0.50'), eur('0.50'))).toBe(true);
    expect(roundingLineAllowed(eur('0.51'), eur('0.50'))).toBe(false);
    expect(roundingLineAllowed(czk('0.50'), czk('0.49'))).toBe(false);
    expect(roundingLineAllowed(czk('0'), czk('0'))).toBe(true);
    expect(() => roundingLineAllowed(czk('0'), czk('-1'))).toThrow(MoneyParseError);
  });

  it('property: roundingLineAllowed(diff) ⇔ |diff| ≤ 1.00', () => {
    fc.assert(
      fc.property(anyCzk, (diff) => {
        expect(roundingLineAllowed(diff)).toBe(exact(diff).abs().lessThanOrEqualTo(1));
      }),
      { numRuns: 500 },
    );
  });

  it('property: around the boundary (0.99 .. 1.01)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 990, max: 1010 }), fc.boolean(), (thousandths, negative) => {
        const signed = new Decimal(negative ? -thousandths : thousandths);
        const diff = Money.fromDecimal(signed.div(1000), CZK);
        expect(roundingLineAllowed(diff)).toBe(thousandths <= 1000);
      }),
    );
  });
});

// ---------- roundCash ----------

describe('roundCash', () => {
  it('rounds a CZK cash amount half away from zero to whole CZK', () => {
    expect(roundCash(czk('123.50')).toString()).toBe('124');
    expect(roundCash(czk('123.49')).toString()).toBe('123');
    expect(roundCash(czk('123.01')).toString()).toBe('123');
    expect(roundCash(czk('-10.50')).toString()).toBe('-11');
    expect(roundCash(czk('100')).toString()).toBe('100');
    expect(roundCash(czk('0.49')).toString()).toBe('0');
    expect(roundCash(czk('123.50')).currency).toBe(CZK);
  });

  it('refuses a non-CZK amount', () => {
    expect(() => roundCash(eur('10.50'))).toThrow(CurrencyMismatchError);
    expect(() => roundCash(eur('10.50'))).toThrow('Currency mismatch: CZK vs EUR');
  });

  it('property: equals round0 for CZK and is whole CZK within 0.5', () => {
    fc.assert(
      fc.property(anyCzk, (x) => {
        const r = roundCash(x);
        expect(r.equals(round0(x))).toBe(true);
        expect(isWholeUnits(r)).toBe(true);
        expect(exact(r).minus(exact(x)).abs().lessThanOrEqualTo('0.5')).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- immutability ----------

describe('rounding does not mutate its input', () => {
  it('the input keeps its exact amount', () => {
    const x = czk('2425.495');
    round2(x);
    round0(x);
    floor0(x);
    ceil0(x);
    round100(x);
    floor100(x);
    roundCash(x);
    vatForRate(x, '21');
    roundingLineAllowed(x);
    expect(x.toString()).toBe('2425.495');
  });
});

// ---------- types: no number accepted (checked by `pnpm typecheck`, not at runtime) ----------

/** Each line below must stay a type error; tsc fails the build if an `@ts-expect-error` is unused. */
function typeErrors(m: Money): void {
  // @ts-expect-error a number is not Money
  round2(2425.495);
  // @ts-expect-error a string is not Money
  round0('2425.50');
  // @ts-expect-error a number is not Money
  floor100(123456.78);
  // @ts-expect-error a number is not a rate
  vatForRate(m, 21);
  // @ts-expect-error a number is not Money
  roundingLineAllowed(0.5);
  // @ts-expect-error a number is not a tolerance
  roundingLineAllowed(m, 1);
  // @ts-expect-error a number is not Money
  roundCash(123.5);
  // @ts-expect-error the result is not a number
  const n: number = round2(m);
  void n;
}

describe('rounding types', () => {
  it('the type-error cases are compiled by typecheck', () => {
    expect(typeof typeErrors).toBe('function');
  });
});
