import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  chooseSubset,
  findSubsetSum,
  multiDocumentScore,
  toHalere,
} from '../src/matcher/subset-sum';

const D = parseLegalDate;
const items = [
  { id: 'a', halere: 100000n },
  { id: 'b', halere: 250000n },
  { id: 'c', halere: 50000n },
  { id: 'd', halere: 150000n },
];

describe('toHalere', () => {
  it('is exact', () => {
    expect(toHalere(Money.parse('1210.50', CZK))).toBe(121050n);
    expect(toHalere(Money.parse('-0.05', CZK))).toBe(-5n);
    expect(toHalere(Money.parse('0', CZK))).toBe(0n);
    expect(toHalere(Money.parse('12345.6', CZK))).toBe(1234560n);
  });
});

describe('findSubsetSum', () => {
  it('finds every subset within tolerance, smallest first', () => {
    expect(findSubsetSum(300000n, items, 0n, 6)).toEqual([
      ['b', 'c'],
      ['a', 'c', 'd'],
    ]);
    expect(findSubsetSum(300000n, items, 0n, 2)).toEqual([['b', 'c']]);
    expect(findSubsetSum(300050n, items, 100n, 6)).toEqual([
      ['b', 'c'],
      ['a', 'c', 'd'],
    ]);
    expect(findSubsetSum(50000n, items, 0n, 6)).toEqual([['c']]);
    expect(findSubsetSum(999n, items, 0n, 6)).toEqual([]);
    expect(findSubsetSum(50000n, items, 0n, 0)).toEqual([]);
    expect(findSubsetSum(50000n, [], 0n, 6)).toEqual([]);
  });
  it('handles 20 × 6 (C(20,6) = 38760 subsets)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, halere: 100000n }));
    expect(findSubsetSum(600000n, twenty, 0n, 6)).toHaveLength(38760);
  });
});

describe('chooseSubset', () => {
  const due = { a: D('2026-03-01'), b: D('2026-03-20'), c: D('2026-03-05'), d: D('2026-03-10') };
  it('one subset is unique', () => {
    expect(chooseSubset([['b', 'c']], due)).toEqual({ ids: ['b', 'c'], unique: true });
  });
  it('several: oldest maximum due date wins', () => {
    expect(
      chooseSubset(
        [
          ['b', 'c'],
          ['a', 'c', 'd'],
        ],
        due,
      ),
    ).toEqual({ ids: ['a', 'c', 'd'], unique: false });
    expect(
      chooseSubset(
        [
          ['a', 'c', 'd'],
          ['b', 'c'],
        ],
        due,
      ),
    ).toEqual({ ids: ['a', 'c', 'd'], unique: false });
    expect(chooseSubset([['b'], ['a', 'x']], due)).toEqual({ ids: ['b'], unique: false });
    expect(chooseSubset([], due)).toBeNull();
  });
});

describe('multiDocumentScore', () => {
  it('caps at 0.89 unless the message names every document', () => {
    const f = {
      account: true,
      alias: false,
      nameSim: 0,
      meanDateFactor: 1,
      unique: true,
      messageHasAll: false,
    };
    expect(multiDocumentScore(f)).toBe(0.89);
    expect(multiDocumentScore({ ...f, messageHasAll: true })).toBe(0.998);
    expect(multiDocumentScore({ ...f, unique: false })).toBe(0.75);
    expect(multiDocumentScore({ ...f, account: false, nameSim: 1 })).toBe(0.89);
    expect(multiDocumentScore({ ...f, account: false, meanDateFactor: 0.5 })).toBe(0.438);
  });
});
