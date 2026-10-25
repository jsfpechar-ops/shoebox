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
