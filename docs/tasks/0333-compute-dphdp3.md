# 0333: `computeDphdp3` with whole-Kč rounding

Status: todo
Ticket: P3-VAT-04 | Depends on: 0328 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 50k tokens

## 1. Objective

Pure `computeDphdp3(entries, status, rules, periodStart)`: source rows summed from the VAT ledger, rounded to whole Kč per rule `vat.return_rounding`, derived rows 43/44/46/62–65 and the `trans` flag; the numbers must equal the user's filed August 2026 return (row 5 = 13 700 / 2 877).

## 2. Context

M05 §4.4 (pasted):
1. Select entries of the period (all entries with non-empty `dphdp3Rows`).
2. For each **source row** of `epo.dphdp3_row_map`: `base_raw = Σ baseCzk`, `tax_raw = Σ vatCzk` over entries whose `dphdp3Rows` contains the row. Deduction rows `43`/`44` listed on entries are **ignored here** (they are derived in step 4 from rounded values).
3. Rounding (`vat.return_rounding`, D-11): `sum_entries_then_round`: `base = round0(base_raw)`, `tax = round0(tax_raw)`. `round_base_then_multiply`: `base = round0(base_raw)`, `tax = round0(base × pct / 100)` with pct = `vat.rates[row.rate]` (`standard`/`reduced`); rows with rate `any` have no tax. `round0` = half away from zero (`../money/index`).
4. Derived rows (payers only): ř.43 base/tax = Σ rows 3,5,12 (rounded values); ř.44 from 4,6,13; ř.46 tax = tax(40)+tax(41)+tax(43)+tax(44) (base not emitted); ř.62 = Σ tax of rows 1,2,3,4,5,6,12,13 (IO: rows 3–13 only, i.e. 3,4,5,6,12,13); ř.63 = ř.46 (IO: 0); ř.64 = max(0, 62−63); ř.65 = max(0, 63−62).
5. `trans = 'A'` if ř.62 ≠ 0 or any of rows 20/21/26 has base ≠ 0, else `'N'` (**[verify]** semantics, T-02).
6. Payer with no entries: all zero, `trans='N'` (nil return). IO with no entries: caller never calls (nothing_to_file).

Row map access: `parseDphdp3RowMap(rules.at(periodStart).get('epo.dphdp3_row_map'))` (`../rules/cz/epo`); each row has `row`, `rate: 'standard'|'reduced'|'any'`, `statuses`, `side`. Rates: `rules.at(periodStart).get('vat.rates')` → `{standard: 21, reduced: 12}`.

Hand-verified golden numbers (ledger fixture of 0311, policy `issue_date`):
- Aug 2026 IO: Booking July 13 699,77 / 2 876,95 → row 5 **13 700 / 2 877**; ř.62 = 2 877, ř.64 = 2 877, ř.63 = ř.65 = 0, `trans='A'`.
- Sep 2026 IO: Booking Aug 11 549,94 / 2 425,49 → **11 550 / 2 425**; under `round_base_then_multiply`: 11 550 × 0,21 = 2 425,50 → half-up → **2 426** (M05 §9 #2).
- Oct 2026 IO: Cloudflare 245,35 / 51,52 → row 12 **245 / 52**; Anthropic 2 212,20 / 464,56 → row 5 **2 212 / 465**; ř.62 = 465 + 52 = **517** = ř.64. (M05 §9 #2 lists Cloudflare under September; the recorded fixture dates it 3 Oct 2026, so it is an October entry under `issue_date`: report this contradiction.)
- Synthetic payer Sep 2026 (used again by 0334/0339): row 1 entries 10 000,00/2 100,00 + 8 264,46/1 735,54 + 8 264,47/1 735,54 → base 26 528,93 → **26 529**, tax 5 571,08 → **5 571**; row 5 Booking **11 550 / 2 425**; row 40 entries 10 711,44/2 249,40 + 990,08/207,92 − 9 917,36/2 082,64 → base 1 784,16 → **1 784**, tax 374,68 → **375**; ř.43 = 11 550 / 2 425; ř.46 = 375 + 2 425 = **2 800**; ř.62 = 5 571 + 2 425 = **7 996**; ř.63 = 2 800; ř.64 = **5 196**; ř.65 = 0.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/vat/dphdp3.ts` | create | types + `computeDphdp3`, `dphdp3Row` helper |
| `packages/domain/test/dphdp3.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './vat/dphdp3';` |

## 4. Steps

1. `dphdp3.ts` exports exactly:
```ts
export type Dphdp3Status = 'platce' | 'identifikovana_osoba';
export type Dphdp3Rounding = 'sum_entries_then_round' | 'round_base_then_multiply';
export interface Dphdp3RowValue { readonly base: Money; readonly tax: Money }          // whole CZK, Money (scale 2, e.g. '13700.00')
export interface Dphdp3Computation {
  readonly status: Dphdp3Status; readonly rounding: Dphdp3Rounding; readonly periodStart: LegalDate;
  readonly rows: Readonly<Record<string, Dphdp3RowValue>>;   // source rows with ≥ 1 entry + derived rows 43/44/46 (payer, when non-zero); never 62–65
  readonly raw: Readonly<Record<string, Dphdp3RowValue>>;    // unrounded sums of the source rows present in `rows`
  readonly row62: Money; readonly row63: Money; readonly row64: Money; readonly row65: Money;
  readonly trans: 'A' | 'N';
  readonly documentIds: readonly string[];                    // sorted unique
  readonly entryCount: number;
}
export const IO_RETURN_ROWS: readonly string[] = ['3', '4', '5', '6', '12', '13'];
export const PAYER_RETURN_ROWS: readonly string[] = ['1', '2', '3', '4', '5', '6', '12', '13'];
export function dphdp3Row(c: Dphdp3Computation, row: string): Dphdp3RowValue;   // zero/zero when absent
export function computeDphdp3(entries: readonly VatLedgerEntryDraft[], status: Dphdp3Status, rules: CzRules, periodStart: LegalDate, roundingOverride?: Dphdp3Rounding): Dphdp3Computation;
```
Entries with empty `dphdp3Rows` are ignored. Rows unknown to the map throw `Error('dphdp3: unknown row ' + row)`. Zero-valued source rows (an entry pair netting to 0) stay in `rows` with zero values (the serializer omits zero attributes).
2. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { computeDphdp3, dphdp3Row } from '../src/vat/dphdp3';
import type { VatLedgerEntryDraft } from '../src/vat/ledger';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const e = (documentId: string, rows: string[], base: string, vat: string, o: Partial<VatLedgerEntryDraft> = {}): VatLedgerEntryDraft => ({
  periodStart: d('2026-08-01'), periodEnd: d('2026-08-31'), vatPointDate: d('2026-08-03'), vatPointRule: 'issue_date', lineId: null, documentId,
  vatTreatment: 'rcv_eu_service_reverse_charge', vatRateType: 'standard', vatRatePct: 21, baseCzk: czk(base), vatCzk: czk(vat), deductionPct: '100',
  currency: 'CZK', baseForeign: null, fxRate: null, fxAmount: null, fxRateDate: null, dphdp3Rows: rows, khSection: null, khDocumentTotalCzk: null,
  shvCode: null, counterpartyVatId: null, evidenceNumber: documentId, ...o,
});
const v = (c: ReturnType<typeof computeDphdp3>, row: string) => [dphdp3Row(c, row).base.toFixed2(), dphdp3Row(c, row).tax.toFixed2()];

describe('computeDphdp3 golden (M05 §9 #1–#3)', () => {
  it('August 2026 IO: row 5 = 13 700 / 2 877, ř.62 = ř.64 = 2 877, trans A, no row 43', () => {
    const c = computeDphdp3([e('booking-jul', ['5'], '13699.77', '2876.95')], 'identifikovana_osoba', rules, d('2026-08-01'));
    expect(v(c, '5')).toEqual(['13700.00', '2877.00']);
    expect(c.raw['5']?.base.toFixed2()).toBe('13699.77');
    expect([c.row62, c.row63, c.row64, c.row65].map((m) => m.toFixed2())).toEqual(['2877.00', '0.00', '2877.00', '0.00']);
    expect(c.trans).toBe('A');
    expect(Object.keys(c.rows)).toEqual(['5']);
    expect(c).toMatchObject({ status: 'identifikovana_osoba', rounding: 'sum_entries_then_round', documentIds: ['booking-jul'], entryCount: 1 });
  });
  it('September 2026 IO: 11 550 / 2 425; 2 426 under round_base_then_multiply', () => {
    const sep = [e('booking-aug', ['5'], '11549.94', '2425.49', { vatPointDate: d('2026-09-03') })];
    expect(v(computeDphdp3(sep, 'identifikovana_osoba', rules, d('2026-09-01')), '5')).toEqual(['11550.00', '2425.00']);
    const alt = computeDphdp3(sep, 'identifikovana_osoba', rules, d('2026-09-01'), 'round_base_then_multiply');
    expect(v(alt, '5')).toEqual(['11550.00', '2426.00']);
    expect(alt.rounding).toBe('round_base_then_multiply');
  });
  it('October 2026 IO: row 12 Cloudflare 245 / 52, row 5 Anthropic 2 212 / 465, ř.62 = 517', () => {
    const c = computeDphdp3([
      e('cloudflare', ['12'], '245.35', '51.52', { vatTreatment: 'rcv_non_eu_service_reverse_charge', currency: 'USD' }),
      e('anthropic', ['5'], '2212.20', '464.56', { currency: 'EUR' }),
    ], 'identifikovana_osoba', rules, d('2026-10-01'));
    expect(v(c, '12')).toEqual(['245.00', '52.00']);
    expect(v(c, '5')).toEqual(['2212.00', '465.00']);
    expect(c.row62.toFixed2()).toBe('517.00');
    expect(c.row64.toFixed2()).toBe('517.00');
    expect(c.documentIds).toEqual(['anthropic', 'cloudflare']);
  });
});

describe('computeDphdp3 payer', () => {
  const sep = [
    e('inv-a', ['1'], '10000.00', '2100.00', { vatTreatment: 'iss_domestic_vat' }),
    e('inv-b', ['1'], '8264.46', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
    e('inv-c', ['1'], '8264.47', '1735.54', { vatTreatment: 'iss_domestic_vat' }),
    e('booking-aug', ['5', '43'], '11549.94', '2425.49'),
    e('manager', ['40'], '10711.44', '2249.40', { vatTreatment: 'rcv_domestic_vat' }),
    e('ikea', ['40'], '990.08', '207.92', { vatTreatment: 'rcv_domestic_vat' }),
    e('credit', ['40'], '-9917.36', '-2082.64', { vatTreatment: 'rcv_domestic_vat' }),
  ];
  it('synthetic September: rows 1/5/40, derived 43/46, ř.62–65', () => {
    const c = computeDphdp3(sep, 'platce', rules, d('2026-09-01'));
    expect(v(c, '1')).toEqual(['26529.00', '5571.00']);
    expect(v(c, '5')).toEqual(['11550.00', '2425.00']);
    expect(v(c, '40')).toEqual(['1784.00', '375.00']);
    expect(v(c, '43')).toEqual(['11550.00', '2425.00']);
    expect(dphdp3Row(c, '46').tax.toFixed2()).toBe('2800.00');
    expect([c.row62, c.row63, c.row64, c.row65].map((m) => m.toFixed2())).toEqual(['7996.00', '2800.00', '5196.00', '0.00']);
    expect(c.trans).toBe('A');
    expect(Object.keys(c.rows).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '5', '40', '43', '46']);
  });
  it('P5: 43 = 3+5+12 and 44 = 4+6+13 from rounded rows; 64 − 65 = 62 − 63; one of 64/65 is zero', () => {
    const c = computeDphdp3([
      e('g', ['3', '43'], '1000.50', '210.11', { vatTreatment: 'rcv_eu_goods_acquisition' }),
      e('s', ['5', '43'], '2000.50', '420.11'),
      e('n', ['12', '43'], '3000.50', '630.11', { vatTreatment: 'rcv_non_eu_service_reverse_charge' }),
      e('r', ['6', '44'], '100.49', '12.06', { vatRateType: 'reduced', vatRatePct: 12 }),
    ], 'platce', rules, d('2026-09-01'));
    expect(v(c, '43')).toEqual(['6003.00', '1260.00']); // 1001 + 2001 + 3001; 210 + 420 + 630
    expect(v(c, '44')).toEqual(['100.00', '12.00']);
    expect(c.row64.subtract(c.row65).equals(c.row62.subtract(c.row63))).toBe(true);
    expect(c.row64.isZero() || c.row65.isZero()).toBe(true);
  });
  it('credit only (row 40) → ř.65, trans N; nil return → all zero, trans N', () => {
    const credit = computeDphdp3([e('m', ['40'], '1784.16', '374.68', { vatTreatment: 'rcv_domestic_vat' })], 'platce', rules, d('2026-09-01'));
    expect([credit.row62, credit.row63, credit.row64, credit.row65].map((m) => m.toFixed2())).toEqual(['0.00', '375.00', '0.00', '375.00']);
    expect(credit.trans).toBe('N');
    const nil = computeDphdp3([], 'platce', rules, d('2026-09-01'));
    expect(nil.rows).toEqual({});
    expect(nil.row64.isZero() && nil.trans === 'N' && nil.entryCount === 0).toBe(true);
  });
  it('P6: IO never gets 43/44/46 and ř.64 = ř.62; row 21 alone sets trans A for a payer', () => {
    const io = computeDphdp3([e('s', ['5'], '2000.50', '420.11')], 'identifikovana_osoba', rules, d('2026-09-01'));
    expect(Object.keys(io.rows)).toEqual(['5']);
    expect(io.row64.equals(io.row62)).toBe(true);
    const sh = computeDphdp3([e('eu', ['21'], '3000.30', '0.00', { vatTreatment: 'iss_eu_service', shvCode: 3 })], 'platce', rules, d('2026-09-01'));
    expect(v(sh, '21')).toEqual(['3000.00', '0.00']);
    expect(sh.trans).toBe('A');
    expect(sh.row62.isZero()).toBe(true);
  });
  it('unknown row throws', () => {
    expect(() => computeDphdp3([e('x', ['99'], '1.00', '0.21')], 'platce', rules, d('2026-09-01'))).toThrow(/unknown row/);
  });
});
```
Implement until green: `pnpm --filter @shoebox/domain test -- dphdp3 2>&1 | tail -30`.
3. Index line, typecheck, commit `feat(domain): computeDphdp3 (0333)`.

## 5. Do not touch

`epo.ts`, rules, `ledger.ts`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- dphdp3 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Golden Aug/Sep/Oct and payer cases green; typecheck clean.
- [ ] Report: `[verify]` `trans` semantics; the September-vs-October Cloudflare contradiction (M05 §9 #2 vs fixture).

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0333-report.md`.

## Risk list

`dphdp3.ts` (the return itself).

## Owner steps

None.
