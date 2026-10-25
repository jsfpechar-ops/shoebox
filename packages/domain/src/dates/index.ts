// Legal dates (ADR-007): a calendar date with no time zone, stored as Postgres `date`.
// "Today" is always the calendar date in Europe/Prague. No date library (none approved).
import type { Clock } from '../clock/index';

declare const legalDateBrand: unique symbol;

/** A valid calendar date as `YYYY-MM-DD` (years 0001–9999). Build it with `parseLegalDate`. */
export type LegalDate = string & { readonly [legalDateBrand]: true };

export const LEGAL_TIME_ZONE = 'Europe/Prague';

export class InvalidLegalDateError extends Error {
  constructor(value: string) {
    super(`Not a legal date (YYYY-MM-DD): ${value}`);
    this.name = 'InvalidLegalDateError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

function fromParts(year: number, month: number, day: number): LegalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as LegalDate;
}

function toParts(date: LegalDate): [number, number, number] {
  const [y, m, d] = date.split('-');
  return [Number.parseInt(y ?? '', 10), Number.parseInt(m ?? '', 10), Number.parseInt(d ?? '', 10)];
}

export function isLegalDate(value: string): value is LegalDate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Parses a strict `YYYY-MM-DD` calendar date; throws `InvalidLegalDateError` otherwise. */
export function parseLegalDate(value: string): LegalDate {
  if (!isLegalDate(value)) throw new InvalidLegalDateError(value);
  return value;
}

/** -1 if a is earlier, 0 if equal, 1 if later. */
export function compareLegalDates(a: LegalDate, b: LegalDate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant, "days_from_civil").
function toEpochDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// Inverse of toEpochDay ("civil_from_days").
function fromEpochDay(epochDay: number): [number, number, number] {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

/** Adds a whole number of calendar days (negative goes back). */
export function addDays(date: LegalDate, days: number): LegalDate {
  if (!Number.isInteger(days)) throw new RangeError(`addDays: days must be an integer: ${days}`);
  const [year, month, day] = fromEpochDay(toEpochDay(...toParts(date)) + days);
  if (year < 1 || year > 9999) throw new RangeError(`addDays: result outside years 0001-9999`);
  return fromParts(year, month, day);
}

const pragueFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LEGAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Europe/Prague at the given instant (epoch milliseconds). */
export function pragueDateOf(instantMs: number): LegalDate {
  const parts = pragueFormatter.formatToParts(instantMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return parseLegalDate(`${get('year')}-${get('month')}-${get('day')}`);
}

/** Today's legal date: the calendar date in Europe/Prague at the clock's instant. */
export function pragueToday(clock: Clock): LegalDate {
  return pragueDateOf(clock.now());
}
