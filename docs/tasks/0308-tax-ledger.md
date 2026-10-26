# 0308: `buildTaxLedgerEntries` (income tax, cash basis)

Status: todo
Ticket: P1-LEDG-01 | Depends on: 0301, 0305, 0306, 0307 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Turn one ready document plus its payment evidence into signed income-tax ledger entries: VAT included as cost for non-payers and identified persons, net of deducted VAT for payers, allocated pro rata over lines and payments, dated by the payment (or marked `document_evidence` / `provisional`). This is the number the user sees as "income" and "expenses" and the accountant gets in the podklady; every golden amount below is hand-verified.

## 2. Context

Hard rule 1 (Money only). M04 §4.11 (pasted, with the brief's decisions in brackets):

**Qualifying documents:** class bookable (`received_invoice`, `received_receipt`, `received_credit_note`, `received_advance_tax_doc`, `issued_invoice`, `issued_credit_note`, `platform_statement`), `status ∈ {ready, finalized}`, not deleted → otherwise `[]`. Lines with `line_type='text'` are skipped; lines with `coveredByDocumentId` are skipped (§4.11.4). [A remaining line without `categoryCode` is a pipeline bug → throw `LedgerInputError`.]

**4.11.1 Cost basis per line (document currency):** `P = profileAt(vatPointDate ?? issueDate)`; `vatIsCost = !(P.vatStatus === 'platce' && doc.deductionAllowed)` (IO and neplatce: VAT is cost); `basis_l = (net_l ?? gross_l) + (vatIsCost ? vat_l : vat_l × (1 − share_l/100))`; `rounding` lines: `basis = gross`; a null `vat` counts as 0. `weight_l = gross_l` (signed; null → 0). For `platform_statement` the printed signed line amount is `gross` (reservation +, commission −, fee −, tourist fee +) and the payout equals `Σ weight`.

**4.11.2 Payment evidence (precedence):**
1. `payments` (M07 links) with `linkType ∈ {payment, platform_payout, offset, fee}` → positive, `refund` → negative; `fx_difference` → ignored. CZK amount: `amountAccount` if its currency is CZK, else `amountAccount × ČNB rate on bookedOn` (`resolveFxRate`; rate missing → return `[]`). Date `bookedOn`. `basis='payment'`, `paymentLinkId`, `transactionId` set.
2. No links and (`isPaidPerDocument === true` or (`paymentMethod ∈ {card, cash}` and class `received_receipt`)) → one synthetic payment of the full document (`p_doc = W`) on `paidAt ?? issueDate` (CZK via ČNB rate at that date for foreign currency; missing → `[]`). `basis='document_evidence'`, `paymentLinkId` and `transactionId` null.
3. `platform_statement` without links → payout on `paidAt ?? issueDate`, `basis='document_evidence'`, `p_doc = W`.
4. Otherwise → one provisional set dated `dueDate ?? issueDate`, `basis='provisional'`, `p_doc = W`.
Partial payments (rule 1 only): remainder `R = W − Σ p_doc`; if `|R| > 0.01` (document currency; the tolerance is `validation.tol.sum`, kept as the constant `REMAINDER_TOLERANCE = '0.01'` here until lane B seeds the key, with a `TODO(rules:validation.tol.sum)` comment) → a provisional set for `R` dated `dueDate ?? issueDate`.

**4.11.3 Allocation:** for each payment `p` (CZK) over weights (document currency): `alloc = allocateProRata(p_czk, weights)` (brief 0307). Then `amount_l = round2(alloc_l × basis_l / gross_l)` for `gross_l ≠ 0` (else `alloc_l`, which is 0), with the same residual rule so that `Σ amount_l = round2(p_czk × Σbasis / W)` (residual → largest |weight|, tie lowest position). Entry per (line × payment): `entryDate` = payment date, `taxYear = year(entryDate)`, `categoryCode`, `taxEffect` from the taxonomy, `amountCzk` signed, `businessSharePct`, `businessAmountCzk = round2(amountCzk × share/100)`.

**Sign mapping:** received documents and issued documents: `amountCzk = +amount_l` (credit-note lines are negative already → negative entries). `platform_statement`: lines whose category has `taxEffect ∈ {deductible_expense, non_deductible_expense}` → `amountCzk = −amount_l` (a commission weight of −750 becomes an expense entry of +750); other lines `+amount_l` (income +, `pass_through` tourist fee +). The remitted tourist fee (`−`) is a document-less transaction (§4.15, later brief).

Golden numbers (M04 §9.1, P4 profile = identified person, monthly; hand-verified):

- AC-9a manager invoice 12 960,84 incl. 21 %: net 10 711,44, VAT 2 249,40 (10 711,44 × 0,21 = 2 249,4024 → 2 249,40; 10 711,44 + 2 249,40 = 12 960,84 ✓). IO: entry 12 960,84. Payer with deduction (AC-11): 10 711,44.
- Two-line variant: 8 000,00 / 1 680,00 / 9 680,00 and 2 711,44 / 569,40 / 3 280,84 (sums 10 711,44 / 2 249,40 / 12 960,84 ✓). Partial payment 5 000 (IO): 5 000 × 9 680 / 12 960,84 = 3 734,3259 → 3 734,33; 5 000 × 3 280,84 / 12 960,84 = 1 265,6741 → 1 265,67 (Σ 5 000,00). Remainder 7 960,84 provisional: 7 960,84 × 9 680 / 12 960,84 = 5 945,6741 → 5 945,67; 7 960,84 × 3 280,84 / 12 960,84 = 2 015,1659 → 2 015,17 (Σ 7 960,84; column sums 9 680,00 and 3 280,84 ✓). Payer partial 5 000: basis = net = gross / 1,21 → 3 734,33 / 1,21 = 3 086,2231 → 3 086,22; 1 265,67 / 1,21 = 1 046,0083 → 1 046,01; target round2(5 000 × 10 711,44 / 12 960,84) = round2(4 132,2314) = 4 132,23 = 3 086,22 + 1 046,01 ✓.
- Payer, 80 % share, MacBook 22 305,79 / 4 684,21 / 26 990,00: basis = 22 305,79 + 4 684,21 × 0,2 = 22 305,79 + 936,842 = 23 242,632 → amount 23 242,63; business = round2(23 242,63 × 0,8) = 18 594,104 → 18 594,10.
- AC-9i IO MacBook 26 990, 80 % → amount 26 990,00, business 21 592,00.
- AC-9j IKEA 1 198 card receipt: net 990,08, VAT 207,92 (Σ 1 198,00); `document_evidence`, `entryDate = issueDate`.
- AC-9k Alza 117: item 118,90, discount −1,95, rounding 0,05 (Σ 117,00), no VAT; provisional on `dueDate ?? issueDate`.
- AC-9g statement: reservation +5 000 (`income_accommodation`), commission −750 (`exp_platform_commission`), payment fee −60 (`exp_payment_fees`), tourist fee +250 (`pt_tourist_fee`); payout 4 440 = Σ weights. Entries +5 000, +750, +60, +250; income 5 000, expenses 810, pass-through excluded.
- Cloudflare $10.46 paid by card on 2026-10-03 (Saturday): Friday rate 23,456 → 245,34976 → 245,35.

Existing API: `allocateProRata` (0307), `resolveFxRate`, `convertToCzk`, `FxRateRow` (0306), `VatProfileSlice`, `ProfileAt` (0305), `getCategory` (0301), `Money`, `round2`, `CZK`, `RuleResolver` (`rules.at(date).get('vat.cnb_rate_rule')`, `'fx.max_lookback_days'`), `LegalDate`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/tax-ledger.test.ts` | create | verbatim below |
| `packages/domain/src/ledgers/tax.ts` | create | `buildTaxLedgerEntries` |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/tax-ledger.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import type { FxRateRow } from '../src/fx';
import {
  buildTaxLedgerEntries,
  LedgerInputError,
  type TaxLedgerDocument,
  type TaxLedgerEntryDraft,
  type TaxLedgerInput,
  type TaxLedgerLine,
  type TaxLedgerPayment,
} from '../src/ledgers/tax';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import type { VatProfileSlice } from '../src/vat/point-date';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const IO: VatProfileSlice = { vatStatus: 'identifikovana_osoba', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date' };
const PAYER: VatProfileSlice = { vatStatus: 'platce', vatPeriod: 'quarterly', foreignServiceDppdPolicy: 'service_period_end' };
const io = () => IO;
const payer = () => PAYER;
const RATES: FxRateRow[] = [
  { rateDate: d('2026-10-02'), currency: 'USD', amount: 1, rate: '23.456000' },
  { rateDate: d('2026-10-05'), currency: 'EUR', amount: 1, rate: '24.580000' },
];

function line(over: Partial<TaxLedgerLine> = {}): TaxLedgerLine {
  return {
    lineId: `l${over.position ?? 1}`, position: 1, lineType: 'item',
    net: czk('10711.44'), vat: czk('2249.40'), gross: czk('12960.84'),
    categoryCode: 'exp_property_management', businessSharePct: '100', coveredByDocumentId: null,
    ...over,
  };
}
function doc(over: Partial<TaxLedgerDocument> = {}): TaxLedgerDocument {
  return {
    documentId: 'doc-1', class: 'received_invoice', status: 'ready', deleted: false, currency: 'CZK',
    issueDate: d('2026-09-01'), dueDate: d('2026-09-15'), paidAt: null, vatPointDate: null,
    isPaidPerDocument: null, paymentMethod: 'bank_transfer', deductionAllowed: false,
    lines: [line()],
    ...over,
  };
}
function pay(over: Partial<TaxLedgerPayment> = {}): TaxLedgerPayment {
  return { paymentLinkId: 'pl-1', transactionId: 'tx-1', linkType: 'payment', bookedOn: d('2026-09-10'), amountDoc: czk('12960.84'), amountAccount: czk('12960.84'), ...over };
}
function build(over: Partial<TaxLedgerInput> = {}): TaxLedgerEntryDraft[] {
  return buildTaxLedgerEntries({ doc: doc(), payments: [], profileAt: io, fxRates: RATES, rules, ...over });
}
const brief = (es: TaxLedgerEntryDraft[]) => es.map((e) => [e.lineId, e.basis, e.entryDate, e.amountCzk.toFixed2()]);
const total = (es: TaxLedgerEntryDraft[]) => Money.sum(es.map((e) => e.amountCzk), 'CZK').toFixed2();

describe('golden shapes (M04 §9.1)', () => {
  it('AC-9a: manager invoice for an IO carries VAT as cost; one entry per line × payment', () => {
    const es = build({ payments: [pay()] });
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({
      entryDate: '2026-09-10', taxYear: 2026, basis: 'payment', documentId: 'doc-1', lineId: 'l1',
      paymentLinkId: 'pl-1', transactionId: 'tx-1', categoryCode: 'exp_property_management',
      taxEffect: 'deductible_expense', businessSharePct: '100',
    });
    expect(es[0]?.amountCzk.toFixed2()).toBe('12960.84');
    expect(es[0]?.businessAmountCzk.toFixed2()).toBe('12960.84');
  });

  it('AC-11: a deducting payer books the net', () => {
    const es = build({ doc: doc({ deductionAllowed: true }), payments: [pay()], profileAt: payer });
    expect(total(es)).toBe('10711.44');
    const noDeduction = build({ doc: doc({ deductionAllowed: false }), payments: [pay()], profileAt: payer });
    expect(total(noDeduction)).toBe('12960.84');
  });

  const twoLines = [
    line({ position: 1, net: czk('8000.00'), vat: czk('1680.00'), gross: czk('9680.00') }),
    line({ position: 2, net: czk('2711.44'), vat: czk('569.40'), gross: czk('3280.84') }),
  ];

  it('two lines, full payment: payer amounts are the nets exactly', () => {
    const es = build({ doc: doc({ lines: twoLines, deductionAllowed: true }), payments: [pay()], profileAt: payer });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '8000.00'],
      ['l2', 'payment', '2026-09-10', '2711.44'],
    ]);
  });

  it('partial payment: pro-rata allocation plus a provisional remainder on the due date (IO)', () => {
    const es = build({ doc: doc({ lines: twoLines }), payments: [pay({ amountDoc: czk('5000.00'), amountAccount: czk('5000.00') })] });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '3734.33'],
      ['l2', 'payment', '2026-09-10', '1265.67'],
      ['l1', 'provisional', '2026-09-15', '5945.67'],
      ['l2', 'provisional', '2026-09-15', '2015.17'],
    ]);
    expect(total(es)).toBe('12960.84');
    expect(es[2]?.paymentLinkId).toBeNull();
    expect(es[2]?.transactionId).toBeNull();
  });

  it('partial payment for a deducting payer: amounts scale by basis/gross and still sum to round2(p × Σbasis / W)', () => {
    const es = build({ doc: doc({ lines: twoLines, deductionAllowed: true }), payments: [pay({ amountDoc: czk('5000.00'), amountAccount: czk('5000.00') })], profileAt: payer });
    expect(brief(es.slice(0, 2))).toEqual([
      ['l1', 'payment', '2026-09-10', '3086.22'],
      ['l2', 'payment', '2026-09-10', '1046.01'],
    ]);
  });

  it('a remainder of 0.01 or less is not provisional; 0.02 is', () => {
    expect(build({ payments: [pay({ amountDoc: czk('12960.83'), amountAccount: czk('12960.83') })] })).toHaveLength(1);
    const es = build({ payments: [pay({ amountDoc: czk('12960.82'), amountAccount: czk('12960.82') })] });
    expect(brief(es)).toEqual([
      ['l1', 'payment', '2026-09-10', '12960.82'],
      ['l1', 'provisional', '2026-09-15', '0.02'],
    ]);
  });

  it('AC-9i: MacBook for an IO at 80 % → 26 990,00 and business 21 592,00; payer with 80 % keeps 20 % of the VAT as cost', () => {
    const mac = line({ net: czk('22305.79'), vat: czk('4684.21'), gross: czk('26990.00'), categoryCode: 'exp_small_assets', businessSharePct: '80' });
    const es = build({ doc: doc({ lines: [mac] }), payments: [pay({ amountDoc: czk('26990.00'), amountAccount: czk('26990.00') })] });
    expect(es[0]?.amountCzk.toFixed2()).toBe('26990.00');
    expect(es[0]?.businessAmountCzk.toFixed2()).toBe('21592.00');
    expect(es[0]?.businessSharePct).toBe('80');
    const p = build({ doc: doc({ lines: [mac], deductionAllowed: true }), payments: [pay({ amountDoc: czk('26990.00'), amountAccount: czk('26990.00') })], profileAt: payer });
    expect(p[0]?.amountCzk.toFixed2()).toBe('23242.63');
    expect(p[0]?.businessAmountCzk.toFixed2()).toBe('18594.10');
  });

  it('AC-9j: IKEA card receipt → document_evidence on the issue date, no link ids', () => {
    const ikea = doc({ class: 'received_receipt', paymentMethod: 'card', issueDate: d('2026-05-12'), dueDate: null,
      lines: [line({ net: czk('990.08'), vat: czk('207.92'), gross: czk('1198.00'), categoryCode: 'exp_small_assets' })] });
    const es = build({ doc: ikea });
    expect(brief(es)).toEqual([['l1', 'document_evidence', '2026-05-12', '1198.00']]);
    expect(es[0]).toMatchObject({ paymentLinkId: null, transactionId: null, taxYear: 2026 });
  });

  it('isPaidPerDocument on an invoice → document_evidence on paidAt; card on a plain invoice → provisional', () => {
    const paid = build({ doc: doc({ isPaidPerDocument: true, paidAt: d('2026-09-03') }) });
    expect(brief(paid)).toEqual([['l1', 'document_evidence', '2026-09-03', '12960.84']]);
    const card = build({ doc: doc({ paymentMethod: 'card' }) });
    expect(brief(card)).toEqual([['l1', 'provisional', '2026-09-15', '12960.84']]);
  });

  it('AC-9k: Alza 117 Kč — discount and rounding lines carry their signed amounts; Σ = printed total', () => {
    const alza = doc({ issueDate: d('2026-09-18'), dueDate: null, lines: [
      line({ position: 1, net: czk('118.90'), vat: null, gross: czk('118.90'), categoryCode: 'exp_office_supplies' }),
      line({ position: 2, lineType: 'discount', net: czk('-1.95'), vat: null, gross: czk('-1.95'), categoryCode: 'exp_office_supplies' }),
      line({ position: 3, lineType: 'rounding', net: czk('0.05'), vat: null, gross: czk('0.05'), categoryCode: 'exp_office_supplies' }),
      line({ position: 4, lineType: 'text', net: null, vat: null, gross: null, categoryCode: null }),
    ] });
    const es = build({ doc: alza });
    expect(brief(es)).toEqual([
      ['l1', 'provisional', '2026-09-18', '118.90'],
      ['l2', 'provisional', '2026-09-18', '-1.95'],
      ['l3', 'provisional', '2026-09-18', '0.05'],
    ]);
    expect(total(es)).toBe('117.00');
  });

  it('AC-9g: platform statement — income gross, fees as positive expenses, tourist fee pass-through; covered commission skipped', () => {
    const stmt = doc({ class: 'platform_statement', paidAt: d('2026-08-05'), lines: [
      line({ position: 1, net: czk('5000.00'), vat: null, gross: czk('5000.00'), categoryCode: 'income_accommodation' }),
      line({ position: 2, lineType: 'fee', net: czk('-750.00'), vat: null, gross: czk('-750.00'), categoryCode: 'exp_platform_commission' }),
      line({ position: 3, lineType: 'fee', net: czk('-60.00'), vat: null, gross: czk('-60.00'), categoryCode: 'exp_payment_fees' }),
      line({ position: 4, net: czk('250.00'), vat: null, gross: czk('250.00'), categoryCode: 'pt_tourist_fee' }),
    ] });
    const es = build({ doc: stmt });
    expect(brief(es)).toEqual([
      ['l1', 'document_evidence', '2026-08-05', '5000.00'],
      ['l2', 'document_evidence', '2026-08-05', '750.00'],
      ['l3', 'document_evidence', '2026-08-05', '60.00'],
      ['l4', 'document_evidence', '2026-08-05', '250.00'],
    ]);
    expect(es.map((e) => e.taxEffect)).toEqual(['taxable_income', 'deductible_expense', 'deductible_expense', 'pass_through']);
    const income = Money.sum(es.filter((e) => e.taxEffect === 'taxable_income').map((e) => e.amountCzk), 'CZK');
    const expenses = Money.sum(es.filter((e) => e.taxEffect === 'deductible_expense').map((e) => e.amountCzk), 'CZK');
    expect([income.toFixed2(), expenses.toFixed2()]).toEqual(['5000.00', '810.00']);
    const covered = build({ doc: { ...stmt, lines: stmt.lines.map((l) => (l.position === 2 ? { ...l, coveredByDocumentId: 'inv-booking' } : l)) } });
    expect(brief(covered).map((b) => b[0])).toEqual(['l1', 'l3', 'l4']);
    expect(total(covered)).toBe('5310.00');
  });

  it('invoice + full credit note (refund link) nets to zero per category', () => {
    const inv = build({ doc: doc({ documentId: 'inv', lines: [line({ net: czk('1000.00'), vat: czk('210.00'), gross: czk('1210.00'), categoryCode: 'exp_services_general' })] }),
      payments: [pay({ amountDoc: czk('1210.00'), amountAccount: czk('1210.00') })] });
    const cn = build({ doc: doc({ documentId: 'cn', class: 'received_credit_note', lines: [line({ net: czk('-1000.00'), vat: czk('-210.00'), gross: czk('-1210.00'), categoryCode: 'exp_services_general' })] }),
      payments: [pay({ paymentLinkId: 'pl-2', linkType: 'refund', amountDoc: czk('1210.00'), amountAccount: czk('1210.00'), bookedOn: d('2026-09-20') })] });
    expect(brief(inv)).toEqual([['l1', 'payment', '2026-09-10', '1210.00']]);
    expect(brief(cn)).toEqual([['l1', 'payment', '2026-09-20', '-1210.00']]);
    expect(total([...inv, ...cn])).toBe('0.00');
  });
});

describe('foreign currency', () => {
  const cloudflare = doc({ documentId: 'cf', currency: 'USD', issueDate: d('2026-10-03'), dueDate: null,
    lines: [line({ net: Money.parse('10.46', 'USD'), vat: Money.parse('0.00', 'USD'), gross: Money.parse('10.46', 'USD'), categoryCode: 'exp_hosting_domains' })] });

  it('document evidence on a Saturday converts with Friday’s ČNB rate (AC-9e amounts)', () => {
    const es = build({ doc: { ...cloudflare, isPaidPerDocument: true, paidAt: d('2026-10-03') } });
    expect(brief(es)).toEqual([['l1', 'document_evidence', '2026-10-03', '245.35']]);
  });

  it('a payment link in CZK uses the account amount; in another currency the ČNB rate on booked_on', () => {
    const czkCard = build({ doc: cloudflare, payments: [pay({ bookedOn: d('2026-10-05'), amountDoc: Money.parse('10.46', 'USD'), amountAccount: czk('245.40') })] });
    expect(brief(czkCard)).toEqual([['l1', 'payment', '2026-10-05', '245.40']]);
    const eurCard = build({ doc: cloudflare, payments: [pay({ bookedOn: d('2026-10-05'), amountDoc: Money.parse('10.46', 'USD'), amountAccount: Money.parse('9.00', 'EUR') })] });
    expect(brief(eurCard)).toEqual([['l1', 'payment', '2026-10-05', '221.22']]);
  });

  it('no ČNB rate within the look-back → no entries (M03 keeps the document off ready)', () => {
    expect(build({ doc: { ...cloudflare, isPaidPerDocument: true, paidAt: d('2026-09-01') } })).toEqual([]);
    expect(build({ doc: cloudflare, payments: [pay({ bookedOn: d('2026-09-01'), amountAccount: Money.parse('9.00', 'EUR') })] })).toEqual([]);
  });
});

describe('qualification and skips', () => {
  it('decoys and duplicates produce no entries (AC-9l)', () => {
    expect(build({ doc: doc({ status: 'duplicate' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ status: 'needs_review' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ class: 'other_supporting' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ class: 'settlement_statement' }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ deleted: true }), payments: [pay()] })).toEqual([]);
    expect(build({ doc: doc({ status: 'finalized' }), payments: [pay()] })).toHaveLength(1);
  });

  it('fx_difference links are ignored; a line without category throws', () => {
    expect(brief(build({ payments: [pay(), pay({ paymentLinkId: 'pl-9', linkType: 'fx_difference', amountDoc: czk('0.00'), amountAccount: czk('3.00') })] }))).toEqual([
      ['l1', 'payment', '2026-09-10', '12960.84'],
    ]);
    expect(() => build({ doc: doc({ lines: [line({ categoryCode: null })] }) })).toThrow(LedgerInputError);
  });

  it('a document whose weights sum to zero produces no entries', () => {
    expect(build({ doc: doc({ lines: [line({ gross: czk('0.00'), net: czk('0.00'), vat: czk('0.00') })] }) })).toEqual([]);
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- tax-ledger 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/ledgers/tax.ts`. Exported names and signatures exactly:

```ts
import { Decimal } from 'decimal.js';
import type { LegalDate } from '../dates/index';
import type { DocumentClass, DocumentStatus, LineType, LinkType, TaxEffect } from '../enums/index';
import { convertToCzk, type FxRateRow, resolveFxRate } from '../fx';
import { type Currency, CZK, Money, round2 } from '../money/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';
import { type CategoryCode, getCategory } from '../taxonomy/categories';
import type { ProfileAt } from '../vat/point-date';
import { allocateProRata } from './allocate';

export type TaxLedgerBasis = 'payment' | 'document_evidence' | 'provisional';
export class LedgerInputError extends Error { /* name = 'LedgerInputError' */ }
export interface TaxLedgerLine { readonly lineId: string; readonly position: number; readonly lineType: LineType; readonly net: Money | null; readonly vat: Money | null; readonly gross: Money | null; readonly categoryCode: CategoryCode | null; readonly businessSharePct: string; readonly coveredByDocumentId: string | null; }
export interface TaxLedgerDocument { readonly documentId: string; readonly class: DocumentClass; readonly status: DocumentStatus; readonly deleted: boolean; readonly currency: Currency; readonly issueDate: LegalDate | null; readonly dueDate: LegalDate | null; readonly paidAt: LegalDate | null; readonly vatPointDate: LegalDate | null; readonly isPaidPerDocument: boolean | null; readonly paymentMethod: string | null; readonly deductionAllowed: boolean; readonly lines: readonly TaxLedgerLine[]; }
export interface TaxLedgerPayment { readonly paymentLinkId: string; readonly transactionId: string; readonly linkType: LinkType; readonly bookedOn: LegalDate; readonly amountDoc: Money /* document currency, as stored (positive) */; readonly amountAccount: Money /* account currency, as stored (positive) */; }
export interface TaxLedgerInput { readonly doc: TaxLedgerDocument; readonly payments: readonly TaxLedgerPayment[]; readonly profileAt: ProfileAt; readonly fxRates: readonly FxRateRow[]; readonly rules: RuleResolver<typeof RULE_SCHEMAS>; }
export interface TaxLedgerEntryDraft { readonly entryDate: LegalDate; readonly taxYear: number; readonly basis: TaxLedgerBasis; readonly documentId: string; readonly lineId: string; readonly paymentLinkId: string | null; readonly transactionId: string | null; readonly categoryCode: CategoryCode; readonly taxEffect: TaxEffect; readonly amountCzk: Money; readonly businessSharePct: string; readonly businessAmountCzk: Money; }

export const BOOKABLE_CLASSES: readonly DocumentClass[] = ['received_invoice', 'received_receipt', 'received_credit_note', 'received_advance_tax_doc', 'issued_invoice', 'issued_credit_note', 'platform_statement'];
export const LEDGER_ALGO_VERSION = 1;
export function buildTaxLedgerEntries(input: TaxLedgerInput): TaxLedgerEntryDraft[];
```

Implementation sketch: (1) qualify or return `[]`; (2) `active` lines (not text, not covered, position order), throw on null category; weights and bases; `W = Σ weight`; if `W` is zero return `[]`; (3) build the payment list `[{ date, pDoc: Money, pCzk: Money, basis, linkId, txId }]` per §4.11.2 (rule 1 → remainder check → rule 4; rule 2/3 synthetic); FX via `resolveFxRate(currency, date, fxRates, rules.at(date).get('vat.cnb_rate_rule'), rules.at(date).get('fx.max_lookback_days'))`, null → return `[]`; (4) for each payment: `alloc = allocateProRata(pCzk, weights)`; `scaled_l = alloc_l × basis_l / gross_l` as Decimal (gross zero → alloc), `amount_l = round2`; target `round2(pCzk × Σbasis / W)`; residual to the largest |weight| (tie lowest position); (5) sign per class; (6) entries. `taxYear` = `Number.parseInt(entryDate.slice(0, 4), 10)`. Order: payments in input order, then the provisional remainder; within a payment by line position.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/ledgers/tax.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- tax-ledger 2>&1 | tail -30`. Expected: green.

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './ledgers/allocate';`. Append after it: `export * from './ledgers/tax';`. Typecheck and biome (§6).

## 5. Do not touch

`allocate.ts`, `fx.ts`, `point-date.ts`, rules, test files, other packages. Hard rule 1.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- tax-ledger 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Test file green, unchanged (AC-9a, 9g, 9i, 9j, 9k, 9l, AC-11 and the credit-note netting).
- [ ] The only numeric literal in `tax.ts` besides `100` (percent) and `LEDGER_ALGO_VERSION` is `REMAINDER_TOLERANCE = '0.01'` with its TODO.
- [ ] Commits `0308 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0308-report.md`, `Status: review`, commit `0308 report`. Record `[verify]` TA-06 (IO self-assessed VAT as income-tax expense: here VAT is simply cost per §4.11.1) and TA-07 (tourist fee outside totals).

## Spec notes for the reviewer

- `deductionAllowed` is a document-level input (04 §3.2 / M04 §4.10: tax-document status and open checks are per document); the per-line `deduction_pct` is `businessSharePct`.
- A line without a category on a ready document throws instead of silently dropping money.
- A payment in a currency with no ČNB rate makes the whole document return `[]` (consistent with the VAT ledger's `S_FX_MISSING`); M03 `FX_RATE_UNAVAILABLE` already blocks `ready`.
- `lineTaxAmountCzk` (M04 §6.1, for M09's basis) is deferred to the brief that wires the ledgers into the Přehled loader; the kernel here is `basis_l / gross_l`.
- The remainder tolerance should be `validation.tol.sum` once lane B seeds it (TODO in code).

## Risk list (for the reviewer)

`packages/domain/src/ledgers/tax.ts` (whole file: amounts, signs, dates).

## Owner steps

None.
