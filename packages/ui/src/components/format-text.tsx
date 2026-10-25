import type { LegalDate } from '@shoebox/domain';
import { cn } from '../primitives/basic';

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Formats a decimal string (never a float, rule 1) as Czech currency: "1 234,56 Kč",
 * NBSP as group separator and before the currency. Intl formats the string exactly.
 */
export function formatMoney(value: string, currency: string, signed = false): string {
  if (!DECIMAL.test(value)) throw new RangeError(`Not a decimal string: ${value}`);
  const format = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });
  return format.format(value as `${number}`);
}

export type MoneyTextProps = {
  value: string;
  currency: string;
  signed?: boolean;
  className?: string;
};

/** An amount with tabular numerals (the `num` utility from theme.css). */
export function MoneyText({ value, currency, signed = false, className }: MoneyTextProps) {
  return (
    <span data-slot="money" className={cn('num whitespace-nowrap', className)}>
      {formatMoney(value, currency, signed)}
    </span>
  );
}

/** "2026-10-18" → "18. 10. 2026" (Czech short date, no leading zeros). */
export function formatLegalDate(date: LegalDate): string {
  const [y, m, d] = date.split('-');
  const day = Number.parseInt(d ?? '', 10);
  const month = Number.parseInt(m ?? '', 10);
  const year = Number.parseInt(y ?? '', 10);
  return `${day}. ${month}. ${year}`;
}

export type LegalDateTextProps = { date: LegalDate; className?: string };

// TODO(P0-UI-02): relative mode ("za 3 dny") lands with the first screen that needs it.
export function LegalDateText({ date, className }: LegalDateTextProps) {
  return (
    <time dateTime={date} className={cn('tabular-nums whitespace-nowrap', className)}>
      {formatLegalDate(date)}
    </time>
  );
}
