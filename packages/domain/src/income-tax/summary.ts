import type { LegalDate } from '../dates/index';
import type { TaxRegime } from '../enums/index';
import { CZK, Money, round0 } from '../money/index';
import type { CzRules } from '../vat/period';
import type { FlatRate, PodkladyAnswers } from './answers';
import { type AssetLineInput, type AssetLists, listAssets } from './assets';
import { computeFlatRateComparison, type FlatRateComparison } from './flat-rate';
import { checkPausalniDan, type PausalniDanCheck } from './pausalni-dan';
import { type PrivateUseInput, type PrivateUseSummary, summarizePrivateUse } from './private-use';
import {
  checkPodkladyReadiness,
  isBlocked,
  type ProfileSegment,
  type ReadinessCheck,
  type ReadinessInput,
  segmentsInYear,
} from './readiness';
import { type AnnualTotals, type AnnualTotalsEntry, computeAnnualTotals } from './totals';
import { buildVatNote, type VatNote, type VatNoteInput } from './vat-note';

export interface PodkladyTransaction {
  readonly categoryCode: string;
  readonly bookedOn: LegalDate;
  readonly amount: Money;
}

export interface PodkladyInput {
  readonly year: number;
  readonly taxpayer: { readonly legalName: string; readonly ico: string | null };
  readonly profiles: readonly ProfileSegment[];
  readonly entries: readonly AnnualTotalsEntry[];
  readonly assetLines: readonly AssetLineInput[];
  readonly privateUse: PrivateUseInput;
  readonly vatFilings: VatNoteInput['vatFilings'];
  readonly transactions: readonly PodkladyTransaction[];
  readonly readiness: Omit<ReadinessInput, 'year' | 'profiles'>;
  readonly answers: PodkladyAnswers;
  readonly partialXmlAvailable: boolean;
}

export interface PaymentsByCategory {
  readonly categoryCode: string;
  readonly total: Money;
  readonly byMonth: readonly Money[];
} // 12 entries

export interface PodkladyHeadline {
  readonly income: Money;
  readonly expenses: Money;
  readonly base: Money;
  readonly label: 'actual' | 'flat' | 'pausalni_dan';
}

export const CHECKLIST_KEYS = [
  'podklady.checklist.credits',
  'podklady.checklist.deductions',
  'podklady.checklist.other_income',
  'podklady.checklist.depreciation',
  'podklady.checklist.car',
  'podklady.checklist.base_adjustments',
  'podklady.checklist.advances_paid',
  'podklady.checklist.insurance_reports',
  'podklady.checklist.accommodation',
  'podklady.checklist.missing_documents',
] as const;

export interface PodkladySummary {
  readonly year: number;
  readonly generatedOn: LegalDate;
  readonly taxpayer: PodkladyInput['taxpayer'];
  readonly empty: boolean;
  readonly regime: TaxRegime;
  readonly segments: readonly ProfileSegment[];
  readonly watermark: boolean;
  readonly readiness: readonly ReadinessCheck[];
  readonly blocked: boolean;
  readonly totals: AnnualTotals;
  readonly headline: PodkladyHeadline;
  readonly flatRate: FlatRateComparison | null;
  readonly pausalniDan: PausalniDanCheck | null;
  readonly assets: AssetLists;
  readonly privateUse: PrivateUseSummary;
  readonly vatNote: VatNote;
  readonly payments: readonly PaymentsByCategory[];
  readonly advancesPaid: Money;
  readonly checklistKeys: readonly string[];
  readonly disclaimerKey: 'podklady.disclaimer';
  readonly partialXmlEligible: boolean;
  readonly noReturnKey: 'pd.no_return' | null;
}

const PAYMENT_CATEGORIES = [
  'tax_vat_payment',
  'tax_income_payment',
  'tax_pausal_advance',
  'ins_social_own',
  'ins_health_own',
  'tax_other_fees',
] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Regime of the year: the segment covering 31 December, else the last segment in the year. */
function regimeSegmentOf(segments: readonly ProfileSegment[], year: number): ProfileSegment | null {
  const yearEnd = `${year}-12-31`;
  const covering = segments.find(
    (s) => s.validFrom <= yearEnd && (s.validTo === null || s.validTo >= yearEnd),
  );
  return covering ?? segments[segments.length - 1] ?? null;
}

/** Months 1..12 of the year covered by the segments of the given regime. */
function monthsCovered(
  segments: readonly ProfileSegment[],
  year: number,
  regime: TaxRegime,
): number[] {
  const months: number[] = [];
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  for (let m = 1; m <= 12; m += 1) {
    const monthStart = `${year}-${pad2(m)}-01`;
    const nextMonthStart = m < 12 ? `${year}-${pad2(m + 1)}-01` : `${year + 1}-01-01`;
    const covered = segments.some((s) => {
      if (s.taxRegime !== regime) return false;
      const from = s.validFrom > yearStart ? s.validFrom : yearStart;
      const to = s.validTo !== null && s.validTo < yearEnd ? s.validTo : yearEnd;
      return from < nextMonthStart && to >= monthStart;
    });
    if (covered) months.push(m);
  }
  return months;
}

/** Podklady summary for one tax year: pure composition of the M06 §4 building blocks. */
export function buildPodkladySummary(
  input: PodkladyInput,
  rules: CzRules,
  today: LegalDate,
): PodkladySummary {
  const { year, answers } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const inYear = (d: LegalDate): boolean => d >= yearStart && d <= yearEnd;

  const segments = segmentsInYear(input.profiles, year);
  const regimeSegment = regimeSegmentOf(segments, year);
  // A year without any profile segment has no regime; the card then shows the empty state.
  const regime: TaxRegime = regimeSegment?.taxRegime ?? 'danova_evidence';

  const readiness = checkPodkladyReadiness(
    { year, profiles: input.profiles, ...input.readiness },
    today,
  );
  const blocked = isBlocked(readiness);
  const watermark = readiness.some((c) => c.code === 'P_YEAR_OPEN');

  const totals = computeAnnualTotals(input.entries, year);
  const yearTransactions = input.transactions.filter((t) => inYear(t.bookedOn));

  let flatRate: FlatRateComparison | null = null;
  if (regime === 'danova_evidence') {
    flatRate = computeFlatRateComparison(
      totals.incomeTotal,
      totals.deductibleTotal,
      answers.comparisonRate ?? 60,
      rules,
      year,
    );
  } else if (regime === 'pausalni_vydaje') {
    const rate: FlatRate = regimeSegment?.pausalRate ?? answers.comparisonRate ?? 60;
    flatRate = computeFlatRateComparison(
      totals.incomeTotal,
      totals.deductibleTotal,
      rate,
      rules,
      year,
    );
  }

  let pausalniDan: PausalniDanCheck | null = null;
  if (regime === 'pausalni_dan') {
    pausalniDan = checkPausalniDan(
      {
        year,
        income: totals.incomeTotal,
        band: regimeSegment?.pausalDanBand ?? 1,
        activityClass: regimeSegment?.pausalRate ?? answers.activityClass ?? 60,
        months: monthsCovered(segments, year, 'pausalni_dan'),
        advances: yearTransactions
          .filter((t) => t.categoryCode === 'tax_pausal_advance')
          .map((t) => ({ bookedOn: t.bookedOn, amount: t.amount })),
        profileSegments: input.profiles,
        answers,
      },
      rules,
    );
  }

  const incomeRounded = round0(totals.incomeTotal);
  let headline: PodkladyHeadline;
  if (regime === 'pausalni_vydaje' && flatRate !== null) {
    headline = {
      income: incomeRounded,
      expenses: flatRate.flat,
      base: flatRate.baseFlat,
      label: 'flat',
    };
  } else if (regime === 'pausalni_dan') {
    headline = {
      income: incomeRounded,
      expenses: Money.zero(CZK),
      base: incomeRounded,
      label: 'pausalni_dan',
    };
  } else {
    const expenses = round0(totals.deductibleTotal);
    headline = {
      income: incomeRounded,
      expenses,
      base: incomeRounded.subtract(expenses),
      label: 'actual',
    };
  }

  const assets = listAssets(input.assetLines, rules, year);
  const privateUse = summarizePrivateUse(input.privateUse);

  const vatPayments = Money.sum(
    yearTransactions.filter((t) => t.categoryCode === 'tax_vat_payment').map((t) => t.amount.abs()),
    CZK,
  );
  // TODO(decision-vat-turnover): the income total approximates domestic cash turnover.
  const vatNote = buildVatNote(
    {
      year,
      segments: input.profiles,
      vatPayments,
      vatFilings: input.vatFilings,
      domesticCashIncome: totals.incomeTotal,
    },
    rules,
  );

  const payments: PaymentsByCategory[] = PAYMENT_CATEGORIES.flatMap((categoryCode) => {
    const rows = yearTransactions.filter((t) => t.categoryCode === categoryCode);
    if (rows.length === 0) return [];
    const byMonth: Money[] = Array.from({ length: 12 }, () => Money.zero(CZK));
    for (const row of rows) {
      const idx = Number.parseInt(row.bookedOn.slice(5, 7), 10) - 1;
      byMonth[idx] = (byMonth[idx] ?? Money.zero(CZK)).add(row.amount.abs());
    }
    return [
      {
        categoryCode,
        total: Money.sum(
          rows.map((r) => r.amount.abs()),
          CZK,
        ),
        byMonth,
      },
    ];
  }).sort((a, b) =>
    a.categoryCode < b.categoryCode ? -1 : a.categoryCode > b.categoryCode ? 1 : 0,
  );

  const paidFor = (codes: readonly string[]): Money =>
    Money.sum(
      payments.filter((p) => codes.includes(p.categoryCode)).map((p) => p.total),
      CZK,
    );
  const advancesPaid =
    regime === 'pausalni_dan'
      ? paidFor(['tax_income_payment', 'tax_pausal_advance'])
      : paidFor(['tax_income_payment']);

  const hasAccommodation = totals.income.some((c) => c.categoryCode === 'income_accommodation');
  const checklistKeys = CHECKLIST_KEYS.filter((key) => {
    if (key === 'podklady.checklist.depreciation' || key === 'podklady.checklist.car') {
      return regime === 'danova_evidence';
    }
    if (key === 'podklady.checklist.accommodation') return hasAccommodation;
    return true;
  });

  const partialXmlEligible =
    input.partialXmlAvailable &&
    (regime === 'pausalni_vydaje' ||
      (regime === 'pausalni_dan' && pausalniDan?.returnRequired === true));
  const noReturnKey: 'pd.no_return' | null =
    regime === 'pausalni_dan' && pausalniDan !== null && !pausalniDan.returnRequired
      ? 'pd.no_return'
      : null;

  const empty = input.entries.every((e) => e.taxYear !== year) && yearTransactions.length === 0;

  return {
    year,
    generatedOn: today,
    taxpayer: input.taxpayer,
    empty,
    regime,
    segments,
    watermark,
    readiness,
    blocked,
    totals,
    headline,
    flatRate,
    pausalniDan,
    assets,
    privateUse,
    vatNote,
    payments,
    advancesPaid,
    checklistKeys,
    disclaimerKey: 'podklady.disclaimer',
    partialXmlEligible,
    noReturnKey,
  };
}
