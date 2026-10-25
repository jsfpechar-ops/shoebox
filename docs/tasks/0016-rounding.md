# 0016: Named rounding functions

Status: done
Ticket: P0-DOM-02 | Depends on: none (P0-DOM-01 merged) | Base commit: head of phase/0 | Branch: task/0016-rounding | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `packages/domain/src/money/rounding.ts`: every rounding context of ADR-007 (`round2`, `round0`, `floor0`, `ceil0`, `round100`, `floor100`, `vatForRate`, `roundingLineAllowed`, `roundCash`) as a named pure function over `Money`, so that no VAT, tax or ledger code ever rounds inline. A wrong rounding here is a wrong tax return, so the files below are final.

**All file contents in this brief are final and were verified by the brief writer in a scratch copy** (26 tests green, `tsc` clean, Biome clean, `rounding.ts` 96 % lines covered). Your job is mechanical: write each file exactly as given with one Write call, do not re-read a file you just wrote, do not explore, do not "improve" anything. If a command does not give the expected result, stop and write the report (§8).

## 2. Context

Spec, 03 ADR-007 (pasted): "Rounding rules per context, implemented as named functions in `packages/domain/rounding.ts`: VAT per rate on a document: `round2(base × rate)`. Supplier's printed totals are authoritative. Any difference ≤ 1.00 CZK becomes a `rounding` line. Cash payment rounding: to whole CZK. Tax return fields: whole CZK. Tax base for DPFO: rounded down to whole hundreds." `Money` is decimal.js, 28 digits, ROUND_HALF_UP.

M05 §8 edge case 13 (pasted): "Rounding to exactly .50 → half away from zero (e.g. 2 425,50 → 2 426)." M05 §4 (pasted): "Functions: `round2(x)`, `round0(x)` (half-up to whole CZK), `ceil0(x)` (sign-preserving: `sign(x) × ceil(|x|)`)." M05 §4.2: "`vat_czk = round2(base_czk × vat_rate_pct / 100)`"; the rule `vat.rates` (06) stores percentages `{standard: 21, reduced: 12}`, so `vatForRate` takes the percentage, not the fraction. M05 §9 example: 11 549,94 × 21 % = 2 425,49.

M06 §4 (pasted): "`round0` = half-up to whole CZK; `floor0`; `round100` = to nearest 100 (display only); `floor100` = down to whole hundreds (DAP base, ADR-007)." M06 §4.3: "`flatRaw = floor0(incomeKc × rate / 100)` // never round up an expense". M06 §4.11: "`base = floor100(profit)` … `display = round100(reserve)`"; `profit = max(0, …)`, so `floor100`/`floor0` get non-negative inputs in the spec. For negative inputs this brief defines `floor*`/`ceil*` on the magnitude with the sign kept (same convention as the spec's `ceil0`); the tests pin that.

rules.md "Money and tax" (pasted): "Amounts are `Money` …, never `number`. Rounding follows ADR-007. Property tests (fast-check) for money and VAT math." Hard rule 1: rates, limits and thresholds live only in `packages/domain/rules`; this file contains no law value (the 1.00 CZK rounding-line tolerance is an ADR-007 product rule, exported as `ROUNDING_LINE_TOLERANCE_CZK`, and the only other numbers are the rounding targets 2 / 0 / 100).

Existing code the new file builds on (`packages/domain/src/money/money.ts`, merged in 0004; do not edit it): `Money.parse(text, currency)`, `Money.fromDecimal(decimal, currency)` (rejects NaN/Infinity with `MoneyParseError`), `toDecimal()` (a fresh Decimal from the ROUND_HALF_UP clone), `multiply(factor: string | Decimal)` and `divide(divisor)` (not rounded; a non-literal string throws `MoneyParseError`), `abs()`, `negate()`, `compare()` (throws `CurrencyMismatchError` across currencies), `isNegative()`, `toString()` (exact, plain notation, e.g. `'2425.5'`, `'0'`), `toFixed2()`. `packages/domain/src/money/errors.ts` has `MoneyError`, `InvalidCurrencyError`, `MoneyParseError`, `CurrencyMismatchError`; step 1 appends `InvalidVatRateError`. `decimal.js@10.6.0` and `fast-check@4.10.2` are already dependencies of `@shoebox/domain`; nothing is installed.

Lint and purity: `no-number-money` bans `parseFloat`/`Number()` in `packages/domain` (none below); dependency-cruiser `domain-is-pure` allows only `decimal.js`, `zod` and `packages/domain/src` imports (the new file imports `decimal.js` and `./currency`, `./errors`, `./money`). Biome sorts import and export specifiers; the files below are already in its order.

Parallel brief: 0017 (P0-DOM-04) edits `packages/domain/src/index.ts`. This brief therefore exports only from `packages/domain/src/money/index.ts` (already re-exported by `src/index.ts` via `export * from './money/index'`), and never touches `src/index.ts`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/money/errors.ts` | edit | append `InvalidVatRateError` |
| `packages/domain/src/money/rounding.ts` | new | the nine rounding functions and `ROUNDING_LINE_TOLERANCE_CZK` |
| `packages/domain/src/money/index.ts` | edit | export the new error and the rounding functions |
| `packages/domain/test/rounding.test.ts` | new | examples, fast-check properties, type cases |
| `docs/tasks/0016-report.md` | new | the report (step 5) |
| `docs/tasks/0016-rounding.md` | edit | `Status: review` (step 5) |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0016-rounding origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3` (expected: `Done in …s`, no `ERR_`; `git status --short` is empty). Commit after each step as `0016 step k` (`git add -A && git commit -m "0016 step k" | tail -3`).

### Step 1: `packages/domain/src/money/errors.ts` (edit: append one class)

The file currently ends with the `CurrencyMismatchError` class. Anchor (exact, the last lines of the file):

```ts
  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
    this.left = left;
    this.right = right;
  }
}
```

Append after it (one blank line, then this, file ends with a newline):

```ts
export class InvalidVatRateError extends MoneyError {
  readonly value: string;

  constructor(value: string) {
    super(
      `Invalid VAT rate: "${value}" (expected a percentage literal between 0 and 100, such as 21)`,
    );
    this.name = 'InvalidVatRateError';
    this.value = value;
  }
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0. Commit.

### Step 2: `packages/domain/src/money/rounding.ts` (new, full content)

```ts
import { Decimal } from 'decimal.js';
import { CZK } from './currency';
import { CurrencyMismatchError, InvalidVatRateError, MoneyParseError } from './errors';
import { Money } from './money';

/**
 * ADR-007: every rounding context is a named pure function here; nothing else in the domain
 * rounds inline. `round*` functions use ROUND_HALF_UP = half away from zero (M05 §8 edge case 13:
 * 2 425,50 → 2 426, and −2 425,50 → −2 426). `floor*`/`ceil*` work on the magnitude and keep
 * the sign (M05 §4: `ceil0(x) = sign(x) × ceil(|x|)`), so `floor0(-1.5) = -1` and
 * `ceil0(-1.5) = -2`; their callers (M06) pass non-negative amounts.
 *
 * The functions take and return `Money` (full precision in, rounded out) and keep the currency.
 * The only numbers here are the rounding targets (2 decimals, whole units, hundreds) and the
 * VAT percentage divisor; no law-driven value lives in this file.
 */

const HUNDRED = '100';

/** Half away from zero to two decimals (haléře): VAT per rate, FX conversions, business shares. */
export function round2(amount: Money): Money {
  return roundTo(amount, 2, Decimal.ROUND_HALF_UP);
}

/** Half away from zero to whole units: tax return fields, PDF summaries, cash. */
export function round0(amount: Money): Money {
  return roundTo(amount, 0, Decimal.ROUND_HALF_UP);
}

/** Magnitude down to whole units, sign kept: flat-rate expenses (never round up an expense). */
export function floor0(amount: Money): Money {
  return roundTo(amount, 0, Decimal.ROUND_DOWN);
}

/** Magnitude up to whole units, sign kept: SH `pln_hodnota` (M05 §4.5). */
export function ceil0(amount: Money): Money {
  return roundTo(amount, 0, Decimal.ROUND_UP);
}

/** Half away from zero to whole hundreds: display of the tax reserve estimate only (M06 §4.11). */
export function round100(amount: Money): Money {
  return roundHundreds(amount, Decimal.ROUND_HALF_UP);
}

/** Magnitude down to whole hundreds, sign kept: the DPFO tax base (ADR-007, M06 §4.11). */
export function floor100(amount: Money): Money {
  return roundHundreds(amount, Decimal.ROUND_DOWN);
}

/**
 * VAT for one rate on a document: `round2(base × ratePct / 100)` (ADR-007, M05 §4.2).
 * `ratePct` is the percentage from `packages/domain/rules` (`vat.rates`, e.g. `'21'`), as a
 * decimal literal or a Decimal in `[0, 100]`; anything else throws `InvalidVatRateError`.
 */
export function vatForRate(base: Money, ratePct: string | Decimal): Money {
  return round2(base.multiply(assertRatePct(ratePct)).divide(HUNDRED));
}

/** ADR-007: a difference between the supplier's printed total and the computed total up to 1.00 CZK (inclusive) becomes a `rounding` line. A product tolerance, not a law value. */
export const ROUNDING_LINE_TOLERANCE_CZK: Money = Money.parse('1.00', CZK);

/**
 * `true` when `|diff| ≤ tolerance`. The default tolerance is 1.00 CZK, so a `diff` in another
 * currency throws `CurrencyMismatchError` unless a tolerance in that currency is given.
 */
export function roundingLineAllowed(
  diff: Money,
  tolerance: Money = ROUNDING_LINE_TOLERANCE_CZK,
): boolean {
  if (tolerance.isNegative()) {
    throw new MoneyParseError(tolerance.toString());
  }
  return diff.abs().compare(tolerance) <= 0;
}

/** Cash payment rounding (ADR-007): CZK only, half away from zero to whole CZK. */
export function roundCash(amount: Money): Money {
  if (amount.currency !== CZK) {
    throw new CurrencyMismatchError(CZK, amount.currency);
  }
  return round0(amount);
}

function roundTo(amount: Money, places: 0 | 2, mode: Decimal.Rounding): Money {
  return Money.fromDecimal(amount.toDecimal().toDecimalPlaces(places, mode), amount.currency);
}

function roundHundreds(amount: Money, mode: Decimal.Rounding): Money {
  const hundreds = amount.toDecimal().div(HUNDRED).toDecimalPlaces(0, mode);
  return Money.fromDecimal(hundreds.times(HUNDRED), amount.currency);
}

function assertRatePct(ratePct: string | Decimal): string | Decimal {
  let value: Decimal;
  try {
    value = Money.parse('1', CZK).multiply(ratePct).toDecimal();
  } catch (error) {
    if (error instanceof MoneyParseError) {
      throw new InvalidVatRateError(String(ratePct));
    }
    throw error;
  }
  if (value.isNegative() || value.greaterThan(HUNDRED)) {
    throw new InvalidVatRateError(value.toString());
  }
  return ratePct;
}
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0. Commit.

### Step 3: `packages/domain/src/money/index.ts` (edit: replace the whole file)

Current content (anchor, exact, 4 lines):

```ts
export type { Currency } from './currency';
export { assertCurrency, CZK, EUR, isCurrency } from './currency';
export { CurrencyMismatchError, InvalidCurrencyError, MoneyError, MoneyParseError } from './errors';
export { MONEY_PRECISION, Money } from './money';
```

New content (the whole file; one Write call):

```ts
export type { Currency } from './currency';
export { assertCurrency, CZK, EUR, isCurrency } from './currency';
export {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidVatRateError,
  MoneyError,
  MoneyParseError,
} from './errors';
export { MONEY_PRECISION, Money } from './money';
export {
  ceil0,
  floor0,
  floor100,
  ROUNDING_LINE_TOLERANCE_CZK,
  round0,
  round2,
  round100,
  roundCash,
  roundingLineAllowed,
  vatForRate,
} from './rounding';
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0. Commit.

### Step 4: `packages/domain/test/rounding.test.ts` (new, full content; do not edit it)

Implement nothing here: the source is already final. If a test fails, the brief is wrong, stop (§8).

```ts
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
```

Command: `pnpm --filter @shoebox/domain test rounding 2>&1 | tail -30` → `Test Files  1 passed (1)`, `Tests  26 passed (26)`. (Exactly `test rounding`, not `test -- rounding`, which runs every file.) Commit.

### Step 5: full checks and the report

Run the §6 commands in order, then write the report (§9).

## 5. Do not touch

- Anything outside §3. In particular not `packages/domain/src/index.ts` (brief 0017 edits it in parallel), not `money.ts`, `currency.ts`, `package.json`, `pnpm-lock.yaml`, `tools/biome-plugins/`, `biome.json`, `.dependency-cruiser.cjs`, `vitest.config.ts`, other packages, `docs/v3/`.
- Do not edit `test/rounding.test.ts` or the given source to make something pass: if a given file fails, the brief is wrong, stop (§8).
- Do not add VAT ledger math, rule tables or any number from a law (rates, caps, thresholds): that is P0-DOM-04 and later.
- Hard rules 1 (no float money; no `parseFloat`/`Number()` in domain), 7 (no new dependency; `pnpm install --frozen-lockfile` must not change the lockfile), 8 (never push to `main`).

## 6. Commands

From the repo root:

1. `pnpm --filter @shoebox/domain test rounding 2>&1 | tail -30` → `Tests  26 passed (26)`.
2. `pnpm --filter @shoebox/domain test money 2>&1 | tail -30` → `Tests  32 passed (32)` (the existing Money tests still pass with the extended barrel).
3. `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → no `error TS`, exit 0 (this also proves every `@ts-expect-error` in the test is used).
4. `pnpm lint 2>&1 | tail -30` → `Checked … files`, `Found 0 errors` (a pre-existing `info` line is fine).
5. `pnpm depcruise 2>&1 | tail -30` → `✔ no dependency violations found`.
6. `pnpm test:unit 2>&1 | tail -30` → all test files pass and the coverage summary shows `Lines` ≥ 90 % for `packages/domain/src/**` (the gate is enforced by this command; the writer measured `rounding.ts` at 96 % lines on its own, `money.ts` is covered by `money.test.ts`).

## 7. Acceptance

- [ ] `packages/domain/test/rounding.test.ts` checks `vatForRate(base, '21')` = `round2(base × 21 / 100)` (11 549,94 → 2 425,49; 100,50 → 21,11), `round0(2425.50) = 2426` and `round0(-2425.50) = -2426` (half away from zero), `floor100` for the DPFO base (123 456,78 → 123 400), `roundingLineAllowed(diff) ⇔ |diff| ≤ 1.00 CZK` (1.00 true, 1.01 false, both signs), cash rounding to whole CZK (`roundCash`, CZK only).
- [ ] Property (fast-check, 1 000 runs): `|round2(x) − x| ≤ 0.005` for random decimals with up to 6 fraction digits; plus the properties for `round0`, `floor0`/`ceil0`, `floor100`/`round100`, `vatForRate`, `roundingLineAllowed`, `roundCash`.
- [ ] No `number` is accepted: the `// @ts-expect-error` lines compile under `pnpm --filter @shoebox/domain typecheck` without an "Unused '@ts-expect-error'" error.
- [ ] `pnpm --filter @shoebox/domain test rounding` green (26 tests); `pnpm test:unit` coverage for `packages/domain/src/**` ≥ 90 % lines.
- [ ] `pnpm lint` and `pnpm depcruise` pass.
- [ ] The functions are reachable as `import { round2, … } from '@shoebox/domain'` through the existing `export * from './money/index'` in `src/index.ts` (no edit of `src/index.ts`).
- Deviation from the ticket's file list: the ticket names `packages/domain/src/rounding.ts`; this brief uses `packages/domain/src/money/rounding.ts` beside `money.ts` (same reason as 0004: the money folder). The orchestrator notes this in the backlog at review.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, `Done: steps 1 to k. Left: steps k+1 to n.`);
- `pnpm install --frozen-lockfile` fails or wants to change `pnpm-lock.yaml`;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0016-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -15`).
2. Each §6 command, with the last 5 lines of its output (including the coverage `Lines` percentage).
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Then `git add -A && git commit -m "0016 report" | tail -3 && git push -u origin task/0016-rounding 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

Read the whole diff of `packages/domain/src/money/rounding.ts` (every rounding mode: `round*` = `ROUND_HALF_UP`, `floor*` = `ROUND_DOWN` toward zero, `ceil0` = `ROUND_UP` away from zero; `vatForRate` divides the percentage by 100; `roundingLineAllowed` is inclusive at 1.00) and `packages/domain/test/rounding.test.ts` (the property arbitraries were not narrowed, `numRuns` kept, the type cases present). Check `packages/domain/src/index.ts` and `pnpm-lock.yaml` are untouched.

Decisions made in this brief that the reviewer should confirm or send to the owner:

1. `floor0`/`floor100` on a negative amount round the magnitude down (`floor100(-150) = -100`), mirroring the spec's sign-preserving `ceil0`. The spec only feeds them non-negative amounts (M06 `profit = max(0, …)`, income ≥ 0), so no current caller sees the difference; a later ticket that needs a true floor toward −∞ for a loss adds a named function rather than changing these.
2. `roundingLineAllowed` defaults to the 1.00 CZK tolerance and throws `CurrencyMismatchError` for a foreign-currency difference unless a tolerance in that currency is passed. M04 (ledgers) decides the foreign-document tolerance; nothing in ADR-007 defines one.
3. `vatForRate` validates the percentage (`0 ≤ rate ≤ 100`, decimal literal or Decimal) and throws `InvalidVatRateError` (new, in `errors.ts`); a rate is a programming error if it is anything else.

## Owner steps

None. The orchestrator opens the PR `task/0016-rounding` → `phase/0` and merges it after CI (lint, typecheck, unit with the 90 % domain coverage gate, depcruise, secrets, pii) is green.
