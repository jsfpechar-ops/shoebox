# 0306: `resolveFxRate` and `convertToCzk` (pure, over a supplied ČNB rate list)

Status: done
Ticket: P1-CAT-02 (c) | Depends on: 0302 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Pick the ČNB rate valid on a date (the rate published that day, else the last one published before it, never later, never older than `fx.max_lookback_days`) and convert foreign amounts to CZK with the ČNB `amount` divisor (HUF, JPY are quoted per 100). The VAT ledger converts every foreign self-assessed base with this; the supplier's printed rate is never used.

## 2. Context

Hard rule 1: `vat.cnb_rate_rule` (`'rate_valid_on_date_else_last_published'`) and `fx.max_lookback_days` (7) are rule values; the function takes them as parameters so callers read them from `rules.at(date)`.

M04 §4.9 / M05 §4.2 step 6 (pasted): `resolveFxRate(currency, date)`: the `fx_rates` row with max `rate_date ≤ date` (within `fx.max_lookback_days`), rate per unit = `rate / amount`. `base_czk = round2(Σ net_foreign × rate / amount)`. No rate within 7 days before → null (M03 `S_FX_MISSING` / `FX_RATE_UNAVAILABLE`). Saturday uses Friday's rate.

`fx_rates` columns (05 §3, migration 0004): `rate_date date, currency char(3), amount integer, rate numeric(12,6)` → in TS `rate` is a decimal string, `amount` an integer count.

Existing API: `Money` (`multiply(Decimal)`, `toDecimal()`, `Money.fromDecimal(d, 'CZK')`), `round2`, `CZK`, `CurrencyMismatchError` (`packages/domain/src/money`), `addDays`, `compareLegalDates`, `LegalDate`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/fx.test.ts` | create | verbatim below |
| `packages/domain/src/fx.ts` | create | the functions |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/fx.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { convertToCzk, type FxRateRow, resolveFxRate } from '../src/fx';
import { CurrencyMismatchError, Money, round2 } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const d = parseLegalDate;
const rules = createCzRules();
const RULE = rules.at('2026-10-01').get('vat.cnb_rate_rule');
const LOOKBACK = rules.at('2026-10-01').get('fx.max_lookback_days');

// Fixture rates (synthetic, not ČNB values). 2026-10-03/04 is a weekend.
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-01'), currency: 'USD', amount: 1, rate: '23.400000' },
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'USD', amount: 1, rate: '23.500000' },
  { rateDate: d('2026-10-02'), currency: 'HUF', amount: 100, rate: '6.123000' },
  { rateDate: d('2026-10-05'), currency: 'EUR', amount: 1, rate: '24.580000' },
  { rateDate: d('2026-09-20'), currency: 'GBP', amount: 1, rate: '28.000000' },
];
const fx = (currency: string, date: string) => resolveFxRate(currency, d(date), RATES, RULE, LOOKBACK);

describe('resolveFxRate (M04 §4.9, M05 §4.2 step 6)', () => {
  it('the rate published on the date, else the last one before it (Saturday → Friday)', () => {
    expect(fx('USD', '2026-10-02')).toMatchObject({ currency: 'USD', rateDate: '2026-10-02', rate: '23.456000', amount: 1 });
    expect(fx('USD', '2026-10-03')?.rateDate).toBe('2026-10-02');
    expect(fx('USD', '2026-10-04')?.rateDate).toBe('2026-10-02');
    expect(fx('USD', '2026-10-05')?.rateDate).toBe('2026-10-05');
    expect(fx('USD', '2026-10-01')?.rate).toBe('23.400000');
  });

  it('never a later rate; null outside the look-back window; null for an unknown currency', () => {
    expect(fx('EUR', '2026-10-04')).toBeNull();
    expect(fx('GBP', '2026-09-27')?.rateDate).toBe('2026-09-20');
    expect(fx('GBP', '2026-09-28')).toBeNull();
    expect(fx('CHF', '2026-10-02')).toBeNull();
    expect(resolveFxRate('GBP', d('2026-09-28'), RATES, RULE, 8)?.rateDate).toBe('2026-09-20');
  });

  it('CZK is the identity rate on the date itself', () => {
    expect(fx('CZK', '2026-10-03')).toEqual({ currency: 'CZK', rateDate: '2026-10-03', rate: '1', amount: 1, perUnit: expect.anything() });
    expect(fx('CZK', '2026-10-03')?.perUnit.toString()).toBe('1');
  });

  it('perUnit = rate / amount (HUF per 100)', () => {
    const huf = fx('HUF', '2026-10-03');
    expect(huf?.amount).toBe(100);
    expect(huf?.perUnit.toString()).toBe('0.06123');
    expect(fx('USD', '2026-10-03')?.perUnit.toString()).toBe('23.456');
  });

  it('rejects a negative look-back', () => {
    expect(() => resolveFxRate('USD', d('2026-10-03'), RATES, RULE, -1)).toThrow(RangeError);
  });
});

describe('convertToCzk', () => {
  it('Cloudflare $10.46 at the Friday rate → 245.34976, round2 → 245.35 (AC-9e)', () => {
    const rate = fx('USD', '2026-10-03');
    if (rate === null) throw new Error('rate');
    const czk = convertToCzk(Money.parse('10.46', 'USD'), rate);
    expect(czk.currency).toBe('CZK');
    expect(czk.toString()).toBe('245.34976');
    expect(round2(czk).toFixed2()).toBe('245.35');
  });

  it('Anthropic €90 at 24.58 → 2212.20 (AC-9f); 1 000 HUF → 61.23', () => {
    const eur = fx('EUR', '2026-10-05');
    const huf = fx('HUF', '2026-10-02');
    if (eur === null || huf === null) throw new Error('rate');
    expect(round2(convertToCzk(Money.parse('90.00', 'EUR'), eur)).toFixed2()).toBe('2212.20');
    expect(round2(convertToCzk(Money.parse('1000.00', 'HUF'), huf)).toFixed2()).toBe('61.23');
  });

  it('currency mismatch throws; CZK passes through unchanged', () => {
    const usd = fx('USD', '2026-10-02');
    const czk = fx('CZK', '2026-10-02');
    if (usd === null || czk === null) throw new Error('rate');
    expect(() => convertToCzk(Money.parse('1.00', 'EUR'), usd)).toThrow(CurrencyMismatchError);
    expect(convertToCzk(Money.parse('12.34', 'CZK'), czk).toString()).toBe('12.34');
    expect(convertToCzk(Money.parse('-10.46', 'USD'), usd).toString()).toBe('-245.34976');
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- fx 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/fx.ts`. Exported names and signatures exactly:

```ts
import { Decimal } from 'decimal.js';
import { addDays, type LegalDate } from '../dates/index';   // adjust the relative path: this file is in src/, so './dates/index'
import { type Currency, CurrencyMismatchError, CZK, Money } from './money/index';

export type CnbRateRule = 'rate_valid_on_date_else_last_published';
/** One `fx_rates` row (05 §3): ČNB fixing for `amount` units of `currency` on `rateDate`. */
export interface FxRateRow { readonly rateDate: LegalDate; readonly currency: Currency; readonly amount: number; readonly rate: string; }
/** The rate chosen for a date, with `perUnit = rate / amount` as an exact Decimal. */
export interface FxRate { readonly currency: Currency; readonly rateDate: LegalDate; readonly rate: string; readonly amount: number; readonly perUnit: Decimal; }
export function resolveFxRate(currency: Currency, date: LegalDate, rates: readonly FxRateRow[], rule: CnbRateRule, maxLookbackDays: number): FxRate | null;
/** `amount × perUnit` as CZK, unrounded (callers apply `round2`). Throws `CurrencyMismatchError` when `amount.currency !== fx.currency`. */
export function convertToCzk(amount: Money, fx: FxRate): Money;
```

Rules: `maxLookbackDays` must be an integer ≥ 0, else `RangeError`. CZK → `{ currency: 'CZK', rateDate: date, rate: '1', amount: 1, perUnit: new Decimal(1) }`. Otherwise filter rows by currency, `rateDate <= date` and `rateDate >= addDays(date, -maxLookbackDays)`, take the max `rateDate`; `perUnit = new Decimal(row.rate).div(row.amount)`. `convertToCzk`: `Money.fromDecimal(amount.toDecimal().times(fx.perUnit), CZK)`. The `rule` parameter is the only admitted value; keep it in the signature so the caller must pass `rules.at(date).get('vat.cnb_rate_rule')`.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/fx.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- fx 2>&1 | tail -30`. Expected: green.

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './enums/index';`. Append after it: `export * from './fx';`. Typecheck and biome (§6).

## 5. Do not touch

Rules, money module, test files, other packages. Hard rule 1.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- fx 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Test file green, unchanged. `7` does not appear as a literal in `fx.ts`.
- [ ] Commits `0306 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0306-report.md`, `Status: review`, commit `0306 report`. Record `[verify]` ZDPH § 4 odst. 8 (rate rule) as noted in `rules/cz/2026.ts`.

## Spec notes for the reviewer

- M04 §9.2 mentions "before 14:30 publication": ČNB publishes the day's fixing at 14:30; a document dated today before publication would use yesterday's rate. The pure function only sees dates, so a row for `date` is used when present (the import job decides when rows exist). Noted for lane A's FX import job.

## Risk list (for the reviewer)

`packages/domain/src/fx.ts`.

## Owner steps

None.
