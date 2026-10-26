# 0358: `computeTaxReserve` and `incomeTaxObligationsFor`

Status: todo
Ticket: P4-POD-03 | Depends on: 0352, 0353, 0354 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 55k tokens

## 1. Objective

Two pure functions: the year-round "how much to set aside" estimate for the dashboard (M06 §4.11, the only implementation; M09 displays it) and the income-tax obligation drafts (`dap`, `pausalni_dan_entry`, `pausalni_dan_exit`, `pausalni_dan_advance`, M06 §4.12). No screen here: lane D renders `reserve.*` copy (0359) from the API of 0365.

## 2. Context

**M06 §4.11** (pasted, rules at `asOf`):
```
asOf = today (Europe/Prague); months = month(asOf)                 // elapsed months incl. current
income  = Σ taxable_income YTD (entries with taxYear = year, entryDate ≤ asOf, basis ≠ provisional; amountCzk)
expense = pausalni_vydaje ? min(floor0(income × rate/100), cap[rate]) : Σ deductible businessAmountCzk YTD
profit  = max(0, income − expense)
base    = floor100(profit)
T       = threshold_annual × months/12 (exact decimal, not rounded)
taxRaw  = base ≤ T ? base × r1/100 : T × r1/100 + (base − T) × r2/100
tax     = round0(max(0, taxRaw − credit × months/12))             // income_tax.rates {r1, r2, threshold_annual}, income_tax.credits.taxpayer
social  = round0(profit × sBase/100 × sRate/100);  health = round0(profit × hBase/100 × hRate/100)   // insurance.rates
paidS, paidH, paidT = Σ |amount| YTD of payments with categoryCode ins_social_own, ins_health_own, tax_income_payment (bookedOn in [year-01-01, asOf])
reserve = max(0, tax − paidT) + max(0, social − paidS) + max(0, health − paidH)
display = round100(reserve)
```
- `pausalni_dan`: no reserve; `{ kind: 'pausalni_dan', paid: Σ tax_pausal_advance YTD, dueYtd: Σ_{m=1..months} bands[band].monthly at ⟨year⟩-⟨mm⟩-01 }`.
- `ucetnictvi`: `null`. VAT is never included. Never shown as an obligation, never used in filings.

Golden S2 (M06 §9) as of 30. 9. 2026: YTD income 1 050 000, expenses 390 000, social paid 9 × 5 005 = 45 045, health paid 9 × 3 306 = 29 754, tax paid 0 → profit 660 000, base 660 000, T = 1 762 812 × 9/12 = 1 322 109 ≥ base → taxRaw 99 000, credit 30 840 × 9/12 = 23 130 → tax 75 870; social 660 000 × 0,55 × 0,292 = 105 996; health 660 000 × 0,50 × 0,135 = 44 550; reserve = 75 870 + 60 951 + 14 796 = **151 617** → display **151 600**.

**M06 §4.12** (pasted):

| Kind | Who | due | note |
|---|---|---|---|
| `dap` | segments `danova_evidence`, `pausalni_vydaje` in the year; `pausalni_dan` only when `pausalniDanReturnRequired` | legal `⟨year+1⟩-05-01`, shifted next working day (2027 → 3. 5. 2027) | `note` = `'podklady.dap.note.advisor'` when any segment `hasAccountant`, else `'podklady.dap.note.standard'` (paper 1 April, advisor 1 July are copy only) |
| `pausalni_dan_entry` (optional) | `eligibleForEntry` (caller: no paušál segment, income ≤ 2 000 000, no `platce`) | `shiftDate(⟨year+1⟩-⟨pausalni_dan.deadlines.entry⟩, 'next_working_day')` | only while `today ≥ ⟨year⟩-12-01` and `today ≤ due` |
| `pausalni_dan_exit` (optional) | a `pausalni_dan` segment covering `⟨year⟩-12-31` | same date with `.exit` | only while `today ≥ ⟨year⟩-12-01` and `today ≤ due` |
| `pausalni_dan_advance` | every month of the year covered by a `pausalni_dan` segment | legal `⟨year⟩-⟨mm⟩-⟨advance_day⟩`, shifted next working day | `amountEstimate` = the band's `monthly` at that month; `done` when Σ advances booked in `[month start, due + 10 days]` ≥ amount (`doneSource: 'bank_payment'`); else `overdue` when `today > due`, else `open` |

Period of `dap` = the tax year; of entry/exit = year+1; of an advance = the month. `sourceRule = 'm06.income_tax_obligations.v1'`. Helpers: `shiftDate`, `addDays`, `compareLegalDates`, `periodEndOf(start, 'month')` (`../vat/period`), `segmentsInYear` (0354), `AnnualTotalsEntry` (0353), `ProfileSegment` (0354), `floor0`, `floor100`, `round0`, `round100`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/income-tax/reserve.ts` | create | `ReserveInput`, `TaxReserveEstimate`, `PausalniDanReserve`, `computeTaxReserve` |
| `packages/domain/src/income-tax/obligations.ts` | create | `IncomeTaxObligationKind`, `IncomeTaxObligationDraft`, `INCOME_TAX_OBLIGATION_SOURCE`, `incomeTaxObligationsFor` |
| `packages/domain/test/tax-reserve.test.ts` | create | below |
| `packages/domain/test/income-tax-obligations.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './income-tax/reserve';` and `export * from './income-tax/obligations';` after the last `./income-tax/` line |

## 4. Steps

1. `reserve.ts` exports exactly:
```ts
export interface ReservePayment { readonly categoryCode: string; readonly bookedOn: LegalDate; readonly amount: Money }
export interface ReserveInput { readonly year: number; readonly regime: TaxRegime; readonly pausalRate: FlatRate | null; readonly pausalDanBand: 1 | 2 | 3 | null; readonly entries: readonly AnnualTotalsEntry[]; readonly payments: readonly ReservePayment[] }
export interface TaxReserveEstimate { readonly kind: 'estimate'; readonly asOf: LegalDate; readonly months: number; readonly income: Money; readonly expense: Money; readonly profit: Money; readonly base: Money; readonly tax: Money; readonly social: Money; readonly health: Money; readonly paidTax: Money; readonly paidSocial: Money; readonly paidHealth: Money; readonly reserve: Money; readonly display: Money }
export interface PausalniDanReserve { readonly kind: 'pausalni_dan'; readonly asOf: LegalDate; readonly paid: Money; readonly dueYtd: Money }
export function computeTaxReserve(input: ReserveInput, rules: CzRules, asOf: LegalDate): TaxReserveEstimate | PausalniDanReserve | null;
```
`pausalni_vydaje` with `pausalRate === null` → treat as 60 (`TODO(decision)` comment). `pausalni_dan` with `pausalDanBand === null` → band 1.
2. `obligations.ts` exports exactly:
```ts
export type IncomeTaxObligationKind = 'dap' | 'pausalni_dan_entry' | 'pausalni_dan_exit' | 'pausalni_dan_advance';
export interface IncomeTaxObligationDraft { readonly kind: IncomeTaxObligationKind; readonly periodStart: LegalDate; readonly periodEnd: LegalDate; readonly legalDueDate: LegalDate; readonly dueDate: LegalDate; readonly amountEstimate: Money | null; readonly state: 'open' | 'done' | 'overdue'; readonly doneSource: 'bank_payment' | null; readonly isOptional: boolean; readonly note: string | null; readonly sourceRule: string }
export const INCOME_TAX_OBLIGATION_SOURCE = 'm06.income_tax_obligations.v1';
export interface IncomeTaxObligationsInput { readonly year: number; readonly profiles: readonly ProfileSegment[]; readonly advances: ReadonlyArray<{ readonly bookedOn: LegalDate; readonly amount: Money }>; readonly pausalniDanReturnRequired: boolean; readonly eligibleForEntry: boolean }
export function incomeTaxObligationsFor(input: IncomeTaxObligationsInput, today: LegalDate, rules: CzRules): IncomeTaxObligationDraft[];
```
Output order: `dap`, then advances by month, then entry, then exit.
3. `tax-reserve.test.ts` verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { computeTaxReserve, type ReserveInput } from '../src/income-tax/reserve';
import type { AnnualTotalsEntry } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
let n = 0;
const e = (taxEffect: AnnualTotalsEntry['taxEffect'], amount: string, entryDate = '2026-03-01', basis: AnnualTotalsEntry['basis'] = 'payment'): AnnualTotalsEntry => ({
  entryDate: d(entryDate), taxYear: Number(entryDate.slice(0, 4)), basis, documentId: `doc-${(n += 1)}`, lineId: null, categoryCode: 'x', taxEffect, amountCzk: amount, businessSharePct: '100', businessAmountCzk: amount,
});
const pay = (categoryCode: string, amount: string, bookedOn: string) => ({ categoryCode, bookedOn: d(bookedOn), amount: czk(amount) });
const months = (cat: string, amount: string, upTo: number) => Array.from({ length: upTo }, (_, i) => pay(cat, amount, `2026-${String(i + 1).padStart(2, '0')}-10`));
const s2 = (o: Partial<ReserveInput> = {}): ReserveInput => ({
  year: 2026, regime: 'danova_evidence', pausalRate: null, pausalDanBand: null,
  entries: [e('taxable_income', '1050000.00'), e('deductible_expense', '390000.00'), e('taxable_income', '200000.00', '2026-11-15'), e('taxable_income', '99999.00', '2026-05-05', 'provisional')],
  payments: [...months('ins_social_own', '5005.00', 9), ...months('ins_health_own', '3306.00', 9)], ...o,
});

describe('computeTaxReserve S2 (M06 §9, as of 30. 9. 2026)', () => {
  const r = computeTaxReserve(s2(), rules, d('2026-09-30'));
  it('profit 660 000 → tax 75 870, social 105 996, health 44 550; reserve 151 617 → ≈ 151 600', () => {
    expect(r?.kind).toBe('estimate');
    if (r?.kind !== 'estimate') return;
    expect([r.months, f(r.income), f(r.expense), f(r.profit), f(r.base)]).toEqual([9, '1050000.00', '390000.00', '660000.00', '660000.00']);
    expect([f(r.tax), f(r.social), f(r.health)]).toEqual(['75870.00', '105996.00', '44550.00']);
    expect([f(r.paidTax), f(r.paidSocial), f(r.paidHealth)]).toEqual(['0.00', '45045.00', '29754.00']);
    expect([f(r.reserve), f(r.display)]).toEqual(['151617.00', '151600.00']);
  });
  it('a payment of tax above the estimate never makes the reserve negative; later entries are ignored', () => {
    const r2 = computeTaxReserve(s2({ payments: [pay('tax_income_payment', '500000.00', '2026-02-01'), pay('ins_social_own', '1.00', '2026-10-01')] }), rules, d('2026-09-30'));
    if (r2?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r2.paidTax), f(r2.paidSocial), f(r2.reserve)]).toEqual(['500000.00', '0.00', '150546.00']); // 0 + 105 996 + 44 550
  });
});

describe('computeTaxReserve: threshold, floor100, flat-rate regime, paušální daň, účetnictví', () => {
  it('profit 2 000 000 on 31. 12.: 15 % to 1 762 812 then 23 %; credit 30 840 → tax 288 135', () => {
    const r = computeTaxReserve(s2({ entries: [e('taxable_income', '2600000.00'), e('deductible_expense', '600000.00')], payments: [] }), rules, d('2026-12-31'));
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([r.months, f(r.tax), f(r.social), f(r.health), f(r.reserve), f(r.display)]).toEqual([12, '288135.00', '321200.00', '135000.00', '744335.00', '744300.00']);
  });
  it('base is floored to hundreds: profit 123 456 → base 123 400; a loss → zero everywhere', () => {
    const r = computeTaxReserve(s2({ entries: [e('taxable_income', '123456.00')], payments: [] }), rules, d('2026-12-31'));
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r.profit), f(r.base)]).toEqual(['123456.00', '123400.00']);
    const loss = computeTaxReserve(s2({ entries: [e('taxable_income', '10.00'), e('deductible_expense', '50.00')], payments: [] }), rules, d('2026-12-31'));
    if (loss?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(loss.profit), f(loss.tax), f(loss.social), f(loss.reserve)]).toEqual(['0.00', '0.00', '0.00', '0.00']);
  });
  it('pausalni_vydaje 60 %: expense = floor(1 050 000 × 0,6) = 630 000, capped at 1 200 000', () => {
    const r = computeTaxReserve(s2({ regime: 'pausalni_vydaje', pausalRate: 60, payments: [] }), rules, d('2026-09-30'));
    if (r?.kind !== 'estimate') throw new Error('estimate expected');
    expect([f(r.expense), f(r.profit), f(r.tax), f(r.social), f(r.health), f(r.display)]).toEqual(['630000.00', '420000.00', '39870.00', '67452.00', '28350.00', '135700.00']);
    const capped = computeTaxReserve(s2({ regime: 'pausalni_vydaje', pausalRate: 60, entries: [e('taxable_income', '3000000.00')], payments: [] }), rules, d('2026-09-30'));
    if (capped?.kind !== 'estimate') throw new Error('estimate expected');
    expect(f(capped.expense)).toBe('1200000.00');
  });
  it('pausalni_dan: paid vs due YTD (9 × 9 162 = 82 458); ucetnictvi → null', () => {
    const r = computeTaxReserve(s2({ regime: 'pausalni_dan', pausalDanBand: 1, payments: months('tax_pausal_advance', '9162.00', 8) }), rules, d('2026-09-30'));
    expect(r).toEqual({ kind: 'pausalni_dan', asOf: '2026-09-30', paid: czk('73296.00'), dueYtd: czk('82458.00') });
    expect(computeTaxReserve(s2({ regime: 'ucetnictvi' }), rules, d('2026-09-30'))).toBeNull();
  });
});
```
4. `income-tax-obligations.test.ts` verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { INCOME_TAX_OBLIGATION_SOURCE, type IncomeTaxObligationsInput, incomeTaxObligationsFor } from '../src/income-tax/obligations';
import type { ProfileSegment } from '../src/income-tax/readiness';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'), validTo: null, entityType: 'osvc', taxRegime: 'danova_evidence', vatStatus: 'neplatce', pausalRate: null, pausalDanBand: null, hasAccountant: false, ...o,
});
const input = (o: Partial<IncomeTaxObligationsInput> = {}): IncomeTaxObligationsInput => ({ year: 2026, profiles: [seg()], advances: [], pausalniDanReturnRequired: false, eligibleForEntry: false, ...o });
const pd = seg({ taxRegime: 'pausalni_dan', pausalRate: 60, pausalDanBand: 1, vatStatus: 'identifikovana_osoba' });

describe('incomeTaxObligationsFor (M06 §4.12, §9 general 8)', () => {
  it('dap for 2026: legal 1. 5. 2027, due Monday 3. 5. 2027; advisor note with an accountant', () => {
    const [dap] = incomeTaxObligationsFor(input(), d('2027-02-01'), rules);
    expect(dap).toEqual({ kind: 'dap', periodStart: '2026-01-01', periodEnd: '2026-12-31', legalDueDate: '2027-05-01', dueDate: '2027-05-03', amountEstimate: null, state: 'open', doneSource: null, isOptional: false, note: 'podklady.dap.note.standard', sourceRule: INCOME_TAX_OBLIGATION_SOURCE });
    expect(incomeTaxObligationsFor(input({ profiles: [seg({ hasAccountant: true })] }), d('2027-02-01'), rules)[0]?.note).toBe('podklady.dap.note.advisor');
    expect(incomeTaxObligationsFor(input(), d('2027-05-04'), rules)[0]?.state).toBe('overdue');
  });
  it('paušální daň: no dap unless a return is required; 12 advances; October due 20. 10. 2026 with 9 162', () => {
    const none = incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-10-10'), rules);
    expect(none.filter((o) => o.kind === 'dap')).toEqual([]);
    const adv = none.filter((o) => o.kind === 'pausalni_dan_advance');
    expect(adv).toHaveLength(12);
    expect(adv[9]).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-31', legalDueDate: '2026-10-20', dueDate: '2026-10-20', amountEstimate: czk('9162.00'), state: 'open', isOptional: false });
    expect(adv[0]?.state).toBe('overdue');
    const withReturn = incomeTaxObligationsFor(input({ profiles: [pd], pausalniDanReturnRequired: true }), d('2026-10-10'), rules);
    expect(withReturn[0]?.kind).toBe('dap');
  });
  it('an advance booked between the 1st and due + 10 days marks the month done; outside the window it does not', () => {
    const list = incomeTaxObligationsFor(input({ profiles: [pd], advances: [{ bookedOn: d('2026-10-15'), amount: czk('9162.00') }, { bookedOn: d('2026-09-05'), amount: czk('9000.00') }, { bookedOn: d('2026-08-28'), amount: czk('9162.00') }] }), d('2026-11-05'), rules);
    const byMonth = Object.fromEntries(list.filter((o) => o.kind === 'pausalni_dan_advance').map((o) => [o.periodStart, [o.state, o.doneSource]]));
    expect(byMonth['2026-10-01']).toEqual(['done', 'bank_payment']);
    expect(byMonth['2026-09-01']).toEqual(['overdue', null]);   // 9 000 < 9 162
    expect(byMonth['2026-08-01']).toEqual(['done', 'bank_payment']);
    expect(byMonth['2026-11-01']).toEqual(['open', null]);
  });
  it('a paušál segment from July only produces July–December advances', () => {
    const list = incomeTaxObligationsFor(input({ profiles: [seg({ validTo: d('2026-06-30') }), { ...pd, validFrom: d('2026-07-01') }] }), d('2026-12-01'), rules);
    expect(list.filter((o) => o.kind === 'pausalni_dan_advance').map((o) => o.periodStart.slice(5, 7))).toEqual(['07', '08', '09', '10', '11', '12']);
  });
  it('exit notice for paušál users and entry notice for eligible others: optional, due 11. 1. 2027, only from 1 December until the date', () => {
    const exit = incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-12-05'), rules).find((o) => o.kind === 'pausalni_dan_exit');
    expect(exit).toEqual({ kind: 'pausalni_dan_exit', periodStart: '2027-01-01', periodEnd: '2027-12-31', legalDueDate: '2027-01-10', dueDate: '2027-01-11', amountEstimate: null, state: 'open', doneSource: null, isOptional: true, note: null, sourceRule: INCOME_TAX_OBLIGATION_SOURCE });
    expect(incomeTaxObligationsFor(input({ profiles: [pd] }), d('2026-11-30'), rules).some((o) => o.kind === 'pausalni_dan_exit')).toBe(false);
    expect(incomeTaxObligationsFor(input({ profiles: [pd] }), d('2027-01-12'), rules).some((o) => o.kind === 'pausalni_dan_exit')).toBe(false);
    const entry = incomeTaxObligationsFor(input({ eligibleForEntry: true }), d('2027-01-11'), rules).find((o) => o.kind === 'pausalni_dan_entry');
    expect(entry).toMatchObject({ kind: 'pausalni_dan_entry', dueDate: '2027-01-11', isOptional: true, state: 'open' });
    expect(incomeTaxObligationsFor(input({ eligibleForEntry: false }), d('2026-12-05'), rules).some((o) => o.kind === 'pausalni_dan_entry')).toBe(false);
  });
});
```
Commands: `pnpm --filter @shoebox/domain test -- tax-reserve 2>&1 | tail -30` · `pnpm --filter @shoebox/domain test -- income-tax-obligations 2>&1 | tail -30`.
5. Index exports; typecheck.
6. Commit `feat(income-tax): tax reserve estimate and income-tax obligations (0358)`.

## 5. Do not touch

`overview/deadlines.ts` (M09's `dap` generator stays), `vat/obligations.ts`, `apps/`.

## 6. Commands

The two test commands above · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] S2 reserve 151 617 / 151 600; threshold case 288 135; `dap` due 3. 5. 2027; October advance 20. 10. 2026 (general 8).

## 8. Stop and ask

TEMPLATE §8. Stop if `income_tax.rates` is missing (0352 not merged).

## 9. Report

`docs/tasks/0358-report.md`. Include the T-18 check: `threshold_annual × 9/12 = 1 322 109`.

## Risk list

Money (the reserve is the number users see all year; obligations drive reminders).

## Owner steps

None (copy decisions are in 0359).
