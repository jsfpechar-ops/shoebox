import { describe, expect, it } from 'vitest';
import { parseLegalDate } from '../src/dates/index';
import {
  czHolidays,
  type DeadlineProfile,
  isCzWorkingDay,
  shiftDate,
  upcomingDeadlines,
} from '../src/overview/deadlines';
import { createCzRules } from '../src/rules/index';

const rules = createCzRules();
const d = parseLegalDate;

function profile(over: Partial<DeadlineProfile> = {}): DeadlineProfile {
  return {
    vatStatus: 'neplatce',
    vatPeriod: null,
    taxRegime: 'danova_evidence',
    pausalDanBand: null,
    insuranceSelfPaid: false,
    ...over,
  };
}

const brief = (list: ReturnType<typeof upcomingDeadlines>) =>
  list.map((x) => `${x.kind} ${x.periodStart} ${x.due}`);

describe('holidays and working days', () => {
  it('reads fixed and movable holidays from the rules', () => {
    const y2026 = czHolidays(2026, rules);
    expect(y2026.movableMissing).toBe(false);
    expect(y2026.dates.has('2026-04-03')).toBe(true);
    expect(y2026.dates.has('2026-10-28')).toBe(true);
    const y2031 = czHolidays(2031, rules);
    expect(y2031.movableMissing).toBe(true);
    expect(y2031.dates.has('2031-12-24')).toBe(true);
  });

  it('weekends and holidays are not working days', () => {
    expect(isCzWorkingDay(d('2026-10-27'), rules)).toBe(true);
    expect(isCzWorkingDay(d('2026-10-28'), rules)).toBe(false);
    expect(isCzWorkingDay(d('2026-04-06'), rules)).toBe(false);
    expect(isCzWorkingDay(d('2026-10-31'), rules)).toBe(false);
  });

  it('shifts forward, backward or not at all', () => {
    expect(shiftDate(d('2026-05-01'), 'next_working_day', rules)).toBe('2026-05-04');
    expect(shiftDate(d('2026-12-26'), 'next_working_day', rules)).toBe('2026-12-28');
    expect(shiftDate(d('2026-11-17'), 'previous_working_day', rules)).toBe('2026-11-16');
    expect(shiftDate(d('2026-10-31'), 'none', rules)).toBe('2026-10-31');
  });
});

describe('upcomingDeadlines', () => {
  it('monthly VAT payer with own insurance: next 60 days, sorted, shifted', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'platce', vatPeriod: 'monthly', insuranceSelfPaid: true }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual([
      'vat_return 2026-09-01 2026-10-26',
      'kh 2026-09-01 2026-10-26',
      'social_advance 2026-10-01 2026-10-30',
      'health_advance 2026-10-01 2026-11-06',
      'vat_return 2026-10-01 2026-11-25',
      'kh 2026-10-01 2026-11-25',
      'social_advance 2026-11-01 2026-11-30',
      'health_advance 2026-11-01 2026-12-08',
    ]);
    const first = list[0];
    expect(first?.periodEnd).toBe('2026-09-30');
    expect(first?.legalDue).toBe('2026-10-25');
    expect(first?.amount).toBeNull();
    const social = list[2];
    expect(social?.legalDue).toBe('2026-10-31');
    expect(social?.amount?.toFixed2()).toBe('5005.00');
    expect(social?.amountIsMinimum).toBe(true);
    expect(list[3]?.amount?.toFixed2()).toBe('3306.00');
    expect(list.every((x) => !x.holidaysMissing)).toBe(true);
  });

  it('quarterly VAT payer without own insurance: the quarter return only', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'platce', vatPeriod: 'quarterly' }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual(['vat_return 2026-07-01 2026-10-26', 'kh 2026-07-01 2026-10-26']);
    expect(list[0]?.periodEnd).toBe('2026-09-30');
  });

  it('paušální daň: the monthly advance of the band', () => {
    const list = upcomingDeadlines(
      profile({ taxRegime: 'pausalni_dan', pausalDanBand: 2, insuranceSelfPaid: true }),
      d('2026-10-25'),
      rules,
    );
    expect(brief(list)).toEqual([
      'pausalni_dan_advance 2026-11-01 2026-11-20',
      'pausalni_dan_advance 2026-12-01 2026-12-21',
    ]);
    expect(list[0]?.amount?.toFixed2()).toBe('16745.00');
    expect(list[0]?.amountIsMinimum).toBe(false);
  });

  it('income tax return: 1 May moves over the holiday and the weekend', () => {
    const list = upcomingDeadlines(profile(), d('2026-03-15'), rules);
    expect(brief(list)).toEqual(['dap 2025-01-01 2026-05-04']);
    expect(list[0]?.periodEnd).toBe('2025-12-31');
    expect(list[0]?.legalDue).toBe('2026-05-01');
  });

  it('an identified person gets no VAT return yet', () => {
    const list = upcomingDeadlines(
      profile({ vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly' }),
      d('2026-10-25'),
      rules,
    );
    expect(list).toEqual([]);
  });
});
