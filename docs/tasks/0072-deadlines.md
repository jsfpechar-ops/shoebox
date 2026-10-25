# 0072: Upcoming deadlines from the taxpayer profile (pure)

Status: review
Ticket: P1-OVERVIEW (M09 §4.7, §4.8, Phase 1 subset) | Depends on: none | Base commit: 37d843b | Branch: task/0072-deadlines | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Seed the Czech public holidays and a first set of deadline generators into the rules, and add a pure function that lists the next deadlines (VAT return, control statement, paušální daň advance, insurance advances, income tax return) for a taxpayer profile. Přehled shows the next payment and the deadline list from it; a wrong date costs the user a fine, so every date comes from the rules and is shifted over weekends and holidays.

## 2. Context

Hard rule 1: deadlines live only in `packages/domain/src/rules`. Hard rule 9: the `[verify]` items were checked against `research/czech-tax-filings.md` §3.3 [O] lines (paušál advance by the 20th; social advance by the end of the month it is for; health advance by the 8th of the next month; VAT return 25 days after the period; DAP electronic deadline 1 May → 4. 5. 2026). The rule keys `calendar.cz_public_holidays` and `deadlines.generators` already have schemas in `rules/law.ts`; this brief seeds their values ("seeded by the module ticket that first reads them").

M09 §4.7 shift policies: `next_working_day` (move forward over weekends and holidays), `previous_working_day` (insurance: never show a date later than the legal one), `none`. Working day = not Saturday, not Sunday, not a holiday. Holidays of a year = `fixed` (every year) + `movable[year]` (Good Friday, Easter Monday). If `movable[year]` is missing, use only the fixed ones and mark the deadline `holidaysMissing: true` (never throw: the dashboard must render).

Phase 1 simplifications (no `obligations` table yet; recomputed on every page load): only the six kinds below; identified persons (`identifikovana_osoba`) get no VAT return yet (`TODO(decision-io-vat-return)`: needs the VAT ledger to know a period had output); no "done" detection, so only deadlines with `asOf ≤ due ≤ asOf + windowDays` are listed.

Kind priority for equal due dates (M09 §4.8): `vat_return`, `kh`, `pausalni_dan_advance`, `social_advance`, `health_advance`, `dap`.

Date helpers in `packages/domain/src/dates/index.ts`: `type LegalDate`, `parseLegalDate('2026-10-25')`, `addDays(date, n)`, `compareLegalDates(a, b)`. Lint bans `Number(x)`, `parseFloat`, `Date.now()` and `new Date()` (no args) in `packages/domain`; use `Number.parseInt(s, 10)` for date parts and `new Date(Date.UTC(y, m - 1, d)).getUTCDay()` for the weekday. Money: `Money.parse(String(9162), 'CZK')`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/rules/cz/deadlines.ts` | create | shared holiday and generator data (step 1) |
| `packages/domain/src/rules/cz/2025.ts` | edit | seed the two keys for 2025 |
| `packages/domain/src/rules/cz/2026.ts` | edit | seed the two keys from 2026 |
| `packages/domain/test/rules-values.test.ts` | edit | counts, seeded keys, verification date |
| `packages/domain/src/overview/deadlines.ts` | create | `czHolidays`, `isCzWorkingDay`, `shiftDate`, `upcomingDeadlines` |
| `packages/domain/test/overview-deadlines.test.ts` | create | the test file below, verbatim |

No other file may change.

## 4. Steps

1. Create `packages/domain/src/rules/cz/deadlines.ts` with exactly:

```ts
// Shared values for `calendar.cz_public_holidays` and `deadlines.generators` (M09 §4.7), seeded by
// 2025.ts and 2026.ts. Verified 2026-10-25 against research/czech-tax-filings.md §3.3 [O].

/** Zákon č. 245/2000 Sb., o státních svátcích a ostatních svátcích. */
export const HOLIDAYS_ACT = 'https://www.zakonyprolidi.cz/cs/2000-245';
/** Zákon č. 280/2009 Sb., daňový řád, § 136 (DAP) and § 33 (a deadline on a non-working day moves on). */
export const TAX_PROCEDURE_ACT = 'https://www.zakonyprolidi.cz/cs/2009-280#p136';
export const DEADLINES_VERIFIED_AT = '2026-10-25';

/** 1. 1., 1. 5., 8. 5., 5. 7., 6. 7., 28. 9., 28. 10., 17. 11., 24.–26. 12. */
export const CZ_FIXED_HOLIDAYS = [
  '01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26',
];

/** Good Friday and Easter Monday. */
export const CZ_MOVABLE_HOLIDAYS = {
  '2025': ['04-18', '04-21'],
  '2026': ['04-03', '04-06'],
  '2027': ['03-26', '03-29'],
  '2028': ['04-14', '04-17'],
  '2029': ['03-30', '04-02'],
  '2030': ['04-19', '04-22'],
};

const ZDPH = 'https://www.zakonyprolidi.cz/cs/2004-235';
const ZDP = 'https://www.zakonyprolidi.cz/cs/1992-586';

export const CZ_DEADLINE_GENERATORS = [
  // ZDPH § 101 odst. 1: the return within 25 days after the period; § 101e: the control statement too.
  { kind: 'vat_return', applies_if: { vat_status: ['platce'] }, period: 'vat_period',
    due: { type: 'day_of_month_after_period', day: 25 }, shift: 'next_working_day', amount: 'none',
    source: `${ZDPH}#p101` },
  { kind: 'kh', applies_if: { vat_status: ['platce'] }, period: 'vat_period',
    due: { type: 'day_of_month_after_period', day: 25 }, shift: 'next_working_day', amount: 'none',
    source: `${ZDPH}#p101e` },
  // ZDP § 38lk: the paušální daň advance by the 20th of the month it is for.
  { kind: 'pausalni_dan_advance', applies_if: { tax_regime: ['pausalni_dan'] }, period: 'month',
    due: { type: 'day_of_month_in_period', day: 20 }, shift: 'next_working_day',
    amount: 'pausalni_dan_band_monthly', source: `${ZDP}#p38lk` },
  // Zákon č. 589/1992 Sb. § 14a: social advance by the end of the month it is for. TODO(verify) shift.
  { kind: 'social_advance', applies_if: { tax_regime: ['danova_evidence', 'pausalni_vydaje'],
    requires: ['insurance_self_paid'] }, period: 'month',
    due: { type: 'day_of_month_in_period', day: 'last' }, shift: 'previous_working_day',
    amount: 'insurance_min_social', source: 'https://www.zakonyprolidi.cz/cs/1992-589#p14a' },
  // Zákon č. 592/1992 Sb. § 7: health advance by the 8th of the next month. TODO(verify) shift.
  { kind: 'health_advance', applies_if: { tax_regime: ['danova_evidence', 'pausalni_vydaje'],
    requires: ['insurance_self_paid'] }, period: 'month',
    due: { type: 'day_of_month_after_period', day: 8 }, shift: 'previous_working_day',
    amount: 'insurance_min_health', source: 'https://www.zakonyprolidi.cz/cs/1992-592#p7' },
  // Daňový řád § 136 odst. 2: DAP filed electronically by 1 May (paper 1 April is info only).
  { kind: 'dap', applies_if: { tax_regime: ['danova_evidence', 'pausalni_vydaje'] }, period: 'year',
    due: { type: 'fixed_date', month: 5, day: 1, year_offset: 1 }, shift: 'next_working_day',
    amount: 'none', source: TAX_PROCEDURE_ACT },
];
```

Command: `pnpm exec biome check --write packages/domain/src/rules/cz/deadlines.ts 2>&1 | tail -5` (formatting only).

2. Edit `packages/domain/src/rules/cz/2025.ts`. Add the import after `import type { RuleEntryInput } from '../segment';`:

```ts
import {
  CZ_DEADLINE_GENERATORS,
  CZ_FIXED_HOLIDAYS,
  DEADLINES_VERIFIED_AT,
  HOLIDAYS_ACT,
  TAX_PROCEDURE_ACT,
} from './deadlines';
```

Then replace the last lines

```ts
  base('cash.payment_limit', CASH_ACT, { amount: 270_000, currency: 'CZK' }),
];
```

with

```ts
  base('cash.payment_limit', CASH_ACT, { amount: 270_000, currency: 'CZK' }),
  // M09 §4.7 (brief 0072): holidays and deadline generators, verified on a later day.
  {
    ...base('calendar.cz_public_holidays', HOLIDAYS_ACT, {
      fixed: CZ_FIXED_HOLIDAYS,
      movable: { '2025': ['04-18', '04-21'] },
    }),
    verified_at: DEADLINES_VERIFIED_AT,
  },
  {
    ...base('deadlines.generators', TAX_PROCEDURE_ACT, CZ_DEADLINE_GENERATORS),
    verified_at: DEADLINES_VERIFIED_AT,
  },
];
```

3. Edit `packages/domain/src/rules/cz/2026.ts`. Same import (add `CZ_MOVABLE_HOLIDAYS` to the list), placed after `import type { RuleEntryInput } from '../segment';`. Then replace

```ts
export const RULES_CZ_2026: readonly RuleEntryInput[] = [
  // ZDPH § 47 odst. 1: 21 % standard, 12 % reduced (unchanged since 2024-01-01).
```

with

```ts
export const RULES_CZ_2026: readonly RuleEntryInput[] = [
  // M09 §4.7 (brief 0072): holidays and deadline generators, verified on a later day.
  {
    ...base('calendar.cz_public_holidays', HOLIDAYS_ACT, {
      fixed: CZ_FIXED_HOLIDAYS,
      movable: CZ_MOVABLE_HOLIDAYS,
    }),
    verified_at: DEADLINES_VERIFIED_AT,
  },
  {
    ...base('deadlines.generators', TAX_PROCEDURE_ACT, CZ_DEADLINE_GENERATORS),
    verified_at: DEADLINES_VERIFIED_AT,
  },
  // ZDPH § 47 odst. 1: 21 % standard, 12 % reduced (unchanged since 2024-01-01).
```

4. Edit `packages/domain/test/rules-values.test.ts`:
   - In `SEEDED_KEYS`, after `'asset.capitalization_threshold',` add `'calendar.cz_public_holidays',`; after `'cash.payment_limit',` add `'deadlines.generators',`.
   - `expect(entry.verified_at).toBe('2026-10-18');` → `expect(['2026-10-18', '2026-10-25']).toContain(entry.verified_at);`
   - `expect(RULES_CZ_2025).toHaveLength(16);` → `18`; `expect(RULES_CZ_2026).toHaveLength(17);` → `19`; `...valid_from === '2026-01-01')).toHaveLength(16);` → `18`.

   Command: `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` → all pass.

5. Create `packages/domain/test/overview-deadlines.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  czHolidays,
  type DeadlineProfile,
  isCzWorkingDay,
  shiftDate,
  upcomingDeadlines,
} from '../src/overview/deadlines';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;

function profile(over: Partial<DeadlineProfile> = {}): DeadlineProfile {
  return {
    vatStatus: 'neplatce',
    vatPeriod: null,
    taxRegime: 'danova_evidence',
    pausalDanBand: null,
    insuranceSelfPaid: false,
    ...over,
  };
}

const brief = (list: ReturnType<typeof upcomingDeadlines>) =>
  list.map((x) => `${x.kind} ${x.periodStart} ${x.due}`);

describe('holidays and working days', () => {
  it('reads fixed and movable holidays from the rules', () => {
    const y2026 = czHolidays(2026, rules);
    expect(y2026.movableMissing).toBe(false);
    expect(y2026.dates.has('2026-04-03')).toBe(true);
    expect(y2026.dates.has('2026-10-28')).toBe(true);
    const y2031 = czHolidays(2031, rules);
    expect(y2031.movableMissing).toBe(true);
    expect(y2031.dates.has('2031-12-24')).toBe(true);
  });

  it('weekends and holidays are not working days', () => {
    expect(isCzWorkingDay(d('2026-10-27'), rules)).toBe(true);
    expect(isCzWorkingDay(d('2026-10-28'), rules)).toBe(false);
    expect(isCzWorkingDay(d('2026-04-06'), rules)).toBe(false);
    expect(isCzWorkingDay(d('2026-10-31'), rules)).toBe(false);
  });

  it('shifts forward, backward or not at all', () => {
    expect(shiftDate(d('2026-05-01'), 'next_working_day', rules)).toBe('2026-05-04');
    expect(shiftDate(d('2026-12-26'), 'next_working_day', rules)).toBe('2026-12-28');
    expect(shiftDate(d('2026-11-17'), 'previous_working_day', rules)).toBe('2026-11-16');
    expect(shiftDate(d('2026-10-31'), 'none', rules)).toBe('2026-10-31');
  });
});

describe('upcomingDeadlines', () => {
  it('monthly VAT payer with own insurance: next 60 days, sorted, shifted', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'platce', vatPeriod: 'monthly', insuranceSelfPaid: true }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual([
      'vat_return 2026-09-01 2026-10-26',
      'kh 2026-09-01 2026-10-26',
      'social_advance 2026-10-01 2026-10-30',
      'health_advance 2026-10-01 2026-11-06',
      'vat_return 2026-10-01 2026-11-25',
      'kh 2026-10-01 2026-11-25',
      'social_advance 2026-11-01 2026-11-30',
      'health_advance 2026-11-01 2026-12-08',
    ]);
    const first = list[0];
    expect(first?.periodEnd).toBe('2026-09-30');
    expect(first?.legalDue).toBe('2026-10-25');
    expect(first?.amount).toBeNull();
    const social = list[2];
    expect(social?.legalDue).toBe('2026-10-31');
    expect(social?.amount?.toFixed2()).toBe('5005.00');
    expect(social?.amountIsMinimum).toBe(true);
    expect(list[3]?.amount?.toFixed2()).toBe('3306.00');
    expect(list.every((x) => !x.holidaysMissing)).toBe(true);
  });

  it('quarterly VAT payer without own insurance: the quarter return only', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'platce', vatPeriod: 'quarterly' }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual(['vat_return 2026-07-01 2026-10-26', 'kh 2026-07-01 2026-10-26']);
    expect(list[0]?.periodEnd).toBe('2026-09-30');
  });

  it('paušální daň: the monthly advance of the band', () => {
    const list = upcomingDeadlines(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 2, insuranceSelfPaid: true }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual([
      'pausalni_dan_advance 2026-11-01 2026-11-20',
      'pausalni_dan_advance 2026-12-01 2026-12-21',
    ]);
    expect(list[0]?.amount?.toFixed2()).toBe('16745.00');
    expect(list[0]?.amountIsMinimum).toBe(false);
  });

  it('income tax return: 1 May moves over the holiday and the weekend', () => {
    const list = upcomingDeadlines(profile(), d('2026-03-15'), rules);
    expect(brief(list)).toEqual(['dap 2025-01-01 2026-05-04']);
    expect(list[0]?.periodEnd).toBe('2025-12-31');
    expect(list[0]?.legalDue).toBe('2026-05-01');
  });

  it('an identified person gets no VAT return yet', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly' }),
      d('2026-10-25'),
      rules,
    );
    expect(list).toEqual([]);
  });
});
```

6. Create `packages/domain/src/overview/deadlines.ts` exporting exactly:

```ts
export type DeadlineKind =
  | 'vat_return' | 'kh' | 'pausalni_dan_advance' | 'social_advance' | 'health_advance' | 'dap';
export type ShiftPolicy = 'next_working_day' | 'previous_working_day' | 'none';
type CzRules = ReturnType<typeof createCzRules>;   // import type { createCzRules } from '../rules/index'
export interface DeadlineProfile {
  readonly vatStatus: VatStatus;
  readonly vatPeriod: VatPeriod | null;      // null = monthly
  readonly taxRegime: TaxRegime;
  readonly pausalDanBand: 1 | 2 | 3 | null;
  readonly insuranceSelfPaid: boolean;
}
export interface Deadline {
  readonly kind: DeadlineKind;
  readonly periodStart: LegalDate;
  readonly periodEnd: LegalDate;
  readonly legalDue: LegalDate;
  readonly due: LegalDate;
  readonly amount: Money | null;
  readonly amountIsMinimum: boolean;      // insurance: the legal minimum, the user may pay more
  readonly holidaysMissing: boolean;
}
export function czHolidays(year: number, rules: CzRules): { dates: ReadonlySet<string>; movableMissing: boolean };
export function isCzWorkingDay(date: LegalDate, rules: CzRules): boolean;
export function shiftDate(date: LegalDate, policy: ShiftPolicy, rules: CzRules): LegalDate;
export function upcomingDeadlines(
  profile: DeadlineProfile,
  asOf: LegalDate,
  rules: CzRules,
  windowDays?: number,                     // default 60
): Deadline[];
```

Algorithm:
- `czHolidays(year)`: `rules.at(`${year}-01-01`).get('calendar.cz_public_holidays')`; dates = fixed + movable[year], each as `${year}-MM-DD`.
- Parse `rules.at(asOf).get('deadlines.generators')` with a zod schema written in this file (`kind` enum of the six kinds; `applies_if: { vat_status?, tax_regime?, requires?: ['insurance_self_paid'] }`; `period: 'month' | 'vat_period' | 'year'`; `due` discriminated on `type`: `day_of_month_after_period {day}`, `day_of_month_in_period {day: number | 'last'}`, `fixed_date {month, day, year_offset}`; `shift`; `amount: 'none' | 'pausalni_dan_band_monthly' | 'insurance_min_social' | 'insurance_min_health'`; `source`). Unknown kinds are skipped, not an error (`safeParse` per item).
- A generator applies when every listed `applies_if` list contains the profile value, and `insurance_self_paid` requires `profile.insuranceSelfPaid`.
- Periods: `month` → the calendar months from 3 before `asOf`'s month to 3 after; `vat_period` → quarters (Q-1, Q, Q+1) when `vatPeriod === 'quarterly'`, else the months as for `month`; `year` → calendar years `asOf.year − 1` and `asOf.year`.
- Legal due: `day_of_month_after_period` → that day in the month after `periodEnd`; `day_of_month_in_period` → that day (or the last day) of the period's month; `fixed_date` → `{year of periodEnd + year_offset}-{month}-{day}`.
- `due = shiftDate(legalDue, shift)`; keep when `asOf ≤ due ≤ addDays(asOf, windowDays)`. `holidaysMissing` = `czHolidays(year of due).movableMissing`.
- Amount: `none` → null; `pausalni_dan_band_monthly` → the band's `monthly` from `pausalni_dan.bands` at `periodStart` (null when `pausalDanBand` is null); `insurance_min_social`/`_health` → `insurance.min_advances.social`/`.health` at `periodStart`, `amountIsMinimum: true`.
- Sort by `due`, then the kind priority of §2, then `periodStart`.

Implement until the tests pass. Do not edit the test file.
Command: `pnpm --filter @shoebox/domain test -- overview-deadlines rules 2>&1 | tail -30` → all pass.

7. Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors; `pnpm exec biome check packages/domain 2>&1 | tail -30` → clean.

## 5. Do not touch

`packages/domain/src/index.ts`, `rules/law.ts`, `rules/keys.ts`, any other rule value, every other package. Hard rules 1, 8, 9.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- overview-deadlines rules 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK (after the report).

## 7. Acceptance

- [ ] The new test file is byte-identical to §4 step 5 and passes; the rules tests pass with only the step 4 edits.
- [ ] No date or day-of-month number typed into `overview/deadlines.ts`; they come from the rules.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0072-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you were unsure about.
