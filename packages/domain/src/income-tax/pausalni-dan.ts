import { type LegalDate, parseLegalDate } from '../dates/index';
import { CZK, Money } from '../money/index';
import { shiftDate } from '../overview/deadlines';
import type { CzRules } from '../vat/period';
import type { FlatRate, PodkladyAnswers } from './answers';
import { type ProfileSegment, segmentsInYear } from './readiness';

export type PausalniDanBand = 1 | 2 | 3;

export type PausalniDanWarningCode =
  | 'pd.band_exceeded'
  | 'pd.regime_limit_exceeded'
  | 'pd.lower_band_possible'
  | 'pd.eligibility.vat_payer'
  | 'pd.eligibility.other_income'
  | 'pd.eligibility.employment'
  | 'pd.eligibility.insolvency';

export interface PausalniDanWarning {
  readonly code: PausalniDanWarningCode;
  readonly severity: 'warning' | 'info';
  readonly params: Readonly<Record<string, string | number>>;
}

export interface PausalniDanMonth {
  readonly month: number;
  readonly due: LegalDate;
  readonly expected: Money;
  readonly paid: Money;
}

export interface PausalniDanInput {
  readonly year: number;
  readonly income: Money;
  readonly band: PausalniDanBand;
  readonly activityClass: FlatRate;
  readonly months: readonly number[]; // 1..12 covered by the paušál segment
  readonly advances: ReadonlyArray<{ readonly bookedOn: LegalDate; readonly amount: Money }>;
  readonly profileSegments: readonly ProfileSegment[];
  readonly answers: PodkladyAnswers;
}

export interface PausalniDanCheck {
  readonly fitBand: PausalniDanBand | null;
  readonly limit: Money; // limit(band, class) of the profile band
  readonly expected: Money;
  readonly paid: Money;
  readonly delta: Money;
  readonly advancesState: 'ok' | 'missing' | 'overpaid';
  readonly months: readonly PausalniDanMonth[];
  readonly noticeDue: LegalDate;
  readonly warnings: readonly PausalniDanWarning[];
  readonly returnRequired: boolean;
}

const czkOf = (n: number): Money => Money.parse(String(n), CZK);

function bandRow(rules: CzRules, at: LegalDate, band: PausalniDanBand) {
  const row = rules
    .at(at)
    .get('pausalni_dan.bands')
    .find((b) => b.band === band);
  if (row === undefined) throw new Error(`pausalni_dan.bands has no band ${band} at ${at}`);
  return row;
}

/** limit(band, class): largest max_income whose ceiling applies to the dominant rate class. */
export function pausalniDanLimit(
  band: PausalniDanBand,
  activityClass: FlatRate,
  rules: CzRules,
  at: LegalDate,
): Money {
  const applicable = bandRow(rules, at, band).ceilings.filter(
    (c) =>
      c.requires_dominant_rate_in === undefined ||
      c.requires_dominant_rate_in.includes(activityClass),
  );
  const max = Math.max(...applicable.map((c) => c.max_income));
  if (applicable.length === 0 || !Number.isFinite(max)) {
    throw new Error(`pausalni_dan.bands has no ceiling for band ${band} class ${activityClass}`);
  }
  return czkOf(max);
}

/** Smallest band whose limit covers the income; null when none does. */
export function fitPausalniDanBand(
  income: Money,
  activityClass: FlatRate,
  rules: CzRules,
  at: LegalDate,
): PausalniDanBand | null {
  for (const band of [1, 2, 3] as const) {
    if (income.compare(pausalniDanLimit(band, activityClass, rules, at)) <= 0) return band;
  }
  return null;
}

export function checkPausalniDan(input: PausalniDanInput, rules: CzRules): PausalniDanCheck {
  const { year, income, band, activityClass, answers } = input;
  const bandAt = parseLegalDate(`${year}-12-31`);
  const limit = pausalniDanLimit(band, activityClass, rules, bandAt);
  const fitBand = fitPausalniDanBand(income, activityClass, rules, bandAt);
  const eligibility = rules.at(bandAt).get('pausalni_dan.eligibility');
  const deadlines = rules.at(bandAt).get('pausalni_dan.deadlines');

  // Advances: expected from the rule in force on the 1st of each covered month.
  const monthlyOn = (mm: number): Money => {
    const at = parseLegalDate(`${year}-${String(mm).padStart(2, '0')}-01`);
    const row = bandRow(rules, at, band);
    return czkOf(row.monthly);
  };
  const expectedRows = input.months.map((m) => monthlyOn(m));
  const expected = Money.sum(expectedRows, CZK);

  const yearAdvances = input.advances.filter((a) => a.bookedOn.startsWith(`${year}-`));
  const paid = Money.sum(
    yearAdvances.map((a) => a.amount.abs()),
    CZK,
  );
  const delta = paid.subtract(expected);
  const advancesState: PausalniDanCheck['advancesState'] = delta.isNegative()
    ? 'missing'
    : delta.isPositive()
      ? 'overpaid'
      : 'ok';

  const months: PausalniDanMonth[] = input.months.map((m, i) => {
    const mm = String(m).padStart(2, '0');
    const due = shiftDate(
      parseLegalDate(`${year}-${mm}-${String(deadlines.advance_day).padStart(2, '0')}`),
      'next_working_day',
      rules,
    );
    const monthPaid = Money.sum(
      yearAdvances.filter((a) => a.bookedOn.slice(5, 7) === mm).map((a) => a.amount.abs()),
      CZK,
    );
    return { month: m, due, expected: expectedRows[i] ?? czkOf(0), paid: monthPaid };
  });

  const noticeDue = shiftDate(
    parseLegalDate(`${year + 1}-${deadlines.exit}`),
    'next_working_day',
    rules,
  );

  // Warnings: band / limit first, then eligibility in the documented order.
  const warnings: PausalniDanWarning[] = [];
  const maxIncome = czkOf(eligibility.max_income);
  if (income.compare(maxIncome) > 0) {
    warnings.push({
      code: 'pd.regime_limit_exceeded',
      severity: 'warning',
      params: { income: income.toFixed2(), limit: maxIncome.toFixed2() },
    });
  } else if (fitBand !== null && fitBand > band) {
    warnings.push({
      code: 'pd.band_exceeded',
      severity: 'warning',
      params: { income: income.toFixed2(), band, limit: limit.toFixed2() },
    });
  } else if (fitBand !== null && fitBand < band) {
    warnings.push({
      code: 'pd.lower_band_possible',
      severity: 'info',
      params: { band: fitBand },
    });
  }

  const segments = segmentsInYear(input.profileSegments, year);
  if (segments.some((s) => s.vatStatus === 'platce')) {
    warnings.push({ code: 'pd.eligibility.vat_payer', severity: 'warning', params: {} });
  }
  if (
    answers.otherIncome === 'yes' &&
    answers.otherIncomeApprox !== null &&
    answers.otherIncomeApprox > eligibility.max_other_income
  ) {
    warnings.push({
      code: 'pd.eligibility.other_income',
      severity: 'warning',
      params: { limit: czkOf(eligibility.max_other_income).toFixed2() },
    });
  }
  if (answers.employmentBeyondLimits === 'yes') {
    warnings.push({ code: 'pd.eligibility.employment', severity: 'warning', params: {} });
  }
  if (answers.insolvencyOrPartner === 'yes') {
    warnings.push({ code: 'pd.eligibility.insolvency', severity: 'warning', params: {} });
  }

  const returnRequired = warnings.some(
    (w) =>
      w.code === 'pd.band_exceeded' ||
      w.code === 'pd.regime_limit_exceeded' ||
      w.code.startsWith('pd.eligibility.'),
  );

  return {
    fitBand,
    limit,
    expected,
    paid,
    delta,
    advancesState,
    months,
    noticeDue,
    warnings,
    returnRequired,
  };
}
