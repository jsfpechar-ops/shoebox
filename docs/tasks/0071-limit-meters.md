# 0071: Přehled limit meters (pure)

Status: review
Ticket: P1-OVERVIEW (M09 §4.4) | Depends on: none | Base commit: 37d843b | Branch: task/0071-limit-meters | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a pure function in `packages/domain` that builds the limit meters for a taxpayer profile: the VAT registration limits and the paušál limits. The user sees how close they are to a limit that changes what they must pay or file.

## 2. Context

Hard rule 1: money is `Money`; limits come only from rules (`packages/domain/src/rules/cz/2026.ts`), never typed into the code. The warn and alert ratios are product config, not law (M09 §4.4), so they live as constants in the new file.

M09 §4.4 (Phase 1 subset):

- Levels: `exceeded` if `current > limit`; else `alert` if `current / limit ≥ 0.95`; else `warn` if `current / limit ≥ 0.80` (or the extra warn condition below); else `ok`. `percent` = floor of `current / limit × 100` as an integer (may exceed 100).
- **VAT registration** (profiles with `vatStatus` `neplatce` or `identifikovana_osoba`; payers see none): two meters over `turnoverYtd`: `vat_calendar_year` with limit `vat.registration_thresholds.calendar_year` (2 000 000) and `vat_immediate` with limit `.immediate` (2 536 500).
- **Paušální daň** (`taxRegime = 'pausalni_dan'`): meter `pausalni_dan_band` over `incomeYtd`. Band = `pausalDanBand ?? 1`. Ceiling = the largest `max_income` among the band's `ceilings` whose `requires_dominant_rate_in` is absent or contains `pausalRate` (when `pausalRate` is null only ceilings without `requires_dominant_rate_in` qualify). Extra warn: `ceiling − current ≤ 100 000 Kč` (`PAUSAL_BAND_WARN_CZK`, product config). When `pausalRate` is null the meter carries `hint: 'set_activity_type'`. Second meter `pausalni_dan_eligibility` over `incomeYtd` with limit `pausalni_dan.eligibility.max_income`.
- **Paušální výdaje** (`taxRegime = 'pausalni_vydaje'` and `pausalRate` not null): meter `pausalni_vydaje_cap` over `incomeYtd`, limit = `pausalni_vydaje.rates_caps[String(pausalRate)] / (pausalRate / 100)` (2026: 1 600 000 / 0.8 = 2 000 000). If the cap for the rate is missing, no meter.
- Order: VAT meters first, then the paušál ones. `danova_evidence` and `ucetnictvi` get only the VAT meters (when not a payer).

Rule values in 2026 (from `rules/cz/2026.ts`): `vat.registration_thresholds` = `{ calendar_year: 2_000_000, immediate: 2_536_500 }`; `pausalni_dan.bands` = band 1 ceilings `[{1_000_000}, {1_500_000, [80,60]}, {2_000_000, [80]}]`, band 2 `[{1_500_000}, {2_000_000, [80,60]}]`, band 3 `[{2_000_000}]`; `pausalni_dan.eligibility.max_income` = 2 000 000; `pausalni_vydaje.rates_caps` = `{ '80': 1_600_000, '60': 1_200_000, '40': 800_000, '30': 600_000 }`.

Reading rules: `createCzRules()` (from `../rules/index`) returns a resolver; `rules.at('2026-10-25').get('vat.registration_thresholds')` returns the typed value. The function takes the `RulesAt` object: type it as `ReturnType<ReturnType<typeof createCzRules>['at']>`.

Money API: `Money.parse('2000000', 'CZK')`, `.subtract`, `.compare(other)` (−1/0/1), `.toDecimal()` (decimal.js `Decimal` with `.div`, `.mul`, `.gte`, `.floor`, `.toNumber`), `.divide('0.8')`, `.toFixed2()`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/overview/meters.ts` | create | `computeLimitMeters`, `meterLevel`, constants |
| `packages/domain/test/overview-meters.test.ts` | create | the test file below, verbatim |

No other file may change.

## 4. Steps

1. Create `packages/domain/test/overview-meters.test.ts` with exactly this content:

```ts
import { describe, expect, it } from 'vitest';
import { Money } from '../src/money/index';
import { computeLimitMeters, type MeterProfile, meterLevel } from '../src/overview/meters';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules().at('2026-10-25');
const czk = (s: string) => Money.parse(s, 'CZK');

function profile(over: Partial<MeterProfile> = {}): MeterProfile {
  return {
    vatStatus: 'neplatce',
    taxRegime: 'danova_evidence',
    pausalRate: null,
    pausalDanBand: null,
    ...over,
  };
}

describe('meterLevel', () => {
  it('ok below 80 %, warn from 80 %, alert from 95 %, exceeded above the limit', () => {
    const limit = czk('1000');
    expect(meterLevel(czk('799.99'), limit)).toBe('ok');
    expect(meterLevel(czk('800'), limit)).toBe('warn');
    expect(meterLevel(czk('950'), limit)).toBe('alert');
    expect(meterLevel(czk('1000'), limit)).toBe('alert');
    expect(meterLevel(czk('1000.01'), limit)).toBe('exceeded');
    expect(meterLevel(czk('10'), limit, true)).toBe('warn');
  });
});

describe('computeLimitMeters', () => {
  it('a non-payer on tax records sees the two VAT registration meters over turnover', () => {
    const meters = computeLimitMeters(
      profile(),
      { incomeYtd: czk('999999'), turnoverYtd: czk('1640000') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['vat_calendar_year', 'vat_immediate']);
    const [year, immediate] = meters;
    expect(year?.current.toFixed2()).toBe('1640000.00');
    expect(year?.limit.toFixed2()).toBe('2000000.00');
    expect(year?.percent).toBe(82);
    expect(year?.level).toBe('warn');
    expect(immediate?.limit.toFixed2()).toBe('2536500.00');
    expect(immediate?.percent).toBe(64);
    expect(immediate?.level).toBe('ok');
  });

  it('a VAT payer sees no VAT meter', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce' }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters).toEqual([]);
  });

  it('an identified person sees the VAT meters too', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'identifikovana_osoba' }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['vat_calendar_year', 'vat_immediate']);
  });

  it('paušální daň band 1: the ceiling depends on the declared activity rate', () => {
    const totals = { incomeYtd: czk('950000'), turnoverYtd: czk('950000') };
    const at80 = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 1, pausalRate: 80 }),
      totals,
      rules,
    );
    expect(at80.map((m) => m.id)).toEqual([
      'vat_calendar_year',
      'vat_immediate',
      'pausalni_dan_band',
      'pausalni_dan_eligibility',
    ]);
    const band80 = at80.find((m) => m.id === 'pausalni_dan_band');
    expect(band80?.limit.toFixed2()).toBe('2000000.00');
    expect(band80?.level).toBe('ok');
    expect(band80?.hint).toBeNull();

    const at40 = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 1, pausalRate: 40 }),
      totals,
      rules,
    );
    const band40 = at40.find((m) => m.id === 'pausalni_dan_band');
    expect(band40?.limit.toFixed2()).toBe('1000000.00');
    expect(band40?.percent).toBe(95);
    expect(band40?.level).toBe('alert');
  });

  it('paušální daň: warn within 100 000 Kč of the ceiling; hint when the rate is unknown', () => {
    const meters = computeLimitMeters(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 2, pausalRate: null }),
      { incomeYtd: czk('1400000'), turnoverYtd: czk('0') },
      rules,
    );
    const band = meters.find((m) => m.id === 'pausalni_dan_band');
    expect(band?.limit.toFixed2()).toBe('1500000.00');
    expect(band?.percent).toBe(93);
    expect(band?.level).toBe('warn');
    expect(band?.hint).toBe('set_activity_type');
    const eligibility = meters.find((m) => m.id === 'pausalni_dan_eligibility');
    expect(eligibility?.limit.toFixed2()).toBe('2000000.00');
    expect(eligibility?.level).toBe('ok');
  });

  it('paušální výdaje: income at which the flat-rate expenses stop growing', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce', taxRegime: 'pausalni_vydaje', pausalRate: 60 }),
      { incomeYtd: czk('2100000'), turnoverYtd: czk('2100000') },
      rules,
    );
    expect(meters.map((m) => m.id)).toEqual(['pausalni_vydaje_cap']);
    expect(meters[0]?.limit.toFixed2()).toBe('2000000.00');
    expect(meters[0]?.level).toBe('exceeded');
    expect(meters[0]?.percent).toBe(105);
  });

  it('paušální výdaje without a rate shows no cap meter', () => {
    const meters = computeLimitMeters(
      profile({ vatStatus: 'platce', taxRegime: 'pausalni_vydaje', pausalRate: null }),
      { incomeYtd: czk('0'), turnoverYtd: czk('0') },
      rules,
    );
    expect(meters).toEqual([]);
  });
});
```

2. Create `packages/domain/src/overview/meters.ts` exporting exactly:

```ts
export type MeterLevel = 'ok' | 'warn' | 'alert' | 'exceeded';
export type MeterId =
  | 'vat_calendar_year' | 'vat_immediate'
  | 'pausalni_dan_band' | 'pausalni_dan_eligibility' | 'pausalni_vydaje_cap';
/** Product config (M09 §4.4), not law. */
export const METER_RATIOS = { warn: '0.80', alert: '0.95' } as const;
/** Product config (M09 §4.4.2, Competitor C's warning). */
export const PAUSAL_BAND_WARN_CZK = '100000';
export interface MeterProfile {
  readonly vatStatus: VatStatus;
  readonly taxRegime: TaxRegime;
  readonly pausalRate: 80 | 60 | 40 | 30 | null;
  readonly pausalDanBand: 1 | 2 | 3 | null;
}
export interface LimitMeter {
  readonly id: MeterId;
  readonly current: Money;
  readonly limit: Money;
  readonly percent: number;      // floor(current / limit × 100), an integer for display only
  readonly level: MeterLevel;
  readonly hint: 'set_activity_type' | null;
}
export function meterLevel(current: Money, limit: Money, extraWarn?: boolean): MeterLevel;
export function computeLimitMeters(
  profile: MeterProfile,
  totals: { readonly incomeYtd: Money; readonly turnoverYtd: Money },
  rules: RulesAt,   // ReturnType<ReturnType<typeof createCzRules>['at']>
): LimitMeter[];
```

Implement §2 until the tests pass. Do not edit the test file. `VatStatus` and `TaxRegime` come from `../enums/index`.
Command: `pnpm --filter @shoebox/domain test -- overview-meters 2>&1 | tail -30` → all pass.

3. Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors; `pnpm exec biome check packages/domain 2>&1 | tail -30` → clean (`--write` on the two new files once if only formatting).

## 5. Do not touch

`packages/domain/src/index.ts`, `packages/domain/src/rules/`, every other package. Hard rule 1: no limit number typed into `meters.ts` except the two product constants above.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- overview-meters 2>&1 | tail -30` → passes.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` → 0 errors.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK (after the report).

## 7. Acceptance

- [ ] The test file is byte-identical to §4 step 1 and passes.
- [ ] Limits are read from `rules`; only `METER_RATIOS` and `PAUSAL_BAND_WARN_CZK` are constants.
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

Write `docs/tasks/0071-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you were unsure about.
