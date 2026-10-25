# 0004: Money value object

Status: done
Ticket: P0-DOM-01 | Depends on: 0005 (merged into phase/0; it also edits `packages/domain/src/index.ts`) | Base commit: head of phase/0 after 0005 merged | Branch: task/0004-money | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add one branded `Money` value object (decimal.js, 28 significant digits, ROUND_HALF_UP, a currency code) to `packages/domain` so that float arithmetic on money is impossible by construction. Every later money, VAT and tax computation builds on this file, so correctness here beats everything else.

**All file contents in this brief are final and were verified by the brief writer in a scratch copy of the repo** (32 tests green, typecheck, `pnpm lint`, `pnpm depcruise` and the 90 % coverage gate all pass). Your job is mechanical: write each file exactly as given with one Write call, do not re-read files you just wrote, do not explore, do not "improve" anything. If a command does not give the expected result, stop and write the report (§8).

## 2. Context

Spec, 03 ADR-007 (pasted): "A `Money` value object (`decimal.js` with 28 significant digits, ROUND_HALF_UP) and a `Currency` code. No floats anywhere in domain code (lint: ban `number` arithmetic on money-typed values via a branded type)." Rounding per context (round2, round0, floor100, cash rounding) is **not** this ticket: P0-DOM-02 adds `rounding.ts` on top of `Money.toDecimal()` / `Money.fromDecimal()`. `Money` itself keeps full precision; only `toFixed2()` rounds (to 2 decimals, ROUND_HALF_UP = half away from zero).

rules.md "Money and tax" (pasted): "Amounts are `Money` (decimal.js; `numeric(15,2)` in the database, as in 05), never `number`. Property tests (fast-check) for money and VAT math." 05: foreign amounts carry `currency char(3)`; there is no currency enum, so `Currency` is a validated three-upper-case-letter string, not a union.

M12 §4.1 rule 3 `no-number-money` (already live as `tools/biome-plugins/no-number-money.grit`): `parseFloat(...)` and `Number(...)` are lint errors in `packages/domain`. The files below contain neither (`Number.NaN` would also be avoided; tests use `new Decimal('NaN')`). dependency-cruiser `domain-is-pure`: `packages/domain/src` may import only `decimal.js`, `zod` and itself.

Hard rule 1: money is never a float. Hard rule 6: the error messages in `errors.ts` are developer-facing (never shown to users); M11 maps error names through `packages/i18n`. Hard rule 7: `decimal.js` and `fast-check` are approved in decisions.md (2026-10-18 [deps]); exact versions `decimal.js@10.6.0` (published 2025-07-06) and `fast-check@4.10.2` (2026-09-19), both older than 14 days.

Design (why the tests look the way they do):

- `Money` is a class with a private constructor, an ES private field `#amount` and a `unique symbol` brand, so a plain object, a number or a look-alike class is never assignable to `Money`, and `m + m` / `m * 2` are TypeScript errors. Unary minus (`-m`) is allowed by TypeScript on any type and cannot be banned; it is not in the tests.
- `Money.parse(text, currency)` accepts only a plain decimal literal `/^-?\d+(\.\d+)?$/`. Czech formats (`1 234,56`) are normalized by extraction (M02), not here.
- Every binary operation (`add`, `subtract`, `compare`, `equals`, `sum`) throws `CurrencyMismatchError` across currencies. `-0` is normalized to `0`. `toString()` is exact and never uses exponent notation; `toFixed2()` never returns `'-0.00'`.
- `multiply`/`divide` take a decimal literal string or a `Decimal` (a rate like `'0.21'` from `packages/domain/rules`), never a `number`, and do not round.
- The property tests use amounts with ≤ 13 integer and ≤ 4 fraction digits, which are exact at 28 significant digits.

Current `packages/domain/package.json` (on phase/0, after 0005) has `"devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }` and no `dependencies` key. Current `packages/domain/src/index.ts` starts with `export const packageName = '@shoebox/domain' as const;` followed by 0005's export lines (Biome sorts exports; do not assume their order).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/package.json` | edit | add `decimal.js` dependency and `fast-check` devDependency |
| `pnpm-lock.yaml` | regenerated | by `pnpm install` |
| `packages/domain/src/money/errors.ts` | new | `MoneyError`, `InvalidCurrencyError`, `MoneyParseError`, `CurrencyMismatchError` |
| `packages/domain/src/money/currency.ts` | new | `Currency`, `CZK`, `EUR`, `isCurrency`, `assertCurrency` |
| `packages/domain/src/money/money.ts` | new | the `Money` class |
| `packages/domain/src/money/index.ts` | new | module barrel |
| `packages/domain/test/money.test.ts` | new | the tests (examples + fast-check properties + type cases) |
| `packages/domain/src/index.ts` | edit | `export * from './money/index';` |

No other file may change.

Order against parallel briefs: 0005 goes first (merged before this branch is cut). 0007 (ui tokens) also regenerates `pnpm-lock.yaml`; whichever of 0004/0007 merges second rebases on phase/0 and reruns `pnpm install` (the orchestrator handles that at review, not the executor).

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0004-money origin/phase/0`. Commit after each step as `0004 step k` (`git add -A && git commit -m "0004 step k" | tail -3`).

### Step 1: dependencies

Edit `packages/domain/package.json`. Anchor (exact):

```json
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Replace with:

```json
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:",
    "fast-check": "4.10.2"
  },
  "dependencies": {
    "decimal.js": "10.6.0"
  }
}
```

Command: `pnpm install 2>&1 | tail -8`. Expected: ends with `Done in …s`, no `ERR_`. Then `git status --short | head` shows `M packages/domain/package.json` and `M pnpm-lock.yaml` only. Commit.

### Step 2: `packages/domain/src/money/errors.ts` (new, full content)

```ts
/**
 * Developer-facing errors (messages are not user copy; M11 maps error names through
 * `packages/i18n` before anything reaches a screen).
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export class InvalidCurrencyError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid currency code: "${value}" (expected three upper-case letters, ISO 4217)`);
    this.name = 'InvalidCurrencyError';
    this.value = value;
  }
}

export class MoneyParseError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid money amount: "${value}" (expected a decimal literal such as -1234.56)`);
    this.name = 'MoneyParseError';
    this.value = value;
  }
}

export class CurrencyMismatchError extends MoneyError {
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
    this.left = left;
    this.right = right;
  }
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

### Step 3: `packages/domain/src/money/currency.ts` (new, full content)

```ts
import { InvalidCurrencyError } from './errors';

/**
 * ISO 4217 alphabetic code, three upper-case letters (05 data model: `currency char(3)`).
 * Not an enum: foreign invoices may carry any code; the rate tables decide what is convertible.
 */
export type Currency = string;

export const CZK: Currency = 'CZK';
export const EUR: Currency = 'EUR';

const CURRENCY_RE = /^[A-Z]{3}$/;

export function isCurrency(value: string): boolean {
  return CURRENCY_RE.test(value);
}

/** Returns the code unchanged, or throws `InvalidCurrencyError`. */
export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new InvalidCurrencyError(value);
  }
  return value;
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

### Step 4: `packages/domain/src/money/money.ts` (new, full content)

```ts
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
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

### Step 5: `packages/domain/src/money/index.ts` (new, full content; this is already in Biome's sort order)

```ts
export type { Currency } from './currency';
export { assertCurrency, CZK, EUR, isCurrency } from './currency';
export { CurrencyMismatchError, InvalidCurrencyError, MoneyError, MoneyParseError } from './errors';
export { MONEY_PRECISION, Money } from './money';
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

### Step 6: `packages/domain/test/money.test.ts` (new, full content; do not edit it)

```ts
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
        expect(b.compare(a)).toBe(-expected);
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
```

Command: `pnpm --filter @shoebox/domain test -- money 2>&1 | tail -30`. Expected: `Test Files  2 passed (2)` (smoke + money), `Tests  32 passed (32)`. Then `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5`: no `error TS` (an `Unused '@ts-expect-error'` error here means the source was not written exactly; stop, §8). Commit.

### Step 7: export from the package root

Edit `packages/domain/src/index.ts`. Anchor (exact, one line; other `export` lines from 0005 may follow it, leave them alone):

```ts
export const packageName = '@shoebox/domain' as const;
```

Insert directly after that line:

```ts
export * from './money/index';
```

Then run `pnpm exec biome check --write packages/domain/src/index.ts 2>&1 | tail -3` so Biome puts the export lines in its sort order (expected: `Checked 1 file …` with `Fixed 1 file` or `No fixes applied`; either is fine).

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -5` (no `error TS`) and `pnpm --filter @shoebox/domain test 2>&1 | tail -8` (all test files pass). Commit.

### Step 8: full checks and the report

Run the §6 commands, then §9.

## 5. Do not touch

- Anything outside §3. In particular not `tools/biome-plugins/`, `biome.json`, `.dependency-cruiser.cjs`, `vitest.config.ts`, `pnpm-workspace.yaml`, the root `package.json`, other packages, `docs/v3/`.
- Do not edit `test/money.test.ts` or the given source to make something pass: if a given file fails, the brief is wrong, stop (§8).
- Do not add `rounding.ts`, VAT math or any number from a law: that is P0-DOM-02/04.
- Hard rules 1 (no float money; no `parseFloat`/`Number()` in domain), 7 (no dependency other than `decimal.js@10.6.0` and `fast-check@4.10.2`), 8 (never push to `main`).

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/domain test -- money 2>&1 | tail -30` → `Tests  32 passed (32)`.
2. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0.
3. `pnpm lint 2>&1 | tail -30` → `Checked … files`, `Found 0 errors` (one pre-existing `info` line is fine).
4. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found`.
5. `pnpm test:unit 2>&1 | tail -30` → all test files pass and the coverage summary shows `Lines` ≥ 90 % (the gate for `packages/domain/src/**` is enforced by this command; the brief writer measured 99 %).

## 7. Acceptance

- [ ] `packages/domain/test/money.test.ts` (fast-check) covers add/subtract commutativity and associativity, `parse('1234.56')`, `toFixed2()`, currency mismatch throws, and the no-`number` cases as `// @ts-expect-error` lines that `pnpm --filter @shoebox/domain typecheck` compiles without an "Unused '@ts-expect-error'" error.
- [ ] `pnpm --filter @shoebox/domain test -- money` green (32 tests); `pnpm test:unit` coverage for `packages/domain/src/**` ≥ 90 % lines.
- [ ] `pnpm lint` and `pnpm depcruise` pass (no `Number()`/`parseFloat`, only `decimal.js` imported from `src`).
- [ ] `Money` is exported from `@shoebox/domain` (`packages/domain/src/index.ts`).
- Deviation from the ticket's file list: the ticket names `packages/domain/src/money.ts`; this brief uses the folder `packages/domain/src/money/` (errors, currency, money, index) so that P0-DOM-02 can add `rounding.ts` beside it without touching these files. The orchestrator notes this in the backlog at review.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, `Done: steps 1 to k. Left: steps k+1 to n.`);
- `pnpm install` fails or wants a dependency other than the two named;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0004-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -15`).
2. Each §6 command, with the last 5 lines of its output (including the coverage `Lines` percentage).
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Then `git add -A && git commit -m "0004 report" | tail -3 && git push -u origin task/0004-money 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

Read the whole diff of `packages/domain/src/money/money.ts` (the only arithmetic) and `packages/domain/test/money.test.ts` (that the type cases are still present and the property arbitraries were not narrowed). Check `packages/domain/package.json` carries exactly `decimal.js@10.6.0` and `fast-check@4.10.2` and nothing else. Check `src/index.ts` still exports 0005's symbols.

Known limits for later tickets: unary minus on a `Money` is not a type error (TypeScript allows it on any type; it evaluates to `NaN` at runtime); `m + ''` is string concatenation and compiles. Neither can produce a wrong amount silently in domain code that goes through `Money` methods, and `no-number-money` already bans `Number()`/`parseFloat`.

## Owner steps

None. The orchestrator opens the PR `task/0004-money` → `phase/0` and merges it after CI (lint, typecheck, unit with the 90 % domain coverage gate, depcruise, secrets, pii) is green.
