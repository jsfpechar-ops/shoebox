import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { scoreBatch, scoreCandidate, sigmoid } from '../src/matcher/score';
import type { Candidate, DocView, MatchContext, TxView } from '../src/matcher/types';

function must<T>(v: T | undefined | null): T {
  if (v == null) throw new Error('missing');
  return v;
}

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
const eur = (s: string) => Money.parse(s, 'EUR');

function tx(over: Partial<TxView> = {}): TxView {
  return {
    id: 't1',
    moneyAccountId: 'acc',
    currency: CZK,
    bookedOn: D('2026-03-10'),
    amount: czk('-1210.00'),
    ...over,
  };
}
function doc(over: Partial<DocView> = {}): DocView {
  return {
    id: 'd1',
    cls: 'received_invoice',
    status: 'ready',
    direction: 'in',
    currency: CZK,
    amountDue: czk('1210.00'),
    openAmount: czk('1210.00'),
    documentNumber: 'FV2026001',
    variableSymbol: '2026001',
    issueDate: D('2026-03-01'),
    dueDate: D('2026-03-15'),
    partnerId: 'p1',
    partnerName: 'Alfa Servis s.r.o.',
    partnerAccounts: ['2400123455/2010'],
    createdAt: '2026-03-01T10:00:00Z',
    ...over,
  };
}
const base: MatchContext = {
  aliases: [],
  rejected: new Set(),
  knownAccounts: [{ value: '2400123455/2010', partnerId: 'p1' }],
  partnersWithVsHistory: new Set(),
  fxRate: () => null,
};
const cand = (t: TxView, d: DocView): Candidate => ({ t, d, via: [] });
const codes = (s: { features: readonly { code: string }[] } | null) =>
  s?.features.map((f) => f.code);

describe('sigmoid', () => {
  it('is the logistic function', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(4.5)).toBeCloseTo(0.989, 3);
  });
});

describe('scoreCandidate: worked examples of M07 §4.6.3', () => {
  it('VS + exact amount → 0.989, vs_amount', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001' }), doc()), base);
    expect(s?.score).toBe(0.989);
    expect(s?.method).toBe('vs_amount');
    expect(codes(s)).toEqual(['amount_exact', 'vs_exact', 'date']);
    expect(s?.logit).toBeCloseTo(4.5, 6);
    expect(s?.amount.amountDoc.toFixed2()).toBe('1210.00');
    expect(s?.txRemaining.toFixed2()).toBe('1210.00');
    expect(s?.anchorDistanceDays).toBe(0);
  });
  it('account + exact amount, no VS → 0.953', () => {
    const t = tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' });
    const s = scoreCandidate(cand(t, doc({ variableSymbol: undefined })), base);
    expect(s?.score).toBe(0.953);
    expect(s?.method).toBe('amount_date_counterparty');
    expect(codes(s)).toEqual(['amount_exact', 'account_match', 'date']);
  });
  it('card: exact amount + merchant name', () => {
    const d = doc({ variableSymbol: undefined, documentNumber: undefined });
    const full = scoreCandidate(
      cand(tx({ bookedOn: D('2026-03-02'), cardMerchant: 'ALFA SERVIS' }), d),
      base,
    );
    expect(full?.score).toBe(0.971);
    expect(full?.method).toBe('card_merchant_fuzzy');
    const near = scoreCandidate(
      cand(tx({ bookedOn: D('2026-03-02'), cardMerchant: 'ALFA SERVICE' }), d),
      base,
    );
    expect(near?.score).toBe(0.924);
    expect(codes(near)).toEqual(['amount_exact', 'name', 'date']);
  });
  it('exact amount + date only → 0.622', () => {
    const s = scoreCandidate(
      cand(tx(), doc({ variableSymbol: undefined, documentNumber: undefined })),
      base,
    );
    expect(s?.score).toBe(0.622);
    expect(s?.method).toBe('amount_date_counterparty');
  });
  it('VS + exact amount outside the window → 0.881; no VS outside → dropped', () => {
    const late = tx({ bookedOn: D('2026-06-20'), vs: '2026001' });
    const s = scoreCandidate(cand(late, doc()), base);
    expect(s?.score).toBe(0.881);
    expect(codes(s)).toEqual(['amount_exact', 'vs_exact', 'date_outside']);
    expect(scoreCandidate(cand(tx({ bookedOn: D('2026-06-20') }), doc()), base)).toBeNull();
  });
  it('needs_review caps at 0.89', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001' }), doc({ status: 'needs_review' })), base);
    expect(s?.score).toBe(0.89);
    expect(s?.capped).toBe(true);
  });
  it('partial with VS → 0.924, vs_only', () => {
    const s = scoreCandidate(cand(tx({ vs: '2026001', amount: czk('-600.00') }), doc()), base);
    expect(s?.score).toBe(0.924);
    expect(s?.method).toBe('vs_only');
    expect(s?.amount.kind).toBe('partial');
    expect(s?.amount.amountDoc.toFixed2()).toBe('600.00');
  });
  it('wrong amount without VS is dropped', () => {
    expect(scoreCandidate(cand(tx({ amount: czk('-999.00') }), doc()), base)).toBeNull();
  });
  it('VS conflict when the partner uses VS', () => {
    const ctx: MatchContext = { ...base, partnersWithVsHistory: new Set(['p1']) };
    const s = scoreCandidate(cand(tx({ vs: '999' }), doc()), ctx);
    expect(s?.score).toBe(0.076);
    expect(codes(s)).toEqual(['amount_exact', 'vs_conflict', 'date']);
    expect(codes(scoreCandidate(cand(tx({ vs: '999' }), doc()), base))).toEqual([
      'amount_exact',
      'date',
    ]);
  });
  it('account known for another partner → −3', () => {
    const ctx: MatchContext = {
      ...base,
      knownAccounts: [{ value: '1003-1234567899/0800', partnerId: 'p2' }],
    };
    const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    const s = scoreCandidate(
      cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })),
      ctx,
    );
    expect(s?.score).toBe(0.076);
    expect(codes(s)).toEqual(['amount_exact', 'account_other_partner', 'date']);
  });
  it('confirmed alias adds 1', () => {
    const ctx: MatchContext = {
      ...base,
      aliases: [{ kind: 'account', value: '2400123455/2010', partnerId: 'p1', confirmations: 2 }],
    };
    const t = tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' });
    const s = scoreCandidate(
      cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })),
      ctx,
    );
    expect(s?.score).toBe(0.982);
    expect(codes(s)).toEqual(['amount_exact', 'account_match', 'date', 'alias']);
    const once: MatchContext = { ...ctx, aliases: [{ ...must(ctx.aliases[0]), confirmations: 1 }] };
    expect(
      scoreCandidate(cand(t, doc({ variableSymbol: undefined, documentNumber: undefined })), once)
        ?.score,
    ).toBe(0.953);
  });
  it('document number in the message → +3 (not with VS)', () => {
    const s = scoreCandidate(
      cand(tx({ message: 'Platba FV2026001' }), doc({ variableSymbol: undefined })),
      base,
    );
    expect(s?.score).toBe(0.971);
    expect(codes(s)).toEqual(['amount_exact', 'msg_doc_number', 'date']);
    const withVs = scoreCandidate(
      cand(tx({ message: 'Platba FV2026001', vs: '2026001' }), doc()),
      base,
    );
    expect(codes(withVs)).toEqual(['amount_exact', 'vs_exact', 'date']);
  });
  it('FX: EUR document paid in CZK', () => {
    const ctx: MatchContext = { ...base, fxRate: () => '25' };
    const d = doc({
      currency: 'EUR',
      amountDue: eur('100.00'),
      openAmount: eur('100.00'),
      variableSymbol: undefined,
      documentNumber: undefined,
    });
    const s = scoreCandidate(cand(tx({ amount: czk('-2525.00') }), d), ctx);
    expect(s?.score).toBe(0.148);
    expect(s?.features.find((f) => f.code === 'amount_fx')?.contribution).toBeCloseTo(0.75, 6);
    const v = scoreCandidate(
      cand(tx({ amount: czk('-2525.00'), vs: '2026001' }), { ...d, variableSymbol: '2026001' }),
      ctx,
    );
    expect(v?.score).toBe(0.905);
    expect(v?.method).toBe('vs_only');
  });
});

describe('scoreBatch', () => {
  const plain = { variableSymbol: undefined, documentNumber: undefined } as const;
  it('adds uniqueness when one transaction and one document match on amount', () => {
    const [s] = scoreBatch([cand(tx(), doc(plain))], base);
    expect(s?.score).toBe(0.818);
    expect(codes(must(s))).toEqual(['amount_exact', 'date', 'unique']);
  });
  it('no uniqueness with two documents of the same amount', () => {
    const t = tx();
    const out = scoreBatch(
      [cand(t, doc({ ...plain, id: 'a' })), cand(t, doc({ ...plain, id: 'b' }))],
      base,
    );
    expect(out.map((s) => s.score)).toEqual([0.622, 0.622]);
  });
  it('no uniqueness with two transactions for one document', () => {
    const d = doc(plain);
    const out = scoreBatch([cand(tx({ id: 't1' }), d), cand(tx({ id: 't2' }), d)], base);
    expect(out.map((s) => s.score)).toEqual([0.622, 0.622]);
  });
  it('drops candidates that score null', () => {
    expect(scoreBatch([cand(tx({ amount: czk('-999.00') }), doc())], base)).toEqual([]);
  });
});
