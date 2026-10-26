// M06 §4.12: income-tax obligation drafts (DAP, paušální daň entry, exit and monthly advances).
// Pure: the profile segments, advances and the rules in, the drafts out. Deadlines, advance day,
// bands and the DAP generator come from `rules/cz`; nothing is typed here.

import { z } from 'zod';
import { addDays, compareLegalDates, type LegalDate, parseLegalDate } from '../dates/index';
import { CZK, Money } from '../money/index';
import { shiftDate } from '../overview/deadlines';
import { type CzRules, periodEndOf } from '../vat/period';
import { type ProfileSegment, segmentsInYear } from './readiness';

export type IncomeTaxObligationKind =
  | 'dap'
  | 'pausalni_dan_entry'
  | 'pausalni_dan_exit'
  | 'pausalni_dan_advance';

export interface IncomeTaxObligationDraft {
  readonly kind: IncomeTaxObligationKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly legalDueDate: LegalDate;
  readonly dueDate: LegalDate;
  readonly amountEstimate: Money | null;
  readonly state: 'open' | 'done' | 'overdue';
  readonly doneSource: 'bank_payment' | null;
  readonly isOptional: boolean;
  readonly note: string | null;
  readonly sourceRule: string;
}

export const INCOME_TAX_OBLIGATION_SOURCE = 'm06.income_tax_obligations.v1';

export interface IncomeTaxObligationsInput {
  readonly year: number;
  readonly profiles: readonly ProfileSegment[];
  readonly advances: ReadonlyArray<{ readonly bookedOn: LegalDate; readonly amount: Money }>;
  readonly pausalniDanReturnRequired: boolean;
  readonly eligibleForEntry: boolean;
}

// The DAP generator lives in `deadlines.generators` (rules/cz/deadlines.ts); only the fields used here.
const DapGenerator = z.looseObject({
  kind: z.literal('dap'),
  due: z.strictObject({
    type: z.literal('fixed_date'),
    month: z.number().int(),
    day: z.number().int(),
    year_offset: z.number().int(),
  }),
  shift: z.enum(['next_working_day', 'previous_working_day', 'none']),
});

const pad2 = (n: number): string => String(n).padStart(2, '0');

function dapGenerator(rules: CzRules, today: LegalDate): z.infer<typeof DapGenerator> {
  for (const generator of rules.at(today).get('deadlines.generators')) {
    const parsed = DapGenerator.safeParse(generator);
    if (parsed.success) return parsed.data;
  }
  throw new Error('dap generator missing in rules');
}

/** Obligations for one tax year, in order: dap, advances by month, entry, exit. */
export function incomeTaxObligationsFor(
  input: IncomeTaxObligationsInput,
  today: LegalDate,
  rules: CzRules,
): IncomeTaxObligationDraft[] {
  const { year } = input;
  const inYear = segmentsInYear(input.profiles, year);
  const danSegments = inYear.filter((s) => s.taxRegime === 'pausalni_dan');
  const yearStart = parseLegalDate(`${year}-01-01`);
  const yearEnd = parseLegalDate(`${year}-12-31`);
  const deadlines = rules.at(today).get('pausalni_dan.deadlines');
  const out: IncomeTaxObligationDraft[] = [];

  const needsDap =
    inYear.some((s) => s.taxRegime === 'danova_evidence' || s.taxRegime === 'pausalni_vydaje') ||
    (input.pausalniDanReturnRequired && danSegments.length > 0);
  if (needsDap) {
    const generator = dapGenerator(rules, today);
    const legalDueDate = parseLegalDate(
      `${year + generator.due.year_offset}-${pad2(generator.due.month)}-${pad2(generator.due.day)}`,
    );
    const dueDate = shiftDate(legalDueDate, generator.shift, rules);
    out.push({
      kind: 'dap',
      periodStart: yearStart,
      periodEnd: yearEnd,
      legalDueDate,
      dueDate,
      amountEstimate: null,
      state: compareLegalDates(today, dueDate) > 0 ? 'overdue' : 'open',
      doneSource: null,
      isOptional: false,
      note: inYear.some((s) => s.hasAccountant)
        ? 'podklady.dap.note.advisor'
        : 'podklady.dap.note.standard',
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
  }

  for (let m = 1; m <= 12; m += 1) {
    const periodStart = parseLegalDate(`${year}-${pad2(m)}-01`);
    const periodEnd = periodEndOf(periodStart, 'month');
    const segment = danSegments.find(
      (s) => s.validFrom <= periodEnd && (s.validTo === null || s.validTo >= periodStart),
    );
    if (segment === undefined) continue;

    const band = segment.pausalDanBand ?? 1;
    const row = rules
      .at(periodStart)
      .get('pausalni_dan.bands')
      .find((b) => b.band === band);
    if (row === undefined) throw new Error(`pausalni_dan band ${band} missing in rules`);
    const amountEstimate = Money.parse(String(row.monthly), CZK);

    const legalDueDate = parseLegalDate(`${year}-${pad2(m)}-${pad2(deadlines.advance_day)}`);
    const dueDate = shiftDate(legalDueDate, 'next_working_day', rules);
    const windowEnd = addDays(dueDate, 10);
    const booked = input.advances
      .filter((a) => a.bookedOn >= periodStart && a.bookedOn <= windowEnd)
      .reduce((acc, a) => acc.add(a.amount.abs()), Money.zero(CZK));
    const done = booked.compare(amountEstimate) >= 0;

    out.push({
      kind: 'pausalni_dan_advance',
      periodStart,
      periodEnd,
      legalDueDate,
      dueDate,
      amountEstimate,
      state: done ? 'done' : compareLegalDates(today, dueDate) > 0 ? 'overdue' : 'open',
      doneSource: done ? 'bank_payment' : null,
      isOptional: false,
      note: null,
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
  }

  // Entry and exit notices: only from 1 December of the tax year until the due date.
  const noticeWindowStart = parseLegalDate(`${year}-12-01`);
  const noticePeriodStart = parseLegalDate(`${year + 1}-01-01`);
  const noticePeriodEnd = parseLegalDate(`${year + 1}-12-31`);
  const noticeLegalDue = parseLegalDate(`${year + 1}-${deadlines.entry}`);
  const noticeDue = shiftDate(noticeLegalDue, 'next_working_day', rules);
  const inNoticeWindow =
    compareLegalDates(today, noticeWindowStart) >= 0 && compareLegalDates(today, noticeDue) <= 0;

  if (input.eligibleForEntry && inNoticeWindow) {
    out.push({
      kind: 'pausalni_dan_entry',
      periodStart: noticePeriodStart,
      periodEnd: noticePeriodEnd,
      legalDueDate: noticeLegalDue,
      dueDate: noticeDue,
      amountEstimate: null,
      state: 'open',
      doneSource: null,
      isOptional: true,
      note: null,
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
  }

  const coversYearEnd = danSegments.some((s) => s.validTo === null || s.validTo >= yearEnd);
  if (coversYearEnd && inNoticeWindow) {
    out.push({
      kind: 'pausalni_dan_exit',
      periodStart: noticePeriodStart,
      periodEnd: noticePeriodEnd,
      legalDueDate: noticeLegalDue,
      dueDate: noticeDue,
      amountEstimate: null,
      state: 'open',
      doneSource: null,
      isOptional: true,
      note: null,
      sourceRule: INCOME_TAX_OBLIGATION_SOURCE,
    });
  }

  return out;
}
