# 0326: Přehled from ledgers (a): `computeLedgerTotals` and the merge rule (`packages/domain`)

Status: todo
Ticket: P1-LEDG-03 (acceptance "ledgers feed Přehled"; M11 Přehled meters) | Depends on: 0308 (`TaxLedgerBasis`, tax effects), none at runtime | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 40k tokens

## 1. Objective

Přehled's income/expense numbers must come from `tax_ledger_entries` (cash basis, pro-rata, business share applied) instead of document sums, while turnover (a VAT concept: issued-invoice bases) and the "pending" count stay document-based. This brief gives the pure aggregation and the merge rule; 0327 wires the query.

## 2. Context

- `packages/domain/src/overview/totals.ts` today: `OverviewTotals {month: {income, expenses}, ytd: {income, expenses}, turnoverYtd, countedCount, pending: {count, grossCzk}}`, all `Money` in CZK, computed from `OverviewDocument[]`. Income effects: `taxable_income`; expense effects: `deductible_expense` (partially via share), per `INCOME_EFFECTS`/`EXPENSE_EFFECTS` in that file (read lines 60–100 to copy the sets exactly).
- Ledger row (0313): `entry_date, tax_year, basis ('payment'|'document_evidence'|'provisional'), tax_effect, amount_czk, business_share_pct, business_amount_czk`. `business_amount_czk` is already `amount × share / 100` (0308) and signed (credit notes negative). `pass_through`, `transfer`, `tax_or_insurance_payment`, `private`, `asset`, `non_deductible_expense`, `non_taxable_income` are excluded from income and expenses (AC-9g: tourist fee excluded).
- Basis filter: the overview counts `payment` and `document_evidence`; `provisional` rows (unpaid invoice, no payment evidence) are reported separately as `provisional` so M11 can show "awaiting payment" later. (TA-07 cash basis.)
- Merge rule: when the org has **any** ledger row in the ytd window, `month`/`ytd` income and expenses come from the ledger; else the document totals stay (pre-LEDG-03 data, or before the first rebuild). `turnoverYtd`, `countedCount`, `pending` always stay document-based. Record the source in `source: 'ledger' | 'documents'` so the screen can show a hint (lane D decides whether to).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/overview/ledger-totals.ts` | create | `computeLedgerTotals`, `mergeOverviewTotals` |
| `packages/domain/test/overview-ledger-totals.test.ts` | create | the test below, verbatim |
| `packages/domain/src/index.ts` | edit | `export * from './overview/ledger-totals';` after the `overview/totals` line |

## 4. Steps

1. Create `packages/domain/src/overview/ledger-totals.ts` exporting exactly:
```ts
import type { LegalDate } from '../dates/index';
import type { TaxEffect } from '../enums/index';
import type { Money } from '../money/index';
import type { OverviewTotals, PeriodTotals } from './totals';
export type LedgerBasis = 'payment' | 'document_evidence' | 'provisional';
export interface LedgerTotalsEntry { readonly entryDate: LegalDate; readonly basis: LedgerBasis; readonly taxEffect: TaxEffect; readonly businessAmountCzk: string; }  // decimal literal as stored
export interface LedgerTotals { readonly month: PeriodTotals; readonly ytd: PeriodTotals; readonly provisional: PeriodTotals; readonly entryCount: number; }
/** Sums business_amount_czk per window (month = asOf's month up to asOf; ytd = asOf's year up to asOf) for income/expense effects; `provisional` rows go to `provisional` (ytd window) instead. Rows after asOf are ignored. */
export function computeLedgerTotals(entries: readonly LedgerTotalsEntry[], asOf: LegalDate): LedgerTotals;
export interface MergedOverviewTotals extends OverviewTotals { readonly source: 'ledger' | 'documents'; readonly provisional: PeriodTotals; }
/** Ledger month/ytd replace the document ones when entryCount > 0; everything else is kept from `docTotals`. */
export function mergeOverviewTotals(docTotals: OverviewTotals, ledger: LedgerTotals): MergedOverviewTotals;
```
   Expenses are reported as **positive** Money (the ledger stores expenses positive for received documents and negative for credit notes; sum them signed, then the result is the expense figure). Income likewise signed. Use `Money.parse(text, 'CZK')` and `Money.add`; never `Number()`.

2. Create `packages/domain/test/overview-ledger-totals.test.ts` verbatim; implement until it passes, do not edit it:
```ts
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
```
   Command: `pnpm --filter @shoebox/domain test -- overview-ledger-totals 2>&1 | tail -30` → all pass.

3. Edit `packages/domain/src/index.ts` (export line). Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors; `pnpm --filter @shoebox/domain test -- overview 2>&1 | tail -30` → existing overview tests unchanged.

## 5. Do not touch

`overview/totals.ts`, `meters.ts`, `deadlines.ts`. Hard rule 1 (Money only).

## 6. Commands

As in §4.

## 7. Acceptance

- [ ] Tests pass; typecheck clean; existing overview tests unchanged. - [ ] No `Number(` in the new file.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0326-report.md`.

## Risk list

`ledger-totals.ts` (sign and effect sets).

## Owner steps

None.
