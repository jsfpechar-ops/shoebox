import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareLegalDates,
  fixedClock,
  InvalidLegalDateError,
  isLegalDate,
  LEGAL_TIME_ZONE,
  type LegalDate,
  parseLegalDate,
  pragueDateOf,
  pragueToday,
} from '../src/index';

const d = (s: string): LegalDate => parseLegalDate(s);

describe('fixedClock', () => {
  it('returns the instant it was built with', () => {
    expect(fixedClock('2026-10-18T22:30:00Z').now()).toBe(Date.UTC(2026, 9, 18, 22, 30));
    expect(fixedClock(0).now()).toBe(0);
  });

  it('rejects an invalid instant', () => {
    expect(() => fixedClock('not a date')).toThrow(RangeError);
    expect(() => fixedClock(Number.NaN)).toThrow(RangeError);
  });
});

describe('pragueToday', () => {
  it('uses Europe/Prague', () => {
    expect(LEGAL_TIME_ZONE).toBe('Europe/Prague');
  });

  it('2026-10-18T22:30Z is already 2026-10-19 in Prague (CEST, UTC+2)', () => {
    expect(pragueToday(fixedClock('2026-10-18T22:30:00Z'))).toBe('2026-10-19');
    expect(pragueToday(fixedClock('2026-10-18T21:59:59Z'))).toBe('2026-10-18');
  });

  it('winter time is UTC+1', () => {
    expect(pragueToday(fixedClock('2026-01-15T22:59:59Z'))).toBe('2026-01-15');
    expect(pragueToday(fixedClock('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
  });

  it('spring change day 2026-03-29 (clocks go forward at 02:00 CET)', () => {
    expect(pragueToday(fixedClock('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
    expect(pragueToday(fixedClock('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(pragueToday(fixedClock('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
    expect(pragueToday(fixedClock('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
  });

  it('autumn change day 2026-10-25 (clocks go back at 03:00 CEST)', () => {
    expect(pragueToday(fixedClock('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
    expect(pragueToday(fixedClock('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(pragueToday(fixedClock('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(pragueToday(fixedClock('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('new year in Prague comes an hour before UTC', () => {
    expect(pragueDateOf(Date.UTC(2026, 11, 31, 23, 0))).toBe('2027-01-01');
    expect(pragueDateOf(Date.UTC(2026, 11, 31, 22, 59, 59))).toBe('2026-12-31');
  });
});

describe('LegalDate parse', () => {
  it('accepts real calendar dates', () => {
    expect(parseLegalDate('2026-10-19')).toBe('2026-10-19');
    expect(parseLegalDate('2024-02-29')).toBe('2024-02-29');
    expect(parseLegalDate('2000-02-29')).toBe('2000-02-29');
    expect(parseLegalDate('0001-01-01')).toBe('0001-01-01');
    expect(parseLegalDate('9999-12-31')).toBe('9999-12-31');
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '0000-01-01',
    '2026-1-01',
    '2026-10-19T00:00',
    ' 2026-10-19',
    '19.10.2026',
    '',
  ])('rejects %j', (value) => {
    expect(isLegalDate(value)).toBe(false);
    expect(() => parseLegalDate(value)).toThrow(InvalidLegalDateError);
  });

  it('names the bad value in the error', () => {
    expect(() => parseLegalDate('2026-02-30')).toThrow('Not a legal date (YYYY-MM-DD): 2026-02-30');
  });
});

describe('LegalDate compare', () => {
  it('orders dates', () => {
    expect(compareLegalDates(d('2026-10-18'), d('2026-10-19'))).toBe(-1);
    expect(compareLegalDates(d('2026-10-19'), d('2026-10-19'))).toBe(0);
    expect(compareLegalDates(d('2027-01-01'), d('2026-12-31'))).toBe(1);
  });

  it('sorts an array chronologically', () => {
    const dates = ['2026-12-31', '2025-01-01', '2026-02-28'].map(d);
    expect([...dates].sort(compareLegalDates)).toEqual(['2025-01-01', '2026-02-28', '2026-12-31']);
  });
});

describe('LegalDate addDays', () => {
  it('moves within and across months and years', () => {
    expect(addDays(d('2026-10-18'), 0)).toBe('2026-10-18');
    expect(addDays(d('2026-10-18'), 1)).toBe('2026-10-19');
    expect(addDays(d('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addDays(d('2026-10-25'), 7)).toBe('2026-11-01');
  });

  it('handles leap years', () => {
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(d('2000-02-28'), 1)).toBe('2000-02-29');
    expect(addDays(d('2100-02-28'), 1)).toBe('2100-03-01');
    expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29');
  });

  it('handles long spans', () => {
    expect(addDays(d('2026-01-01'), 365)).toBe('2027-01-01');
    expect(addDays(d('2024-01-01'), 366)).toBe('2025-01-01');
    expect(addDays(d('1970-01-01'), 20_744)).toBe('2026-10-18');
    expect(addDays(d('2026-10-18'), -20_744)).toBe('1970-01-01');
  });

  it('agrees with Date.UTC for every day of 2023-2028', () => {
    let date = d('2023-01-01');
    for (let i = 1; i <= 6 * 366; i++) {
      date = addDays(date, 1);
      const utc = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
      expect(date).toBe(utc);
    }
  });

  it('rejects non-integer days and results outside 0001-9999', () => {
    expect(() => addDays(d('2026-10-18'), 1.5)).toThrow(RangeError);
    expect(() => addDays(d('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addDays(d('0001-01-01'), -1)).toThrow(RangeError);
  });
});
