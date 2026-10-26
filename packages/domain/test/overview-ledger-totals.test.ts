import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { CZK, Money } from '../src/money/index';
import { computeLedgerTotals, type LedgerTotalsEntry, mergeOverviewTotals } from '../src/overview/ledger-totals';
import type { OverviewTotals } from '../src/overview/totals';

const d = parseLegalDate;
const asOf = d('2026-10-26');
const czk = (t: string) => Money.parse(t, CZK);
const e = (entryDate: string, taxEffect: LedgerTotalsEntry['taxEffect'], amount: string, basis: LedgerTotalsEntry['basis'] = 'payment'): LedgerTotalsEntry => ({ entryDate: d(entryDate), taxEffect, businessAmountCzk: amount, basis });

describe('computeLedgerTotals', () => {
  it('sums income and expenses per window, applies the ledger sign, ignores excluded effects and future rows', () => {
    const t = computeLedgerTotals([
      e('2026-10-05', 'taxable_income', '50000.00'),
      e('2026-10-20', 'deductible_expense', '12960.84', 'document_evidence'),
      e('2026-10-21', 'deductible_expense', '-1000.00'),            // credit note
      e('2026-03-01', 'taxable_income', '30000.00'),
      e('2026-03-02', 'deductible_expense', '21592.00'),            // MacBook 80 %
      e('2026-03-03', 'pass_through', '1500.00'),                   // tourist fee: excluded (AC-9g)
      e('2026-03-03', 'private', '249.00'),
      e('2026-03-03', 'asset', '92000.00'),
      e('2025-12-31', 'taxable_income', '99999.00'),                // last year
      e('2026-10-27', 'taxable_income', '77777.00'),                // after asOf
    ], asOf);
    expect(t.month.income.equals(czk('50000.00'))).toBe(true);
    expect(t.month.expenses.equals(czk('11960.84'))).toBe(true);
    expect(t.ytd.income.equals(czk('80000.00'))).toBe(true);
    expect(t.ytd.expenses.equals(czk('33552.84'))).toBe(true);
    expect(t.provisional.income.isZero()).toBe(true);
    expect(t.entryCount).toBe(8);
  });
  it('provisional rows are reported apart and never counted', () => {
    const t = computeLedgerTotals([e('2026-10-01', 'taxable_income', '1000.00', 'provisional'), e('2026-09-01', 'deductible_expense', '200.00', 'provisional')], asOf);
    expect(t.ytd.income.isZero()).toBe(true);
    expect(t.provisional.income.equals(czk('1000.00'))).toBe(true);
    expect(t.provisional.expenses.equals(czk('200.00'))).toBe(true);
    expect(t.entryCount).toBe(2);
  });
  it('empty', () => {
    const t = computeLedgerTotals([], asOf);
    expect(t.entryCount).toBe(0);
    expect(t.ytd.expenses.isZero()).toBe(true);
  });
});

describe('mergeOverviewTotals', () => {
  const docTotals: OverviewTotals = { month: { income: czk('1.00'), expenses: czk('2.00') }, ytd: { income: czk('3.00'), expenses: czk('4.00') }, turnoverYtd: czk('5.00'), countedCount: 7, pending: { count: 1, grossCzk: czk('9.00') } };
  it('uses the ledger when it has rows and keeps turnover, counted and pending from documents', () => {
    const m = mergeOverviewTotals(docTotals, computeLedgerTotals([e('2026-10-05', 'taxable_income', '50000.00')], asOf));
    expect(m.source).toBe('ledger');
    expect(m.ytd.income.equals(czk('50000.00'))).toBe(true);
    expect(m.month.expenses.isZero()).toBe(true);
    expect(m.turnoverYtd.equals(czk('5.00'))).toBe(true);
    expect(m.countedCount).toBe(7);
    expect(m.pending.count).toBe(1);
  });
  it('falls back to the document totals when the ledger is empty', () => {
    const m = mergeOverviewTotals(docTotals, computeLedgerTotals([], asOf));
    expect(m.source).toBe('documents');
    expect(m.ytd.income.equals(czk('3.00'))).toBe(true);
    expect(m.provisional.income.isZero()).toBe(true);
  });
});
