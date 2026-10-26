import { describe, expect, it } from 'vitest';
import { type RadarTx, radarCandidates, supplierRequestText } from '../src/radar';

const TODAY = '2026-10-26';
const base: RadarTx = {
  id: 't1',
  amount: '-1210.00',
  currency: 'CZK',
  bookedOn: '2026-10-19',
  matchState: 'unmatched',
  categoryCode: null,
  isPending: false,
  isBusiness: true,
  linkedAmount: '0',
  counterparty: 'Alza.cz a.s.',
  variableSymbol: '123',
};

describe('radarCandidates', () => {
  it('includes a transaction exactly grace days old', () => {
    expect(radarCandidates([base], TODAY, 7).map((c) => c.id)).toEqual(['t1']);
  });
  it('excludes a transaction one day younger', () => {
    expect(radarCandidates([{ ...base, bookedOn: '2026-10-20' }], TODAY, 7)).toEqual([]);
  });
  it('shows the remainder of a partial match', () => {
    const [c] = radarCandidates(
      [{ ...base, matchState: 'partial', linkedAmount: '200.50' }],
      TODAY,
      7,
    );
    expect(c?.remainder).toBe('1009.50');
  });
  it('excludes a fully explained transaction', () => {
    expect(radarCandidates([{ ...base, linkedAmount: '1210.00' }], TODAY, 7)).toEqual([]);
  });
  it('excludes incoming, pending, categorised, matched and private-account transactions', () => {
    for (const patch of [
      { amount: '100.00' },
      { isPending: true },
      { categoryCode: 'bank_fee' },
      { matchState: 'matched' },
      { isBusiness: false },
    ]) {
      expect(radarCandidates([{ ...base, ...patch }], TODAY, 7)).toEqual([]);
    }
  });
});

describe('supplierRequestText', () => {
  const input = {
    orgName: 'Jan Novak',
    ico: '12345678',
    dic: 'CZ12345678',
    address: 'Main 1, Praha, 11000',
    bookedOn: '2026-10-19',
    amount: '1210',
    currency: 'CZK',
    variableSymbol: '123',
    counterparty: 'Alza.cz a.s.',
  };
  it('builds subject and lists the invoicing details', () => {
    const r = supplierRequestText(input);
    expect(r.subject).toBe('Invoice for payment of 1210.00 CZK on 2026-10-19');
    expect(r.body).toContain('12345678');
    expect(r.body).toContain('CZ12345678');
    expect(r.body).toContain('Main 1, Praha, 11000');
    expect(r.body).toContain('Variable symbol: 123');
  });
  it('omits lines for null values', () => {
    const r = supplierRequestText({
      ...input,
      dic: null,
      address: null,
      ico: null,
      variableSymbol: null,
      counterparty: null,
    });
    expect(r.body).not.toMatch(/DIČ|IČO|Address|Variable symbol/);
    expect(r.body).toContain('Jan Novak');
  });
});
