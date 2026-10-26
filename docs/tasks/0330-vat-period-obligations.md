# 0330: VAT due dates and `vatObligationsFor`

Status: todo
Ticket: P3-VAT-02 | Depends on: 0328 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

Pure `vatDueDate` (25th after the period, shifted to the next working day) and `vatObligationsFor` (vat_return, kh, sh, vat_payment drafts) that M09's `obligations.generate` will upsert. M05 never writes `obligations` itself.

## 2. Context

M05 §4.12 (pasted): due date rule `25th_after_period`: day `vat.deadline_day` of the month after `period_end`; if Saturday/Sunday/holiday (`calendar.cz_public_holidays`) → next working day. Upsert key `(org_id, kind, period_start)`; `source_rule` = generator id.

| Kind | Who | `amount_estimate` | Done when |
|---|---|---|---|
| `vat_return` | payer: every period; IO: periods with ≥ 1 entry on rows 3–13 | ř.64 (− ř.65 as negative) | DPHDP3 `marked_filed` |
| `kh` | payer | — | DPHKH1 `marked_filed` |
| `sh` | payer or IO with SH entries in the month | Σ `pln_hodnota` | DPHSHV `marked_filed` |
| `vat_payment` | where ř.64 > 0 | ř.64 | Σ matched `tax_vat_payment` transactions booked in `(period_end, due_date + 30 d]` ≥ amount |

`state='overdue'` when `due_date < today` and not done. `vat_amendment`/`kh_nasledne` come with brief 0348 (leave `// TODO(0348)`). M05 §9 #14: 25 Oct 2026 is a Sunday → `2026-10-26`; December 2026 IO return → `2027-01-25`. Extra hand-checked case: November 2026 → legal 25 Dec 2026 (Friday, holiday), 26–27 weekend → `2026-12-28`.

Existing helpers (`packages/domain/src/overview/deadlines.ts`, exported from the package index): `shiftDate(date, 'next_working_day', rules)`, `isCzWorkingDay(date, rules)`; `rules` is `ReturnType<typeof createCzRules>` (`createCzRules()` from `../rules/index`). `vat.deadline_day` (25) is seeded. Dates: `LegalDate`, `parseLegalDate`, `addDays`, `compareLegalDates` from `../dates/index`. Money: `Money`, `CZK` from `../money/index` (never floats; sum with `Money.sum(items, 'CZK')`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/period.ts` | create | `vatDueDate`, `monthAfter`, `periodEndOf` |
| `packages/domain/src/vat/obligations.ts` | create | types + `vatObligationsFor` |
| `packages/domain/test/vat-obligations.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/period';` and `export * from './vat/obligations';` |

## 4. Steps

1. `period.ts` exports exactly:
```ts
export type CzRules = ReturnType<typeof createCzRules>;
/** First day of the month after `date`'s month. */
export function monthAfter(date: LegalDate): LegalDate;
/** Last day of the month/quarter that starts at `start`. */
export function periodEndOf(start: LegalDate, kind: 'month' | 'quarter'): LegalDate;
/** { legal: day `vat.deadline_day` of the month after periodEnd, due: shifted to the next CZ working day }. Rules resolved at `periodEnd`. */
export function vatDueDate(periodEnd: LegalDate, rules: CzRules): { legal: LegalDate; due: LegalDate };
```
2. `obligations.ts` exports exactly:
```ts
export type VatObligationKind = 'vat_return' | 'kh' | 'sh' | 'vat_payment';
export interface VatPeriodSummary { readonly start: LegalDate; readonly end: LegalDate; readonly kind: 'month' | 'quarter'; readonly hasReturnRows: boolean; /* IO: an entry on rows 3–13; payer: always true once the period exists */ readonly row64: Money | null; readonly row65: Money | null; /* null until computed */ readonly shMonths: readonly { readonly monthStart: LegalDate; readonly monthEnd: LegalDate; readonly plnHodnotaSum: Money }[] }
export interface VatFilingSummary { readonly type: 'DPHDP3' | 'DPHKH1' | 'DPHSHV'; readonly kind: FilingKind; readonly periodStart: LegalDate; readonly state: FilingState }
export interface VatPaymentSummary { readonly bookedOn: LegalDate; readonly amount: Money }   // matched tax_vat_payment transactions
export interface VatObligationsInput { readonly status: 'platce' | 'identifikovana_osoba'; readonly periods: readonly VatPeriodSummary[]; readonly filings: readonly VatFilingSummary[]; readonly payments: readonly VatPaymentSummary[]; readonly today: LegalDate }
export interface ObligationDraft { readonly kind: VatObligationKind; readonly periodStart: LegalDate; readonly periodEnd: LegalDate; readonly legalDueDate: LegalDate; readonly dueDate: LegalDate; readonly amountEstimate: Money | null; readonly state: 'open' | 'done' | 'overdue'; readonly doneSource: 'filing' | 'bank_payment' | null; readonly sourceRule: string }
export const VAT_OBLIGATION_SOURCE = 'm05.vat_obligations.v1';
export function vatObligationsFor(input: VatObligationsInput, rules: CzRules): ObligationDraft[];
```
Semantics: output sorted by (`dueDate`, `kind` in the order vat_return, kh, sh, vat_payment, `periodStart`). `vat_return`: IO only when `hasReturnRows`; amount = `row64` if > 0, else `row65.negate()` if > 0, else `Money.zero('CZK')` when both known, else null. `kh`: payers only, per period. `sh`: one per `shMonths` entry, due from the month end, amount = sum. `vat_payment`: when `row64` is positive and a DPHDP3 filing for the period has state in (`generated`,`downloaded`,`marked_filed`); done when Σ payments with `bookedOn` in `(end, due+30]` ≥ row64 (`doneSource:'bank_payment'`). Filing-done rule: a filing of the matching type with `state === 'marked_filed'` for that `periodStart` (`doneSource:'filing'`). Not done and `dueDate < today` → `overdue`.
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { type VatPeriodSummary, vatObligationsFor } from '../src/vat/obligations';
import { monthAfter, periodEndOf, vatDueDate } from '../src/vat/period';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const month = (start: string, over: Partial<VatPeriodSummary> = {}): VatPeriodSummary => ({
  start: d(start), end: periodEndOf(d(start), 'month'), kind: 'month', hasReturnRows: true, row64: null, row65: null, shMonths: [], ...over,
});

describe('vatDueDate (M05 §4.12, §9 #14)', () => {
  it('helpers', () => {
    expect(monthAfter(d('2026-12-31'))).toBe('2027-01-01');
    expect(periodEndOf(d('2026-07-01'), 'quarter')).toBe('2026-09-30');
    expect(periodEndOf(d('2026-02-01'), 'month')).toBe('2026-02-28');
  });
  it('Q3 2026: 25 Oct is a Sunday → 26. 10. 2026', () => {
    expect(vatDueDate(d('2026-09-30'), rules)).toEqual({ legal: '2026-10-25', due: '2026-10-26' });
  });
  it('December 2026 → 25. 1. 2027 (Monday, no shift)', () => {
    expect(vatDueDate(d('2026-12-31'), rules)).toEqual({ legal: '2027-01-25', due: '2027-01-25' });
  });
  it('November 2026 → 25 Dec holiday, weekend → 28. 12. 2026', () => {
    expect(vatDueDate(d('2026-11-30'), rules)).toEqual({ legal: '2026-12-25', due: '2026-12-28' });
  });
});

describe('vatObligationsFor', () => {
  it('IO: vat_return only for months with rows 3–13; amount = ř.64', () => {
    const out = vatObligationsFor({ status: 'identifikovana_osoba', today: d('2026-09-01'), filings: [], payments: [],
      periods: [month('2026-08-01', { row64: czk('2877.00'), row65: czk('0.00') }), month('2026-07-01', { hasReturnRows: false })] }, rules);
    expect(out.map((o) => ({ ...o, amountEstimate: o.amountEstimate?.toFixed2() ?? null }))).toEqual([{ kind: 'vat_return', periodStart: '2026-08-01', periodEnd: '2026-08-31', legalDueDate: '2026-09-25', dueDate: '2026-09-25', amountEstimate: '2877.00', state: 'open', doneSource: null, sourceRule: 'm05.vat_obligations.v1' }]);
  });
  it('payer: vat_return + kh every period, sh per month, vat_payment once generated; overdue after due', () => {
    const q3: VatPeriodSummary = { start: d('2026-07-01'), end: d('2026-09-30'), kind: 'quarter', hasReturnRows: true, row64: czk('5196.00'), row65: czk('0.00'),
      shMonths: [{ monthStart: d('2026-08-01'), monthEnd: d('2026-08-31'), plnHodnotaSum: czk('3001.00') }] };
    const out = vatObligationsFor({ status: 'platce', today: d('2026-10-27'), payments: [],
      filings: [{ type: 'DPHDP3', kind: 'radne', periodStart: d('2026-07-01'), state: 'generated' }], periods: [q3] }, rules);
    expect(out.map((o) => [o.kind, o.dueDate, o.state, o.amountEstimate?.toFixed2() ?? null])).toEqual([
      ['sh', '2026-09-25', 'overdue', '3001.00'],
      ['vat_return', '2026-10-26', 'overdue', '5196.00'],
      ['kh', '2026-10-26', 'overdue', null],
      ['vat_payment', '2026-10-26', 'overdue', '5196.00'],
    ]);
    expect(out.find((o) => o.kind === 'sh')?.periodStart).toBe('2026-08-01');
  });
  it('done by filing and by payment; credit (ř.65) is a negative estimate; no vat_payment without a generated filing', () => {
    const out = vatObligationsFor({ status: 'platce', today: d('2026-11-30'),
      filings: [{ type: 'DPHDP3', kind: 'radne', periodStart: d('2026-09-01'), state: 'marked_filed' }, { type: 'DPHKH1', kind: 'radne', periodStart: d('2026-09-01'), state: 'marked_filed' }, { type: 'DPHDP3', kind: 'radne', periodStart: d('2026-10-01'), state: 'draft' }],
      payments: [{ bookedOn: d('2026-10-20'), amount: czk('3000.00') }, { bookedOn: d('2026-11-24'), amount: czk('2196.00') }, { bookedOn: d('2026-11-25'), amount: czk('1.00') }],
      periods: [month('2026-09-01', { row64: czk('5196.00'), row65: czk('0.00') }), month('2026-10-01', { row64: czk('0.00'), row65: czk('120.00') })] }, rules);
    const by = (k: string, p: string) => out.find((o) => o.kind === k && o.periodStart === p);
    expect(by('vat_return', '2026-09-01')).toMatchObject({ state: 'done', doneSource: 'filing' });
    expect(by('kh', '2026-09-01')).toMatchObject({ state: 'done', doneSource: 'filing' });
    expect(by('vat_payment', '2026-09-01')).toMatchObject({ state: 'done', doneSource: 'bank_payment' }); // 3000 + 2196 within (30 Sep, 26 Oct + 30 d = 25 Nov]
    expect(by('vat_return', '2026-10-01')?.state).toBe('overdue');
    expect(by('vat_return', '2026-10-01')?.amountEstimate?.toFixed2()).toBe('-120.00');
    expect(by('vat_payment', '2026-10-01')).toBeUndefined();
  });
  it('payment window excludes the day after due+30', () => {
    const out = vatObligationsFor({ status: 'platce', today: d('2026-10-01'),
      filings: [{ type: 'DPHDP3', kind: 'radne', periodStart: d('2026-09-01'), state: 'downloaded' }],
      payments: [{ bookedOn: d('2026-11-26'), amount: czk('5196.00') }],
      periods: [month('2026-09-01', { row64: czk('5196.00'), row65: czk('0.00') })] }, rules);
    expect(out.find((o) => o.kind === 'vat_payment')).toMatchObject({ state: 'open', doneSource: null });
  });
});
```
Implement until green. Command: `pnpm --filter @shoebox/domain test -- vat-obligations 2>&1 | tail -30`.
4. Index lines; typecheck; commit `feat(domain): VAT due dates and obligation drafts (0330)`.

## 5. Do not touch

`overview/deadlines.ts` (M09; import only), rules seeds, db.

## 6. Commands

`pnpm --filter @shoebox/domain test -- vat-obligations 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] All four date cases and four obligation cases green; typecheck clean.
- [ ] Report: `[verify]` SH always monthly for payers (M05 §4.1); late-filing penalty text left out (TODO(TA-10)).

## 8. Stop and ask

TEMPLATE §8; also if `calendar.cz_public_holidays` lacks 2026-12-25 (then the holiday seed is wrong: report, do not patch).

## 9. Report

`docs/tasks/0330-report.md`.

## Risk list

`period.ts` (deadlines), `obligations.ts` (amounts).

## Owner steps

None. Wiring into M09 `obligations.generate` is P1-DASH-02 (another lane) and takes `vatObligationsFor` as is.
