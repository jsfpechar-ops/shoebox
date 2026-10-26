# 0357: `listAssets`, `summarizePrivateUse`, `buildVatNote`

Status: todo
Ticket: P4-POD-02 (assets, private use, IO/VAT note) | Depends on: — | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 16 tool calls, 45k tokens

## 1. Objective

Three pure list builders for the podklady (M06 §4.5–4.7): the asset list (> 80 000 Kč, no depreciation) with the two consistency warnings, the private-use summary, and the IO/VAT note with the registration-threshold warning. No computation beyond sums and `round2`.

## 2. Context

**M06 §4.5** (pasted): asset list = lines with `category_code='asset_long_term'` on finalized documents whose `paid_at` or `issue_date` is in the year (union, deduplicated by line), `price = line gross` for non-payers/IO and `line net` for payers where the VAT was deducted (`vatDeducted`); the "vstupní cena" decision is the accountant's. Columns: date (`paidAt ?? issueDate`), supplier, description, document number, price, paid amount in the year, business share, car flag. Consistency: any line with `category_code ≠ 'asset_long_term'` and `price > asset.capitalization_threshold` → `asset.maybe_misclassified`; any `asset_long_term` line with `price ≤ threshold` → `asset.below_threshold` (still listed). Small assets = `exp_small_assets` lines, for information. Note key `podklady.assets.note` ("depreciation is the accountant's").

**§4.6**: documents with `business_flag='personal'` paid in the year (count, sum); lines with `0 < business_share_pct < 100` (description, total, business part = `round2(total × share / 100)`, private part); `review_questions` of kind `car_regime` with the answer (`actual_costs` | `flat_km`, business share) or unanswered.

**§4.7**: VAT status segments in the year; IO: Σ `tax_vat_payment` transactions and the M05 filings of the year (period, ř. 64, state), text `podklady.vat.io` (the VAT an IO self-assesses is "usually an expense – the accountant confirms", 22 TA-06 **[verify]**; never added to totals); payer: `podklady.vat.payer` ("income and expenses are without VAT") + Σ `tax_vat_payment`; non-payer: `podklady.vat.none`; more than one status in the year: `podklady.vat.mixed`. Non-payer/IO: if domestic cash income of the calendar year > `vat.registration_thresholds.calendar_year` → `registrationWarning` (the dashboard alert owns the action).

Rule access: `rules.at(⟨year⟩-12-31).get('asset.capitalization_threshold')` (number, 80 000) and `.get('vat.registration_thresholds')` (`{ calendar_year, immediate }`). `CzRules` from `../vat/period`; `round2`, `Money` from `../money/index`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/income-tax/assets.ts` | create | `AssetLineInput`, `AssetRow`, `AssetWarning`, `listAssets` |
| `packages/domain/src/income-tax/private-use.ts` | create | `PrivateUseInput`, `PrivateUseSummary`, `summarizePrivateUse` |
| `packages/domain/src/income-tax/vat-note.ts` | create | `VatNoteInput`, `VatNote`, `buildVatNote` |
| `packages/domain/test/podklady-lists.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append three `export * from './income-tax/<file>';` lines after the last `./income-tax/` line (or after `./ledgers/tax` if none) |

## 4. Steps

1. `assets.ts` exports exactly:
```ts
import type { LegalDate } from '../dates/index';
import type { Money } from '../money/index';
import type { CzRules } from '../vat/period';
export interface AssetLineInput {
  readonly documentId: string; readonly lineId: string; readonly documentNumber: string | null; readonly partnerName: string | null;
  readonly description: string | null; readonly issueDate: LegalDate | null; readonly paidAt: LegalDate | null;
  readonly categoryCode: string; readonly net: Money | null; readonly gross: Money | null; readonly businessSharePct: string;
  readonly vatDeducted: boolean; readonly carFlag: boolean; readonly paidInYear: Money;
}
export interface AssetRow { readonly documentId: string; readonly lineId: string; readonly date: LegalDate | null; readonly partnerName: string | null; readonly description: string | null; readonly documentNumber: string | null; readonly price: Money; readonly paidInYear: Money; readonly businessSharePct: string; readonly carFlag: boolean }
export interface AssetWarning { readonly code: 'asset.maybe_misclassified' | 'asset.below_threshold'; readonly documentId: string; readonly lineId: string; readonly params: { readonly price: string; readonly threshold: string } }
export interface AssetLists { readonly assets: readonly AssetRow[]; readonly smallAssets: readonly AssetRow[]; readonly warnings: readonly AssetWarning[]; readonly threshold: Money }
export function listAssets(lines: readonly AssetLineInput[], rules: CzRules, year: number): AssetLists;
```
`price = vatDeducted ? (net ?? gross) : (gross ?? net)`, zero when both null. In-year = `paidAt` or `issueDate` within `[year-01-01, year-12-31]`; a `lineId` seen twice is kept once (first wins). Rows sorted by `date` then `lineId`. Warnings in input order.
2. `private-use.ts` exports exactly:
```ts
export interface PrivateUseInput {
  readonly personalDocuments: ReadonlyArray<{ readonly documentId: string; readonly paidAt: LegalDate; readonly amountCzk: Money }>;
  readonly partialShareLines: ReadonlyArray<{ readonly documentId: string; readonly lineId: string; readonly description: string | null; readonly totalCzk: Money; readonly businessSharePct: string }>;
  readonly carRegimeAnswers: ReadonlyArray<{ readonly questionId: string; readonly answer: 'actual_costs' | 'flat_km' | null; readonly businessSharePct: string | null }>;
}
export interface PartialShareRow { readonly documentId: string; readonly lineId: string; readonly description: string | null; readonly totalCzk: Money; readonly businessSharePct: string; readonly businessPart: Money; readonly privatePart: Money }
export interface PrivateUseSummary { readonly personalCount: number; readonly personalSum: Money; readonly partialShares: readonly PartialShareRow[]; readonly carRegime: 'actual_costs' | 'flat_km' | 'unanswered'; readonly carBusinessSharePct: string | null }
export function summarizePrivateUse(input: PrivateUseInput): PrivateUseSummary;
```
Lines with share `0` or `100` are dropped from `partialShares`. `carRegime` = the last answered car question, else `'unanswered'`.
3. `vat-note.ts` exports exactly:
```ts
export interface VatNoteInput {
  readonly year: number;
  readonly segments: ReadonlyArray<{ readonly validFrom: LegalDate; readonly validTo: LegalDate | null; readonly vatStatus: VatStatus }>;
  readonly vatPayments: Money;                                                     // Σ tax_vat_payment in the year (absolute)
  readonly vatFilings: ReadonlyArray<{ readonly periodStart: LegalDate; readonly row64: Money; readonly state: string }>;
  readonly domesticCashIncome: Money;
}
export type VatNoteKind = 'payer' | 'io' | 'none' | 'mixed';
export interface VatNote { readonly kind: VatNoteKind; readonly textKey: `podklady.vat.${VatNoteKind}`; readonly segments: ReadonlyArray<{ readonly from: LegalDate; readonly to: LegalDate | null; readonly vatStatus: VatStatus }>; readonly vatPaid: Money; readonly filings: VatNoteInput['vatFilings']; readonly registrationWarning: boolean; readonly registrationThreshold: Money }
export function buildVatNote(input: VatNoteInput, rules: CzRules): VatNote;
```
`segments` = input segments overlapping the year, clipped to the year, sorted. `kind`: more than one distinct status → `mixed`; else `platce` → `payer`, `identifikovana_osoba` → `io`, else `none`. `registrationWarning` = kind ≠ `payer` and `domesticCashIncome > calendar_year`.
4. Test file verbatim:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { type AssetLineInput, listAssets } from '../src/income-tax/assets';
import { summarizePrivateUse } from '../src/income-tax/private-use';
import { buildVatNote } from '../src/income-tax/vat-note';
import { CZK, Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const f = (m: Money) => m.toFixed2();
const line = (o: Partial<AssetLineInput> & { lineId: string; categoryCode: string }): AssetLineInput => ({
  documentId: `doc-${o.lineId}`, documentNumber: null, partnerName: null, description: null, issueDate: d('2026-05-12'), paidAt: d('2026-05-12'),
  net: null, gross: null, businessSharePct: '100', vatDeducted: false, carFlag: false, paidInYear: czk('0.00'), ...o,
});

describe('listAssets (M06 §4.5)', () => {
  it('S2 van 650 000 is an asset; MacBook 26 990 a small asset; threshold 80 000', () => {
    const r = listAssets([
      line({ lineId: 'van', categoryCode: 'asset_long_term', gross: czk('650000.00'), net: czk('537190.08'), paidInYear: czk('650000.00'), carFlag: true, partnerName: 'Dealer' }),
      line({ lineId: 'mac', categoryCode: 'exp_small_assets', gross: czk('26990.00'), issueDate: d('2026-03-02'), paidAt: d('2026-03-02') }),
    ], rules, 2026);
    expect(f(r.threshold)).toBe('80000.00');
    expect(r.assets.map((a) => [a.lineId, f(a.price), f(a.paidInYear), a.carFlag, a.partnerName])).toEqual([['van', '650000.00', '650000.00', true, 'Dealer']]);
    expect(r.smallAssets.map((a) => [a.lineId, f(a.price), a.date])).toEqual([['mac', '26990.00', '2026-03-02']]);
    expect(r.warnings).toEqual([]);
  });
  it('a deducting payer gets the net as the price; an IO the gross', () => {
    const payer = listAssets([line({ lineId: 'p', categoryCode: 'asset_long_term', net: czk('500000.00'), gross: czk('605000.00'), vatDeducted: true })], rules, 2026);
    const io = listAssets([line({ lineId: 'i', categoryCode: 'asset_long_term', net: czk('500000.00'), gross: czk('605000.00') })], rules, 2026);
    expect([f(payer.assets[0]?.price ?? czk('0')), f(io.assets[0]?.price ?? czk('0'))]).toEqual(['500000.00', '605000.00']);
  });
  it('warnings: an expense line above the threshold, an asset line at or below it (still listed)', () => {
    const r = listAssets([
      line({ lineId: 'big', categoryCode: 'exp_material', gross: czk('90000.00') }),
      line({ lineId: 'edge', categoryCode: 'exp_material', gross: czk('80000.00') }),
      line({ lineId: 'small-asset', categoryCode: 'asset_long_term', gross: czk('50000.00') }),
    ], rules, 2026);
    expect(r.warnings).toEqual([
      { code: 'asset.maybe_misclassified', documentId: 'doc-big', lineId: 'big', params: { price: '90000.00', threshold: '80000.00' } },
      { code: 'asset.below_threshold', documentId: 'doc-small-asset', lineId: 'small-asset', params: { price: '50000.00', threshold: '80000.00' } },
    ]);
    expect(r.assets.map((a) => a.lineId)).toEqual(['small-asset']);
  });
  it('year filter is the union of paid_at and issue_date; a duplicated line counts once', () => {
    const r = listAssets([
      line({ lineId: 'old', categoryCode: 'asset_long_term', gross: czk('100000.00'), issueDate: d('2025-12-01'), paidAt: d('2025-12-15') }),
      line({ lineId: 'late-paid', categoryCode: 'asset_long_term', gross: czk('100000.00'), issueDate: d('2025-12-20'), paidAt: d('2026-01-05') }),
      line({ lineId: 'late-paid', categoryCode: 'asset_long_term', gross: czk('100000.00'), issueDate: d('2025-12-20'), paidAt: d('2026-01-05') }),
      line({ lineId: 'unpaid', categoryCode: 'asset_long_term', gross: czk('100000.00'), issueDate: d('2026-11-30'), paidAt: null }),
    ], rules, 2026);
    expect(r.assets.map((a) => [a.lineId, a.date])).toEqual([['late-paid', '2026-01-05'], ['unpaid', '2026-11-30']]);
  });
});

describe('summarizePrivateUse (M06 §4.6)', () => {
  it('Decathlon personal; phone 24 000 at 50 % → 12 000 / 12 000; car question answered flat_km 70 %', () => {
    const s = summarizePrivateUse({
      personalDocuments: [{ documentId: 'decathlon', paidAt: d('2026-10-09'), amountCzk: czk('249.00') }],
      partialShareLines: [
        { documentId: 'phone', lineId: 'l1', description: 'Phone plan', totalCzk: czk('24000.00'), businessSharePct: '50' },
        { documentId: 'full', lineId: 'l2', description: null, totalCzk: czk('100.00'), businessSharePct: '100' },
      ],
      carRegimeAnswers: [{ questionId: 'q1', answer: null, businessSharePct: null }, { questionId: 'q2', answer: 'flat_km', businessSharePct: '70' }],
    });
    expect([s.personalCount, f(s.personalSum)]).toEqual([1, '249.00']);
    expect(s.partialShares.map((p) => [p.lineId, f(p.businessPart), f(p.privatePart)])).toEqual([['l1', '12000.00', '12000.00']]);
    expect([s.carRegime, s.carBusinessSharePct]).toEqual(['flat_km', '70']);
    expect(summarizePrivateUse({ personalDocuments: [], partialShareLines: [], carRegimeAnswers: [] }).carRegime).toBe('unanswered');
  });
  it('an odd share rounds the business part half-up (33 % of 100,01 → 33,00)', () => {
    const s = summarizePrivateUse({ personalDocuments: [], partialShareLines: [{ documentId: 'x', lineId: 'l', description: null, totalCzk: czk('100.01'), businessSharePct: '33' }], carRegimeAnswers: [] });
    expect([f(s.partialShares[0]?.businessPart ?? czk('0')), f(s.partialShares[0]?.privatePart ?? czk('0'))]).toEqual(['33.00', '67.01']);
  });
});

describe('buildVatNote (M06 §4.7)', () => {
  const threshold = rules.at('2026-12-31').get('vat.registration_thresholds').calendar_year;
  it('S4: IO since 3. 8. 2026 after a non-payer segment → mixed, VAT payments 5 348 listed, two filings', () => {
    const n = buildVatNote({
      year: 2026,
      segments: [{ validFrom: d('2025-01-01'), validTo: d('2026-08-02'), vatStatus: 'neplatce' }, { validFrom: d('2026-08-03'), validTo: null, vatStatus: 'identifikovana_osoba' }],
      vatPayments: czk('5348.00'),
      vatFilings: [{ periodStart: d('2026-08-01'), row64: czk('2877.00'), state: 'marked_filed' }, { periodStart: d('2026-09-01'), row64: czk('2471.00'), state: 'generated' }],
      domesticCashIncome: czk('240000.00'),
    }, rules);
    expect([n.kind, n.textKey, f(n.vatPaid), n.filings.length, n.registrationWarning]).toEqual(['mixed', 'podklady.vat.mixed', '5348.00', 2, false]);
    expect(n.segments).toEqual([{ from: '2026-01-01', to: '2026-08-02', vatStatus: 'neplatce' }, { from: '2026-08-03', to: null, vatStatus: 'identifikovana_osoba' }]);
  });
  it('payer all year → payer text, no registration warning even above the threshold; IO above the threshold warns', () => {
    const base = { year: 2026, vatPayments: czk('0.00'), vatFilings: [], domesticCashIncome: Money.parse(String(threshold + 1), CZK) };
    const payer = buildVatNote({ ...base, segments: [{ validFrom: d('2024-01-01'), validTo: null, vatStatus: 'platce' }] }, rules);
    const io = buildVatNote({ ...base, segments: [{ validFrom: d('2024-01-01'), validTo: null, vatStatus: 'identifikovana_osoba' }] }, rules);
    expect([payer.kind, payer.registrationWarning, io.kind, io.registrationWarning, f(io.registrationThreshold)]).toEqual(['payer', false, 'io', true, `${threshold}.00`]);
    const none = buildVatNote({ ...base, domesticCashIncome: czk('100.00'), segments: [{ validFrom: d('2024-01-01'), validTo: null, vatStatus: 'neplatce' }] }, rules);
    expect([none.kind, none.registrationWarning]).toEqual(['none', false]);
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- podklady-lists 2>&1 | tail -30`.
5. Index exports; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
6. Commit `feat(income-tax): asset list, private use, VAT note (0357)`.

## 5. Do not touch

`ledgers/`, `vat/`, `apps/`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- podklady-lists 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Tests green; report notes the TA-06 `[verify]` (IO VAT as an income-tax expense) with the source checked.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0357-report.md`.

## Risk list

Asset price (payer net vs gross) is shown to the accountant; no totals change.

## Owner steps

None.
