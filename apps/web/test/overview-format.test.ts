import { Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { formatCzkWhole, formatDue, meterText, periodLabel } from '../src/overview/format';

const d = parseLegalDate;
const asOf = d('2026-10-25');
const czk = (s: string) => Money.parse(s, 'CZK');
const plain = (s: string) => s.replace(/ | /g, ' ');

describe('overview formatting', () => {
  it('whole crowns, Czech grouping', () => {
    expect(plain(formatCzkWhole(czk('1640000.40')))).toBe('1 640 000 Kč');
    expect(plain(formatCzkWhole(czk('0')))).toBe('0 Kč');
  });

  it('due dates with relative words up to 14 days, the year only when it differs', () => {
    expect(formatDue(d('2026-10-25'), asOf)).toBe('25. 10. (today)');
    expect(formatDue(d('2026-10-26'), asOf)).toBe('26. 10. (tomorrow)');
    expect(formatDue(d('2026-10-27'), asOf)).toBe('27. 10. (in 2 days)');
    expect(formatDue(d('2026-10-30'), asOf)).toBe('30. 10. (in 5 days)');
    expect(formatDue(d('2026-11-08'), asOf)).toBe('8. 11. (in 14 days)');
    expect(formatDue(d('2026-11-09'), asOf)).toBe('9. 11.');
    expect(formatDue(d('2027-01-08'), asOf)).toBe('8. 1. 2027');
  });

  it('period labels for a month, a quarter and a year', () => {
    expect(periodLabel({ periodStart: d('2026-09-01'), periodEnd: d('2026-09-30') })).toBe(
      'for 9/2026',
    );
    expect(periodLabel({ periodStart: d('2026-07-01'), periodEnd: d('2026-09-30') })).toBe(
      'for Q3 2026',
    );
    expect(periodLabel({ periodStart: d('2025-01-01'), periodEnd: d('2025-12-31') })).toBe(
      'for 2025',
    );
  });

  it('meter text prints the amount, the limit and the percent', () => {
    expect(plain(meterText({ current: czk('1640000'), limit: czk('2000000'), percent: 82 }))).toBe(
      '1 640 000 Kč of 2 000 000 Kč · 82 %',
    );
  });
});
