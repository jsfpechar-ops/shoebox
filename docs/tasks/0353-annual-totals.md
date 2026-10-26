# 0353: K-C01 fix in the tax ledger basis + `computeAnnualTotals`

Status: todo
Ticket: P4-POD-01 (totals) | Depends on: — | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Sonnet 5.5 (money: changes the ledger basis every podklady number rests on, with property tests) | Fits one session: 22 tool calls, 60k tokens

## 1. Objective

1. Close known issue K-C01: for a deducting VAT payer with a partial business share, `buildTaxLedgerEntries` keeps VAT × (1 − share) in the basis and then multiplies by the share again, so a slice of private VAT lands in `business_amount_czk`. The basis of a deducting payer becomes the net alone.
2. Pure `computeAnnualTotals(entries, year)`: cash-basis annual totals by category and tax effect with the business/private split, provisional entries excluded and listed, drill-down per category (M06 §4.2).

## 2. Context

**K-C01** (`docs/context/known-issues.md`): "Payer with a partial business share: the tax ledger keeps VAT × (1 − share) in the basis and then multiplies by the share again, so a little private VAT lands in the business amount (M04 §4.11.2 uses deduction_pct = share)". Resolution: the non-deductible VAT of the private share is private, never a business cost. Golden (test AC-9i, MacBook net 22 305,79 + VAT 4 684,21, share 80, deducting payer): today `amount_czk 23 242,63 / business 18 594,10`; after the fix `amount_czk 22 305,79 / business 17 844,63` (22 305,79 × 0,8 = 17 844,632 → round2). IO/non-payer numbers do not change (26 990,00 / 21 592,00).

**M06 §4.2** (pasted): Source `tax_ledger_entries where org_id = $1 and tax_year = $2` (cash basis, dated by payment, pro rata across lines). For VAT payers M04 records amounts without deductible VAT; for non-payers and IOs amounts include VAT. For each entry: `business = business_amount_czk` (the builder stores `round2(amount_czk × share / 100)`), `private = amount_czk − business`.

| Bucket | Rule |
|---|---|
| Income | `tax_effect='taxable_income'` Σ `amount_czk` (share ignored) |
| Non-taxable income | `non_taxable_income`, listed, not in totals |
| Deductible expenses | `deductible_expense` Σ `business` |
| Private part | Σ `private` of deductible lines + Σ `amount_czk` of `tax_effect='private'` |
| Non-deductible | `non_deductible_expense` Σ `amount_czk`, listed, not deducted |
| Assets | `asset`, listed (0357 builds the asset list from lines) |
| Pass-through | `pass_through` by category, separate box |
| Taxes & insurance | `tax_or_insurance_payment` by category, info table |
| Transfers | `transfer`, count only |

Provisional entries (`basis='provisional'`, M04 §4.11 rule 4) are excluded from every bucket and listed separately as "unpaid / unverified". Entries of another `taxYear` are ignored (a December invoice paid in January belongs to the next year). Totals are 2-decimal `Money` (CZK); the PDF rounds later. Category lists are sorted by `categoryCode` ascending; drill-down entries keep input order. A negative category total (credit notes, refunds) is returned as such.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/ledgers/tax.ts` | edit | K-C01 basis; `LEDGER_ALGO_VERSION` 1 → 2 |
| `packages/domain/test/tax-ledger.test.ts` | edit | AC-9i payer numbers |
| `packages/domain/src/income-tax/totals.ts` | create | types + `computeAnnualTotals` |
| `packages/domain/test/annual-totals.test.ts` | create | below |
| `packages/domain/src/index.ts` | edit | append `export * from './income-tax/totals';` after the `./ledgers/tax` line |

## 4. Steps

1. `tax.ts`. Anchor (verbatim):
```ts
  const basisOf = (l: TaxLedgerLine): Money => {
    if (l.lineType === 'rounding') return l.gross ?? zero;
    const base = l.net ?? l.gross ?? zero;
    const vat = l.vat ?? zero;
    const keepShare = hundred.minus(l.businessSharePct).div(hundred);
    const vatPart = vatIsCost ? vat : vat.multiply(keepShare);
    return base.add(vatPart);
  };
```
Replace with:
```ts
  // K-C01: for a deducting payer the non-deductible VAT of the private share is private, never a
  // business cost (M04 §4.11.2, deduction_pct = share), so the basis is the net alone.
  const basisOf = (l: TaxLedgerLine): Money => {
    if (l.lineType === 'rounding') return l.gross ?? zero;
    const base = l.net ?? l.gross ?? zero;
    const vat = l.vat ?? zero;
    return vatIsCost ? base.add(vat) : base;
  };
```
Then `export const LEDGER_ALGO_VERSION = 1;` → `= 2;`. Run `grep -rn "LEDGER_ALGO_VERSION" packages apps --include=*.ts | grep -v node_modules | head -20`; where a test asserts the literal `1`, change it to `2` (nothing else).
2. `tax-ledger.test.ts`. Anchor: `it('AC-9i: MacBook for an IO at 80 % → 26 990,00 and business 21 592,00; payer with 80 % keeps 20 % of the VAT as cost', () => {` → `it('AC-9i: MacBook for an IO at 80 % → 26 990,00 and business 21 592,00; a deducting payer books the net only (K-C01)', () => {`. Anchor: `expect(p[0]?.amountCzk.toFixed2()).toBe('23242.63');` → `'22305.79'`; `expect(p[0]?.businessAmountCzk.toFixed2()).toBe('18594.10');` → `'17844.63'`. Command: `pnpm --filter @shoebox/domain test -- tax-ledger 2>&1 | tail -30` (green; if another test fails, its expected number also carried the K-C01 error: recompute as net × share and record it in the report).
3. `totals.ts` exports exactly:
```ts
import type { LegalDate } from '../dates/index';
import type { TaxEffect } from '../enums/index';
import { Money } from '../money/index';
import type { TaxLedgerBasis } from '../ledgers/tax';

/** A `tax_ledger_entries` row as read from the database (decimal literals as stored). */
export interface AnnualTotalsEntry {
  readonly entryDate: LegalDate; readonly taxYear: number; readonly basis: TaxLedgerBasis;
  readonly documentId: string; readonly lineId: string | null;
  readonly categoryCode: string; readonly taxEffect: TaxEffect;
  readonly amountCzk: string; readonly businessSharePct: string; readonly businessAmountCzk: string;
}
export interface DrillDownEntry { readonly documentId: string; readonly lineId: string | null; readonly entryDate: LegalDate; readonly basis: TaxLedgerBasis; readonly amountCzk: Money; readonly businessAmountCzk: Money; readonly businessSharePct: string }
export interface CategoryTotal { readonly categoryCode: string; readonly taxEffect: TaxEffect; readonly amount: Money; readonly businessAmount: Money; readonly privateAmount: Money; readonly entryCount: number; readonly entries: readonly DrillDownEntry[] }
export interface AnnualTotals {
  readonly year: number;
  readonly income: readonly CategoryTotal[]; readonly incomeTotal: Money;              // Σ amount
  readonly nonTaxableIncome: readonly CategoryTotal[];
  readonly deductible: readonly CategoryTotal[]; readonly deductibleTotal: Money;      // Σ businessAmount
  readonly privatePart: Money;                                                          // Σ privateAmount of deductible + Σ amount of 'private'
  readonly privateItems: readonly CategoryTotal[];                                      // tax_effect 'private'
  readonly nonDeductible: readonly CategoryTotal[]; readonly nonDeductibleTotal: Money; // Σ amount
  readonly assets: readonly CategoryTotal[];
  readonly passThrough: readonly CategoryTotal[];
  readonly taxAndInsurancePayments: readonly CategoryTotal[];
  readonly transfersCount: number;
  readonly provisional: readonly CategoryTotal[]; readonly provisionalCount: number;   // basis 'provisional', any effect
  readonly entryCount: number;                                                           // non-provisional entries of the year
}
export function computeAnnualTotals(entries: readonly AnnualTotalsEntry[], year: number): AnnualTotals;
```
`amount = Money.parse(amountCzk, 'CZK')`, `businessAmount = Money.parse(businessAmountCzk, 'CZK')`, `privateAmount = amount − businessAmount` (for income/pass-through/tax/transfer rows this is still computed, it is simply not summed anywhere). Group by `categoryCode` within one effect.
4. Test file verbatim:
```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { TaxEffect } from '../src/enums/index';
import { type AnnualTotalsEntry, computeAnnualTotals } from '../src/income-tax/totals';
import { CZK, Money } from '../src/money/index';

const d = parseLegalDate;
let seq = 0;
const e = (categoryCode: string, taxEffect: TaxEffect, amountCzk: string, o: Partial<AnnualTotalsEntry> = {}): AnnualTotalsEntry => ({
  entryDate: d('2026-06-15'), taxYear: 2026, basis: 'payment', documentId: `doc-${(seq += 1)}`, lineId: `line-${seq}`,
  categoryCode, taxEffect, amountCzk, businessSharePct: '100', businessAmountCzk: amountCzk, ...o,
});
const f2 = (m: Money) => m.toFixed2();
const byCode = (list: ReadonlyArray<{ categoryCode: string; amount: Money }>) => Object.fromEntries(list.map((c) => [c.categoryCode, f2(c.amount)]));

// M06 §9 S4: P4 Josef 2026 (fixture CZK amounts; the MacBook is booked at 100 % in this scenario).
const s4: AnnualTotalsEntry[] = [
  e('income_accommodation', 'taxable_income', '180000.00'),
  e('income_services', 'taxable_income', '60000.00'),
  e('exp_cleaning', 'deductible_expense', '11600.00'), e('exp_cleaning', 'deductible_expense', '8150.00'),
  e('exp_property_management', 'deductible_expense', '12960.84'), e('exp_property_management', 'deductible_expense', '9749.44'),
  e('exp_platform_commission', 'deductible_expense', '13699.77'), e('exp_platform_commission', 'deductible_expense', '11549.94'),
  e('exp_small_assets', 'deductible_expense', '26990.00', { documentId: 'macbook' }),
  e('exp_material', 'deductible_expense', '1198.00', { documentId: 'ikea' }), e('exp_material', 'deductible_expense', '117.00', { documentId: 'alza' }),
  e('exp_hosting_domains', 'deductible_expense', '226.50'), e('exp_software_saas', 'deductible_expense', '2218.32'),
  e('pt_tourist_fee', 'pass_through', '3500.00'), e('pt_tourist_fee', 'pass_through', '4150.00'),
  e('exp_other_deductible', 'private', '249.00', { documentId: 'decathlon', businessSharePct: '0', businessAmountCzk: '0.00' }),
  e('tax_vat_payment', 'tax_or_insurance_payment', '2877.00'), e('tax_vat_payment', 'tax_or_insurance_payment', '2471.00'),
  e('transfer_own', 'transfer', '10000.00'),
  e('income_services', 'taxable_income', '85000.00', { entryDate: d('2027-01-04'), taxYear: 2027 }),
  e('income_services', 'taxable_income', '5000.00', { basis: 'provisional', entryDate: d('2026-12-20') }),
];

describe('computeAnnualTotals S4 (M06 §9)', () => {
  const t = computeAnnualTotals(s4, 2026);
  it('income 240 000,00 by category; the 2027 entry and the provisional one are not in it', () => {
    expect(f2(t.incomeTotal)).toBe('240000.00');
    expect(byCode(t.income)).toEqual({ income_accommodation: '180000.00', income_services: '60000.00' });
    expect(t.income.map((c) => c.categoryCode)).toEqual(['income_accommodation', 'income_services']);
  });
  it('deductible 98 459,81; tourist fee 7 650 only in pass-through; Decathlon 249 private; VAT payments listed', () => {
    expect(f2(t.deductibleTotal)).toBe('98459.81');
    expect(byCode(t.passThrough)).toEqual({ pt_tourist_fee: '7650.00' });
    expect(f2(t.privatePart)).toBe('249.00');
    expect(t.privateItems[0]?.entries[0]?.documentId).toBe('decathlon');
    expect(byCode(t.taxAndInsurancePayments)).toEqual({ tax_vat_payment: '5348.00' });
    expect(t.transfersCount).toBe(1);
    expect(t.assets).toEqual([]);
  });
  it('provisional listed, not counted; entryCount excludes it and the other year', () => {
    expect(t.provisionalCount).toBe(1);
    expect(byCode(t.provisional)).toEqual({ income_services: '5000.00' });
    expect(t.entryCount).toBe(19);
    expect(t.year).toBe(2026);
  });
  it('drill-down keeps document ids and entry order', () => {
    const mat = t.deductible.find((c) => c.categoryCode === 'exp_material');
    expect(mat?.entries.map((x) => x.documentId)).toEqual(['ikea', 'alza']);
    expect(mat?.entryCount).toBe(2);
  });
});

describe('computeAnnualTotals S2 shapes and edge cases', () => {
  it('S2: phone at 50 % → 12 000 deductible + 12 000 private; representation listed; van as asset; insurance in payments', () => {
    const t = computeAnnualTotals([
      e('income_services', 'taxable_income', '1400000.00'),
      e('exp_material', 'deductible_expense', '400000.00'), e('exp_fuel', 'deductible_expense', '60000.00'),
      e('exp_telecom', 'deductible_expense', '24000.00', { businessSharePct: '50', businessAmountCzk: '12000.00' }),
      e('exp_small_assets', 'deductible_expense', '48000.00'),
      e('exp_representation', 'non_deductible_expense', '4000.00'),
      e('asset_long_term', 'asset', '650000.00', { entryDate: d('2026-05-12') }),
      e('ins_social_own', 'tax_or_insurance_payment', '60060.00'), e('ins_health_own', 'tax_or_insurance_payment', '39672.00'),
    ], 2026);
    expect(f2(t.incomeTotal)).toBe('1400000.00');
    expect(f2(t.deductibleTotal)).toBe('520000.00');
    expect(f2(t.privatePart)).toBe('12000.00');
    expect(byCode(t.nonDeductible)).toEqual({ exp_representation: '4000.00' });
    expect(f2(t.nonDeductibleTotal)).toBe('4000.00');
    expect(byCode(t.assets)).toEqual({ asset_long_term: '650000.00' });
    expect(byCode(t.taxAndInsurancePayments)).toEqual({ ins_health_own: '39672.00', ins_social_own: '60060.00' });
    const phone = t.deductible.find((c) => c.categoryCode === 'exp_telecom');
    expect([f2(phone?.businessAmount ?? Money.zero(CZK)), f2(phone?.privateAmount ?? Money.zero(CZK))]).toEqual(['12000.00', '12000.00']);
  });
  it('a refund larger than the purchase gives a negative category total', () => {
    const t = computeAnnualTotals([e('exp_material', 'deductible_expense', '1198.00'), e('exp_material', 'deductible_expense', '-1500.00')], 2026);
    expect(byCode(t.deductible)).toEqual({ exp_material: '-302.00' });
    expect(f2(t.deductibleTotal)).toBe('-302.00');
  });
  it('non-taxable income is listed and not in incomeTotal; empty input → zeros', () => {
    const t = computeAnnualTotals([e('income_subsidy', 'non_taxable_income', '50000.00')], 2026);
    expect(f2(t.incomeTotal)).toBe('0.00');
    expect(byCode(t.nonTaxableIncome)).toEqual({ income_subsidy: '50000.00' });
    const z = computeAnnualTotals([], 2026);
    expect([f2(z.incomeTotal), f2(z.deductibleTotal), f2(z.privatePart), z.entryCount]).toEqual(['0.00', '0.00', '0.00', 0]);
  });
});

describe('properties (M06 §9 general 4)', () => {
  const effects: TaxEffect[] = ['taxable_income', 'non_taxable_income', 'deductible_expense', 'non_deductible_expense', 'asset', 'pass_through', 'transfer', 'tax_or_insurance_payment', 'private'];
  const arbEntry = fc.record({
    categoryCode: fc.constantFrom('a', 'b', 'c'),
    taxEffect: fc.constantFrom(...effects),
    cents: fc.integer({ min: -5_000_000, max: 5_000_000 }),
    share: fc.constantFrom(0, 25, 50, 80, 100),
    provisional: fc.boolean(),
  }).map(({ categoryCode, taxEffect, cents, share, provisional }) => {
    const amount = Money.fromDecimal(Money.parse(String(cents), CZK).toDecimal().div(100), CZK);
    const business = Money.fromDecimal(amount.toDecimal().times(share).div(100).toDecimalPlaces(2), CZK);
    return e(categoryCode, taxEffect, amount.toFixed2(), { businessSharePct: String(share), businessAmountCzk: business.toFixed2(), basis: provisional ? 'provisional' : 'payment' });
  });
  it('Σ categories = bucket totals and amount = business + private for every category', () => {
    fc.assert(fc.property(fc.array(arbEntry, { maxLength: 40 }), (entries) => {
      const t = computeAnnualTotals(entries, 2026);
      const sum = (list: readonly { amount: Money }[], pick: (c: { amount: Money; businessAmount: Money }) => Money = (c) => c.amount) =>
        Money.sum(list.map((c) => pick(c as { amount: Money; businessAmount: Money })), CZK);
      expect(f2(sum(t.income))).toBe(f2(t.incomeTotal));
      expect(f2(sum(t.deductible, (c) => c.businessAmount))).toBe(f2(t.deductibleTotal));
      expect(f2(sum(t.nonDeductible))).toBe(f2(t.nonDeductibleTotal));
      for (const list of [t.income, t.deductible, t.nonDeductible, t.passThrough, t.assets, t.privateItems, t.provisional]) {
        for (const c of list) expect(f2(c.businessAmount.add(c.privateAmount))).toBe(f2(c.amount));
      }
      expect(t.entryCount + t.provisionalCount).toBe(entries.length);
    }), { numRuns: 200 });
  });
});
```
Command: `pnpm --filter @shoebox/domain test -- annual-totals 2>&1 | tail -30`. If `Money` lacks a method the test uses (`fromDecimal`, `toDecimal`, `sum`, `add`, `toFixed2`, `parse`, `zero` all exist in `packages/domain/src/money/money.ts`), stop and ask.
5. Append the export line to `src/index.ts`; `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`.
6. Commit `fix(ledger): K-C01 deducting payer basis is the net; feat: computeAnnualTotals (0353)`.

## 5. Do not touch

`allocate.ts`, `vat/ledger.ts`, `overview/ledger-totals.ts`, `docs/context/known-issues.md` (the orchestrator removes K-C01 after review), `apps/`.

## 6. Commands

`pnpm --filter @shoebox/domain test -- tax-ledger 2>&1 | tail -30` · `pnpm --filter @shoebox/domain test -- annual-totals 2>&1 | tail -30` · `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] AC-9i payer: `22305.79 / 17844.63`; every other tax-ledger test green with unchanged numbers (or the report lists each changed number with net × share).
- [ ] annual-totals: S4 `240000.00 / 98459.81 / 7650.00 / 249.00`, S2 `520000.00 / 12000.00`, properties 200 runs.

## 8. Stop and ask

TEMPLATE §8. Also stop if the K-C01 change alters a number in `vat-ledger.test.ts` (it must not: the VAT ledger has its own basis).

## 9. Report

`docs/tasks/0353-report.md`. Include: every test number changed by K-C01; `LEDGER_ALGO_VERSION` consumers found by the grep.

## Risk list

`ledgers/tax.ts` (every podklady and Přehled number), `LEDGER_ALGO_VERSION` bump (forces `P_LEDGER_STALE` → full rebuild on the next `ledger.rebuild_org`).

## Owner steps

1. Accountant review of the K-C01 rule (one sentence): "a deducting payer's business expense is the net × business share; the VAT on the private share is private." Record the answer in decisions.
