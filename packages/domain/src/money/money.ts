import { Decimal } from 'decimal.js';
import { assertCurrency, type Currency } from './currency';
import { CurrencyMismatchError, MoneyParseError } from './errors';

/** ADR-007: 28 significant digits, ROUND_HALF_UP (half away from zero). */
export const MONEY_PRECISION = 28;

/**
 * The only Decimal constructor used for money. Cloned so that no other decimal.js
 * configuration in the process can change money arithmetic. `toExpNeg`/`toExpPos`
 * keep `toString()` in plain notation (never `1e+21`).
 */
const MoneyDecimal = Decimal.clone({
  precision: MONEY_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** A decimal literal: optional minus, digits, optional fraction. No sign `+`, spaces, commas or exponent. */
const DECIMAL_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/** `Money` is nominal: the brand and the private field make it unassignable from plain objects or numbers. */
declare const moneyBrand: unique symbol;

export class Money {
  declare readonly [moneyBrand]: true;

  readonly currency: Currency;
  readonly #amount: Decimal;

  private constructor(amount: Decimal, currency: Currency) {
    // Normalize -0 to 0 so that toString() and equals() have one zero.
    this.#amount = amount.isZero() ? new MoneyDecimal(0) : amount;
    this.currency = currency;
  }

  /** `Money.parse('1234.56', 'CZK')`. Only a decimal literal is accepted; never a `number`. */
  static parse(text: string, currency: Currency): Money {
    return new Money(parseLiteral(text), assertCurrency(currency));
  }

  static zero(currency: Currency): Money {
    return new Money(new MoneyDecimal(0), assertCurrency(currency));
  }

  /** For the rounding functions (P0-DOM-02) and rule math; rejects NaN and ±Infinity. */
  static fromDecimal(amount: Decimal, currency: Currency): Money {
    const value = new MoneyDecimal(amount);
    if (!value.isFinite()) {
      throw new MoneyParseError(amount.toString());
    }
    return new Money(value, assertCurrency(currency));
  }

  static fromJSON(json: { readonly amount: string; readonly currency: string }): Money {
    return Money.parse(json.amount, json.currency);
  }

  /** Sum of `items`, all in `currency`; the empty sum is `Money.zero(currency)`. */
  static sum(items: readonly Money[], currency: Currency): Money {
    let total = Money.zero(currency);
    for (const item of items) {
      total = total.add(item);
    }
    return total;
  }

  static isMoney(value: unknown): value is Money {
    return value instanceof Money;
  }

  /** A fresh Decimal (Money stays immutable). */
  toDecimal(): Decimal {
    return new MoneyDecimal(this.#amount);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.#amount.plus(other.#amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.#amount.minus(other.#amount), this.currency);
  }

  negate(): Money {
    return new Money(this.#amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.#amount.abs(), this.currency);
  }

  /** Multiply by a rate or quantity given as a decimal literal or a Decimal (e.g. a VAT rate `'0.21'`). Not rounded. */
  multiply(factor: string | Decimal): Money {
    return new Money(this.#amount.times(toDecimal(factor)), this.currency);
  }

  /** Divide by a non-zero decimal literal or Decimal. Not rounded. */
  divide(divisor: string | Decimal): Money {
    const value = toDecimal(divisor);
    if (value.isZero()) {
      throw new MoneyParseError(value.toString());
    }
    return new Money(this.#amount.div(value), this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    const cmp = this.#amount.comparedTo(other.#amount);
    if (cmp < 0) {
      return -1;
    }
    return cmp > 0 ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.compare(other) === 0;
  }

  isZero(): boolean {
    return this.#amount.isZero();
  }

  isNegative(): boolean {
    return this.#amount.isNegative() && !this.#amount.isZero();
  }

  isPositive(): boolean {
    return this.#amount.isPositive() && !this.#amount.isZero();
  }

  /** Two decimals, ROUND_HALF_UP, plain notation; a rounded zero is `'0.00'`, never `'-0.00'`. */
  toFixed2(): string {
    const rounded = this.#amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return (rounded.isZero() ? new MoneyDecimal(0) : rounded).toFixed(2);
  }

  /** Exact amount in plain notation, e.g. `'1234.56'`, `'0'`, `'-0.005'`. */
  toString(): string {
    return this.#amount.toFixed();
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function parseLiteral(text: string): Decimal {
  if (typeof text !== 'string' || !DECIMAL_LITERAL_RE.test(text)) {
    throw new MoneyParseError(String(text));
  }
  return new MoneyDecimal(text);
}

function toDecimal(value: string | Decimal): Decimal {
  if (typeof value === 'string') {
    return parseLiteral(value);
  }
  const result = new MoneyDecimal(value);
  if (!result.isFinite()) {
    throw new MoneyParseError(value.toString());
  }
  return result;
}
