import { addDays, CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { computePaidAt, type LinkView, paidThreshold } from '../src/matcher/paid-at';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const doc = { amountDue: czk('1210.00'), currency: CZK, issueDate: D('2026-03-01') };
let seq = 0;
const link = (
  amount: string,
  bookedOn: string,
  linkType: LinkView['linkType'] = 'payment',
  currency = CZK,
): LinkView => ({
  linkType,
  amount: Money.parse(amount, currency),
  bookedOn: D(bookedOn),
  createdAt: `2026-03-01T00:00:${String(seq++).padStart(2, '0')}Z`,
});

describe('paidThreshold', () => {
  it('CZK tolerance 1.00, foreign 1 %', () => {
    expect(paidThreshold(doc).toFixed2()).toBe('1209.00');
    expect(
      paidThreshold({ amountDue: Money.parse('100.00', 'EUR'), currency: 'EUR' }).toFixed2(),
    ).toBe('99.00');
    expect(
      paidThreshold({ amountDue: Money.parse('250.50', 'EUR'), currency: 'EUR' }).toFixed2(),
    ).toBe('248.00');
  });
});

describe('computePaidAt', () => {
  it('full payment → its booked date', () => {
    expect(computePaidAt(doc, [link('1210.00', '2026-03-10')])).toBe('2026-03-10');
  });
  it('two partial payments → the date that closes the sum', () => {
    expect(computePaidAt(doc, [link('610.00', '2026-03-20'), link('600.00', '2026-03-10')])).toBe(
      '2026-03-20',
    );
  });
  it('rounding tolerance', () => {
    expect(computePaidAt(doc, [link('1209.00', '2026-03-10')])).toBe('2026-03-10');
    expect(computePaidAt(doc, [link('1208.99', '2026-03-10')])).toBeNull();
  });
  it('refund drops below, later payment re-closes', () => {
    const paid = link('1210.00', '2026-03-10');
    expect(computePaidAt(doc, [paid, link('1210.00', '2026-04-01', 'refund')])).toBeNull();
    expect(
      computePaidAt(doc, [
        paid,
        link('100.00', '2026-04-01', 'refund'),
        link('100.00', '2026-04-15'),
      ]),
    ).toBe('2026-04-15');
    expect(computePaidAt(doc, [paid, link('0.50', '2026-04-01', 'refund')])).toBe('2026-03-10');
  });
  it('fees do not count; offsets and payouts do', () => {
    expect(computePaidAt(doc, [link('1210.00', '2026-03-10', 'fee')])).toBeNull();
    expect(
      computePaidAt(doc, [
        link('1000.00', '2026-03-10', 'offset'),
        link('210.00', '2026-03-12', 'platform_payout'),
      ]),
    ).toBe('2026-03-12');
    expect(
      computePaidAt(doc, [
        link('1209.50', '2026-03-10'),
        link('0.50', '2026-03-10', 'fx_difference'),
      ]),
    ).toBe('2026-03-10');
  });
  it('foreign currency uses 1 %', () => {
    const eur = { amountDue: Money.parse('100.00', 'EUR'), currency: 'EUR' };
    expect(computePaidAt(eur, [link('99.20', '2026-03-10', 'payment', 'EUR')])).toBe('2026-03-10');
    expect(computePaidAt(eur, [link('98.90', '2026-03-10', 'payment', 'EUR')])).toBeNull();
  });
  it('amount_due ≤ 0', () => {
    const zero = { ...doc, amountDue: czk('0.00') };
    expect(computePaidAt(zero, [])).toBeNull();
    expect(computePaidAt({ ...zero, isPaidPerDocument: true }, [])).toBe('2026-03-01');
    expect(
      computePaidAt({ amountDue: czk('-5.00'), currency: CZK, isPaidPerDocument: true }, []),
    ).toBeNull();
  });
  it('same day: created_at breaks the tie', () => {
    const a = { ...link('1210.00', '2026-03-10'), createdAt: '2026-03-10T10:00:00Z' };
    const r = { ...link('1210.00', '2026-03-10', 'refund'), createdAt: '2026-03-10T09:00:00Z' };
    expect(computePaidAt(doc, [a, r])).toBeNull();
    expect(computePaidAt(doc, [a, { ...r, createdAt: '2026-03-10T11:00:00Z' }])).toBeNull();
    expect(
      computePaidAt(doc, [
        { ...r, createdAt: '2026-03-10T11:00:00Z' },
        a,
        { ...a, createdAt: '2026-03-10T12:00:00Z' },
      ]),
    ).toBe('2026-03-10');
  });
});

describe('computePaidAt properties (seeded, 1000 runs)', () => {
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const halere = (h: number) => czk(`${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`);
  const next = rng(20261018);
  const int = (max: number) => Math.floor(next() * max);
  const types: LinkView['linkType'][] = [
    'payment',
    'payment',
    'payment',
    'refund',
    'fee',
    'offset',
  ];
  const SIGN: Record<LinkView['linkType'], number> = {
    payment: 1,
    offset: 1,
    platform_payout: 1,
    fx_difference: 1,
    refund: -1,
    fee: 0,
  };

  it('A10/A11: null iff the final sum is below the threshold; date is the first prefix that reaches it', () => {
    for (let run = 0; run < 1000; run++) {
      const due = halere(1 + int(100000));
      const d = { amountDue: due, currency: CZK };
      const n = 1 + int(6);
      const links: LinkView[] = [];
      for (let i = 0; i < n; i++) {
        links.push({
          linkType: types[int(types.length)] ?? 'payment',
          amount: halere(int(60000)),
          bookedOn: addDays(D('2026-01-01'), int(365)),
          createdAt: `2026-01-01T00:00:00.${String(int(1000)).padStart(3, '0')}Z`,
        });
      }
      const threshold = paidThreshold(d);
      const sorted = [...links].sort((a, b) =>
        a.bookedOn < b.bookedOn
          ? -1
          : a.bookedOn > b.bookedOn
            ? 1
            : a.createdAt < b.createdAt
              ? -1
              : a.createdAt > b.createdAt
                ? 1
                : 0,
      );
      let sum = Money.zero(CZK);
      let expected: string | null = null;
      for (const l of sorted) {
        const s = SIGN[l.linkType];
        if (s === 1) sum = sum.add(l.amount);
        if (s === -1) sum = sum.subtract(l.amount);
        if (sum.compare(threshold) >= 0) expected = expected ?? l.bookedOn;
        else expected = null;
      }
      const result = computePaidAt(d, links);
      expect(result).toBe(expected);
      expect(result === null).toBe(sum.compare(threshold) < 0);
      if (result !== null) expect(links.some((l) => l.bookedOn === result)).toBe(true);
      const withZero = [
        ...links,
        {
          linkType: 'payment' as const,
          amount: czk('0.00'),
          bookedOn: D('2026-12-31'),
          createdAt: '2026-12-31T00:00:00Z',
        },
      ];
      expect(computePaidAt(d, withZero)).toBe(result);
    }
  });
});
