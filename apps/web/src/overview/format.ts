import type { LegalDate, Money } from '@shoebox/domain';
import { t } from '@shoebox/i18n';

const CZK_WHOLE = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Whole crowns in Czech format, from the exact decimal string (never a float). */
export function formatCzkWhole(amount: Money): string {
  return CZK_WHOLE.format(amount.toFixed2() as unknown as number);
}

function parts(date: LegalDate): { year: number; month: number; day: number } {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return { year, month, day };
}

function dayNumber(date: LegalDate): number {
  const { year, month, day } = parts(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** "26. 10. (tomorrow)": relative words up to 14 days, the year only when it is not this year. */
export function formatDue(due: LegalDate, asOf: LegalDate): string {
  const p = parts(due);
  const sameYear = p.year === parts(asOf).year;
  const date = `${p.day}. ${p.month}.${sameYear ? '' : ` ${p.year}`}`;
  const diff = dayNumber(due) - dayNumber(asOf);
  if (diff < 0 || diff > 14) return date;
  const relative =
    diff === 0
      ? t('overview.due.today')
      : diff === 1
        ? t('overview.due.tomorrow')
        : t('overview.due.in_days', { n: diff });
  return t('overview.due.with_relative', { date, relative });
}

/** "for 9/2026", "for Q3 2026" or "for 2025". */
export function periodLabel(p: {
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
}): string {
  const start = parts(p.periodStart);
  const end = parts(p.periodEnd);
  const year = String(start.year);
  if (start.month === 1 && start.day === 1 && end.month === 12 && end.day === 31) {
    return t('overview.period.year', { year });
  }
  const months = (end.year - start.year) * 12 + end.month - start.month + 1;
  if (months === 3) {
    return t('overview.period.quarter', { quarter: String(Math.ceil(start.month / 3)), year });
  }
  return t('overview.period.month', { month: String(start.month), year });
}

/** "1 640 000 Kč of 2 000 000 Kč · 82 %", printed next to every meter. */
export function meterText(m: {
  readonly current: Money;
  readonly limit: Money;
  readonly percent: number;
}): string {
  return t('overview.meter.value', {
    current: formatCzkWhole(m.current),
    limit: formatCzkWhole(m.limit),
    percent: String(m.percent),
  });
}
