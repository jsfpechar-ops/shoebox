// Building blocks shared by the per-key rule schemas (06 §2). Amounts are never floats (ADR-007):
// whole CZK thresholds are integers, fractional amounts are decimal strings parsed with Money by
// the consumer. Percentages and ratios are plain numbers; they are factors, not money.
import { z } from 'zod';

/** A whole amount in CZK from the law (thresholds, caps, monthly amounts), never negative. */
export const CzkWhole = z.number().int().min(0);

/** A non-negative amount with exactly two decimals, as text (`'0.02'`); consumers parse it with `Money`. */
export const MoneyString = z.string().regex(/^\d+\.\d{2}$/, 'Expected an amount like 12.50');

/** A non-negative decimal as text with 1–6 decimals (`'0.005'`); consumers parse it with `decimal.js`. */
export const DecimalString = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Expected a decimal like 0.005');

/** A percentage 0–100 with at most two decimals (`21`, `29.2`). A factor, not money. */
export const Pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, 'At most two decimals');

/** A ratio 0–1 (confidence thresholds, relative tolerances). */
export const Ratio = z.number().min(0).max(1);

export const NonNegInt = z.number().int().min(0);
export const PositiveInt = z.number().int().min(1);

/** A day of a month, 1–31. */
export const DayOfMonth = z.number().int().min(1).max(31);

/** A month and day without a year, `MM-DD`. */
export const MonthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected MM-DD');

/** A four-digit year as an object key (`'2026'`). */
export const YearKey = z.string().regex(/^\d{4}$/, 'Expected YYYY');

/** An ISO 3166-1 alpha-2 code (`'CZ'`), plus `'XI'` for Northern Ireland goods. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'Expected a two-letter country code');

/** A snake_case identifier such as a category, treatment or form id (`income_accommodation`). */
export const Identifier = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a snake_case identifier');

/** Digits only (bank account prefixes and numbers). */
export const Digits = z.string().regex(/^\d+$/, 'Expected digits');

/** A shape owned by a module spec that is not implemented yet: keys are strings, values are checked there. */
export const ModuleOwnedRecord = z.record(z.string(), z.unknown());
