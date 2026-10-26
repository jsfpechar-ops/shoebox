import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { computeDedupeHash, dedupeSeqs, dedupeTuple } from '../src/dedupe';
import type { CanonicalTx } from '../src/types';

const tx = (over: Partial<CanonicalTx> = {}): CanonicalTx => ({
  bookedOn: parseLegalDate('2026-09-16'),
  amount: Money.parse('-89', CZK),
  counterparty: {},
  message: 'Káva Praha',
  raw: {},
  ...over,
});

describe('dedupe', () => {
  it('builds the tuple with folded message and fixed amount', () => {
    expect(dedupeTuple(tx({ vs: '12', counterparty: { account: '2400123455', bankCode: '2010' } }))).toBe(
      '2026-09-16|-89.00|2400123455/2010|12|||kava praha',
    );
  });

  it('counts identical transactions of the same day', () => {
    const other = tx({ bookedOn: parseLegalDate('2026-09-17') });
    expect(dedupeSeqs([tx(), tx(), other, tx()])).toEqual([0, 1, 0, 2]);
  });

  it('gives two identical coffees different hashes, and is stable', () => {
    const a = computeDedupeHash('acc-1', tx(), 0);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeDedupeHash('acc-1', tx(), 1)).not.toBe(a);
    expect(computeDedupeHash('acc-2', tx(), 0)).not.toBe(a);
    expect(computeDedupeHash('acc-1', tx(), 0)).toBe(a);
  });
});
