import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { compareAmount } from '../src/matcher/amount';
import { generateCandidates, isEligible } from '../src/matcher/candidates';
import type { DocView, MatchContext, TxView } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const eur = (s: string) => Money.parse(s, 'EUR');

function tx(over: Partial<TxView> = {}): TxView {
  return { id: 't1', moneyAccountId: 'acc', currency: CZK, bookedOn: D('2026-03-10'), amount: czk('-1210.00'), ...over };
}
function doc(over: Partial<DocView> = {}): DocView {
  return {
    id: 'd1', cls: 'received_invoice', status: 'ready', direction: 'in', currency: CZK,
    amountDue: czk('1210.00'), openAmount: czk('1210.00'), issueDate: D('2026-03-01'), dueDate: D('2026-03-15'),
    partnerAccounts: [], createdAt: '2026-03-01T10:00:00Z', ...over,
  };
}
const ctx: MatchContext = {
  aliases: [], rejected: new Set(), knownAccounts: [], partnersWithVsHistory: new Set(), fxRate: () => null,
};
const f2 = (m: Money) => m.toFixed2();

describe('compareAmount', () => {
  it('exact and rounding in CZK', () => {
    const a = compareAmount(tx(), doc(), ctx, false);
    expect(a).toMatchObject({ kind: 'exact', ratio: 1 });
    expect(f2(a!.amountDoc)).toBe('1210.00');
    expect(f2(a!.amountAccount)).toBe('1210.00');
    const r = compareAmount(tx({ amount: czk('-1210.50') }), doc(), ctx, false);
    expect(r?.kind).toBe('rounding');
    expect(f2(r!.amountDoc)).toBe('1210.00');
    expect(f2(r!.amountAccount)).toBe('1210.50');
    expect(compareAmount(tx({ amount: czk('-1211.50') }), doc(), ctx, false)).toBeNull();
  });
  it('partial and overpayment need an exact VS', () => {
    expect(compareAmount(tx({ amount: czk('-600.00') }), doc(), ctx, false)).toBeNull();
    const p = compareAmount(tx({ amount: czk('-600.00') }), doc(), ctx, true);
    expect(p?.kind).toBe('partial');
    expect(f2(p!.amountDoc)).toBe('600.00');
    const o = compareAmount(tx({ amount: czk('-1211.50') }), doc(), ctx, true);
    expect(o?.kind).toBe('overpayment');
    expect(f2(o!.amountDoc)).toBe('1210.00');
    expect(f2(o!.amountAccount)).toBe('1210.00');
  });
  it('uses the remaining amount of the transaction', () => {
    const a = compareAmount(tx({ remaining: czk('610.00') }), doc({ openAmount: czk('610.00') }), ctx, false);
    expect(a?.kind).toBe('exact');
    expect(compareAmount(tx({ remaining: czk('0.00') }), doc(), ctx, false)).toBeNull();
  });
  it('matches the original currency exactly', () => {
    const t = tx({ amount: czk('-2500.00'), amountOriginal: eur('-100.00') });
    const a = compareAmount(t, doc({ currency: 'EUR', amountDue: eur('100.00'), openAmount: eur('100.00') }), ctx, false);
    expect(a?.kind).toBe('exact');
    expect(f2(a!.amountDoc)).toBe('100.00');
    expect(f2(a!.amountAccount)).toBe('2500.00');
  });
  it('FX path with ČNB rate and tolerance', () => {
    const d = doc({ currency: 'EUR', amountDue: eur('100.00'), openAmount: eur('100.00') });
    const fx: MatchContext = { ...ctx, fxRate: () => '25' };
    const a = compareAmount(tx({ amount: czk('-2525.00') }), d, fx, false);
    expect(a?.kind).toBe('fx');
    expect(a!.ratio).toBeCloseTo(0.5, 6);
    expect(f2(a!.amountDoc)).toBe('100.00');
    expect(f2(a!.amountAccount)).toBe('2525.00');
    const card = compareAmount(tx({ amount: czk('-2525.00'), cardMerchant: 'X' }), d, fx, false);
    expect(card!.ratio).toBeCloseTo(0.6667, 3);
    expect(compareAmount(tx({ amount: czk('-2600.00') }), d, fx, false)).toBeNull();
    const o = compareAmount(tx({ amount: czk('-2600.00') }), d, fx, true);
    expect(o?.kind).toBe('overpayment');
    expect(f2(o!.amountAccount)).toBe('2500.00');
    const p = compareAmount(tx({ amount: czk('-1250.00') }), d, fx, true);
    expect(p?.kind).toBe('partial');
    expect(f2(p!.amountDoc)).toBe('50.00');
    expect(compareAmount(tx({ amount: czk('-2525.00') }), d, ctx, false)).toBeNull();
  });
});

describe('isEligible', () => {
  const out = tx();
  const inc = tx({ amount: czk('1210.00') });
  it.each([
    ['received_invoice', 'in', 'ready', '1210.00', out, true],
    ['received_invoice', 'in', 'duplicate', '1210.00', out, false],
    ['received_invoice', 'in', 'ready', '0.00', out, false],
    ['issued_invoice', 'out', 'ready', '1210.00', out, false],
    ['issued_invoice', 'out', 'ready', '1210.00', inc, true],
    ['issued_credit_note', 'out', 'ready', '1210.00', out, true],
    ['received_credit_note', 'in', 'ready', '1210.00', inc, true],
    ['government_filing', null, 'finalized', '1210.00', out, true],
    ['contract', 'in', 'ready', '1210.00', out, false],
    ['received_receipt', 'in', 'needs_review', '1210.00', out, true],
  ] as const)('%s %s %s open %s', (cls, direction, status, open, t, expected) => {
    const d = doc({ cls, direction, status, openAmount: czk(open), amountDue: czk(open) });
    expect(isEligible(t, d)).toBe(expected);
  });
});

describe('generateCandidates', () => {
  const t = tx({
    vs: '2026001', message: 'Faktura FV777', counterpartyAccount: '2400123455', counterpartyBankCode: '2010',
    counterpartyName: 'Alfa Servis',
  });
  const docs = [
    doc({ id: 'byVs', variableSymbol: '2026001', openAmount: czk('999.00'), partnerName: 'Beta' }),
    doc({ id: 'byMsg', documentNumber: 'FV777', openAmount: czk('999.00') }),
    doc({ id: 'byAmount', partnerName: 'Delta' }),
    doc({ id: 'byAccount', openAmount: czk('999.00'), partnerAccounts: ['2400123455/2010'], partnerName: 'Gamma' }),
    doc({ id: 'byName', openAmount: czk('999.00'), partnerName: 'Alfa Servis s.r.o.' }),
    doc({ id: 'none', openAmount: czk('999.00'), partnerName: 'Omega', variableSymbol: '555' }),
    doc({ id: 'both', variableSymbol: '2026001', partnerName: 'Zeta' }),
  ];
  it('retrieves by each key and reports the keys', () => {
    const c = generateCandidates(t, docs, ctx);
    const via = Object.fromEntries(c.map((x) => [x.d.id, x.via]));
    expect(via).toEqual({
      both: ['vs', 'amount'], byVs: ['vs'], byMsg: ['message'], byAmount: ['amount'], byAccount: ['account'], byName: ['name'],
    });
    expect(c[0]!.d.id).toBe('both');
  });
  it('amount retrieval respects the date window', () => {
    const old = doc({ id: 'old', issueDate: D('2025-01-01'), dueDate: D('2025-01-15'), partnerName: 'Delta' });
    expect(generateCandidates(t, [old], ctx)).toEqual([]);
  });
  it('account retrieval via partner_bank_accounts and aliases', () => {
    const d = doc({ id: 'p1', openAmount: czk('999.00'), partnerId: 'p1', partnerName: 'Gamma' });
    const known: MatchContext = { ...ctx, knownAccounts: [{ value: '2400123455/2010', partnerId: 'p1' }] };
    expect(generateCandidates(t, [d], known).map((x) => x.via)).toEqual([['account']]);
    const alias: MatchContext = { ...ctx, aliases: [{ kind: 'account', value: '2400123455/2010', partnerId: 'p1', confirmations: 1 }] };
    expect(generateCandidates(t, [d], alias).map((x) => x.via)).toEqual([['account']]);
    const other: MatchContext = { ...ctx, knownAccounts: [{ value: '2400123455/2010', partnerId: 'p2' }] };
    expect(generateCandidates(t, [d], other)).toEqual([]);
  });
  it('caps at 50 candidates', () => {
    const many = Array.from({ length: 60 }, (_, i) => doc({ id: `m${i}`, partnerName: 'Delta' }));
    expect(generateCandidates(tx(), many, ctx)).toHaveLength(50);
  });
});
