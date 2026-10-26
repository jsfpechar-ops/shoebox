import type { LegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { exportEntryName, parsePeriod, periodOptions } from '../src/documents/export-period';

const today = '2026-10-26' as LegalDate;

describe('parsePeriod', () => {
  it('reads a month, a quarter and a year', () => {
    expect(parsePeriod('2026-09', today)).toEqual({ key: '2026-09', from: '2026-09-01', to: '2026-09-30' });
    expect(parsePeriod('2026-02', today).to).toBe('2026-02-28');
    expect(parsePeriod('2024-02', today).to).toBe('2024-02-29');
    expect(parsePeriod('2026-Q4', today)).toEqual({ key: '2026-Q4', from: '2026-10-01', to: '2026-12-31' });
    expect(parsePeriod('2025', today)).toEqual({ key: '2025', from: '2025-01-01', to: '2025-12-31' });
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
    const row = { date: '2026-09-30' as LegalDate, partner: 'Úklid Praha s.r.o.', number: '2026/0412' };
    expect(exportEntryName(row, 'scan.PDF', 'application/pdf', used)).toBe('2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412.pdf');
    expect(exportEntryName(row, null, 'application/pdf', used)).toBe('2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412 (2).pdf');
  });
  it('handles missing data', () => {
    expect(exportEntryName({ date: null, partner: null, number: null }, null, 'image/jpeg', new Set())).toBe('undated/document.jpg');
  });
});
