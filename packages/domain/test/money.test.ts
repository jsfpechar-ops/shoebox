import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertCurrency,
  CurrencyMismatchError,
  CZK,
  EUR,
  InvalidCurrencyError,
  isCurrency,
  MONEY_PRECISION,
  Money,
  MoneyError,
  MoneyParseError,
} from '../src/money/index';

// ---------- arbitraries ----------

/** 1..max decimal digits as a string, leading zeros allowed. */
const digits = (max: number): fc.Arbitrary<string> =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: max }).map((d) => d.join(''));

/** A decimal literal with up to 13 integer and 4 fraction digits: exact at 28 significant digits. */
const amountLiteral: fc.Arbitrary<string> = fc
  .tuple(fc.boolean(), digits(13), fc.option(digits(4), { nil: null }))
  .map(([negative, int, frac]) => `${negative ? '-' : ''}${int}${frac === null ? '' : `.${frac}`}`);

const czk: fc.Arbitrary<Money> = amountLiteral.map((s) => Money.parse(s, CZK));
const eur: fc.Arbitrary<Money> = amountLiteral.map((s) => Money.parse(s, EUR));

const half = Money.parse('0.005', CZK);

// ---------- currency ----------

describe('Currency', () => {
  it('accepts three upper-case letters only', () => {
    expect(isCurrency('CZK')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    for (const bad of ['czk', 'CZ', 'CZKK', '', 'CZ1', ' CZK', 'Kč']) {
      expect(isCurrency(bad)).toBe(false);
    }
  });

  it('assertCurrency returns the code or throws InvalidCurrencyError', () => {
    expect(assertCurrency('CZK')).toBe(CZK);
    expect(() => assertCurrency('czk')).toThrow(InvalidCurrencyError);
    expect(() => assertCurrency('czk')).toThrow(MoneyError);
    expect(() => Money.parse('1', 'czk')).toThrow(InvalidCurrencyError);
    expect(() => Money.zero('')).toThrow(InvalidCurrencyError);
    expect(() => Money.fromDecimal(new Decimal(1), 'EURO')).toThrow(InvalidCurrencyError);
  });

  it('exposes the constants', () => {
    expect(CZK).toBe('CZK');
    expect(EUR).toBe('EUR');
    expect(MONEY_PRECISION).toBe(28);
  });
});

// ---------- parse / format ----------

describe('Money.parse and formatting', () => {
  it('parses a decimal literal', () => {
    const m = Money.parse('1234.56', CZK);
    expect(m.currency).toBe('CZK');
    expect(m.toString()).toBe('1234.56');
    expect(m.toFixed2()).toBe('1234.56');
    expect(m.toJSON()).toEqual({ amount: '1234.56', currency: 'CZK' });
  });

  it('keeps full precision in toString and rounds only in toFixed2', () => {
    expect(Money.parse('2.345', CZK).toString()).toBe('2.345');
    expect(Money.parse('2.345', CZK).toFixed2()).toBe('2.35');
    expect(Money.parse('2.344', CZK).toFixed2()).toBe('2.34');
    expect(Money.parse('-2.345', CZK).toFixed2()).toBe('-2.35');
    expect(Money.parse('0.125', CZK).toFixed2()).toBe('0.13');
    expect(Money.parse('1', CZK).toFixed2()).toBe('1.00');
    expect(Money.parse('1234567890123.5', CZK).toFixed2()).toBe('1234567890123.50');
    expect(Money.parse('1234567890123.5', CZK).toString()).toBe('1234567890123.5');
  });

  it('has exactly one zero', () => {
    expect(Money.parse('-0', CZK).toString()).toBe('0');
    expect(Money.parse('0.000', CZK).toString()).toBe('0');
    expect(Money.parse('-0.001', CZK).toFixed2()).toBe('0.00');
    expect(Money.zero(CZK).toString()).toBe('0');
    expect(Money.zero(CZK).toFixed2()).toBe('0.00');
    expect(Money.parse('-0', CZK).equals(Money.zero(CZK))).toBe(true);
  });

  it('never prints exponent notation', () => {
    expect(Money.parse('100000000000000000000000', CZK).toString()).toBe(
      '100000000000000000000000',
    );
    expect(Money.parse('0.00000001', CZK).toString()).toBe('0.00000001');
  });

  it('rejects everything that is not a plain decimal literal', () => {
    for (const bad of [
      '',
      ' 1',
      '1 ',
      '1,5',
      '1 000',
      '1e3',
      '+1',
      '1.',
      '.5',
      '-',
      'abc',
      'NaN',
      'Infinity',
      '0x10',
      '1_000',
    ]) {
      expect(() => Money.parse(bad, CZK), bad).toThrow(MoneyParseError);
    }
  });

  it('rejects a number smuggled in at runtime', () => {
    const notAString = 12.5 as unknown as string;
    expect(() => Money.parse(notAString, CZK)).toThrow(MoneyParseError);
  });

  it('fromDecimal accepts finite decimals and rejects NaN and Infinity', () => {
    expect(Money.fromDecimal(new Decimal('10.5'), EUR).toString()).toBe('10.5');
    expect(Money.fromDecimal(new Decimal(-0), EUR).toString()).toBe('0');
    expect(() => Money.fromDecimal(new Decimal('NaN'), EUR)).toThrow(MoneyParseError);
    expect(() => Money.fromDecimal(new Decimal('Infinity'), EUR)).toThrow(MoneyParseError);
  });

  it('toDecimal returns a fresh value that cannot mutate the Money', () => {
    const m = Money.parse('1.5', CZK);
    const d = m.toDecimal();
    expect(d.toString()).toBe('1.5');
    expect(d.plus(1).toString()).toBe('2.5');
    expect(m.toString()).toBe('1.5');
  });

  it('fromJSON and toJSON round-trip', () => {
    const m = Money.parse('-99.99', EUR);
    expect(Money.fromJSON(m.toJSON()).equals(m)).toBe(true);
    expect(JSON.parse(JSON.stringify({ total: m }))).toEqual({
      total: { amount: '-99.99', currency: 'EUR' },
    });
    expect(() => Money.fromJSON({ amount: '1', currency: 'eur' })).toThrow(InvalidCurrencyError);
    expect(() => Money.fromJSON({ amount: '1,0', currency: 'EUR' })).toThrow(MoneyParseError);
  });

  it('isMoney', () => {
    expect(Money.isMoney(Money.zero(CZK))).toBe(true);
    expect(Money.isMoney({ amount: '1', currency: 'CZK' })).toBe(false);
    expect(Money.isMoney(1)).toBe(false);
    expect(Money.isMoney(null)).toBe(false);
  });
});

// ---------- arithmetic ----------

describe('Money arithmetic', () => {
  it('0.1 + 0.2 is 0.3', () => {
    expect(Money.parse('0.1', CZK).add(Money.parse('0.2', CZK)).toString()).toBe('0.3');
  });

  it('add, subtract, negate, abs', () => {
    const a = Money.parse('100.10', CZK);
    const b = Money.parse('0.15', CZK);
    expect(a.add(b).toString()).toBe('100.25');
    expect(a.subtract(b).toString()).toBe('99.95');
    expect(b.subtract(a).toString()).toBe('-99.95');
    expect(a.negate().toString()).toBe('-100.1');
    expect(a.negate().abs().toString()).toBe('100.1');
    expect(Money.zero(CZK).negate().toString()).toBe('0');
  });

  it('multiply by a rate (not rounded) and divide', () => {
    const base = Money.parse('1000', CZK);
    expect(base.multiply('0.21').toString()).toBe('210');
    expect(Money.parse('123.45', CZK).multiply('0.21').toString()).toBe('25.9245');
    expect(base.multiply(new Decimal('0.12')).toString()).toBe('120');
    expect(base.multiply('-1').toString()).toBe('-1000');
    expect(base.multiply('0').toString()).toBe('0');
    expect(base.divide('4').toString()).toBe('250');
    expect(base.divide(new Decimal(8)).toString()).toBe('125');
    expect(Money.parse('100', CZK).divide('3').toString()).toBe('33.33333333333333333333333333');
  });

  it('rejects bad factors and division by zero', () => {
    const m = Money.parse('1', CZK);
    expect(() => m.multiply('abc')).toThrow(MoneyParseError);
    expect(() => m.multiply('1,5')).toThrow(MoneyParseError);
    expect(() => m.multiply(new Decimal('NaN'))).toThrow(MoneyParseError);
    expect(() => m.divide('0')).toThrow(MoneyParseError);
    expect(() => m.divide('0.0')).toThrow(MoneyParseError);
    expect(() => m.divide(new Decimal(0))).toThrow(MoneyParseError);
  });

  it('compare, equals and sign predicates', () => {
    const a = Money.parse('1', CZK);
    const b = Money.parse('2', CZK);
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(Money.parse('1.0', CZK))).toBe(0);
    expect(a.equals(Money.parse('1.00', CZK))).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.isPositive()).toBe(true);
    expect(a.isNegative()).toBe(false);
    expect(a.isZero()).toBe(false);
    expect(a.negate().isNegative()).toBe(true);
    expect(a.negate().isPositive()).toBe(false);
    expect(Money.zero(CZK).isZero()).toBe(true);
    expect(Money.zero(CZK).isPositive()).toBe(false);
    expect(Money.zero(CZK).isNegative()).toBe(false);
  });

  it('sum', () => {
    const items = ['1.10', '2.20', '-0.30'].map((s) => Money.parse(s, CZK));
    expect(Money.sum(items, CZK).toString()).toBe('3');
    expect(Money.sum([], CZK).toString()).toBe('0');
    expect(Money.sum([], EUR).currency).toBe('EUR');
  });

  it('every binary operation throws CurrencyMismatchError across currencies', () => {
    const a = Money.parse('1', CZK);
    const b = Money.parse('1', EUR);
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
    expect(() => a.subtract(b)).toThrow(CurrencyMismatchError);
    expect(() => a.compare(b)).toThrow(CurrencyMismatchError);
    expect(() => a.equals(b)).toThrow(CurrencyMismatchError);
    expect(() => Money.sum([a, b], CZK)).toThrow(CurrencyMismatchError);
    expect(() => Money.sum([a], EUR)).toThrow(CurrencyMismatchError);
    try {
      a.add(b);
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyError);
      expect((error as CurrencyMismatchError).left).toBe('CZK');
      expect((error as CurrencyMismatchError).right).toBe('EUR');
      expect((error as CurrencyMismatchError).name).toBe('CurrencyMismatchError');
    }
  });
});

// ---------- properties (fast-check) ----------

describe('Money properties', () => {
  it('add is commutative', () => {
    fc.assert(
      fc.property(czk, czk, (a, b) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }),
    );
  });

  it('add is associative', () => {
    fc.assert(
      fc.property(czk, czk, czk, (a, b, c) => {
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
      }),
    );
  });

  it('subtract is the inverse of add, zero is the identity', () => {
    fc.assert(
      fc.property(czk, czk, (a, b) => {
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
        expect(a.subtract(b).add(b).equals(a)).toBe(true);
        expect(a.add(Money.zero(CZK)).equals(a)).toBe(true);
        expect(a.subtract(a).isZero()).toBe(true);
      }),
    );
  });

  it('negate is an involution and abs is non-negative', () => {
    fc.assert(
      fc.property(czk, (a) => {
        expect(a.negate().negate().equals(a)).toBe(true);
        expect(a.add(a.negate()).isZero()).toBe(true);
        expect(a.abs().isNegative()).toBe(false);
        expect(a.abs().equals(a.isNegative() ? a.negate() : a)).toBe(true);
      }),
    );
  });

  it('multiply by 1 and divide by 1 are identities, multiply by 0 is zero', () => {
    fc.assert(
      fc.property(czk, (a) => {
        expect(a.multiply('1').equals(a)).toBe(true);
        expect(a.divide('1').equals(a)).toBe(true);
        expect(a.multiply('0').isZero()).toBe(true);
        expect(a.multiply('2').equals(a.add(a))).toBe(true);
      }),
    );
  });

  it('parse(toString()) round-trips and the literal is normalized', () => {
    fc.assert(
      fc.property(czk, (a) => {
        const text = a.toString();
        expect(text).toMatch(/^-?\d+(\.\d*[1-9])?$/);
        expect(Money.parse(text, CZK).equals(a)).toBe(true);
        expect(Money.fromJSON(a.toJSON()).equals(a)).toBe(true);
      }),
    );
  });

  it('toFixed2 has two decimals and is within 0.005 of the exact value', () => {
    fc.assert(
      fc.property(czk, (a) => {
        const fixed = a.toFixed2();
        expect(fixed).toMatch(/^-?\d+\.\d{2}$/);
        expect(fixed).not.toBe('-0.00');
        const diff = Money.parse(fixed, CZK).subtract(a).abs();
        expect(diff.compare(half)).toBeLessThanOrEqual(0);
      }),
    );
  });

  it('compare agrees with the sign of the difference and is antisymmetric', () => {
    fc.assert(
      fc.property(czk, czk, (a, b) => {
        const diff = a.subtract(b);
        const expected = diff.isZero() ? 0 : diff.isNegative() ? -1 : 1;
        expect(a.compare(b)).toBe(expected);
        expect(b.compare(a)).toBe(expected === 0 ? 0 : -expected); // -0 fails Object.is when a equals b
        expect(a.equals(b)).toBe(expected === 0);
      }),
    );
  });

  it('sum equals a left fold', () => {
    fc.assert(
      fc.property(fc.array(czk, { maxLength: 20 }), (items) => {
        const folded = items.reduce((acc, m) => acc.add(m), Money.zero(CZK));
        expect(Money.sum(items, CZK).equals(folded)).toBe(true);
      }),
    );
  });

  it('any mixed-currency operation throws', () => {
    fc.assert(
      fc.property(czk, eur, (a, b) => {
        expect(() => a.add(b)).toThrow(CurrencyMismatchError);
        expect(() => b.subtract(a)).toThrow(CurrencyMismatchError);
        expect(() => a.compare(b)).toThrow(CurrencyMismatchError);
      }),
    );
  });
});

// ---------- types: no number accepted (checked by `pnpm typecheck`, not at runtime) ----------

/** Each line below must stay a type error; tsc fails the build if an `@ts-expect-error` is unused. */
function typeErrors(m: Money): void {
  // @ts-expect-error a number is not an amount
  Money.parse(1234.56, CZK);
  // @ts-expect-error a number is not Money
  m.add(5);
  // @ts-expect-error a number is not Money
  m.subtract(1234.56);
  // @ts-expect-error a number is not a factor
  m.multiply(2);
  // @ts-expect-error a number is not a divisor
  m.divide(2);
  // @ts-expect-error a bigint is not Money
  m.add(5n);
  // @ts-expect-error money is not a number
  const n: number = m;
  // @ts-expect-error no arithmetic on Money
  const sum = m + m;
  // @ts-expect-error no arithmetic on Money
  const product = m * 2;
  // @ts-expect-error a plain object is not Money
  const fake: Money = { currency: 'CZK', amount: '1' };
  // @ts-expect-error the constructor is private
  const made = new Money();
  // @ts-expect-error a structurally similar class is not Money
  const other: Money = new (class {
    readonly currency = 'CZK';
  })();
  void [n, sum, product, fake, made, other];
}

describe('Money types', () => {
  it('the type-error cases are compiled by typecheck', () => {
    expect(typeof typeErrors).toBe('function');
  });
});
