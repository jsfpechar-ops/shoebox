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
