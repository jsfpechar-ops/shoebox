import { Decimal } from 'decimal.js';
import { addDays, compareLegalDates, type LegalDate } from './dates/index';
import { type Currency, CurrencyMismatchError, CZK, Money } from './money/index';

export type CnbRateRule = 'rate_valid_on_date_else_last_published';

/** One `fx_rates` row (05 §3): ČNB fixing for `amount` units of `currency` on `rateDate`. */
export interface FxRateRow {
  readonly rateDate: LegalDate;
  readonly currency: Currency;
  readonly amount: number;
  readonly rate: string;
}

/** The rate chosen for a date, with `perUnit = rate / amount` as an exact Decimal. */
export interface FxRate {
  readonly currency: Currency;
  readonly rateDate: LegalDate;
  readonly rate: string;
  readonly amount: number;
  readonly perUnit: Decimal;
}

/**
 * The rate for `currency` on `date`: the row with the latest `rateDate` that is on or before `date`
 * and no older than `maxLookbackDays`. Null when none exists (M03 `S_FX_MISSING`).
 */
export function resolveFxRate(
  currency: Currency,
  date: LegalDate,
  rates: readonly FxRateRow[],
  rule: CnbRateRule,
  maxLookbackDays: number,
): FxRate | null {
  void rule;
  if (!Number.isInteger(maxLookbackDays) || maxLookbackDays < 0) {
    throw new RangeError(`maxLookbackDays must be an integer >= 0, got ${maxLookbackDays}`);
  }
  if (currency === CZK) {
    return { currency: CZK, rateDate: date, rate: '1', amount: 1, perUnit: new Decimal(1) };
  }
  const earliest = addDays(date, -maxLookbackDays);
  let best: FxRateRow | null = null;
  for (const row of rates) {
    if (row.currency !== currency) continue;
    if (compareLegalDates(row.rateDate, date) > 0) continue;
    if (compareLegalDates(row.rateDate, earliest) < 0) continue;
    if (best === null || compareLegalDates(row.rateDate, best.rateDate) > 0) best = row;
  }
  if (best === null) return null;
  return {
    currency,
    rateDate: best.rateDate,
    rate: best.rate,
    amount: best.amount,
    perUnit: new Decimal(best.rate).div(best.amount),
  };
}

/** `amount × perUnit` as CZK, unrounded (callers apply `round2`). Throws `CurrencyMismatchError` when `amount.currency !== fx.currency`. */
export function convertToCzk(amount: Money, fx: FxRate): Money {
  if (amount.currency !== fx.currency) {
    throw new CurrencyMismatchError(amount.currency, fx.currency);
  }
  return Money.fromDecimal(amount.toDecimal().times(fx.perUnit), CZK);
}
