import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import { Money } from '../src/money/index';
import { createCzRules } from '../src/rules/index';
import { type VatPeriodSummary, vatObligationsFor } from '../src/vat/obligations';
import { monthAfter, periodEndOf, vatDueDate } from '../src/vat/period';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, 'CZK');
const month = (start: string, over: Partial<VatPeriodSummary> = {}): VatPeriodSummary => ({
  start: d(start),
  end: periodEndOf(d(start), 'month'),
  kind: 'month',
  hasReturnRows: true,
  row64: null,
  row65: null,
  shMonths: [],
  ...over,
});

describe('vatDueDate (M05 §4.12, §9 #14)', () => {
  it('helpers', () => {
    expect(monthAfter(d('2026-12-31'))).toBe('2027-01-01');
    expect(periodEndOf(d('2026-07-01'), 'quarter')).toBe('2026-09-30');
    expect(periodEndOf(d('2026-02-01'), 'month')).toBe('2026-02-28');
  });
  it('Q3 2026: 25 Oct is a Sunday → 26. 10. 2026', () => {
    expect(vatDueDate(d('2026-09-30'), rules)).toEqual({ legal: '2026-10-25', due: '2026-10-26' });
  });
  it('December 2026 → 25. 1. 2027 (Monday, no shift)', () => {
    expect(vatDueDate(d('2026-12-31'), rules)).toEqual({ legal: '2027-01-25', due: '2027-01-25' });
  });
  it('November 2026 → 25 Dec holiday, weekend → 28. 12. 2026', () => {
    expect(vatDueDate(d('2026-11-30'), rules)).toEqual({ legal: '2026-12-25', due: '2026-12-28' });
  });
});

describe('vatObligationsFor', () => {
  it('IO: vat_return only for months with rows 3–13; amount = ř.64', () => {
    const out = vatObligationsFor(
      {
        status: 'identifikovana_osoba',
        today: d('2026-09-01'),
        filings: [],
        payments: [],
        periods: [
          month('2026-08-01', { row64: czk('2877.00'), row65: czk('0.00') }),
          month('2026-07-01', { hasReturnRows: false }),
        ],
      },
      rules,
    );
    expect(
      out.map((o) => ({ ...o, amountEstimate: o.amountEstimate?.toFixed2() ?? null })),
    ).toEqual([
      {
        kind: 'vat_return',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        legalDueDate: '2026-09-25',
        dueDate: '2026-09-25',
        amountEstimate: '2877.00',
        state: 'open',
        doneSource: null,
        sourceRule: 'm05.vat_obligations.v1',
      },
    ]);
  });
  it('payer: vat_return + kh every period, sh per month, vat_payment once generated; overdue after due', () => {
    const q3: VatPeriodSummary = {
      start: d('2026-07-01'),
      end: d('2026-09-30'),
      kind: 'quarter',
      hasReturnRows: true,
      row64: czk('5196.00'),
      row65: czk('0.00'),
      shMonths: [
        { monthStart: d('2026-08-01'), monthEnd: d('2026-08-31'), plnHodnotaSum: czk('3001.00') },
      ],
    };
    const out = vatObligationsFor(
      {
        status: 'platce',
        today: d('2026-10-27'),
        payments: [],
        filings: [
          { type: 'DPHDP3', kind: 'radne', periodStart: d('2026-07-01'), state: 'generated' },
        ],
        periods: [q3],
      },
      rules,
    );
    expect(
      out.map((o) => [o.kind, o.dueDate, o.state, o.amountEstimate?.toFixed2() ?? null]),
    ).toEqual([
      ['sh', '2026-09-25', 'overdue', '3001.00'],
      ['vat_return', '2026-10-26', 'overdue', '5196.00'],
      ['kh', '2026-10-26', 'overdue', null],
      ['vat_payment', '2026-10-26', 'overdue', '5196.00'],
    ]);
    expect(out.find((o) => o.kind === 'sh')?.periodStart).toBe('2026-08-01');
  });
  it('done by filing and by payment; credit (ř.65) is a negative estimate; no vat_payment without a generated filing', () => {
    const out = vatObligationsFor(
      {
        status: 'platce',
        today: d('2026-11-30'),
        filings: [
          { type: 'DPHDP3', kind: 'radne', periodStart: d('2026-09-01'), state: 'marked_filed' },
          { type: 'DPHKH1', kind: 'radne', periodStart: d('2026-09-01'), state: 'marked_filed' },
          { type: 'DPHDP3', kind: 'radne', periodStart: d('2026-10-01'), state: 'draft' },
        ],
        payments: [
          { bookedOn: d('2026-10-20'), amount: czk('3000.00') },
          { bookedOn: d('2026-11-24'), amount: czk('2196.00') },
          { bookedOn: d('2026-11-25'), amount: czk('1.00') },
        ],
        periods: [
          month('2026-09-01', { row64: czk('5196.00'), row65: czk('0.00') }),
          month('2026-10-01', { row64: czk('0.00'), row65: czk('120.00') }),
        ],
      },
      rules,
    );
    const by = (k: string, p: string) => out.find((o) => o.kind === k && o.periodStart === p);
    expect(by('vat_return', '2026-09-01')).toMatchObject({ state: 'done', doneSource: 'filing' });
    expect(by('kh', '2026-09-01')).toMatchObject({ state: 'done', doneSource: 'filing' });
    expect(by('vat_payment', '2026-09-01')).toMatchObject({
      state: 'done',
      doneSource: 'bank_payment',
    }); // 3000 + 2196 within (30 Sep, 26 Oct + 30 d = 25 Nov]
    expect(by('vat_return', '2026-10-01')?.state).toBe('overdue');
    expect(by('vat_return', '2026-10-01')?.amountEstimate?.toFixed2()).toBe('-120.00');
    expect(by('vat_payment', '2026-10-01')).toBeUndefined();
  });
  it('payment window excludes the day after due+30', () => {
    const out = vatObligationsFor(
      {
        status: 'platce',
        today: d('2026-10-01'),
        filings: [
          { type: 'DPHDP3', kind: 'radne', periodStart: d('2026-09-01'), state: 'downloaded' },
        ],
        payments: [{ bookedOn: d('2026-11-26'), amount: czk('5196.00') }],
        periods: [month('2026-09-01', { row64: czk('5196.00'), row65: czk('0.00') })],
      },
      rules,
    );
    expect(out.find((o) => o.kind === 'vat_payment')).toMatchObject({
      state: 'open',
      doneSource: null,
    });
  });
});
