# 0301: Category taxonomy in the domain (04 §3.1) and `deriveDeductibility`

Status: done
Ticket: P1-CAT-01 (taxonomy part), P0-DB-11 (domain list the DB seed will mirror) | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Put every `category_code` of the domain model into `packages/domain` as typed data (code, direction, tax effect, English label, icon, sort) with `deriveDeductibility`, so the cascade, the ledgers and the DB seed all read one list. A wrong tax effect here mis-states the user's income tax, so the list is checked code by code against the spec table pasted below.

## 2. Context

Hard rule 1: tax effects are data in `packages/domain`; no number here. Hard rule 6 (owner 2026-10-25): English only, no new Czech; the Czech labels of 04 are dormant, so this list carries `labelEn` and `explanationEn` only.

04 §3.1 (pasted): `tax_effect` enum: `taxable_income | non_taxable_income | deductible_expense | non_deductible_expense | asset | pass_through | transfer | tax_or_insurance_payment | private` (already in `packages/domain/src/enums/index.ts` as `TAX_EFFECT_VALUES`).

| Group | `category_code` → tax_effect |
|---|---|
| Income | `income_services` → taxable_income · `income_goods` → taxable_income · `income_accommodation` → taxable_income · `income_platform_payout` → taxable_income · `income_other_taxable` → taxable_income · `income_interest` → non_taxable_income · `income_subsidy` → non_taxable_income · `income_loan_received` → non_taxable_income · `income_owner_deposit` → non_taxable_income · `income_vat_refund` → non_taxable_income |
| Operating expenses (all deductible_expense) | `exp_material` · `exp_goods_for_resale` · `exp_small_assets` · `exp_services_general` · `exp_software_saas` · `exp_hosting_domains` · `exp_telecom` · `exp_rent` · `exp_energy` · `exp_cleaning` · `exp_property_management` · `exp_platform_commission` · `exp_payment_fees` · `exp_bank_fees` · `exp_advertising` · `exp_accounting_legal` · `exp_postage_shipping` · `exp_travel_transport` · `exp_fuel` · `exp_car_operating` · `exp_car_lease` · `exp_repairs` · `exp_insurance_business` · `exp_training_education` · `exp_office_supplies` · `exp_salaries` · `exp_other_deductible` |
| Non-deductible (non_deductible_expense) | `exp_representation` · `exp_fines_penalties` · `exp_other_non_deductible` |
| Assets (asset) | `asset_long_term` |
| Pass-through (pass_through) | `pt_tourist_fee` · `pt_deposit` · `pt_customs_vat` |
| Taxes and insurance (tax_or_insurance_payment) | `tax_vat_payment` · `tax_income_payment` · `tax_pausal_advance` · `ins_social_own` · `ins_health_own` · `tax_other_fees` |
| Transfers (transfer) | `transfer_own_accounts` · `transfer_cash_deposit` · `transfer_cash_withdrawal` · `loan_repayment_principal` |
| Private (private) | `private_expense` · `private_withdrawal` |

56 codes in all (10 + 27 + 3 + 1 + 3 + 6 + 4 + 2).

M04 §4.1 `deriveDeductibility(category, share)`: tax_effect `deductible_expense` → share = 100 `deductible`, 0 < share < 100 `partially_deductible`, share = 0 `non_deductible`; `non_deductible_expense` → `non_deductible`; `asset` → `not_applicable`; `private` → `non_deductible`; all income, `pass_through`, `transfer`, `tax_or_insurance_payment` → `not_applicable`.

Direction: income categories occur on issued documents (`out`), expenses, assets, taxes and `private_expense` on received ones (`in`); pass-through, transfers and `private_withdrawal` occur on both sides. The DB column `categories.direction` is a two-value enum; the domain carries `both` (see "Spec notes").

Existing API to reuse: `Money` is not needed here. `Decimal` from `decimal.js` is a dependency. `LegalDate`, `parseLegalDate` from `packages/domain/src/dates/index.ts`. Lint: no `Number(x)` or `parseFloat` in `packages/domain`; use `new Decimal(text)` for the share.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/src/taxonomy/categories.ts` | create | the list, lookups, `deriveDeductibility` |
| `packages/domain/test/taxonomy.test.ts` | create | the test file below, verbatim |
| `packages/domain/src/index.ts` | edit | export the module |

No other file may change.

## 4. Steps

1. Create `packages/domain/test/taxonomy.test.ts` with exactly:

```ts
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { TAX_EFFECT_VALUES } from '../src/enums/index';
import {
  CATEGORIES,
  CATEGORY_CODES,
  categoryAllowsDirection,
  deriveDeductibility,
  findCategory,
  getCategory,
  isCategoryCode,
  isCategoryValidOn,
  UnknownCategoryError,
} from '../src/taxonomy/categories';

// 04 §3.1, pasted into brief 0301 §2. The order is the spec's order; `sort` follows it.
const SPEC: Record<string, string[]> = {
  taxable_income: [
    'income_services', 'income_goods', 'income_accommodation', 'income_platform_payout',
    'income_other_taxable',
  ],
  non_taxable_income: [
    'income_interest', 'income_subsidy', 'income_loan_received', 'income_owner_deposit',
    'income_vat_refund',
  ],
  deductible_expense: [
    'exp_material', 'exp_goods_for_resale', 'exp_small_assets', 'exp_services_general',
    'exp_software_saas', 'exp_hosting_domains', 'exp_telecom', 'exp_rent', 'exp_energy',
    'exp_cleaning', 'exp_property_management', 'exp_platform_commission', 'exp_payment_fees',
    'exp_bank_fees', 'exp_advertising', 'exp_accounting_legal', 'exp_postage_shipping',
    'exp_travel_transport', 'exp_fuel', 'exp_car_operating', 'exp_car_lease', 'exp_repairs',
    'exp_insurance_business', 'exp_training_education', 'exp_office_supplies', 'exp_salaries',
    'exp_other_deductible',
  ],
  non_deductible_expense: ['exp_representation', 'exp_fines_penalties', 'exp_other_non_deductible'],
  asset: ['asset_long_term'],
  pass_through: ['pt_tourist_fee', 'pt_deposit', 'pt_customs_vat'],
  tax_or_insurance_payment: [
    'tax_vat_payment', 'tax_income_payment', 'tax_pausal_advance', 'ins_social_own',
    'ins_health_own', 'tax_other_fees',
  ],
  transfer: [
    'transfer_own_accounts', 'transfer_cash_deposit', 'transfer_cash_withdrawal',
    'loan_repayment_principal',
  ],
  private: ['private_expense', 'private_withdrawal'],
};

describe('CATEGORIES (04 §3.1)', () => {
  it('has the 56 codes of the spec, each exactly once, in spec order', () => {
    const expected = Object.values(SPEC).flat();
    expect(expected).toHaveLength(56);
    expect([...CATEGORY_CODES]).toEqual(expected);
    expect(CATEGORIES.map((c) => c.code)).toEqual(expected);
    expect(new Set(CATEGORY_CODES).size).toBe(56);
  });

  it('maps every code to the tax effect of its spec group', () => {
    for (const [taxEffect, codes] of Object.entries(SPEC)) {
      for (const code of codes) {
        expect(getCategory(code).taxEffect, code).toBe(taxEffect);
      }
    }
    expect(Object.keys(SPEC).sort()).toEqual([...TAX_EFFECT_VALUES].sort());
  });

  it('sort is strictly increasing, labels and icons are non-empty, codes are snake_case', () => {
    let last = -1;
    for (const c of CATEGORIES) {
      expect(c.sort).toBeGreaterThan(last);
      last = c.sort;
      expect(c.labelEn.length).toBeGreaterThan(0);
      expect(c.explanationEn.length).toBeGreaterThan(0);
      expect(c.icon).toMatch(/^[a-z0-9-]+$/);
      expect(c.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c.validFrom).toBe('2000-01-01');
      expect(c.validTo).toBeNull();
      expect(c.replacedBy).toBeNull();
    }
  });

  it('directions: income out, expenses/assets/taxes in, pass-through and transfers both', () => {
    for (const code of [...SPEC.taxable_income, ...SPEC.non_taxable_income]) {
      expect(getCategory(code).direction, code).toBe('out');
    }
    for (const code of [
      ...SPEC.deductible_expense, ...SPEC.non_deductible_expense, ...SPEC.asset,
      ...SPEC.tax_or_insurance_payment, 'private_expense',
    ]) {
      expect(getCategory(code).direction, code).toBe('in');
    }
    for (const code of [...SPEC.pass_through, ...SPEC.transfer, 'private_withdrawal']) {
      expect(getCategory(code).direction, code).toBe('both');
    }
    expect(categoryAllowsDirection(getCategory('pt_tourist_fee'), 'in')).toBe(true);
    expect(categoryAllowsDirection(getCategory('pt_tourist_fee'), 'out')).toBe(true);
    expect(categoryAllowsDirection(getCategory('exp_cleaning'), 'out')).toBe(false);
    expect(categoryAllowsDirection(getCategory('income_services'), 'in')).toBe(false);
  });

  it('lookups', () => {
    expect(isCategoryCode('exp_cleaning')).toBe(true);
    expect(isCategoryCode('exp_nope')).toBe(false);
    expect(findCategory('exp_nope')).toBeUndefined();
    expect(() => getCategory('exp_nope')).toThrow(UnknownCategoryError);
    expect(isCategoryValidOn(getCategory('exp_cleaning'), '2026-10-26')).toBe(true);
    expect(isCategoryValidOn(getCategory('exp_cleaning'), '1999-12-31')).toBe(false);
    expect(
      isCategoryValidOn(
        { ...getCategory('exp_cleaning'), validTo: '2026-06-30' as never },
        '2026-07-01',
      ),
    ).toBe(false);
  });
});

describe('deriveDeductibility (M04 §4.1)', () => {
  const cases: Array<[string, string, string]> = [
    ['exp_cleaning', '100', 'deductible'],
    ['exp_cleaning', '80', 'partially_deductible'],
    ['exp_cleaning', '0.01', 'partially_deductible'],
    ['exp_cleaning', '0', 'non_deductible'],
    ['exp_representation', '100', 'non_deductible'],
    ['exp_representation', '0', 'non_deductible'],
    ['asset_long_term', '100', 'not_applicable'],
    ['private_expense', '0', 'non_deductible'],
    ['private_expense', '100', 'non_deductible'],
    ['income_services', '100', 'not_applicable'],
    ['income_interest', '100', 'not_applicable'],
    ['pt_tourist_fee', '100', 'not_applicable'],
    ['transfer_own_accounts', '100', 'not_applicable'],
    ['tax_vat_payment', '100', 'not_applicable'],
  ];
  it.each(cases)('%s at %s %% → %s', (code, share, expected) => {
    expect(deriveDeductibility(getCategory(code), share)).toBe(expected);
    expect(deriveDeductibility(getCategory(code), new Decimal(share))).toBe(expected);
  });

  it('rejects a share outside 0..100', () => {
    expect(() => deriveDeductibility(getCategory('exp_cleaning'), '101')).toThrow(RangeError);
    expect(() => deriveDeductibility(getCategory('exp_cleaning'), '-1')).toThrow(RangeError);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- taxonomy 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/taxonomy/categories.ts`. Exported names and signatures exactly:

```ts
import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { Direction, TaxEffect } from '../enums/index';

export type CategoryGroup =
  | 'income' | 'expense' | 'non_deductible' | 'asset' | 'pass_through'
  | 'tax_insurance' | 'transfer' | 'private';
/** `both`: the category occurs on received and issued documents (pass-through, transfers). */
export type CategoryDirection = Direction | 'both';
export type Deductibility = 'deductible' | 'non_deductible' | 'partially_deductible' | 'not_applicable';

export interface Category {
  readonly code: CategoryCode;
  readonly group: CategoryGroup;
  readonly direction: CategoryDirection;
  readonly taxEffect: TaxEffect;
  readonly labelEn: string;
  readonly explanationEn: string;   // one sentence a layman understands
  readonly icon: string;            // Lucide icon name, kebab-case
  readonly sort: number;
  readonly validFrom: LegalDate;    // '2000-01-01' for the whole seed
  readonly validTo: LegalDate | null;
  readonly replacedBy: CategoryCode | null;
}

export class UnknownCategoryError extends Error { constructor(code: string) ... name = 'UnknownCategoryError' }

export const CATEGORY_CODES = [ /* the 56 codes in spec order */ ] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];
export const CATEGORIES: readonly Category[];
export function isCategoryCode(value: string): value is CategoryCode;
export function findCategory(code: string): Category | undefined;
export function getCategory(code: string): Category;              // throws UnknownCategoryError
export function categoryAllowsDirection(category: Category, direction: Direction): boolean;
export function isCategoryValidOn(category: Category, date: LegalDate | string): boolean;  // validFrom <= date <= validTo (null = open)
export function deriveDeductibility(category: Category, sharePct: string | Decimal): Deductibility;
```

Build `CATEGORIES` from one literal array in the spec order with `sort` = 10, 20, 30, … (increasing by 10). Suggested icons (Lucide names, any valid kebab-case name is acceptable): income_services `briefcase`, income_goods `package`, income_accommodation `bed`, income_platform_payout `wallet`, income_other_taxable `coins`, income_interest `percent`, income_subsidy `hand-coins`, income_loan_received `banknote`, income_owner_deposit `piggy-bank`, income_vat_refund `receipt`, exp_material `hammer`, exp_goods_for_resale `shopping-cart`, exp_small_assets `laptop`, exp_services_general `wrench`, exp_software_saas `cloud`, exp_hosting_domains `globe`, exp_telecom `phone`, exp_rent `building`, exp_energy `zap`, exp_cleaning `sparkles`, exp_property_management `key`, exp_platform_commission `badge-percent`, exp_payment_fees `credit-card`, exp_bank_fees `landmark`, exp_advertising `megaphone`, exp_accounting_legal `scale`, exp_postage_shipping `truck`, exp_travel_transport `plane`, exp_fuel `fuel`, exp_car_operating `car`, exp_car_lease `car-front`, exp_repairs `drill`, exp_insurance_business `shield`, exp_training_education `graduation-cap`, exp_office_supplies `paperclip`, exp_salaries `users`, exp_other_deductible `tag`, exp_representation `utensils`, exp_fines_penalties `triangle-alert`, exp_other_non_deductible `ban`, asset_long_term `building-2`, pt_tourist_fee `map-pin`, pt_deposit `lock`, pt_customs_vat `ship`, tax_vat_payment `receipt-text`, tax_income_payment `landmark`, tax_pausal_advance `calendar-check`, ins_social_own `heart-handshake`, ins_health_own `heart-pulse`, tax_other_fees `file-text`, transfer_own_accounts `arrow-left-right`, transfer_cash_deposit `arrow-down-to-line`, transfer_cash_withdrawal `arrow-up-from-line`, loan_repayment_principal `undo-2`, private_expense `user`, private_withdrawal `user-minus`. Write one plain English sentence per `explanationEn` (e.g. exp_cleaning: "Cleaning of the premises you use for business."). Group per spec row: income rows → `income`; operating expenses → `expense`; non-deductible → `non_deductible`; assets → `asset`; pass-through → `pass_through`; taxes and insurance → `tax_insurance`; transfers → `transfer`; private → `private`.

`deriveDeductibility`: parse the share with `new Decimal(sharePct)` (a string literal or a Decimal); if not finite or `< 0` or `> 100` throw `RangeError`. Then the M04 table from §2. Use `share.isZero()` and `share.equals(100)`; no floats, no `Number()`.

Implement until the test passes; do not edit the test file. Then: `pnpm exec biome check --write packages/domain/src/taxonomy/categories.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- taxonomy 2>&1 | tail -30`. Expected: `Tests  7 passed` (it.each expands the cases; total ≥ 7, 0 failed).

3. Edit `packages/domain/src/index.ts`. Anchor (last line of the file):

```ts
export * from './rules/index';
```

Append after it:

```ts
export * from './taxonomy/categories';
```

Command: `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`. Expected: no error lines. Then `pnpm exec biome check packages/domain 2>&1 | tail -10` → "No fixes applied" / no errors (run `biome check --write` on the one file if it reports an import-order fix).

## 5. Do not touch

`packages/domain/src/enums/index.ts`, `packages/db/`, `docs/v3/`, every other package. Hard rules 1, 5, 6.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- taxonomy 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] `taxonomy.test.ts` green, unchanged.
- [ ] `CATEGORY_CODES` has 56 entries in spec order; every tax effect per the spec table.
- [ ] typecheck and biome clean.
- [ ] Commits `0301 step 1`, `0301 step 2`, `0301 step 3` on the current branch; no push.

## 8. Stop and ask

Stop, and write the report, if: an excerpt is not found; a test fails twice or seems wrong; you reach 25 tool calls or about 50k tokens (report `blocked`); a new dependency seems needed; a file outside §3 needs a change; a step is unclear.

## 9. Report

Write `docs/tasks/0301-report.md` (600 tokens at most), set `Status: review`, commit `0301 report`. Contents per TEMPLATE §9. Do not push; do not open a PR.

## Spec notes for the reviewer

- 05 `categories.direction` is the two-value enum `direction`, but pass-through, transfer and `private_withdrawal` categories occur on both sides (a tourist fee is collected on a platform statement and remitted by a transaction). The domain list carries `both`; the DB seed brief (0312) stores `in` for those rows and the cascade checks direction against the domain list. Suggested 05 edit (orchestrator): make `categories.direction` nullable or add a `both` value.
- Czech labels and explanations (04 §3.1: cs/en) are not written (owner 2026-10-25, hard rule 6). The DB seed uses the English label as a placeholder for `label_cs`.

## Risk list (for the reviewer)

`packages/domain/src/taxonomy/categories.ts`: the tax effect of each code (money-relevant).

## Owner steps

None.
