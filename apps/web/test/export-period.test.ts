import type { LegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  defaultPeriodKey,
  exportEntryName,
  parsePeriod,
  periodChoices,
  periodOptions,
} from '../src/documents/export-period';

const today = '2026-10-26' as LegalDate;

describe('parsePeriod', () => {
  it('reads a month, a quarter and a year', () => {
    expect(parsePeriod('2026-09', today)).toEqual({
      key: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(parsePeriod('2026-02', today).to).toBe('2026-02-28');
    expect(parsePeriod('2024-02', today).to).toBe('2024-02-29');
    expect(parsePeriod('2026-Q4', today)).toEqual({
      key: '2026-Q4',
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(parsePeriod('2025', today)).toEqual({
      key: '2025',
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });
  it('defaults to last month, also across a new year', () => {
    expect(parsePeriod(null, today).key).toBe('2026-09');
    expect(parsePeriod('junk', '2026-01-15' as LegalDate).key).toBe('2025-12');
  });
});

describe('periodOptions', () => {
  it('lists 12 months, 4 quarters and 2 years', () => {
    const keys = periodOptions(today).map((p) => p.key);
    expect(keys).toHaveLength(18);
    expect(keys.slice(0, 2)).toEqual(['2026-10', '2026-09']);
    expect(keys).toContain('2026-Q4');
    expect(keys).toContain('2026-Q1');
    expect(keys.slice(-2)).toEqual(['2026', '2025']);
  });
});

describe('exportEntryName', () => {
  it('names by month folder, date, partner and number', () => {
    const used = new Set<string>();
    const row = {
      date: '2026-09-30' as LegalDate,
      partner: 'Úklid Praha s.r.o.',
      number: '2026/0412',
    };
    expect(exportEntryName(row, 'scan.PDF', 'application/pdf', used)).toBe(
      '2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412.pdf',
    );
    expect(exportEntryName(row, null, 'application/pdf', used)).toBe(
      '2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412 (2).pdf',
    );
  });
  it('handles missing data', () => {
    expect(
      exportEntryName({ date: null, partner: null, number: null }, null, 'image/jpeg', new Set()),
    ).toBe('undated/document.jpg');
  });
  it('prefixes a needs-review file', () => {
    const name = exportEntryName(
      { date: '2026-09-30' as LegalDate, partner: 'Uklid', number: '1' },
      'a.pdf',
      'application/pdf',
      new Set(),
      true,
    );
    expect(name).toBe('2026-09/NEEDS-REVIEW_2026-09-30 Uklid 1.pdf');
  });
});

describe('periodChoices', () => {
  const dates = ['2025-06-12', '2025-06-30', '2025-07-01'];
  it('offers a month with documents from 16 months ago, with its count', () => {
    const choices = periodChoices(today, dates);
    expect(choices.find((p) => p.key === '2025-06')?.count).toBe(2);
    expect(choices.find((p) => p.key === '2025-Q2')?.count).toBe(2);
    expect(choices.find((p) => p.key === '2025')?.count).toBe(3);
    expect(choices.filter((p) => p.key === '2025-06')).toHaveLength(1);
  });
  it('lists months newest first, then quarters, then years', () => {
    const keys = periodChoices(today, dates).map((p) => p.key);
    expect(keys.indexOf('2026-10')).toBeLessThan(keys.indexOf('2025-06'));
    expect(keys.indexOf('2025-06')).toBeLessThan(keys.indexOf('2026-Q4'));
    expect(keys.indexOf('2026-Q4')).toBeLessThan(keys.indexOf('2026'));
  });
});

describe('defaultPeriodKey', () => {
  it('is the newest month with documents that is not in the future', () => {
    expect(defaultPeriodKey(today, ['2025-06-12', '2025-07-01', '2027-01-05'])).toBe('2025-07');
  });
  it('falls back to last month without documents', () => {
    expect(defaultPeriodKey(today, [])).toBe('2026-09');
  });
});
