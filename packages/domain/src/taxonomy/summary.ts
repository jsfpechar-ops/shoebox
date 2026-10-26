import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { TaxEffect, VatStatus, VatTreatment } from '../enums/index';
import type { VatPeriodRange } from '../vat/point-date';
import { type Deductibility, getCategory } from './categories';

export const SUMMARY_MAX_LENGTH = 120;

// TODO(i18n-cs): English until cs.json wakes up (owner 2026-10-25).
export const MONTH_NAMES_EN: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface SummaryInput {
  readonly asOf: LegalDate;
  readonly subject: {
    readonly user: string | null;
    readonly llm: string | null;
    readonly vendorHint: string | null;
  };
  readonly dominant: {
    readonly categoryCode: string;
    readonly taxEffect: TaxEffect;
    readonly deductibility: Deductibility;
    readonly businessSharePct: string;
    readonly vatTreatment: VatTreatment | null;
    readonly vatRatePct: string | null;
  };
  readonly otherTaxEffects: readonly TaxEffect[];
  readonly servicePeriodFrom: LegalDate | null;
  readonly servicePeriodTo: LegalDate | null;
  readonly duzp: LegalDate | null;
  readonly issueDate: LegalDate | null;
  readonly recurringCategories: readonly string[];
  readonly vatStatus: VatStatus;
  readonly deductionAllowed: boolean;
  readonly vatPeriod: VatPeriodRange | null;
}

function monthIndex(date: LegalDate): number {
  return parseInt(date.slice(5, 7), 10) - 1;
}

function yearOf(date: LegalDate): string {
  return date.slice(0, 4);
}

/** "September" in the as-of year, "September 2025" otherwise. */
export function monthLabel(date: LegalDate, asOf: LegalDate): string {
  const name = MONTH_NAMES_EN[monthIndex(date)] ?? '';
  return yearOf(date) === yearOf(asOf) ? name : `${name} ${yearOf(date)}`;
}

/** "August" for a monthly period, "Q3 2026" for a quarterly one. */
export function periodLabel(period: VatPeriodRange, asOf: LegalDate): string {
  if (period.kind === 'month') return monthLabel(period.start, asOf);
  const quarter = Math.floor(monthIndex(period.start) / 3) + 1;
  return `Q${quarter} ${yearOf(period.start)}`;
}

function formatPct(value: string): string {
  return new Decimal(value).toDecimalPlaces(2).toFixed();
}

function servicePeriodPhrase(input: SummaryInput): string {
  const { servicePeriodFrom: from, servicePeriodTo: to } = input;
  if (from && to) {
    if (from.slice(0, 7) === to.slice(0, 7)) return ` for ${monthLabel(from, input.asOf)}`;
    if (yearOf(from) === yearOf(to)) {
      const range = `${MONTH_NAMES_EN[monthIndex(from)]}–${MONTH_NAMES_EN[monthIndex(to)]}`;
      return yearOf(from) === yearOf(input.asOf)
        ? ` for ${range}`
        : ` for ${range} ${yearOf(from)}`;
    }
  }
  const recurringDate = input.duzp ?? input.issueDate;
  if (recurringDate && input.recurringCategories.includes(input.dominant.categoryCode)) {
    return ` for ${monthLabel(recurringDate, input.asOf)}`;
  }
  return '';
}

function subjectOf(input: SummaryInput): string {
  const candidates = [input.subject.user, input.subject.llm, input.subject.vendorHint];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return getCategory(input.dominant.categoryCode).labelEn;
}

function taxPhrase(input: SummaryInput): string {
  const { taxEffect, deductibility, businessSharePct } = input.dominant;
  switch (taxEffect) {
    case 'private':
      return 'personal expense, not counted for the business';
    case 'asset':
      return 'long-term asset, depreciation is for the accountant';
    case 'pass_through':
      return 'pass-through item, neither income nor expense';
    case 'taxable_income':
      return 'taxable income';
    case 'non_taxable_income':
      return 'non-taxable income';
    case 'transfer':
      return 'transfer between own accounts';
    case 'tax_or_insurance_payment':
      return 'tax or insurance payment';
    case 'non_deductible_expense':
      return 'not tax-deductible';
    case 'deductible_expense':
      if (deductibility === 'partially_deductible') {
        return `${formatPct(businessSharePct)} % tax-deductible`;
      }
      if (deductibility === 'non_deductible') return 'not tax-deductible';
      return deductibility === 'deductible' ? 'tax-deductible expense' : 'expense';
  }
}

function vatPhrase(input: SummaryInput): string | null {
  const { vatTreatment, vatRatePct } = input.dominant;
  const rate = vatRatePct === null ? '' : `${formatPct(vatRatePct)} %`;
  const { vatStatus, deductionAllowed, vatPeriod } = input;
  const returnFor = vatPeriod ? ` in the return for ${periodLabel(vatPeriod, input.asOf)}` : '';
  switch (vatTreatment) {
    case 'rcv_domestic_no_vat':
      return 'no VAT';
    case 'rcv_foreign_vat_charged':
      return 'foreign VAT is part of the cost';
    case 'rcv_domestic_vat':
      if (vatStatus === 'platce') {
        return deductionAllowed ? `you deduct VAT ${rate}` : 'VAT not deductible';
      }
      return `VAT ${rate} is part of the cost`;
    case 'rcv_eu_service_reverse_charge':
    case 'rcv_non_eu_service_reverse_charge':
    case 'rcv_eu_goods_acquisition':
      if (vatStatus === 'neplatce') return 'note: this triggers a VAT registration duty';
      if (vatStatus === 'platce') return `you declare and deduct VAT ${rate}${returnFor}`;
      return `you pay VAT ${rate} yourself${returnFor}`;
    default:
      return null;
  }
}

/** One plain sentence per document; the LLM only supplies the subject. */
export function buildSummary(input: SummaryInput): string {
  const period = servicePeriodPhrase(input);
  const tax = taxPhrase(input);
  const vat = vatPhrase(input);
  const otherCount = input.otherTaxEffects.filter((e) => e !== input.dominant.taxEffect).length;
  const suffix = otherCount > 0 ? ` (+ ${otherCount} more items)` : '';
  const rest = `${period} – ${tax}${vat ? `, ${vat}` : ''}${suffix}`;

  let subject = subjectOf(input);
  const available = SUMMARY_MAX_LENGTH - rest.length;
  if (subject.length + rest.length > SUMMARY_MAX_LENGTH) {
    subject = `${subject.slice(0, Math.max(0, available - 1))}…`;
  }
  const result = `${subject}${rest}`;
  return result.length > SUMMARY_MAX_LENGTH
    ? `${result.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
    : result;
}
