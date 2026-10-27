import { parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { computeBillsToPay, computeWorkSummary, type WorkRow } from '../src/overview/work';

const asOf = parseLegalDate('2026-10-26');

function row(over: Partial<WorkRow>): WorkRow {
  return {
    id: 'id',
    status: 'ready',
    direction: 'in',
    dueDate: parseLegalDate('2026-11-01'),
    paidAt: null,
    paidPerDocument: false,
    paymentMethod: null,
    totalGross: '100.00',
    currency: 'CZK',
    documentNumber: null,
    partnerName: null,
    hasUserField: false,
    ...over,
  };
}

describe('computeWorkSummary', () => {
  it('is empty for no rows', () => {
    expect(computeWorkSummary([], asOf)).toEqual({
      waiting: 0,
      reading: 0,
      done: 0,
      autoReadPct: null,
    });
  });

  it('counts waiting, reading and done by status', () => {
    const rows = [
      row({ status: 'needs_review' }),
      row({ status: 'extracting' }),
      row({ status: 'received' }),
      row({ status: 'ready' }),
      row({ status: 'duplicate' }),
    ];
    const s = computeWorkSummary(rows, asOf);
    expect([s.waiting, s.reading, s.done]).toEqual([1, 2, 1]);
  });

  it('rounds the auto-read share down and ignores documents with user fields', () => {
    const rows = [
      row({ status: 'ready' }),
      row({ status: 'ready' }),
      row({ status: 'finalized', hasUserField: true }),
    ];
    expect(computeWorkSummary(rows, asOf).autoReadPct).toBe(66);
    expect(computeWorkSummary([row({})], asOf).autoReadPct).toBe(100);
    expect(computeWorkSummary([row({ hasUserField: true })], asOf).autoReadPct).toBe(0);
  });
});

describe('computeBillsToPay', () => {
  it('counts but does not list bills due more than 14 days ago, and skips card or per-document paid', () => {
    const r = computeBillsToPay(
      [
        row({ id: 'old', dueDate: parseLegalDate('2026-10-01') }),
        row({ id: 'edge', dueDate: parseLegalDate('2026-10-12') }),
        row({ id: 'card', paymentMethod: 'card' }),
        row({ id: 'recv', paidPerDocument: true }),
      ],
      asOf,
    );
    expect(r.items.map((i) => i.id)).toEqual(['edge']);
    expect(r.olderCount).toBe(1);
  });

  it('is empty for no rows', () => {
    expect(computeBillsToPay([], asOf)).toEqual({
      items: [],
      count: 0,
      totalCzk: null,
      olderCount: 0,
    });
  });

  it('keeps only unpaid received bills with a due date in ready or needs_review', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', direction: 'out' }),
      row({ id: 'c', paidAt: '2026-10-01' }),
      row({ id: 'd', dueDate: null }),
      row({ id: 'e', status: 'extracting' }),
      row({ id: 'f', status: 'needs_review' }),
    ];
    expect(computeBillsToPay(rows, asOf).items.map((i) => i.id)).toEqual(['a', 'f']);
  });

  it('marks overdue only when due is before asOf', () => {
    const rows = [
      row({ id: 'past', dueDate: parseLegalDate('2026-10-25') }),
      row({ id: 'today', dueDate: parseLegalDate('2026-10-26') }),
      row({ id: 'later', dueDate: parseLegalDate('2026-10-28') }),
    ];
    const items = computeBillsToPay(rows, asOf).items;
    expect(items.map((i) => [i.id, i.overdue, i.daysLeft])).toEqual([
      ['past', true, -1],
      ['today', false, 0],
      ['later', false, 2],
    ]);
  });

  it('sorts by due date ascending', () => {
    const rows = [
      row({ id: 'b', dueDate: parseLegalDate('2026-12-01') }),
      row({ id: 'a', dueDate: parseLegalDate('2026-11-01') }),
    ];
    expect(computeBillsToPay(rows, asOf).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('shows at most five but counts all', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: `r${i}` }));
    const result = computeBillsToPay(rows, asOf);
    expect(result.items).toHaveLength(5);
    expect(result.count).toBe(7);
    expect(result.totalCzk).toBe('700.00');
  });

  it('sums CZK without float drift and skips other currencies', () => {
    const rows = [
      row({ totalGross: '0.10' }),
      row({ totalGross: '0.20' }),
      row({ totalGross: '50.00', currency: 'EUR' }),
    ];
    expect(computeBillsToPay(rows, asOf).totalCzk).toBe('0.30');
    expect(computeBillsToPay([row({ currency: 'EUR' })], asOf).totalCzk).toBeNull();
  });
});
