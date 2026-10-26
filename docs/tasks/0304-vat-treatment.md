# 0304: `deriveVatTreatment` truth table and `deriveVatRateType` (pure)

Status: todo
Ticket: P1-CAT-02 (a) | Depends on: 0302 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Derive the VAT treatment of a line deterministically from supplier country, CZ DIČ, printed VAT, supply kind and the document's tax-document status, exactly per M04 §4.2, so memory and the LLM can only ever influence `supply_kind`. A wrong treatment puts the wrong DPHDP3 row on the return; the truth table below is the spec.

## 2. Context

Hard rule 1 (EU list and out-of-scope categories come from rules: `vat.eu_member_states`, `vat.out_of_scope_categories`, `vat.reduced_rate_categories`, `vat.rates`, all seeded by 0302); hard rule 2 (treatment is never taken from memory/LLM).

M04 §4.2 (pasted; `EU = rules.at(issueDate).get('vat.eu_member_states')` minus `'CZ'`):

```
if direction == 'in':
  supplier unknown (null)                                    → treatment null, ambiguous 'supplier'
  category.taxEffect in (pass_through, tax_or_insurance_payment, transfer) or category in vat.out_of_scope_categories
                                                             → rcv_out_of_scope
  line.rcCommodityCode, or flag reverseCharge92a and supplier.czDic → rcv_domestic_reverse_charge
  flag customsDeclaration (JSD)                              → rcv_import_customs
  if supplier.czDic:                 // incl. foreign companies registered for CZ VAT (Apple Distribution Intl)
      taxDocStatus == 'not_tax_document'                     → rcv_domestic_no_vat
      line.vat > 0 or line.vatRatePct > 0                    → rcv_domestic_vat
      else                                                   → rcv_domestic_no_vat
  if supplier.country == 'CZ'                                → rcv_domestic_no_vat
  foreignVat = line.vat > 0                                  → rcv_foreign_vat_charged  (+ note TAXDOC_FOREIGN_VAT_CHARGED_B2B)
  flag placeOfSupplyAbroad (no VAT printed)                  → rcv_out_of_scope          (+ note PLACE_OF_SUPPLY_ABROAD)
  if supplier.country in EU:
      supplyKind 'goods'                                     → rcv_eu_goods_acquisition
      supplyKind 'service'                                   → rcv_eu_service_reverse_charge
  else (non-EU, incl. unknown country):
      supplyKind 'service'                                   → rcv_non_eu_service_reverse_charge
      supplyKind 'goods'                                     → rcv_import_customs
  supplyKind unknown → provisional 'service' by category (exp_software_saas | exp_hosting_domains | exp_platform_commission |
      exp_advertising | exp_services_general) with provisional: true, else treatment null, ambiguous 'supply_kind'
if direction == 'out':
  platform_statement income line (line.isStatementIncomeLine)      → platce ? iss_domestic_vat : iss_no_vat
  customer null (B2C) or customer.czDic or customer.country == 'CZ' → platce ? (rcCommodityCode ? iss_domestic_reverse_charge : iss_domestic_vat) : iss_no_vat
  customer.country in EU and customer.vatIdValid:  service → iss_eu_service (every status; IO files SH)
                                                   goods   → platce ? iss_eu_goods : iss_no_vat
  customer.country in EU, VAT ID missing/invalid           → treated as B2C above
  customer non-EU:  platce ? (service → iss_non_eu_service, goods → iss_export_goods) : iss_no_vat
  supplyKind unknown for a foreign customer                  → treatment null, ambiguous 'supply_kind'
```

`vat_rate_type` (M04 §4.2): domestic VAT lines (`rcv_domestic_vat`, `iss_domestic_vat`) from the printed rate mapped through `vat.rates` (`standard | reduced`), `0`/null → `zero`, any other value → `none`; self-assessed lines (`rcv_eu_service_reverse_charge`, `rcv_non_eu_service_reverse_charge`, `rcv_eu_goods_acquisition`, `rcv_domestic_reverse_charge`, `rcv_import_customs`) default `standard` unless the category is in `vat.reduced_rate_categories`; every other treatment and `null` → `none`.

Existing API: `Money` (`compare`, `isPositive`), `Decimal` (`new Decimal('21').equals(21)`), `getCategory` (0301), `RuleResolver` with `.at(date).get(key)`. Enums in `packages/domain/src/enums/index.ts`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/vat-treatment.test.ts` | create | verbatim below |
| `packages/domain/src/vat/treatment.ts` | create | `deriveVatTreatment`, `deriveVatRateType` |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/vat-treatment.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import type { VatTreatment } from '../src/enums/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import {
  deriveVatRateType,
  deriveVatTreatment,
  SERVICE_DEFAULT_CATEGORIES,
  type VatTreatmentInput,
  type VatTreatmentParty,
} from '../src/vat/treatment';

const rules = createCzRules();
const czk = (s: string) => Money.parse(s, 'CZK');
const CZ_PAYER: VatTreatmentParty = { country: 'CZ', czDic: 'CZ12345678', vatId: null, vatIdValid: null, isVatPayer: true };
const CZ_NONPAYER: VatTreatmentParty = { country: 'CZ', czDic: null, vatId: null, vatIdValid: null, isVatPayer: false };
const IE: VatTreatmentParty = { country: 'IE', czDic: null, vatId: 'IE6388047V', vatIdValid: true, isVatPayer: null };
const US: VatTreatmentParty = { country: 'US', czDic: null, vatId: null, vatIdValid: null, isVatPayer: null };
const DE_B2C: VatTreatmentParty = { country: 'DE', czDic: null, vatId: null, vatIdValid: null, isVatPayer: null };

function tin(over: Partial<VatTreatmentInput> = {}): VatTreatmentInput {
  return {
    direction: 'in',
    docClass: 'received_invoice',
    taxDocStatus: 'full_tax_document',
    issueDate: '2026-09-05' as never,
    flags: { reverseCharge92a: false, customsDeclaration: false, placeOfSupplyAbroad: false },
    line: { vat: czk('21.00'), vatRatePct: '21', rcCommodityCode: null, categoryCode: 'exp_services_general', isStatementIncomeLine: false },
    supplier: CZ_PAYER,
    customer: null,
    supplyKind: null,
    vatStatus: 'identifikovana_osoba',
    rules,
    ...over,
  };
}
const noVat = { vat: czk('0.00'), vatRatePct: null, rcCommodityCode: null, categoryCode: 'exp_services_general' as const, isStatementIncomeLine: false };
const t = (over: Partial<VatTreatmentInput> = {}) => deriveVatTreatment(tin(over));

describe('received side (M04 §4.2)', () => {
  const cases: Array<[string, Partial<VatTreatmentInput>, VatTreatment | null]> = [
    ['CZ payer, VAT printed', {}, 'rcv_domestic_vat'],
    ['CZ payer, rate printed without amount', { line: { ...noVat, vat: null, vatRatePct: '21' } }, 'rcv_domestic_vat'],
    ['CZ payer, no VAT on the line', { line: noVat }, 'rcv_domestic_no_vat'],
    ['CZ payer but not a tax document (AC-9k Alza, substitute)', { taxDocStatus: 'not_tax_document' }, 'rcv_domestic_no_vat'],
    ['CZ non-payer s.r.o. (AC-9b cleaning)', { supplier: CZ_NONPAYER, line: noVat }, 'rcv_domestic_no_vat'],
    ['CZ supplier without DIČ even with a printed rate', { supplier: CZ_NONPAYER }, 'rcv_domestic_no_vat'],
    ['tourist fee is out of scope whoever bills it', { line: { ...noVat, categoryCode: 'pt_tourist_fee' } }, 'rcv_out_of_scope'],
    ['tax payment is out of scope', { line: { ...noVat, categoryCode: 'tax_vat_payment' } }, 'rcv_out_of_scope'],
    ['own-account transfer is out of scope', { line: { ...noVat, categoryCode: 'transfer_own_accounts' } }, 'rcv_out_of_scope'],
    ['§92a commodity code with CZ DIČ', { line: { ...noVat, rcCommodityCode: '12' } }, 'rcv_domestic_reverse_charge'],
    ['§92a flag with CZ DIČ', { flags: { reverseCharge92a: true, customsDeclaration: false, placeOfSupplyAbroad: false }, line: noVat }, 'rcv_domestic_reverse_charge'],
    ['§92a flag without CZ DIČ falls through to EU service', { supplier: IE, supplyKind: 'service', flags: { reverseCharge92a: true, customsDeclaration: false, placeOfSupplyAbroad: false }, line: noVat }, 'rcv_eu_service_reverse_charge'],
    ['customs declaration', { supplier: US, flags: { reverseCharge92a: false, customsDeclaration: true, placeOfSupplyAbroad: false }, line: noVat }, 'rcv_import_customs'],
    ['EU supplier, service, no VAT (AC-9c Booking, AC-9f Anthropic)', { supplier: IE, supplyKind: 'service', line: noVat }, 'rcv_eu_service_reverse_charge'],
    ['EU supplier, goods, no VAT', { supplier: IE, supplyKind: 'goods', line: noVat }, 'rcv_eu_goods_acquisition'],
    ['EU supplier charging its own VAT', { supplier: IE, supplyKind: 'service', line: { ...noVat, vat: Money.parse('23.00', 'EUR'), vatRatePct: '23' } }, 'rcv_foreign_vat_charged'],
    ['non-EU supplier, service (AC-9e Cloudflare)', { supplier: US, supplyKind: 'service', line: noVat }, 'rcv_non_eu_service_reverse_charge'],
    ['non-EU supplier, goods → customs path', { supplier: US, supplyKind: 'goods', line: noVat }, 'rcv_import_customs'],
    ['GB is not EU', { supplier: { ...US, country: 'GB' }, supplyKind: 'service', line: noVat }, 'rcv_non_eu_service_reverse_charge'],
    ['foreign company with a CZ DIČ (Apple Distribution Intl)', { supplier: { ...IE, czDic: 'CZ683555118' } }, 'rcv_domestic_vat'],
    ['unknown supply kind, SaaS category → provisional service', { supplier: US, line: { ...noVat, categoryCode: 'exp_software_saas' } }, 'rcv_non_eu_service_reverse_charge'],
    ['unknown supply kind, EU, hosting → provisional service', { supplier: IE, line: { ...noVat, categoryCode: 'exp_hosting_domains' } }, 'rcv_eu_service_reverse_charge'],
    ['unknown supply kind, material → ambiguous', { supplier: IE, line: { ...noVat, categoryCode: 'exp_material' } }, null],
    ['hotel abroad with foreign VAT printed', { supplier: DE_B2C, line: { ...noVat, vat: Money.parse('19.00', 'EUR'), vatRatePct: '19' } }, 'rcv_foreign_vat_charged'],
    ['hotel abroad, no VAT printed, place of supply abroad', { supplier: DE_B2C, supplyKind: 'service', flags: { reverseCharge92a: false, customsDeclaration: false, placeOfSupplyAbroad: true }, line: noVat }, 'rcv_out_of_scope'],
    ['neplatce gets the same treatment (the ledger decides there is no entry)', { supplier: IE, supplyKind: 'service', line: noVat, vatStatus: 'neplatce' }, 'rcv_eu_service_reverse_charge'],
    ['platce gets the same treatment', { supplier: IE, supplyKind: 'service', line: noVat, vatStatus: 'platce' }, 'rcv_eu_service_reverse_charge'],
  ];
  it.each(cases)('%s', (_name, over, expected) => {
    expect(t(over).treatment).toBe(expected);
  });

  it('flags: ambiguity, provisional and notes', () => {
    expect(t({ supplier: IE, line: { ...noVat, categoryCode: 'exp_material' } })).toEqual({ treatment: null, ambiguous: 'supply_kind' });
    expect(t({ supplier: null })).toEqual({ treatment: null, ambiguous: 'supplier' });
    expect(t({ supplier: US, line: { ...noVat, categoryCode: 'exp_software_saas' } }).provisional).toBe(true);
    expect(t({ supplier: US, supplyKind: 'service', line: noVat }).provisional).toBeUndefined();
    expect(t({ supplier: IE, line: { ...noVat, vat: Money.parse('23.00', 'EUR'), vatRatePct: '23' } }).note).toBe('TAXDOC_FOREIGN_VAT_CHARGED_B2B');
    expect(t({ supplier: DE_B2C, supplyKind: 'service', flags: { reverseCharge92a: false, customsDeclaration: false, placeOfSupplyAbroad: true }, line: noVat }).note).toBe('PLACE_OF_SUPPLY_ABROAD');
    expect(SERVICE_DEFAULT_CATEGORIES).toEqual(['exp_software_saas', 'exp_hosting_domains', 'exp_platform_commission', 'exp_advertising', 'exp_services_general']);
  });

  it('AC-2: a CZ-DIČ supplier gets the same treatment whatever supply kind memory or the LLM proposes', () => {
    for (const supplyKind of ['service', 'goods', null] as const) {
      expect(t({ supplyKind }).treatment).toBe('rcv_domestic_vat');
      expect(t({ supplyKind, line: noVat }).treatment).toBe('rcv_domestic_no_vat');
    }
  });
});

describe('issued side', () => {
  const out = (over: Partial<VatTreatmentInput> = {}) =>
    deriveVatTreatment(tin({ direction: 'out', docClass: 'issued_invoice', supplier: null, line: { ...noVat, categoryCode: 'income_services' }, ...over }));
  const cases: Array<[string, Partial<VatTreatmentInput>, VatTreatment | null]> = [
    ['payer, CZ customer with DIČ', { vatStatus: 'platce', customer: CZ_PAYER }, 'iss_domestic_vat'],
    ['payer, CZ customer, §92a code', { vatStatus: 'platce', customer: CZ_PAYER, line: { ...noVat, categoryCode: 'income_services', rcCommodityCode: '12' } }, 'iss_domestic_reverse_charge'],
    ['payer, B2C (no customer)', { vatStatus: 'platce' }, 'iss_domestic_vat'],
    ['IO, CZ customer', { customer: CZ_PAYER }, 'iss_no_vat'],
    ['neplatce, B2C', { vatStatus: 'neplatce' }, 'iss_no_vat'],
    ['payer, EU business, service', { vatStatus: 'platce', customer: IE, supplyKind: 'service' }, 'iss_eu_service'],
    ['payer, EU business, goods', { vatStatus: 'platce', customer: IE, supplyKind: 'goods' }, 'iss_eu_goods'],
    ['IO, EU business, service → SH only', { customer: IE, supplyKind: 'service' }, 'iss_eu_service'],
    ['IO, EU business, goods', { customer: IE, supplyKind: 'goods' }, 'iss_no_vat'],
    ['payer, EU consumer (no valid VAT ID) is domestic', { vatStatus: 'platce', customer: DE_B2C, supplyKind: 'service' }, 'iss_domestic_vat'],
    ['payer, non-EU, service', { vatStatus: 'platce', customer: US, supplyKind: 'service' }, 'iss_non_eu_service'],
    ['payer, non-EU, goods', { vatStatus: 'platce', customer: US, supplyKind: 'goods' }, 'iss_export_goods'],
    ['IO, non-EU', { customer: US, supplyKind: 'service' }, 'iss_no_vat'],
    ['payer, EU business, unknown kind', { vatStatus: 'platce', customer: IE }, null],
    ['payer, platform statement income line', { vatStatus: 'platce', docClass: 'platform_statement', line: { ...noVat, categoryCode: 'income_accommodation', isStatementIncomeLine: true } }, 'iss_domestic_vat'],
    ['IO, platform statement income line (AC-9g)', { docClass: 'platform_statement', line: { ...noVat, categoryCode: 'income_accommodation', isStatementIncomeLine: true } }, 'iss_no_vat'],
  ];
  it.each(cases)('%s', (_name, over, expected) => {
    expect(out(over).treatment).toBe(expected);
  });
  it('unknown kind for a foreign business is ambiguous', () => {
    expect(out({ vatStatus: 'platce', customer: IE })).toEqual({ treatment: null, ambiguous: 'supply_kind' });
  });
});

describe('deriveVatRateType', () => {
  const at = rules.at('2026-09-05');
  const cases: Array<[VatTreatment | null, string | null, string, string]> = [
    ['rcv_domestic_vat', '21', 'exp_services_general', 'standard'],
    ['rcv_domestic_vat', '21.00', 'exp_services_general', 'standard'],
    ['rcv_domestic_vat', '12', 'exp_services_general', 'reduced'],
    ['rcv_domestic_vat', '0', 'exp_services_general', 'zero'],
    ['rcv_domestic_vat', null, 'exp_services_general', 'zero'],
    ['rcv_domestic_vat', '15', 'exp_services_general', 'none'],
    ['iss_domestic_vat', '21', 'income_services', 'standard'],
    ['rcv_eu_service_reverse_charge', null, 'exp_platform_commission', 'standard'],
    ['rcv_non_eu_service_reverse_charge', '0', 'exp_hosting_domains', 'standard'],
    ['rcv_eu_goods_acquisition', null, 'exp_material', 'standard'],
    ['rcv_domestic_reverse_charge', null, 'exp_material', 'standard'],
    ['rcv_import_customs', null, 'exp_material', 'standard'],
    ['rcv_domestic_no_vat', '21', 'exp_cleaning', 'none'],
    ['rcv_out_of_scope', null, 'pt_tourist_fee', 'none'],
    ['rcv_foreign_vat_charged', '19', 'exp_travel_transport', 'none'],
    ['iss_eu_service', null, 'income_services', 'none'],
    ['iss_no_vat', null, 'income_services', 'none'],
    [null, '21', 'exp_cleaning', 'none'],
  ];
  it.each(cases)('%s with printed %s → %s', (treatment, printed, category, expected) => {
    expect(deriveVatRateType(treatment, printed, category, at)).toBe(expected);
  });

  it('a reduced-rate category comes from the rules, not from code', () => {
    const patched = createCzRules([
      { key: 'vat.reduced_rate_categories', layer: 'override', valid_from: '2026-01-01', valid_to: null, source: 'https://www.zakonyprolidi.cz/cs/2004-235#p47', verified_at: '2026-01-01', value: ['exp_services_general'] },
    ]).at('2026-09-05');
    expect(deriveVatRateType('rcv_eu_service_reverse_charge', null, 'exp_services_general', patched)).toBe('reduced');
    expect(deriveVatRateType('rcv_eu_service_reverse_charge', null, 'exp_cleaning', patched)).toBe('standard');
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- vat-treatment 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/vat/treatment.ts`. Exported names and signatures exactly:

```ts
import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { Direction, DocumentClass, TaxDocStatus, VatRateType, VatStatus, VatTreatment } from '../enums/index';
import type { Money } from '../money/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver, RulesAt } from '../rules/resolver';
import { type CategoryCode, getCategory } from '../taxonomy/categories';

export type SupplyKind = 'service' | 'goods';
export interface VatTreatmentParty { readonly country: string | null; readonly czDic: string | null; readonly vatId: string | null; readonly vatIdValid: boolean | null; readonly isVatPayer: boolean | null; }
export interface VatTreatmentLine { readonly vat: Money | null; readonly vatRatePct: string | null; readonly rcCommodityCode: string | null; readonly categoryCode: CategoryCode; readonly isStatementIncomeLine: boolean; }
export interface VatTreatmentFlags { readonly reverseCharge92a: boolean; readonly customsDeclaration: boolean; readonly placeOfSupplyAbroad: boolean; }
export interface VatTreatmentInput { readonly direction: Direction; readonly docClass: DocumentClass; readonly taxDocStatus: TaxDocStatus; readonly issueDate: LegalDate; readonly flags: VatTreatmentFlags; readonly line: VatTreatmentLine; readonly supplier: VatTreatmentParty | null; readonly customer: VatTreatmentParty | null; readonly supplyKind: SupplyKind | null; readonly vatStatus: VatStatus; readonly rules: RuleResolver<typeof RULE_SCHEMAS>; }
export interface VatTreatmentResult { readonly treatment: VatTreatment | null; readonly ambiguous?: 'supply_kind' | 'supplier'; readonly provisional?: true; readonly note?: 'TAXDOC_FOREIGN_VAT_CHARGED_B2B' | 'PLACE_OF_SUPPLY_ABROAD'; }

export const SERVICE_DEFAULT_CATEGORIES: readonly CategoryCode[] = ['exp_software_saas', 'exp_hosting_domains', 'exp_platform_commission', 'exp_advertising', 'exp_services_general'];
export const SELF_ASSESSED_TREATMENTS: readonly VatTreatment[] = ['rcv_eu_service_reverse_charge', 'rcv_non_eu_service_reverse_charge', 'rcv_eu_goods_acquisition', 'rcv_domestic_reverse_charge', 'rcv_import_customs'];
export function deriveVatTreatment(input: VatTreatmentInput): VatTreatmentResult;
export function deriveVatRateType(treatment: VatTreatment | null, printedRatePct: string | null, categoryCode: CategoryCode, rulesAt: RulesAt<typeof RULE_SCHEMAS>): VatRateType;
```

Notes: build the result object with only the keys that apply (the tests use `toEqual` on `{ treatment: null, ambiguous: 'supply_kind' }`). "vat > 0" = `vat !== null && vat.isPositive()`; "vatRatePct > 0" = `new Decimal(pct).isPositive()`. EU set = `rules.at(issueDate).get('vat.eu_member_states')` without `'CZ'`. Rate comparison: `new Decimal(printed).equals(rates.standard)`.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/vat/treatment.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- vat-treatment 2>&1 | tail -30`. Expected: green.

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './taxonomy/categories';`. Append after it: `export * from './vat/treatment';`. Then typecheck and biome (see §6).

## 5. Do not touch

Rules, taxonomy, test files, other packages. Hard rules 1, 2.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- vat-treatment 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Truth table (27 received + 16 issued cases) and rate-type table green, unchanged.
- [ ] No country code or category literal in `treatment.ts` except `'CZ'` and `SERVICE_DEFAULT_CATEGORIES`.
- [ ] Commits `0304 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0304-report.md`, `Status: review`, commit `0304 report`. Record the `[verify]` items: reduced-rate categories per service, place-of-supply note copy.

## Spec notes for the reviewer

- Non-payers on the issued side: M04 §4.2 only spells out the payer/IO split for domestic and EU-goods cases; for non-EU customers and EU goods a non-payer gets `iss_no_vat` (safer: no return row). IO with an EU business customer keeps `iss_eu_service` so the SH (souhrnné hlášení) can list it (04 §3.2, TA-08).
- `supplier: null` yields `ambiguous: 'supplier'` instead of guessing (M03 keeps the document off `ready`).
- An EU supplier without a valid VAT ID is still routed by country (the customer-side VIES check does not apply to purchases).

## Risk list (for the reviewer)

`packages/domain/src/vat/treatment.ts` (whole file).

## Owner steps

None.
