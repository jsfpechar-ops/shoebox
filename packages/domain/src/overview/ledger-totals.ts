import type { LegalDate } from '../dates/index';
import type { TaxEffect } from '../enums/index';
import { CZK, Money } from '../money/index';
import type { OverviewTotals, PeriodTotals } from './totals';
export type LedgerBasis = 'payment' | 'document_evidence' | 'provisional';
export interface LedgerTotalsEntry { readonly entryDate: LegalDate; readonly basis: LedgerBasis; readonly taxEffect: TaxEffect; readonly businessAmountCzk: string; }  // decimal literal as stored
export interface LedgerTotals { readonly month: PeriodTotals; readonly ytd: PeriodTotals; readonly provisional: PeriodTotals; readonly entryCount: number; }
export interface MergedOverviewTotals extends OverviewTotals { readonly source: 'ledger' | 'documents'; readonly provisional: PeriodTotals; }

const LEDGER_INCOME_EFFECTS: ReadonlySet<string> = new Set(['taxable_income']);
const LEDGER_EXPENSE_EFFECTS: ReadonlySet<string> = new Set(['deductible_expense']);

/** Sums business_amount_czk per window (month = asOf's month up to asOf; ytd = asOf's year up to asOf) for income/expense effects; `provisional` rows go to `provisional` (ytd window) instead. Rows after asOf are ignored. */
export function computeLedgerTotals(entries: readonly LedgerTotalsEntry[], asOf: LegalDate): LedgerTotals {
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const ytdStart = `${asOf.slice(0, 4)}-01-01`;
  let monthIncome = Money.zero(CZK);
  let monthExpenses = Money.zero(CZK);
  let ytdIncome = Money.zero(CZK);
  let ytdExpenses = Money.zero(CZK);
  let provIncome = Money.zero(CZK);
  let provExpenses = Money.zero(CZK);
  let entryCount = 0;
  for (const entry of entries) {
    if (entry.entryDate < ytdStart || entry.entryDate > asOf) {
      continue;
    }
    entryCount += 1;
    const amount = Money.parse(entry.businessAmountCzk, CZK);
    const isIncome = LEDGER_INCOME_EFFECTS.has(entry.taxEffect);
    const isExpense = LEDGER_EXPENSE_EFFECTS.has(entry.taxEffect);
    if (!isIncome && !isExpense) {
      continue;
    }
    if (entry.basis === 'provisional') {
      if (isIncome) {
        provIncome = provIncome.add(amount);
      } else {
        provExpenses = provExpenses.add(amount);
      }
      continue;
    }
    const inMonth = entry.entryDate >= monthStart;
    if (isIncome) {
      ytdIncome = ytdIncome.add(amount);
      if (inMonth) {
        monthIncome = monthIncome.add(amount);
      }
    } else {
      ytdExpenses = ytdExpenses.add(amount);
      if (inMonth) {
        monthExpenses = monthExpenses.add(amount);
      }
    }
  }
  return {
    month: { income: monthIncome, expenses: monthExpenses },
    ytd: { income: ytdIncome, expenses: ytdExpenses },
    provisional: { income: provIncome, expenses: provExpenses },
    entryCount,
  };
}

/** Ledger month/ytd replace the document ones when entryCount > 0; everything else is kept from `docTotals`. */
export function mergeOverviewTotals(docTotals: OverviewTotals, ledger: LedgerTotals): MergedOverviewTotals {
  const useLedger = ledger.entryCount > 0;
  return {
    ...docTotals,
    month: useLedger ? ledger.month : docTotals.month,
    ytd: useLedger ? ledger.ytd : docTotals.ytd,
    source: useLedger ? 'ledger' : 'documents',
    provisional: ledger.provisional,
  };
}
