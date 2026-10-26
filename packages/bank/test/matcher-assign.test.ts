import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { assign, orderScores } from '../src/matcher/assign';
import type { CandidateScore } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);

function cs(
  over: Partial<CandidateScore> & { transactionId: string; documentId: string; score: number },
): CandidateScore {
  return {
    logit: 0,
    features: [],
    method: 'vs_amount',
    amount: { kind: 'exact', ratio: 1, amountDoc: czk('1210.00'), amountAccount: czk('1210.00') },
    txRemaining: czk('1210.00'),
    docOpen: czk('1210.00'),
    anchorDistanceDays: 0,
    dueDate: D('2026-03-15'),
    docCreatedAt: '2026-03-01T10:00:00Z',
    capped: false,
    ...over,
  };
}
const ids = (xs: readonly { documentId: string }[]) => xs.map((x) => x.documentId);

describe('orderScores', () => {
  it('orders by score, anchor distance, due date, created_at, ids', () => {
    const a = cs({ transactionId: 't1', documentId: 'a', score: 0.9, anchorDistanceDays: 3 });
    const b = cs({
      transactionId: 't1',
      documentId: 'b',
      score: 0.9,
      anchorDistanceDays: 1,
      dueDate: D('2026-03-20'),
    });
    const c = cs({
      transactionId: 't1',
      documentId: 'c',
      score: 0.9,
      anchorDistanceDays: 1,
      dueDate: D('2026-03-10'),
    });
    const d = cs({ transactionId: 't1', documentId: 'd', score: 0.95 });
    const e = cs({
      transactionId: 't1',
      documentId: 'e',
      score: 0.9,
      anchorDistanceDays: 1,
      dueDate: undefined,
    });
    const f = cs({
      transactionId: 't1',
      documentId: 'f',
      score: 0.9,
      anchorDistanceDays: 1,
      dueDate: D('2026-03-10'),
      docCreatedAt: '2026-02-01T00:00:00Z',
    });
    expect(ids(orderScores([a, b, c, d, e, f]))).toEqual(['d', 'f', 'c', 'b', 'e', 'a']);
  });
});

describe('assign', () => {
  it('links one clear pair', () => {
    const r = assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.989 })]);
    expect(r.links).toHaveLength(1);
    expect(r.suggestions).toHaveLength(0);
    expect(r.links[0]).toMatchObject({
      transactionId: 't1',
      documentId: 'd1',
      linkType: 'payment',
      confidence: 0.989,
      matchMethod: 'vs_amount',
    });
    expect(r.links[0]?.amountDoc.toFixed2()).toBe('1210.00');
    expect(r.links[0]?.amountAccount.toFixed2()).toBe('1210.00');
  });
  it('margin rule per transaction: 0.95 vs 0.90 → two suggestions', () => {
    const r = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }),
      cs({ transactionId: 't1', documentId: 'd2', score: 0.9 }),
    ]);
    expect(r.links).toHaveLength(0);
    expect(ids(r.suggestions)).toEqual(['d1', 'd2']);
    expect(r.suggestions[0]).toMatchObject({
      transactionId: 't1',
      kind: 'document',
      documentIds: ['d1'],
      score: 0.95,
    });
    expect(r.suggestions[0]?.amounts[0]?.toFixed2()).toBe('1210.00');
  });
  it('margin ok: links the best, the rest has no capacity left', () => {
    const r = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }),
      cs({ transactionId: 't1', documentId: 'd2', score: 0.8 }),
    ]);
    expect(ids(r.links)).toEqual(['d1']);
    expect(r.suggestions).toHaveLength(0);
  });
  it('margin rule per document: two transactions close in score', () => {
    const r = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }),
      cs({ transactionId: 't2', documentId: 'd1', score: 0.93 }),
    ]);
    expect(r.links).toHaveLength(0);
    expect(r.suggestions.map((s) => s.transactionId)).toEqual(['t1', 't2']);
  });
  it('tie-breaker: older due date first', () => {
    const r = assign([
      cs({ transactionId: 't1', documentId: 'da', score: 0.95, dueDate: D('2026-03-15') }),
      cs({ transactionId: 't2', documentId: 'db', score: 0.95, dueDate: D('2026-03-10') }),
    ]);
    expect(ids(r.links)).toEqual(['db', 'da']);
  });
  it('drops low scores and rejected pairs', () => {
    expect(assign([cs({ transactionId: 't1', documentId: 'd1', score: 0.55 })])).toEqual({
      links: [],
      suggestions: [],
    });
    const r = assign(
      [cs({ transactionId: 't1', documentId: 'd1', score: 0.989 })],
      undefined,
      new Set(['t1:d1']),
    );
    expect(r).toEqual({ links: [], suggestions: [] });
  });
  it('keeps at most 3 suggestions per transaction', () => {
    const r = assign(
      [0.85, 0.8, 0.75, 0.7].map((score, i) =>
        cs({ transactionId: 't1', documentId: `d${i + 1}`, score }),
      ),
    );
    expect(r.links).toHaveLength(0);
    expect(ids(r.suggestions)).toEqual(['d1', 'd2', 'd3']);
  });
  it('is idempotent', () => {
    const input = [
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95 }),
      cs({ transactionId: 't1', documentId: 'd2', score: 0.7 }),
      cs({ transactionId: 't2', documentId: 'd3', score: 0.65 }),
    ];
    expect(assign(input)).toEqual(assign(input));
  });
  it('respects capacities and amounts', () => {
    const small = {
      kind: 'exact',
      ratio: 1,
      amountDoc: czk('500.00'),
      amountAccount: czk('500.00'),
    } as const;
    const r = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('1710.00') }),
      cs({
        transactionId: 't1',
        documentId: 'd2',
        score: 0.8,
        txRemaining: czk('1710.00'),
        docOpen: czk('500.00'),
        amount: small,
      }),
    ]);
    expect(ids(r.links)).toEqual(['d1']);
    expect(ids(r.suggestions)).toEqual(['d2']);
    expect(r.suggestions[0]?.amounts[0]?.toFixed2()).toBe('500.00');
    const capped = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('1000.00') }),
    ]);
    expect(capped.links[0]?.amountAccount.toFixed2()).toBe('1000.00');
    expect(capped.links[0]?.amountDoc.toFixed2()).toBe('1000.00');
    const none = assign([
      cs({ transactionId: 't1', documentId: 'd1', score: 0.95, txRemaining: czk('0.00') }),
    ]);
    expect(none).toEqual({ links: [], suggestions: [] });
  });
});
