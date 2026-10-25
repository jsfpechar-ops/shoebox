// Upcoming deadlines for the Přehled screen (M09 §4.7, §4.8). Pure: the profile and the rules in,
// the list out. Every day-of-month, holiday and amount comes from `rules/cz/deadlines.ts` and the
// other rule keys; nothing is typed here.

import { z } from 'zod';
import { addDays, compareLegalDates, type LegalDate, parseLegalDate } from '../dates/index';
import {
  TAX_REGIME_VALUES,
  type TaxRegime,
  VAT_STATUS_VALUES,
  type VatPeriod,
  type VatStatus,
} from '../enums/index';
import { Money } from '../money/index';
import type { createCzRules } from '../rules/index';

export type DeadlineKind =
  | 'vat_return'
  | 'kh'
  | 'pausalni_dan_advance'
  | 'social_advance'
  | 'health_advance'
  | 'dap';
export type ShiftPolicy = 'next_working_day' | 'previous_working_day' | 'none';
type CzRules = ReturnType<typeof createCzRules>;

export interface DeadlineProfile {
  readonly vatStatus: VatStatus;
  readonly vatPeriod: VatPeriod | null; // null = monthly
  readonly taxRegime: TaxRegime;
  readonly pausalDanBand: 1 | 2 | 3 | null;
  readonly insuranceSelfPaid: boolean;
}

export interface Deadline {
  readonly kind: DeadlineKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly legalDue: LegalDate;
  readonly due: LegalDate;
  readonly amount: Money | null;
  readonly amountIsMinimum: boolean; // insurance: the legal minimum, the user may pay more
  readonly holidaysMissing: boolean;
}

const KIND_PRIORITY: readonly DeadlineKind[] = [
  'vat_return',
  'kh',
  'pausalni_dan_advance',
  'social_advance',
  'health_advance',
  'dap',
];

const Generator = z.object({
  kind: z.enum([
    'vat_return',
    'kh',
    'pausalni_dan_advance',
    'social_advance',
    'health_advance',
    'dap',
  ]),
  applies_if: z
    .object({
      vat_status: z.array(z.enum(VAT_STATUS_VALUES)).optional(),
      tax_regime: z.array(z.enum(TAX_REGIME_VALUES)).optional(),
      requires: z.array(z.literal('insurance_self_paid')).optional(),
    })
    .optional(),
  period: z.enum(['month', 'vat_period', 'year']),
  due: z.discriminatedUnion('type', [
    z.object({ type: z.literal('day_of_month_after_period'), day: z.number().int() }),
    z.object({
      type: z.literal('day_of_month_in_period'),
      day: z.union([z.number().int(), z.literal('last')]),
    }),
    z.object({
      type: z.literal('fixed_date'),
      month: z.number().int(),
      day: z.number().int(),
      year_offset: z.number().int(),
    }),
  ]),
  shift: z.enum(['next_working_day', 'previous_working_day', 'none']),
  amount: z.enum([
    'none',
    'pausalni_dan_band_monthly',
    'insurance_min_social',
    'insurance_min_health',
  ]),
  source: z.string(),
});
type Generator = z.infer<typeof Generator>;

interface Period {
  readonly start: LegalDate;
  readonly end: LegalDate;
}

function parts(date: string): { y: number; m: number; d: number } {
  return {
    y: Number.parseInt(date.slice(0, 4), 10),
    m: Number.parseInt(date.slice(5, 7), 10),
    d: Number.parseInt(date.slice(8, 10), 10),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): LegalDate {
  return parseLegalDate(`${y}-${pad2(m)}-${pad2(d)}`);
}

/** Month index from a year and a 1-based month (0 = January of year 0). */
function monthIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
}

function fromMonthIndex(idx: number): { y: number; m: number } {
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Last day of a 1-based month: day 0 of the next month. */
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function span(fromIdx: number, toIdx: number): Period {
  const f = fromMonthIndex(fromIdx);
  const t = fromMonthIndex(toIdx);
  return { start: iso(f.y, f.m, 1), end: iso(t.y, t.m, lastDay(t.y, t.m)) };
}

export function czHolidays(
  year: number,
  rules: CzRules,
): { dates: ReadonlySet<string>; movableMissing: boolean } {
  const value = rules.at(parseLegalDate(`${year}-01-01`)).get('calendar.cz_public_holidays');
  const movable: readonly string[] | undefined = value.movable[String(year)];
  const dates = new Set<string>();
  for (const md of value.fixed) dates.add(`${year}-${md}`);
  for (const md of movable ?? []) dates.add(`${year}-${md}`);
  return { dates, movableMissing: movable === undefined };
}

export function isCzWorkingDay(date: LegalDate, rules: CzRules): boolean {
  const { y, m, d } = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !czHolidays(y, rules).dates.has(date);
}

export function shiftDate(date: LegalDate, policy: ShiftPolicy, rules: CzRules): LegalDate {
  if (policy === 'none') return date;
  const step = policy === 'next_working_day' ? 1 : -1;
  let current = date;
  while (!isCzWorkingDay(current, rules)) current = addDays(current, step);
  return current;
}

function applies(gen: Generator, p: DeadlineProfile): boolean {
  const c = gen.applies_if;
  if (!c) return true;
  if (c.vat_status && !c.vat_status.includes(p.vatStatus)) return false;
  if (c.tax_regime && !c.tax_regime.includes(p.taxRegime)) return false;
  if (c.requires?.includes('insurance_self_paid') && !p.insuranceSelfPaid) return false;
  return true;
}

/** The periods a generator looks at, around `asOf`. */
function periodsFor(period: Generator['period'], asOf: LegalDate, p: DeadlineProfile): Period[] {
  const a = parts(asOf);
  const base = monthIndex(a.y, a.m);
  if (period === 'year') {
    return [a.y - 1, a.y].map((y) => span(monthIndex(y, 1), monthIndex(y, 12)));
  }
  if (period === 'vat_period' && p.vatPeriod === 'quarterly') {
    const q = Math.floor(base / 3);
    return [q - 1, q, q + 1].map((qi) => span(qi * 3, qi * 3 + 2));
  }
  return [-3, -2, -1, 0, 1, 2, 3].map((i) => span(base + i, base + i));
}

function legalDueOf(due: Generator['due'], period: Period): LegalDate {
  if (due.type === 'day_of_month_after_period') {
    const e = parts(period.end);
    const next = fromMonthIndex(monthIndex(e.y, e.m) + 1);
    return iso(next.y, next.m, due.day);
  }
  if (due.type === 'day_of_month_in_period') {
    const s = parts(period.start);
    const day = due.day === 'last' ? lastDay(s.y, s.m) : due.day;
    return iso(s.y, s.m, day);
  }
  const e = parts(period.end);
  return iso(e.y + due.year_offset, due.month, due.day);
}

function amountFor(
  kind: Generator['amount'],
  p: DeadlineProfile,
  periodStart: LegalDate,
  rules: CzRules,
): { money: Money | null; minimum: boolean } {
  if (kind === 'none') return { money: null, minimum: false };
  if (kind === 'pausalni_dan_band_monthly') {
    const band = rules
      .at(periodStart)
      .get('pausalni_dan.bands')
      .find((b) => b.band === p.pausalDanBand);
    return {
      money: band ? Money.parse(String(band.monthly), 'CZK') : null,
      minimum: false,
    };
  }
  const minAdvances = rules.at(periodStart).get('insurance.min_advances');
  const value = kind === 'insurance_min_social' ? minAdvances.social : minAdvances.health;
  return { money: Money.parse(String(value), 'CZK'), minimum: true };
}

function parseGenerators(list: readonly unknown[]): Generator[] {
  return list.flatMap((item) => {
    const result = Generator.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

export function upcomingDeadlines(
  profile: DeadlineProfile,
  asOf: LegalDate,
  rules: CzRules,
  windowDays = 60,
): Deadline[] {
  const generators = parseGenerators(rules.at(asOf).get('deadlines.generators'));
  const windowEnd = addDays(asOf, windowDays);
  const out: Deadline[] = [];
  for (const gen of generators) {
    if (!applies(gen, profile)) continue;
    for (const period of periodsFor(gen.period, asOf, profile)) {
      const legalDue = legalDueOf(gen.due, period);
      const due = shiftDate(legalDue, gen.shift, rules);
      if (compareLegalDates(due, asOf) < 0 || compareLegalDates(due, windowEnd) > 0) continue;
      const amount = amountFor(gen.amount, profile, period.start, rules);
      out.push({
        kind: gen.kind,
        periodStart: period.start,
        periodEnd: period.end,
        legalDue,
        due,
        amount: amount.money,
        amountIsMinimum: amount.minimum,
        holidaysMissing: czHolidays(parts(due).y, rules).movableMissing,
      });
    }
  }
  return out.sort(
    (x, y) =>
      compareLegalDates(x.due, y.due) ||
      KIND_PRIORITY.indexOf(x.kind) - KIND_PRIORITY.indexOf(y.kind) ||
      compareLegalDates(x.periodStart, y.periodStart),
  );
}
