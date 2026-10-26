// M06 §4.11: the year-round "how much to set aside" estimate (dashboard reserve). Pure: the
// year's ledger entries, payments and the rules in, the estimate out. Rates, thresholds, credits,
// flat-rate caps and insurance bases come from `rules/cz`; nothing is typed here except the
// rounding targets owned by `money/rounding`.

import { Decimal } from 'decimal.js';
import { type LegalDate, parseLegalDate } from '../dates/index';
import type { TaxRegime } from '../enums/index';
import { CZK, Money } from '../money/index';
import { floor0, floor100, round0, round100 } from '../money/rounding';
import type { CzRules } from '../vat/period';
import type { FlatRate } from './answers';
import type { AnnualTotalsEntry } from './totals';

export interface ReservePayment {
  readonly categoryCode: string;
  readonly bookedOn: LegalDate;
  readonly amount: Money;
}

export interface ReserveInput {
  readonly year: number;
  readonly regime: TaxRegime;
  readonly pausalRate: FlatRate | null;
  readonly pausalDanBand: 1 | 2 | 3 | null;
  readonly entries: readonly AnnualTotalsEntry[];
  readonly payments: readonly ReservePayment[];
}

export interface TaxReserveEstimate {
  readonly kind: 'estimate';
  readonly asOf: LegalDate;
  readonly months: number;
  readonly income: Money;
  readonly expense: Money;
  readonly profit: Money;
  readonly base: Money;
  readonly tax: Money;
  readonly social: Money;
  readonly health: Money;
  readonly paidTax: Money;
  readonly paidSocial: Money;
  readonly paidHealth: Money;
  readonly reserve: Money;
  readonly display: Money;
}

export interface PausalniDanReserve {
  readonly kind: 'pausalni_dan';
  readonly asOf: LegalDate;
  readonly paid: Money;
  readonly dueYtd: Money;
}

const pct = (value: number): Decimal => new Decimal(value).div(100);
const czk = (value: number): Money => Money.parse(String(value), CZK);
const zero = (): Money => Money.zero(CZK);
const nonNegative = (m: Money): Money => (m.isNegative() ? zero() : m);
const monthOf = (date: LegalDate): number => Number.parseInt(date.slice(5, 7), 10);
const pad2 = (n: number): string => String(n).padStart(2, '0');

function sumWhere(
  items: readonly ReservePayment[],
  from: LegalDate,
  to: LegalDate,
  categoryCode: string,
): Money {
  return items
    .filter((p) => p.categoryCode === categoryCode && p.bookedOn >= from && p.bookedOn <= to)
    .reduce((acc, p) => acc.add(p.amount.abs()), zero());
}

/**
 * M06 §4.11. `null` for `ucetnictvi` (no reserve, VAT is never included). For `pausalni_dan` the
 * reserve is the paid-vs-due comparison of the monthly advances, not a tax estimate.
 */
export function computeTaxReserve(
  input: ReserveInput,
  rules: CzRules,
  asOf: LegalDate,
): TaxReserveEstimate | PausalniDanReserve | null {
  const yearStart = parseLegalDate(`${input.year}-01-01`);
  const months = monthOf(asOf);

  if (input.regime === 'ucetnictvi') return null;

  if (input.regime === 'pausalni_dan') {
    const band = input.pausalDanBand ?? 1;
    const paid = sumWhere(input.payments, yearStart, asOf, 'tax_pausal_advance');
    let dueYtd = zero();
    for (let m = 1; m <= months; m += 1) {
      const monthStart = parseLegalDate(`${input.year}-${pad2(m)}-01`);
      const row = rules
        .at(monthStart)
        .get('pausalni_dan.bands')
        .find((b) => b.band === band);
      if (row === undefined) throw new Error(`pausalni_dan band ${band} missing in rules`);
      dueYtd = dueYtd.add(czk(row.monthly));
    }
    return { kind: 'pausalni_dan', asOf, paid, dueYtd };
  }

  const ytd = input.entries.filter(
    (e) => e.taxYear === input.year && e.entryDate <= asOf && e.basis !== 'provisional',
  );
  const income = ytd
    .filter((e) => e.taxEffect === 'taxable_income')
    .reduce((acc, e) => acc.add(Money.parse(e.amountCzk, CZK)), zero());

  let expense: Money;
  if (input.regime === 'pausalni_vydaje') {
    // TODO(decision): a flat-rate regime without a stored rate is treated as 60 %.
    const rate = input.pausalRate ?? 60;
    const caps = rules.at(asOf).get('pausalni_vydaje.rates_caps');
    const cap = caps[String(rate) as keyof typeof caps];
    if (cap === undefined) throw new Error(`pausalni_vydaje cap for ${rate} missing in rules`);
    const flat = floor0(income.multiply(pct(rate)));
    expense = flat.compare(czk(cap)) > 0 ? czk(cap) : flat;
  } else {
    expense = ytd
      .filter((e) => e.taxEffect === 'deductible_expense')
      .reduce((acc, e) => acc.add(Money.parse(e.businessAmountCzk, CZK)), zero());
  }

  const profit = nonNegative(income.subtract(expense));
  const base = floor100(profit);

  const rates = rules.at(asOf).get('income_tax.rates');
  const credit = rules.at(asOf).get('income_tax.credits').taxpayer;
  const threshold = czk(rates.threshold_annual).multiply(String(months)).divide('12');
  const r1 = pct(rates.r1);
  const r2 = pct(rates.r2);
  const taxRaw =
    base.compare(threshold) <= 0
      ? base.multiply(r1)
      : threshold.multiply(r1).add(base.subtract(threshold).multiply(r2));
  const tax = round0(
    nonNegative(taxRaw.subtract(czk(credit).multiply(String(months)).divide('12'))),
  );

  const ins = rules.at(asOf).get('insurance.rates');
  const social = round0(profit.multiply(pct(ins.social_base_pct)).multiply(pct(ins.social_pct)));
  const health = round0(profit.multiply(pct(ins.health_base_pct)).multiply(pct(ins.health_pct)));

  const paidTax = sumWhere(input.payments, yearStart, asOf, 'tax_income_payment');
  const paidSocial = sumWhere(input.payments, yearStart, asOf, 'ins_social_own');
  const paidHealth = sumWhere(input.payments, yearStart, asOf, 'ins_health_own');

  const reserve = nonNegative(tax.subtract(paidTax))
    .add(nonNegative(social.subtract(paidSocial)))
    .add(nonNegative(health.subtract(paidHealth)));

  return {
    kind: 'estimate',
    asOf,
    months,
    income,
    expense,
    profit,
    base,
    tax,
    social,
    health,
    paidTax,
    paidSocial,
    paidHealth,
    reserve,
    display: round100(reserve),
  };
}
