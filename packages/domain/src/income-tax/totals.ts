import type { LegalDate } from '../dates/index';
import type { TaxEffect } from '../enums/index';
import type { TaxLedgerBasis } from '../ledgers/tax';
import { CZK, Money } from '../money/index';

/** A `tax_ledger_entries` row as read from the database (decimal literals as stored). */
export interface AnnualTotalsEntry {
  readonly entryDate: LegalDate;
  readonly taxYear: number;
  readonly basis: TaxLedgerBasis;
  readonly documentId: string;
  readonly lineId: string | null;
  readonly categoryCode: string;
  readonly taxEffect: TaxEffect;
  readonly amountCzk: string;
  readonly businessSharePct: string;
  readonly businessAmountCzk: string;
}
export interface DrillDownEntry {
  readonly documentId: string;
  readonly lineId: string | null;
  readonly entryDate: LegalDate;
  readonly basis: TaxLedgerBasis;
  readonly amountCzk: Money;
  readonly businessAmountCzk: Money;
  readonly businessSharePct: string;
}
export interface CategoryTotal {
  readonly categoryCode: string;
  readonly taxEffect: TaxEffect;
  readonly amount: Money;
  readonly businessAmount: Money;
  readonly privateAmount: Money;
  readonly entryCount: number;
  readonly entries: readonly DrillDownEntry[];
}
export interface AnnualTotals {
  readonly year: number;
  readonly income: readonly CategoryTotal[];
  readonly incomeTotal: Money; // Σ amount
  readonly nonTaxableIncome: readonly CategoryTotal[];
  readonly deductible: readonly CategoryTotal[];
  readonly deductibleTotal: Money; // Σ businessAmount
  readonly privatePart: Money; // Σ privateAmount of deductible + Σ amount of 'private'
  readonly privateItems: readonly CategoryTotal[]; // tax_effect 'private'
  readonly nonDeductible: readonly CategoryTotal[];
  readonly nonDeductibleTotal: Money; // Σ amount
  readonly assets: readonly CategoryTotal[];
  readonly passThrough: readonly CategoryTotal[];
  readonly taxAndInsurancePayments: readonly CategoryTotal[];
  readonly transfersCount: number;
  readonly provisional: readonly CategoryTotal[];
  readonly provisionalCount: number; // basis 'provisional', any effect
  readonly entryCount: number; // non-provisional entries of the year
}

interface Row {
  readonly entry: AnnualTotalsEntry;
  readonly amount: Money;
  readonly business: Money;
  readonly private: Money;
}

function toRow(entry: AnnualTotalsEntry): Row {
  const amount = Money.parse(entry.amountCzk, CZK);
  const business = Money.parse(entry.businessAmountCzk, CZK);
  return { entry, amount, business, private: amount.subtract(business) };
}

function group(rows: readonly Row[], effect: TaxEffect | null): CategoryTotal[] {
  const byCode = new Map<string, { effect: TaxEffect; rows: Row[] }>();
  for (const r of rows) {
    if (effect !== null && r.entry.taxEffect !== effect) continue;
    const key = r.entry.categoryCode;
    const g = byCode.get(key) ?? { effect: r.entry.taxEffect, rows: [] };
    g.rows.push(r);
    byCode.set(key, g);
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([categoryCode, g]) => ({
      categoryCode,
      taxEffect: g.effect,
      amount: Money.sum(
        g.rows.map((r) => r.amount),
        CZK,
      ),
      businessAmount: Money.sum(
        g.rows.map((r) => r.business),
        CZK,
      ),
      privateAmount: Money.sum(
        g.rows.map((r) => r.private),
        CZK,
      ),
      entryCount: g.rows.length,
      entries: g.rows.map((r) => ({
        documentId: r.entry.documentId,
        lineId: r.entry.lineId,
        entryDate: r.entry.entryDate,
        basis: r.entry.basis,
        amountCzk: r.amount,
        businessAmountCzk: r.business,
        businessSharePct: r.entry.businessSharePct,
      })),
    }));
}

/** Cash-basis annual totals (M06 §4.2). Provisional entries and other tax years are excluded. */
export function computeAnnualTotals(
  entries: readonly AnnualTotalsEntry[],
  year: number,
): AnnualTotals {
  const inYear = entries.filter((e) => e.taxYear === year);
  const provisionalRows = inYear.filter((e) => e.basis === 'provisional').map(toRow);
  const rows = inYear.filter((e) => e.basis !== 'provisional').map(toRow);

  const income = group(rows, 'taxable_income');
  const deductible = group(rows, 'deductible_expense');
  const privateItems = group(rows, 'private');
  const nonDeductible = group(rows, 'non_deductible_expense');

  return {
    year,
    income,
    incomeTotal: Money.sum(
      income.map((c) => c.amount),
      CZK,
    ),
    nonTaxableIncome: group(rows, 'non_taxable_income'),
    deductible,
    deductibleTotal: Money.sum(
      deductible.map((c) => c.businessAmount),
      CZK,
    ),
    privatePart: Money.sum(
      [...deductible.map((c) => c.privateAmount), ...privateItems.map((c) => c.amount)],
      CZK,
    ),
    privateItems,
    nonDeductible,
    nonDeductibleTotal: Money.sum(
      nonDeductible.map((c) => c.amount),
      CZK,
    ),
    assets: group(rows, 'asset'),
    passThrough: group(rows, 'pass_through'),
    taxAndInsurancePayments: group(rows, 'tax_or_insurance_payment'),
    transfersCount: rows.filter((r) => r.entry.taxEffect === 'transfer').length,
    provisional: group(provisionalRows, null),
    provisionalCount: provisionalRows.length,
    entryCount: rows.length,
  };
}
