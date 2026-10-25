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
