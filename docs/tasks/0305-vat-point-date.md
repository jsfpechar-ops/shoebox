# 0305: VAT point date (`computeVatPointDate`, `deriveVatPointDate`) and VAT period (`periodFor`)

Status: done
Ticket: P1-CAT-02 (b) | Depends on: 0302 | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Date every VAT-relevant line to the right return period: issued by DUZP, payer deductions by `max(duzp, received)`, foreign services by the org's policy (issue date or service-period end, with the prepayment and 62-day guards), EU goods by the 15th-of-next-month rule. The Booking golden case must land in August with `issue_date` and in July with `service_period_end`; a wrong month is a wrong return.

## 2. Context

Hard rule 1: `vat.deduction_deferral_years` (2) and `classification.max_service_period_days_for_end` (62) come from the rules. 22 D-05 default: `service_period_end` when a period is printed, else `issue_date`; per-org override; the P4 golden fixture pins `issue_date`. Leave `// TODO(decision-05)` next to the policy switch.

M05 §4.1 kernel `computeVatPointDate(doc, treatment, profile)` (pasted):

| Treatment | `vat_point_date` | rule name |
|---|---|---|
| `iss_*` (every issued treatment incl. `iss_no_vat`) | `duzp ?? issue_date` | `duzp` |
| `rcv_domestic_vat` on a `received_receipt` or a `simplified_tax_document` | `duzp ?? issue_date` | `duzp` |
| `rcv_domestic_vat` otherwise | `max(duzp ?? issue_date, received_date ?? issue_date)` | `max_duzp_received` |
| `rcv_eu_service_reverse_charge`, `rcv_non_eu_service_reverse_charge` | policy `issue_date` → `issue_date` (`issue_date`); policy `service_period_end` → `service_period_to` if not null (`service_period_end`) else `issue_date` (`issue_date`) | |
| `rcv_eu_goods_acquisition` | `min(issue_date, 15th of the month after (duzp ?? issue_date))` | `eu_goods_15th` |
| `rcv_domestic_reverse_charge` | `duzp ?? issue_date` | `duzp` |
| others (`rcv_domestic_no_vat`, `rcv_foreign_vat_charged`, `rcv_out_of_scope`, `rcv_import_customs`) | null | |

Missing `issue_date` (and no `duzp`) → null (M03 `S_DATE_MISSING` is lane B's).

M04 §4.8 wrapper `deriveVatPointDate(doc, treatments, profileAt, payments, rules)`:

- `P = profileAt(duzp ?? issue_date)`; the rules at that date.
- `rcv_domestic_vat`: a user override `doc.userVatPointDate` is used (rule `user_override`) only if `≥ max(duzp ?? issue, received ?? issue)` and `≤ 31.12.(year(duzp ?? issue) + vat.deduction_deferral_years)`; otherwise the kernel.
- Foreign services with policy `service_period_end`: the service period counts only if `span = days(service_period_to − service_period_from) + 1 ≤ max_service_period_days_for_end` (62); a longer or half-missing period → `issue_date` (rule `issue_date`). `prepaid` = the earliest of `doc.paidAt` and every `payments[].bookedOn` that is `< sp`; result `min(sp, prepaid)` with rule `prepayment` when the prepayment is earlier, else `service_period_end`. Policy `issue_date` ignores prepayments.
- Several treatments: precedence self-assessed (`rcv_eu_service_reverse_charge`, `rcv_non_eu_service_reverse_charge`, `rcv_eu_goods_acquisition`, `rcv_domestic_reverse_charge`) > domestic (`rcv_domestic_vat`) > issued; within the same class the earliest date. Treatments with no date are ignored; none → null.

Period (`periodFor(date, profile)`): `identifikovana_osoba` → calendar month; `platce` → month if `vatPeriod='monthly'`, calendar quarter if `quarterly`; `neplatce` → null. `resolveVatPeriod(profile, date)` is the M05-named alias.

Existing API: `LegalDate`, `parseLegalDate`, `addDays`, `compareLegalDates` in `packages/domain/src/dates/index.ts` (no month helper: build dates from parts with `Number.parseInt(part, 10)` and `String(n).padStart(2, '0')`; the lint bans `Number()` and `new Date()`). Days between two dates: `addDays` cannot subtract, so compute an epoch-day with the same formula as `dates/index.ts` (copy the `toEpochDay` arithmetic locally, or count by comparing `addDays(from, span - 1) === to` for spans up to the limit).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/domain/test/vat-point-date.test.ts` | create | verbatim below |
| `packages/domain/src/vat/point-date.ts` | create | the functions |
| `packages/domain/src/index.ts` | edit | export |

## 4. Steps

1. Create `packages/domain/test/vat-point-date.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { createCzRules } from '../src/rules/index';
import {
  computeVatPointDate,
  deriveVatPointDate,
  fifteenthOfNextMonth,
  periodFor,
  resolveVatPeriod,
  type VatPointDocument,
  type VatProfileSlice,
} from '../src/vat/point-date';

const rules = createCzRules();
const d = parseLegalDate;
const IO: VatProfileSlice = { vatStatus: 'identifikovana_osoba', vatPeriod: null, foreignServiceDppdPolicy: 'issue_date' };
const IO_SPE: VatProfileSlice = { ...IO, foreignServiceDppdPolicy: 'service_period_end' };
const PAYER_Q: VatProfileSlice = { vatStatus: 'platce', vatPeriod: 'quarterly', foreignServiceDppdPolicy: 'service_period_end' };
const PAYER_M: VatProfileSlice = { ...PAYER_Q, vatPeriod: 'monthly' };
const NONPAYER: VatProfileSlice = { vatStatus: 'neplatce', vatPeriod: null, foreignServiceDppdPolicy: 'service_period_end' };

/** Booking July invoice (AC-9c): issued 3 Aug 2026 for 1–31 July. */
function booking(over: Partial<VatPointDocument> = {}): VatPointDocument {
  return {
    class: 'received_invoice', direction: 'in', taxDocStatus: 'full_tax_document',
    issueDate: d('2026-08-03'), duzp: null, receivedDate: null,
    servicePeriodFrom: d('2026-07-01'), servicePeriodTo: d('2026-07-31'),
    paidAt: null, userVatPointDate: null, ...over,
  };
}
const at = (profile: VatProfileSlice) => () => profile;

describe('computeVatPointDate (M05 §4.1)', () => {
  it('foreign services: policy issue_date → August, service_period_end → July (AC-9c)', () => {
    expect(computeVatPointDate(booking(), 'rcv_eu_service_reverse_charge', IO)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
    expect(computeVatPointDate(booking(), 'rcv_eu_service_reverse_charge', IO_SPE)).toEqual({ date: '2026-07-31', rule: 'service_period_end' });
    expect(computeVatPointDate(booking({ servicePeriodTo: null }), 'rcv_non_eu_service_reverse_charge', IO_SPE)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
    expect(computeVatPointDate(booking({ issueDate: d('2026-10-03') }), 'rcv_non_eu_service_reverse_charge', IO)).toEqual({ date: '2026-10-03', rule: 'issue_date' });
  });

  it('issued: duzp, else issue date', () => {
    const inv = booking({ class: 'issued_invoice', direction: 'out', duzp: d('2026-05-31'), issueDate: d('2026-06-02') });
    expect(computeVatPointDate(inv, 'iss_domestic_vat', PAYER_M)).toEqual({ date: '2026-05-31', rule: 'duzp' });
    expect(computeVatPointDate({ ...inv, duzp: null }, 'iss_eu_service', PAYER_M)).toEqual({ date: '2026-06-02', rule: 'duzp' });
    expect(computeVatPointDate(inv, 'iss_no_vat', IO)).toEqual({ date: '2026-05-31', rule: 'duzp' });
  });

  it('payer deduction on a domestic invoice: max(duzp, received)', () => {
    const inv = booking({ duzp: d('2026-08-31'), receivedDate: d('2026-09-02') });
    expect(computeVatPointDate(inv, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-09-02', rule: 'max_duzp_received' });
    expect(computeVatPointDate({ ...inv, receivedDate: null }, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-08-31', rule: 'max_duzp_received' });
    expect(computeVatPointDate({ ...inv, duzp: null, receivedDate: null }, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-08-03', rule: 'max_duzp_received' });
    expect(computeVatPointDate({ ...inv, receivedDate: d('2026-08-20') }, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-08-31', rule: 'max_duzp_received' });
  });

  it('receipts and simplified documents: duzp (issue = DUZP)', () => {
    const receipt = booking({ class: 'received_receipt', taxDocStatus: 'simplified_tax_document', issueDate: d('2026-05-12'), receivedDate: d('2026-05-20') });
    expect(computeVatPointDate(receipt, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-05-12', rule: 'duzp' });
    const simplified = booking({ taxDocStatus: 'simplified_tax_document', duzp: d('2026-05-12'), receivedDate: d('2026-05-20') });
    expect(computeVatPointDate(simplified, 'rcv_domestic_vat', PAYER_M)).toEqual({ date: '2026-05-12', rule: 'duzp' });
  });

  it('EU goods: the 15th of the month after DUZP, or the invoice date if earlier', () => {
    expect(fifteenthOfNextMonth(d('2026-07-20'))).toBe('2026-08-15');
    expect(fifteenthOfNextMonth(d('2026-12-02'))).toBe('2027-01-15');
    const goods = booking({ duzp: d('2026-07-20'), issueDate: d('2026-07-25') });
    expect(computeVatPointDate(goods, 'rcv_eu_goods_acquisition', PAYER_M)).toEqual({ date: '2026-07-25', rule: 'eu_goods_15th' });
    expect(computeVatPointDate({ ...goods, issueDate: d('2026-09-01') }, 'rcv_eu_goods_acquisition', PAYER_M)).toEqual({ date: '2026-08-15', rule: 'eu_goods_15th' });
    expect(computeVatPointDate({ ...goods, duzp: null }, 'rcv_eu_goods_acquisition', PAYER_M)).toEqual({ date: '2026-07-25', rule: 'eu_goods_15th' });
  });

  it('domestic reverse charge: duzp; no-entry treatments: null; missing dates: null', () => {
    expect(computeVatPointDate(booking({ duzp: d('2026-08-10') }), 'rcv_domestic_reverse_charge', PAYER_M)).toEqual({ date: '2026-08-10', rule: 'duzp' });
    for (const t of ['rcv_domestic_no_vat', 'rcv_foreign_vat_charged', 'rcv_out_of_scope', 'rcv_import_customs'] as const) {
      expect(computeVatPointDate(booking(), t, PAYER_M)).toBeNull();
    }
    expect(computeVatPointDate(booking({ issueDate: null }), 'rcv_eu_service_reverse_charge', IO)).toBeNull();
    expect(computeVatPointDate(booking({ issueDate: null, duzp: null }), 'iss_domestic_vat', PAYER_M)).toBeNull();
  });
});

describe('deriveVatPointDate (M04 §4.8)', () => {
  it('Booking: August under issue_date, July under service_period_end', () => {
    expect(deriveVatPointDate(booking(), ['rcv_eu_service_reverse_charge'], at(IO), [], rules)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
    expect(deriveVatPointDate(booking(), ['rcv_eu_service_reverse_charge'], at(IO_SPE), [], rules)).toEqual({ date: '2026-07-31', rule: 'service_period_end' });
  });

  it('a service period longer than 62 days falls back to the issue date (annual domain renewal)', () => {
    const year = booking({ issueDate: d('2025-12-20'), servicePeriodFrom: d('2026-01-01'), servicePeriodTo: d('2026-12-31') });
    expect(deriveVatPointDate(year, ['rcv_non_eu_service_reverse_charge'], at(IO_SPE), [], rules)).toEqual({ date: '2025-12-20', rule: 'issue_date' });
    const ok62 = booking({ issueDate: d('2026-09-03'), servicePeriodFrom: d('2026-07-01'), servicePeriodTo: d('2026-08-31') });
    expect(deriveVatPointDate(ok62, ['rcv_eu_service_reverse_charge'], at(IO_SPE), [], rules)?.date).toBe('2026-08-31');
    const over63 = booking({ issueDate: d('2026-09-03'), servicePeriodFrom: d('2026-07-01'), servicePeriodTo: d('2026-09-01') });
    expect(deriveVatPointDate(over63, ['rcv_eu_service_reverse_charge'], at(IO_SPE), [], rules)).toEqual({ date: '2026-09-03', rule: 'issue_date' });
    const half = booking({ servicePeriodFrom: null });
    expect(deriveVatPointDate(half, ['rcv_eu_service_reverse_charge'], at(IO_SPE), [], rules)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
  });

  it('a prepayment before the period end dates the service to the payment', () => {
    expect(deriveVatPointDate(booking({ paidAt: d('2026-07-10') }), ['rcv_eu_service_reverse_charge'], at(IO_SPE), [], rules)).toEqual({ date: '2026-07-10', rule: 'prepayment' });
    expect(deriveVatPointDate(booking({ paidAt: d('2026-07-10') }), ['rcv_eu_service_reverse_charge'], at(IO_SPE), [{ bookedOn: d('2026-07-05') }], rules)).toEqual({ date: '2026-07-05', rule: 'prepayment' });
    expect(deriveVatPointDate(booking(), ['rcv_eu_service_reverse_charge'], at(IO_SPE), [{ bookedOn: d('2026-08-10') }], rules)).toEqual({ date: '2026-07-31', rule: 'service_period_end' });
    expect(deriveVatPointDate(booking({ paidAt: d('2026-07-10') }), ['rcv_eu_service_reverse_charge'], at(IO), [], rules)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
  });

  it('payer user override within the window, else the kernel', () => {
    const inv = booking({ duzp: d('2026-08-31'), receivedDate: d('2026-09-02') });
    const payer = at(PAYER_M);
    expect(deriveVatPointDate({ ...inv, userVatPointDate: d('2026-10-15') }, ['rcv_domestic_vat'], payer, [], rules)).toEqual({ date: '2026-10-15', rule: 'user_override' });
    expect(deriveVatPointDate({ ...inv, userVatPointDate: d('2028-12-31') }, ['rcv_domestic_vat'], payer, [], rules)).toEqual({ date: '2028-12-31', rule: 'user_override' });
    expect(deriveVatPointDate({ ...inv, userVatPointDate: d('2029-01-01') }, ['rcv_domestic_vat'], payer, [], rules)).toEqual({ date: '2026-09-02', rule: 'max_duzp_received' });
    expect(deriveVatPointDate({ ...inv, userVatPointDate: d('2026-09-01') }, ['rcv_domestic_vat'], payer, [], rules)).toEqual({ date: '2026-09-02', rule: 'max_duzp_received' });
    expect(deriveVatPointDate(inv, ['rcv_domestic_vat'], payer, [], rules)).toEqual({ date: '2026-09-02', rule: 'max_duzp_received' });
  });

  it('mixed treatments: self-assessed before domestic; no-entry treatments ignored; none → null', () => {
    const mixed = booking({ duzp: d('2026-08-31'), receivedDate: d('2026-09-02') });
    expect(deriveVatPointDate(mixed, ['rcv_domestic_vat', 'rcv_eu_service_reverse_charge'], at(PAYER_M), [], rules)).toEqual({ date: '2026-07-31', rule: 'service_period_end' });
    expect(deriveVatPointDate(mixed, ['rcv_domestic_vat', 'rcv_eu_service_reverse_charge'], at(IO), [], rules)).toEqual({ date: '2026-08-03', rule: 'issue_date' });
    expect(deriveVatPointDate(mixed, ['rcv_domestic_no_vat', 'rcv_domestic_vat'], at(PAYER_M), [], rules)).toEqual({ date: '2026-09-02', rule: 'max_duzp_received' });
    expect(deriveVatPointDate(mixed, ['rcv_domestic_no_vat', 'rcv_out_of_scope'], at(PAYER_M), [], rules)).toBeNull();
    expect(deriveVatPointDate(mixed, [], at(PAYER_M), [], rules)).toBeNull();
  });

  it('asks the profile at duzp ?? issue_date', () => {
    const seen: string[] = [];
    const spy = (date: string) => { seen.push(date); return IO; };
    deriveVatPointDate(booking({ duzp: d('2026-07-31') }), ['rcv_eu_service_reverse_charge'], spy, [], rules);
    deriveVatPointDate(booking(), ['rcv_eu_service_reverse_charge'], spy, [], rules);
    expect(seen).toEqual(['2026-07-31', '2026-08-03']);
  });
});

describe('periodFor / resolveVatPeriod', () => {
  it('IO: month; payer monthly: month; payer quarterly: quarter; neplatce: null', () => {
    expect(periodFor(d('2026-08-03'), IO)).toEqual({ start: '2026-08-01', end: '2026-08-31', kind: 'month' });
    expect(periodFor(d('2026-07-31'), IO_SPE)).toEqual({ start: '2026-07-01', end: '2026-07-31', kind: 'month' });
    expect(periodFor(d('2026-02-10'), PAYER_M)).toEqual({ start: '2026-02-01', end: '2026-02-28', kind: 'month' });
    expect(periodFor(d('2028-02-10'), PAYER_M)).toEqual({ start: '2028-02-01', end: '2028-02-29', kind: 'month' });
    expect(periodFor(d('2026-08-03'), PAYER_Q)).toEqual({ start: '2026-07-01', end: '2026-09-30', kind: 'quarter' });
    expect(periodFor(d('2026-12-15'), PAYER_Q)).toEqual({ start: '2026-10-01', end: '2026-12-31', kind: 'quarter' });
    expect(periodFor(d('2026-01-01'), PAYER_Q)).toEqual({ start: '2026-01-01', end: '2026-03-31', kind: 'quarter' });
    expect(periodFor(d('2026-08-03'), NONPAYER)).toBeNull();
    expect(resolveVatPeriod(PAYER_Q, d('2026-08-03'))).toEqual(periodFor(d('2026-08-03'), PAYER_Q));
  });
});
```

Command: `pnpm --filter @shoebox/domain test -- vat-point-date 2>&1 | tail -30`. Expected: fails (module missing).

2. Create `packages/domain/src/vat/point-date.ts`. Exported names and signatures exactly:

```ts
import { addDays, compareLegalDates, type LegalDate } from '../dates/index';
import type { Direction, DocumentClass, TaxDocStatus, VatPeriod, VatStatus, VatTreatment } from '../enums/index';
import type { RULE_SCHEMAS } from '../rules/keys';
import type { RuleResolver } from '../rules/resolver';

export type VatPointRule = 'duzp' | 'max_duzp_received' | 'issue_date' | 'service_period_end' | 'prepayment' | 'eu_goods_15th' | 'user_override';
export type ForeignServiceDppdPolicy = 'issue_date' | 'service_period_end';
export interface VatProfileSlice { readonly vatStatus: VatStatus; readonly vatPeriod: VatPeriod | null; readonly foreignServiceDppdPolicy: ForeignServiceDppdPolicy; }
export interface VatPointDocument { readonly class: DocumentClass; readonly direction: Direction; readonly taxDocStatus: TaxDocStatus; readonly issueDate: LegalDate | null; readonly duzp: LegalDate | null; readonly receivedDate: LegalDate | null; readonly servicePeriodFrom: LegalDate | null; readonly servicePeriodTo: LegalDate | null; readonly paidAt: LegalDate | null; readonly userVatPointDate: LegalDate | null; }
export interface PaymentEvidenceDate { readonly bookedOn: LegalDate; }
export interface VatPointResult { readonly date: LegalDate; readonly rule: VatPointRule; }
export interface VatPeriodRange { readonly start: LegalDate; readonly end: LegalDate; readonly kind: 'month' | 'quarter'; }
export type ProfileAt = (date: LegalDate) => VatProfileSlice;

export const SELF_ASSESSED_POINT_TREATMENTS: readonly VatTreatment[] = ['rcv_eu_service_reverse_charge', 'rcv_non_eu_service_reverse_charge', 'rcv_eu_goods_acquisition', 'rcv_domestic_reverse_charge'];
export function fifteenthOfNextMonth(date: LegalDate): LegalDate;
export function computeVatPointDate(doc: VatPointDocument, treatment: VatTreatment, profile: VatProfileSlice): VatPointResult | null;
export function deriveVatPointDate(doc: VatPointDocument, treatments: readonly VatTreatment[], profileAt: ProfileAt, payments: readonly PaymentEvidenceDate[], rules: RuleResolver<typeof RULE_SCHEMAS>): VatPointResult | null;
export function periodFor(date: LegalDate, profile: VatProfileSlice): VatPeriodRange | null;
export function resolveVatPeriod(profile: VatProfileSlice, date: LegalDate): VatPeriodRange | null;
```

Hints: call `profileAt` exactly once per `deriveVatPointDate` call (the test counts calls). Month arithmetic from the `YYYY-MM-DD` parts (`Number.parseInt(s, 10)`), month end = `addDays(firstOfNextMonth, -1)`. The span in days: `let span = 1; let cursor = from; while (cursor < to && span <= limit) { cursor = addDays(cursor, 1); span += 1; }` is enough (the limit is 62). Mark the policy switch `// TODO(decision-05)`.

Implement until the tests pass; `pnpm exec biome check --write packages/domain/src/vat/point-date.ts 2>&1 | tail -5`.

Command: `pnpm --filter @shoebox/domain test -- vat-point-date 2>&1 | tail -30`. Expected: green.

3. Edit `packages/domain/src/index.ts`. Anchor: `export * from './taxonomy/categories';`. Append after it: `export * from './vat/point-date';`. Typecheck and biome (§6).

## 5. Do not touch

Rules, dates module, test files, other packages. Hard rules 1, 10.

## 6. Commands

- `pnpm --filter @shoebox/domain test -- vat-point-date 2>&1 | tail -30`
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/domain 2>&1 | tail -10`

## 7. Acceptance

- [ ] Test file green, unchanged (Booking Aug/Jul, 62-day guard, prepayment, override window, 15th rule, periods).
- [ ] `62` and `2` do not appear as literals in `point-date.ts` (they come from the rules).
- [ ] Commits `0305 step 1..3`; no push.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0305-report.md`, `Status: review`, commit `0305 report`. Record `[verify]` M04 §4.8 "long prepaid periods fall back to issue/payment date" (advisor) and M05 §4.1 "SH always monthly".

## Spec notes for the reviewer

- M05 §4.1 (no 62-day cap, no prepayment) and M04 §4.8 (both) differ; the backlog says M05 is the kernel and M04 wraps it, so `computeVatPointDate` is M05's table and `deriveVatPointDate` adds the M04 guards. The VAT ledger (0311) calls the wrapper.
- M05 says `iss_* → duzp`; M04 says `duzp ?? issue_date`. The safer reading (a date rather than a dropped entry) is `duzp ?? issue_date`.
- The user override is applied only for `rcv_domestic_vat` (payer deferral, 04 §3.3); other treatments ignore `userVatPointDate`.

## Risk list (for the reviewer)

`packages/domain/src/vat/point-date.ts` (whole file).

## Owner steps

None.
