# 0355: `computeFlatRateComparison` (caps from rules, floor rounding)

Status: todo
Ticket: P4-POD-02 (flat rate) | Depends on: 0354 (`FlatRate` type) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 14 tool calls, 40k tokens

## 1. Objective

Pure flat-rate expenses and the flat-rate vs actual comparison (M06 §4.3): bases only, never tax; caps come from `pausalni_vydaje.rates_caps` on 1 January of the tax year; an override row changes the result without a deploy.

## 2. Context

M06 §4.3 (pasted). Applies to `danova_evidence` (comparison only) and `pausalni_vydaje` (the regime's figure). Inputs: `income` (Σ from 0353), `rate` (profile `pausal_rate`; DE users pick in the wizard, default 60), `actual` (Σ deductible business).
```
incomeKc   = round0(income)
capKc      = rules.pausalni_vydaje.rates_caps[rate]          // 2026: 80→1 600 000, 60→1 200 000, 40→800 000, 30→600 000
flatRaw    = floor0(incomeKc × rate / 100)                   // never round up an expense (22 TA-13 default: expenses floor0, income round0)
flat       = min(flatRaw, capKc);  capReached = flatRaw > capKc
baseFlat   = incomeKc − flat
baseActual = incomeKc − round0(actual)
better     = baseFlat < baseActual ? 'flat' : baseFlat > baseActual ? 'actual' : 'equal'
difference = |baseFlat − baseActual|
```
Caveats are fixed i18n keys attached to every result (text lives in 0359's en.json): `podklady.flat.caveat.depreciation` (actual excludes depreciation and car allowances), `podklady.flat.caveat.insurance` (own social/health insurance is never an expense), `podklady.flat.caveat.credits_35ca` (§35ca: flat-rate bases above 50 % of the total base lose the spouse credit and child benefit, 22 TA-14 **[verify]** in the report: ZDP § 35ca text as of the tax year), `podklady.flat.caveat.switching` (switching method has consequences the accountant assesses).

Rules: `CzRules` = `ReturnType<typeof createCzRules>` (exported from `../vat/period`); `rules.at(date).get('pausalni_vydaje.rates_caps')` returns `{ '80'?: number, '60'?: number, '40'?: number, '30'?: number }`. Money helpers: `round0`, `floor0` in `../money/index`; `Money.fromDecimal(dec, 'CZK')`, `m.toDecimal()`. Override rows: `createCzRules(extra)` with `extra: RuleEntryInput[]` (`{ key, layer: 'override', valid_from, valid_to, source, verified_at, value }`).

Golden numbers (M06 §9): S2 income 1 400 000 / actual 520 000 / 80 → flat 1 120 000, baseFlat 280 000, baseActual 880 000, `flat`, 600 000. S2b income 2 300 000 / 80 → flatRaw 1 840 000, flat 1 600 000, capReached. S3 income 3 500 000 / actual 2 900 000 / 60 → flatRaw 2 100 000, flat 1 200 000, baseFlat 2 300 000, baseActual 600 000, `actual`, 1 700 000. S4 income 240 000 / actual 98 459,81 / 60 → flat 144 000, baseFlat 96 000, baseActual 141 540 (M06 §9 writes 141 540,19: the formula rounds the actual to whole Kč first, so the whole-Kč value wins; the XLSX shows the haléře via 0353), `flat`, 45 540.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/income-tax/flat-rate.ts` | create | `FlatRateComparison`, `FLAT_RATE_CAVEAT_KEYS`, `computeFlatRateComparison` |
| `packages/domain/test/flat-rate.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './income-tax/flat-rate';` after the `./income-tax/answers` line |

## 4. Steps

1. `flat-rate.ts` exports exactly:
```ts
import type { Money } from '../money/index';
import type { CzRules } from '../vat/period';
import type { FlatRate } from './answers';
export const FLAT_RATE_CAVEAT_KEYS = ['podklady.flat.caveat.depreciation', 'podklady.flat.caveat.insurance', 'podklady.flat.caveat.credits_35ca', 'podklady.flat.caveat.switching'] as const;
export interface FlatRateComparison {
  readonly rate: FlatRate; readonly incomeKc: Money; readonly capKc: Money; readonly flatRaw: Money; readonly flat: Money;
  readonly capReached: boolean; readonly baseFlat: Money; readonly baseActual: Money;
  readonly better: 'flat' | 'actual' | 'equal'; readonly difference: Money;
  readonly caveatKeys: readonly string[];
}
export function computeFlatRateComparison(income: Money, actual: Money, rate: FlatRate, rules: CzRules, year: number): FlatRateComparison;
```
Throws `Error('flat-rate: no cap for rate ' + rate)` when the key has no entry for the rate. All `Money` values are CZK with scale 2 (`'1120000.00'`).
2. Test file verbatim:
```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeFlatRateComparison, FLAT_RATE_CAVEAT_KEYS } from '../src/income-tax/flat-rate';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, CZK);
const cmp = (income: string, actual: string, rate: 80 | 60 | 40 | 30, r = rules) => computeFlatRateComparison(czk(income), czk(actual), rate, r, 2026);
const f = (m: Money) => m.toFixed2();

describe('computeFlatRateComparison golden (M06 §9)', () => {
  it('S2: 80 % on 1 400 000 → flat 1 120 000, bases 280 000 vs 880 000, flat better by 600 000', () => {
    const c = cmp('1400000.00', '520000.00', 80);
    expect([f(c.incomeKc), f(c.capKc), f(c.flatRaw), f(c.flat), c.capReached]).toEqual(['1400000.00', '1600000.00', '1120000.00', '1120000.00', false]);
    expect([f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual(['280000.00', '880000.00', 'flat', '600000.00']);
    expect(c.caveatKeys).toEqual([...FLAT_RATE_CAVEAT_KEYS]);
  });
  it('S2b: 2 300 000 at 80 % hits the 1 600 000 cap', () => {
    const c = cmp('2300000.00', '520000.00', 80);
    expect([f(c.flatRaw), f(c.flat), c.capReached, f(c.baseFlat)]).toEqual(['1840000.00', '1600000.00', true, '700000.00']);
  });
  it('S3: 3 500 000 at 60 % capped at 1 200 000; actual 2 900 000 is better by 1 700 000', () => {
    const c = cmp('3500000.00', '2900000.00', 60);
    expect([f(c.flatRaw), f(c.flat), c.capReached, f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual(['2100000.00', '1200000.00', true, '2300000.00', '600000.00', 'actual', '1700000.00']);
  });
  it('S4: 240 000 at 60 % → flat 144 000; actual 98 459,81 rounds to 98 460 → base 141 540; difference 45 540', () => {
    const c = cmp('240000.00', '98459.81', 60);
    expect([f(c.flat), f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual(['144000.00', '96000.00', '141540.00', 'flat', '45540.00']);
  });
  it('rounding: income half-up, flat-rate expense floored; equal bases → equal', () => {
    const c = cmp('1000.50', '600.00', 60);               // 1 001 × 0,6 = 600,6 → 600
    expect([f(c.incomeKc), f(c.flat), f(c.baseFlat), f(c.baseActual), c.better, f(c.difference)]).toEqual(['1001.00', '600.00', '401.00', '401.00', 'equal', '0.00']);
    expect(f(cmp('0.00', '0.00', 40).flat)).toBe('0.00');
  });
  it('general 7: an override row on pausalni_vydaje.rates_caps changes S2b without a deploy', () => {
    const overridden = createCzRules([{
      key: 'pausalni_vydaje.rates_caps', layer: 'override', valid_from: '2026-01-01', valid_to: null,
      source: 'test', verified_at: '2026-10-26', value: { '80': 1_900_000, '60': 1_200_000, '40': 800_000, '30': 600_000 },
    }]);
    const c = cmp('2300000.00', '520000.00', 80, overridden);
    expect([f(c.capKc), f(c.flat), c.capReached]).toEqual(['1900000.00', '1840000.00', false]);
  });
});

describe('properties (M06 §9 general 4)', () => {
  it('flat ≤ cap and flat ≤ income × rate / 100; baseFlat + flat = incomeKc', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 500_000_000 }), fc.integer({ min: 0, max: 500_000_000 }), fc.constantFrom(80, 60, 40, 30), (inc, act, rate) => {
      const c = computeFlatRateComparison(Money.fromDecimal(czk(String(inc)).toDecimal().div(100), CZK), Money.fromDecimal(czk(String(act)).toDecimal().div(100), CZK), rate as 80 | 60 | 40 | 30, rules, 2026);
      expect(c.flat.compare(c.capKc) <= 0).toBe(true);
      expect(c.flat.toDecimal().lte(c.incomeKc.toDecimal().times(rate).div(100))).toBe(true);
      expect(f(c.baseFlat.add(c.flat))).toBe(f(c.incomeKc));
      expect(c.difference.compare(Money.zero(CZK)) >= 0).toBe(true);
    }), { numRuns: 300 });
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- flat-rate 2>&1 | tail -30`. If `RuleEntryInput` needs a field the override literal lacks, add only that field with a neutral value and note it in the report.
3. Index export; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
4. Commit `feat(income-tax): flat-rate comparison (0355)`.

## 5. Do not touch

Rule seed files, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- flat-rate 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] S2 / S2b / S3 / S4 numbers above; override test; property 300 runs.
- [ ] Report: TA-13 (`floor0` for the expense) and TA-14 (§35ca) `[verify]` findings.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0355-report.md`.

## Risk list

Money (bases shown to the user and used for the partial XML ř. 102 in 0366).

## Owner steps

1. Ask the accountant whether flat-rate expenses are floored or rounded half-up (TA-13); the default is floor.
