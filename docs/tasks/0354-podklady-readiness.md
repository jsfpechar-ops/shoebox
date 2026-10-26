# 0354: `checkPodkladyReadiness` + `PodkladyAnswers` schema

Status: todo
Ticket: P4-POD-01 (readiness) | Depends on: — | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 14 tool calls, 40k tokens

## 1. Objective

Pure readiness checks run before every preview/generation (M06 §4.1) and the zod schema of the generation-wizard answers (M06 §4.8), which must reject a rodné číslo by construction.

## 2. Context

M06 §4.1 (pasted): results are shown, generation is still allowed except where **blocking**.

| Code | Condition | Severity, params |
|---|---|---|
| `P_YEAR_OPEN` | today < 1 Jan of year+1 | `info`, `{ date: today }` (output watermarked) |
| `P_REGIME_UNSUPPORTED` | any profile segment in the year with `taxRegime='ucetnictvi'` or `entityType≠'osvc'` | `blocking`, `{ regime, entityType }` of the first such segment |
| `P_REGIME_CHANGED` | `taxRegime` differs between segments in the year | `warning`, `{ regimes: 'a,b' }` (distinct, in validFrom order) |
| `P_LEDGER_STALE` | `ledger.staleEntries > 0` or `ledger.documentsFinalizedAfterBuild > 0` | `warning`, `{ staleEntries, documentsFinalizedAfterBuild }` (the service enqueues M04's rebuild) |
| `P_PENDING_DOCUMENTS` | `pendingDocuments > 0` | `warning`, `{ count }` |
| `P_UNPAID_ISSUED` | `unpaidIssued > 0` | `warning`, `{ count }` ("not counted as income", cash basis) |
| `P_UNEXPLAINED_TX` | `unexplainedTransactions.count > 0` | `warning`, `{ count, sum }` (`sum` = `toFixed2()`) |
| `P_BUSINESS_FLAG_UNKNOWN` | `businessFlagUnknown.count > 0` | `warning`, `{ count, sum }` |

Checks come back in this table order. A segment is "in the year" when `[validFrom, validTo ?? ∞]` overlaps `[year-01-01, year-12-31]`.

M06 §4.8 answers (max 6, each skippable): (1) other §6/§8/§9/§10 income? yes/no + approx. amount (paušální daň only); (2) employment beyond DPP/DPČ limits? (paušální daň only); (3) insolvency / v.o.s. or k.s. partner? (paušální daň only); (4) flat rate for the comparison (DE users); (5) activity class for paušální daň if `pausal_rate` is null; (6) include the partial XML (flag on and regime qualifies). Stored in `filings.inputs`, never a rodné číslo (05 §8 `filings_inputs_no_rc`). A `z.strictObject` rejects any extra key, so `rodneCislo` can never pass through this type.

Enum values (`packages/domain/src/enums/index.ts`): `TaxRegime` = `danova_evidence | pausalni_vydaje | pausalni_dan | ucetnictvi`; `VatStatus` = `neplatce | identifikovana_osoba | platce`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/income-tax/answers.ts` | create | `podkladyAnswersSchema`, `PodkladyAnswers`, `EMPTY_ANSWERS`, `FLAT_RATES`, `FlatRate` |
| `packages/domain/src/income-tax/readiness.ts` | create | `ProfileSegment`, `ReadinessInput`, `ReadinessCheck`, `segmentsInYear`, `checkPodkladyReadiness`, `isBlocked` |
| `packages/domain/test/readiness.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './income-tax/answers';` and `export * from './income-tax/readiness';` after the `./income-tax/totals` line if present, else after `./ledgers/tax` |

## 4. Steps

1. `answers.ts` exports exactly:
```ts
import { z } from 'zod';
export const FLAT_RATES = [80, 60, 40, 30] as const;
export type FlatRate = (typeof FLAT_RATES)[number];
export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
const flatRate = z.union([z.literal(80), z.literal(60), z.literal(40), z.literal(30)]);
export const podkladyAnswersSchema = z.strictObject({
  otherIncome: z.enum(YES_NO_UNKNOWN).default('unknown'),
  otherIncomeApprox: z.number().int().min(0).nullable().default(null),   // whole CZK, paušální daň only
  employmentBeyondLimits: z.enum(YES_NO_UNKNOWN).default('unknown'),
  insolvencyOrPartner: z.enum(YES_NO_UNKNOWN).default('unknown'),
  comparisonRate: flatRate.nullable().default(null),                       // DE users, §4.3
  activityClass: flatRate.nullable().default(null),                        // paušální daň when pausal_rate is null
  includePartialXml: z.boolean().default(false),
});
export type PodkladyAnswers = z.output<typeof podkladyAnswersSchema>;
export const EMPTY_ANSWERS: PodkladyAnswers = podkladyAnswersSchema.parse({});
```
2. `readiness.ts` exports exactly:
```ts
import type { LegalDate } from '../dates/index';
import type { TaxRegime, VatStatus } from '../enums/index';
import type { Money } from '../money/index';
import type { FlatRate } from './answers';
export interface ProfileSegment {
  readonly validFrom: LegalDate; readonly validTo: LegalDate | null;
  readonly entityType: string; readonly taxRegime: TaxRegime; readonly vatStatus: VatStatus;
  readonly pausalRate: FlatRate | null; readonly pausalDanBand: 1 | 2 | 3 | null; readonly hasAccountant: boolean;
}
export interface ReadinessInput {
  readonly year: number; readonly profiles: readonly ProfileSegment[];
  readonly ledger: { readonly staleEntries: number; readonly documentsFinalizedAfterBuild: number };
  readonly pendingDocuments: number; readonly unpaidIssued: number;
  readonly unexplainedTransactions: { readonly count: number; readonly sum: Money };
  readonly businessFlagUnknown: { readonly count: number; readonly sum: Money };
}
export type ReadinessCode = 'P_YEAR_OPEN' | 'P_REGIME_UNSUPPORTED' | 'P_REGIME_CHANGED' | 'P_LEDGER_STALE' | 'P_PENDING_DOCUMENTS' | 'P_UNPAID_ISSUED' | 'P_UNEXPLAINED_TX' | 'P_BUSINESS_FLAG_UNKNOWN';
export type ReadinessSeverity = 'blocking' | 'warning' | 'info';
export interface ReadinessCheck { readonly code: ReadinessCode; readonly severity: ReadinessSeverity; readonly params: Readonly<Record<string, string | number>> }
export function segmentsInYear(profiles: readonly ProfileSegment[], year: number): ProfileSegment[];   // sorted by validFrom
export function checkPodkladyReadiness(input: ReadinessInput, today: LegalDate): ReadinessCheck[];
export function isBlocked(checks: readonly ReadinessCheck[]): boolean;
```
3. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { EMPTY_ANSWERS, podkladyAnswersSchema } from '../src/income-tax/answers';
import { checkPodkladyReadiness, isBlocked, type ProfileSegment, type ReadinessInput, segmentsInYear } from '../src/income-tax/readiness';
import { CZK, Money } from '../src/money/index';

const d = parseLegalDate;
const seg = (o: Partial<ProfileSegment> = {}): ProfileSegment => ({
  validFrom: d('2025-01-01'), validTo: null, entityType: 'osvc', taxRegime: 'danova_evidence', vatStatus: 'neplatce',
  pausalRate: null, pausalDanBand: null, hasAccountant: false, ...o,
});
const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  year: 2026, profiles: [seg()], ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 }, pendingDocuments: 0, unpaidIssued: 0,
  unexplainedTransactions: { count: 0, sum: Money.zero(CZK) }, businessFlagUnknown: { count: 0, sum: Money.zero(CZK) }, ...o,
});
const codes = (input: ReadinessInput, today = d('2027-02-15')) => checkPodkladyReadiness(input, today).map((c) => c.code);

describe('checkPodkladyReadiness (M06 §4.1)', () => {
  it('clean closed year → no checks; open year → P_YEAR_OPEN info with the date', () => {
    expect(codes(base())).toEqual([]);
    const open = checkPodkladyReadiness(base(), d('2026-10-26'));
    expect(open).toEqual([{ code: 'P_YEAR_OPEN', severity: 'info', params: { date: '2026-10-26' } }]);
    expect(isBlocked(open)).toBe(false);
  });
  it('ucetnictvi or a non-OSVČ entity in the year blocks', () => {
    const r = checkPodkladyReadiness(base({ profiles: [seg({ taxRegime: 'ucetnictvi' })] }), d('2027-02-15'));
    expect(r).toEqual([{ code: 'P_REGIME_UNSUPPORTED', severity: 'blocking', params: { regime: 'ucetnictvi', entityType: 'osvc' } }]);
    expect(isBlocked(r)).toBe(true);
    expect(codes(base({ profiles: [seg({ entityType: 'sro' })] }))).toEqual(['P_REGIME_UNSUPPORTED']);
  });
  it('a segment that ended before the year or starts after it is ignored', () => {
    const profiles = [seg({ validFrom: d('2024-01-01'), validTo: d('2025-12-31'), taxRegime: 'ucetnictvi' }), seg({ validFrom: d('2026-01-01') }), seg({ validFrom: d('2027-01-01'), taxRegime: 'ucetnictvi' })];
    expect(segmentsInYear(profiles, 2026).map((s) => s.validFrom)).toEqual(['2026-01-01']);
    expect(codes(base({ profiles }))).toEqual([]);
  });
  it('regime change inside the year → warning with both regimes in order', () => {
    const profiles = [seg({ validTo: d('2026-06-30') }), seg({ validFrom: d('2026-07-01'), taxRegime: 'pausalni_vydaje', pausalRate: 60 })];
    const r = checkPodkladyReadiness(base({ profiles }), d('2027-02-15'));
    expect(r).toEqual([{ code: 'P_REGIME_CHANGED', severity: 'warning', params: { regimes: 'danova_evidence,pausalni_vydaje' } }]);
  });
  it('every other code with its params, in table order', () => {
    const r = checkPodkladyReadiness(base({
      ledger: { staleEntries: 3, documentsFinalizedAfterBuild: 1 }, pendingDocuments: 3, unpaidIssued: 2,
      unexplainedTransactions: { count: 2, sum: Money.parse('4500.50', CZK) }, businessFlagUnknown: { count: 1, sum: Money.parse('249.00', CZK) },
    }), d('2026-10-26'));
    expect(r.map((c) => c.code)).toEqual(['P_YEAR_OPEN', 'P_LEDGER_STALE', 'P_PENDING_DOCUMENTS', 'P_UNPAID_ISSUED', 'P_UNEXPLAINED_TX', 'P_BUSINESS_FLAG_UNKNOWN']);
    expect(r[1]?.params).toEqual({ staleEntries: 3, documentsFinalizedAfterBuild: 1 });
    expect(r[4]).toEqual({ code: 'P_UNEXPLAINED_TX', severity: 'warning', params: { count: 2, sum: '4500.50' } });
    expect(r[5]?.params).toEqual({ count: 1, sum: '249.00' });
    expect(r.every((c) => c.severity !== 'blocking')).toBe(true);
  });
});

describe('podkladyAnswersSchema (M06 §4.8, 05 §8 no RČ)', () => {
  it('empty object → defaults; EMPTY_ANSWERS equals them', () => {
    expect(podkladyAnswersSchema.parse({})).toEqual({
      otherIncome: 'unknown', otherIncomeApprox: null, employmentBeyondLimits: 'unknown', insolvencyOrPartner: 'unknown',
      comparisonRate: null, activityClass: null, includePartialXml: false,
    });
    expect(EMPTY_ANSWERS).toEqual(podkladyAnswersSchema.parse({}));
  });
  it('rejects rodneCislo and any unknown key; rejects a rate outside 80/60/40/30', () => {
    expect(podkladyAnswersSchema.safeParse({ rodneCislo: '7801011229' }).success).toBe(false);
    expect(podkladyAnswersSchema.safeParse({ rod_c: '7801011229' }).success).toBe(false);
    expect(podkladyAnswersSchema.safeParse({ comparisonRate: 50 }).success).toBe(false);
    expect(podkladyAnswersSchema.safeParse({ otherIncome: 'yes', otherIncomeApprox: 60000, comparisonRate: 80 }).success).toBe(true);
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- readiness 2>&1 | tail -30`.
4. Index exports; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
5. Commit `feat(income-tax): podklady readiness checks and answers schema (0354)`.

## 5. Do not touch

Other `income-tax/` files, `apps/`, `packages/db`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- readiness 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Every `P_*` code is produced by one test; `P_REGIME_UNSUPPORTED` is the only blocking one; `rodneCislo` never parses.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0354-report.md`.

## Risk list

None (no money).

## Owner steps

None.
