# 0316: P1-CAT-03b `buildSummary` — the deterministic one-line document summary (`packages/domain`)

Status: done
Ticket: P1-CAT-03 | Depends on: 0301 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 40k tokens

## 1. Objective

A pure function that renders `documents.summary_cs` (column name stays per 05; copy is English for now, `TODO(i18n-cs)`) from the dominant line's classification, the service period and the VAT treatment, so the inbox and detail show one plain sentence per document. The LLM only ever supplies the subject.

## 2. Context

M04 §4.4, adapted to English (owner 2026-10-25):

```
subject = userSubject > llmSubject > vendorHintSubject > category(dominant).labelEn
period  = servicePeriod within one month → " for {Month}"; spans months in one year → " for {M1}–{M2}";
          else if dominant ∈ recurringCategories → " for {Month(duzp ?? issueDate)}"; else ""
          append " {yyyy}" when the year ≠ asOf year. Months: January … December.
tax     = by dominant deductibility/taxEffect:
          deductible → "tax-deductible expense"; partially_deductible → "{share} % tax-deductible";
          non_deductible (expense) → "not tax-deductible"; private → "personal expense, not counted for the business";
          taxEffect asset → "long-term asset, depreciation is for the accountant"; pass_through → "pass-through item, neither income nor expense";
          taxable_income → "taxable income"; non_taxable_income → "non-taxable income";
          transfer → "transfer between own accounts"; tax_or_insurance_payment → "tax or insurance payment"
vat     = by dominant treatment × vatStatus at the VAT point date:
          rcv_domestic_no_vat → "no VAT"; rcv_domestic_vat & (neplatce|identifikovana_osoba) → "VAT {rate} % is part of the cost";
          rcv_domestic_vat & platce & deduction → "you deduct VAT {rate} %"; rcv_domestic_vat & platce & no deduction → "VAT not deductible";
          rcv_eu_service_reverse_charge|rcv_non_eu_service_reverse_charge|rcv_eu_goods_acquisition & identifikovana_osoba → "you pay VAT {rate} % yourself in the return for {PeriodLabel}";
          … & platce → "you declare and deduct VAT {rate} % in the return for {PeriodLabel}";
          … & neplatce → "note: this triggers a VAT registration duty";
          rcv_foreign_vat_charged → "foreign VAT is part of the cost"; rcv_out_of_scope, iss_*, null → omitted
summary = subject + period + " – " + tax + (vat ? ", " + vat : "")   // ≤ 120 chars; truncate subject with "…" first
multi-category documents append " (+ {n} more items)" when non-dominant item lines have another taxEffect.
```
`{share}` and `{rate}` print as whole numbers when whole (`'80.00'` → `80`, `'21'` → `21`; use `new Decimal(x).toFixed()` after `toDecimalPlaces(2)`), never `Number()`. PeriodLabel: month name (+ year when ≠ asOf year) for a monthly VAT period, `Q{n} {yyyy}` for a quarterly one. Golden (English renditions of M04 §9.1): cleaning Sept → `Apartment cleaning for September – tax-deductible expense, no VAT`; manager Aug → `Apartment management for August – tax-deductible expense, VAT 21 % is part of the cost`; Booking July (policy issue_date, period 2026-08) → `Booking.com commission for July – tax-deductible expense, you pay VAT 21 % yourself in the return for August`; Decathlon after answer → `Backpack – personal expense, not counted for the business`.

Existing API: `getCategory(code).labelEn/.taxEffect`, `Deductibility` (`'deductible'|'non_deductible'|'partially_deductible'|'not_applicable'`), `VatTreatment`, `VatStatus`, `LegalDate` (string brand; `parseLegalDate`), `VatPeriodRange {start,end,kind:'month'|'quarter'}` (brief 0305, `packages/domain/src/vat/point-date.ts`). Lint rules of the package: no `Number()`, no `new Date()`; slice the ISO string for month/year.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/taxonomy/summary.ts` | create | `buildSummary` and helpers |
| `packages/domain/test/summary.test.ts` | create | the test below, verbatim |
| `packages/domain/src/index.ts` | edit | one export line |

## 4. Steps

1. Create `packages/domain/src/taxonomy/summary.ts` exporting exactly:

```ts
import type { LegalDate } from '../dates/index';
import type { TaxEffect, VatStatus, VatTreatment } from '../enums/index';
import type { VatPeriodRange } from '../vat/point-date';
import type { Deductibility } from './categories';
export const SUMMARY_MAX_LENGTH = 120;
export const MONTH_NAMES_EN: readonly string[]; // January … December
export interface SummaryInput {
  readonly asOf: LegalDate;
  readonly subject: { readonly user: string | null; readonly llm: string | null; readonly vendorHint: string | null };
  readonly dominant: { readonly categoryCode: string; readonly taxEffect: TaxEffect; readonly deductibility: Deductibility; readonly businessSharePct: string; readonly vatTreatment: VatTreatment | null; readonly vatRatePct: string | null };
  readonly otherTaxEffects: readonly TaxEffect[];           // taxEffect of every other item line
  readonly servicePeriodFrom: LegalDate | null; readonly servicePeriodTo: LegalDate | null;
  readonly duzp: LegalDate | null; readonly issueDate: LegalDate | null;
  readonly recurringCategories: readonly string[];          // rules classification.recurring_categories
  readonly vatStatus: VatStatus; readonly deductionAllowed: boolean;
  readonly vatPeriod: VatPeriodRange | null;                 // the period of the VAT point date, when self-assessed
}
export function monthLabel(date: LegalDate, asOf: LegalDate): string;         // "September" or "September 2025"
export function periodLabel(period: VatPeriodRange, asOf: LegalDate): string; // "August" | "Q3 2026"
export function buildSummary(input: SummaryInput): string;                    // TODO(i18n-cs): English until cs.json wakes up
```

2. Create `packages/domain/test/summary.test.ts` verbatim; implement until it passes, do not edit it:

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { buildSummary, monthLabel, periodLabel, SUMMARY_MAX_LENGTH, type SummaryInput } from '../src/taxonomy/summary';

const d = parseLegalDate;
const ASOF = d('2026-10-26');

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    asOf: ASOF,
    subject: { user: null, llm: 'Apartment cleaning', vendorHint: null },
    dominant: { categoryCode: 'exp_cleaning', taxEffect: 'deductible_expense', deductibility: 'deductible', businessSharePct: '100', vatTreatment: 'rcv_domestic_no_vat', vatRatePct: null },
    otherTaxEffects: [],
    servicePeriodFrom: d('2026-09-01'), servicePeriodTo: d('2026-09-30'),
    duzp: null, issueDate: d('2026-10-02'),
    recurringCategories: ['exp_cleaning', 'exp_property_management', 'exp_platform_commission'],
    vatStatus: 'identifikovana_osoba', deductionAllowed: false, vatPeriod: null,
    ...over,
  };
}

describe('buildSummary', () => {
  it('cleaning September (golden b)', () => {
    expect(buildSummary(input())).toBe('Apartment cleaning for September – tax-deductible expense, no VAT');
  });
  it('manager August: domestic VAT as cost for an identified person (golden a), month from DUZP', () => {
    const s = buildSummary(input({ subject: { user: null, llm: 'Apartment management', vendorHint: null }, dominant: { categoryCode: 'exp_property_management', taxEffect: 'deductible_expense', deductibility: 'deductible', businessSharePct: '100', vatTreatment: 'rcv_domestic_vat', vatRatePct: '21' }, servicePeriodFrom: null, servicePeriodTo: null, duzp: d('2026-08-31') }));
    expect(s).toBe('Apartment management for August – tax-deductible expense, VAT 21 % is part of the cost');
  });
  it('Booking July: self-assessed VAT names the return period (golden c, policy issue_date)', () => {
    const s = buildSummary(input({ subject: { user: null, llm: 'Booking.com commission', vendorHint: null }, dominant: { categoryCode: 'exp_platform_commission', taxEffect: 'deductible_expense', deductibility: 'deductible', businessSharePct: '100', vatTreatment: 'rcv_eu_service_reverse_charge', vatRatePct: '21' }, servicePeriodFrom: d('2026-07-01'), servicePeriodTo: d('2026-07-31'), issueDate: d('2026-08-03'), vatPeriod: { start: d('2026-08-01'), end: d('2026-08-31'), kind: 'month' } }));
    expect(s).toBe('Booking.com commission for July – tax-deductible expense, you pay VAT 21 % yourself in the return for August');
  });
  it('Decathlon after the answer: private, no VAT sentence (golden h)', () => {
    const s = buildSummary(input({ subject: { user: null, llm: 'Backpack', vendorHint: null }, dominant: { categoryCode: 'private_expense', taxEffect: 'private', deductibility: 'not_applicable', businessSharePct: '0', vatTreatment: 'rcv_domestic_vat', vatRatePct: '21' }, servicePeriodFrom: null, servicePeriodTo: null, recurringCategories: [] }));
    expect(s).toBe('Backpack – personal expense, not counted for the business');
  });
  it('MacBook 80 %: partially deductible', () => {
    const s = buildSummary(input({ subject: { user: null, llm: 'MacBook Air laptop', vendorHint: null }, dominant: { categoryCode: 'exp_small_assets', taxEffect: 'deductible_expense', deductibility: 'partially_deductible', businessSharePct: '80', vatTreatment: 'rcv_domestic_vat', vatRatePct: '21' }, servicePeriodFrom: null, servicePeriodTo: null, recurringCategories: [] }));
    expect(s).toBe('MacBook Air laptop – 80 % tax-deductible, VAT 21 % is part of the cost');
  });
  it('payer with deduction, quarterly period label, year suffix when not the asOf year', () => {
    const s = buildSummary(input({ vatStatus: 'platce', deductionAllowed: true, dominant: { categoryCode: 'exp_software_saas', taxEffect: 'deductible_expense', deductibility: 'deductible', businessSharePct: '100', vatTreatment: 'rcv_eu_service_reverse_charge', vatRatePct: '21' }, subject: { user: 'AI tool subscription', llm: 'x', vendorHint: null }, servicePeriodFrom: d('2025-11-01'), servicePeriodTo: d('2025-12-31'), vatPeriod: { start: d('2025-10-01'), end: d('2025-12-31'), kind: 'quarter' } }));
    expect(s).toBe('AI tool subscription for November–December 2025 – tax-deductible expense, you declare and deduct VAT 21 % in the return for Q4 2025');
  });
  it('subject precedence: user > llm > vendor hint > category label', () => {
    expect(buildSummary(input({ subject: { user: null, llm: null, vendorHint: 'Weekly cleaning' } }))).toMatch(/^Weekly cleaning for September/);
    expect(buildSummary(input({ subject: { user: null, llm: null, vendorHint: null } }))).toMatch(/^Cleaning/);
  });
  it('appends the count of other tax effects and never exceeds 120 characters', () => {
    const s = buildSummary(input({ otherTaxEffects: ['private', 'deductible_expense', 'asset'] }));
    expect(s.endsWith(' (+ 2 more items)')).toBe(true);
    const long = buildSummary(input({ subject: { user: 'x'.repeat(200), llm: null, vendorHint: null } }));
    expect(long.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
    expect(long).toContain('…');
    expect(long).toContain('– tax-deductible expense, no VAT');
  });
  it('labels', () => {
    expect(monthLabel(d('2026-09-15'), ASOF)).toBe('September');
    expect(monthLabel(d('2025-09-15'), ASOF)).toBe('September 2025');
    expect(periodLabel({ start: d('2026-07-01'), end: d('2026-09-30'), kind: 'quarter' }, ASOF)).toBe('Q3 2026');
  });
});
```
   "other tax effects" counts other item lines whose `taxEffect` differs from the dominant one (here `private`, `asset` → 2).
   Command: `pnpm --filter @shoebox/domain test -- summary 2>&1 | tail -30` → all pass.

3. Edit `packages/domain/src/index.ts`: after `export * from './taxonomy/categories';` add `export * from './taxonomy/summary';`. Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.

## 5. Do not touch

Any other file in `packages/domain`; no Czech strings (owner 2026-10-25); hard rule 1 (`recurringCategories` comes from the caller's rules, never hard-coded here).

## 6. Commands

`pnpm --filter @shoebox/domain test -- summary 2>&1 | tail -30`; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`; `pnpm eval --quick 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass, typecheck clean. - [ ] No `Number(`, `new Date(` in `summary.ts`.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0316-report.md`.

## Risk list

None money-bearing; copy only.

## Owner steps

None.
