import { CZK, Money, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  authorityRulesOf,
  classifyByRules,
  findOwnTransferPair,
  type OwnAccount,
} from '../src/matcher/classify';
import type { TxView } from '../src/matcher/types';

const D = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
function tx(over: Partial<TxView> = {}): TxView {
  return {
    id: 't1',
    moneyAccountId: 'acc',
    currency: CZK,
    bookedOn: D('2026-03-10'),
    amount: czk('-5000.00'),
    ...over,
  };
}
const rules = authorityRulesOf({
  fu: {
    bank_code: '0710',
    prefix_map: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' },
    vat_refund_category: 'income_vat_refund',
  },
  cssz: { category: 'ins_social_own', accounts: ['1003-1234567899/0800'] },
  insurers: { category: 'ins_health_own', accounts: [] },
  name_hints: {
    'FINANCNI URAD': 'tax_other_fees',
    OSSZ: 'ins_social_own',
    'ZDRAVOTNI POJISTOVNA': 'ins_health_own',
    VZP: 'ins_health_own',
  },
});
const own: OwnAccount[] = [
  { id: 'acc', account: '2400123455', bankCode: '2010', iban: 'CZ8720100000002400123455' },
  { id: 'acc2', account: '1003-1234567899', bankCode: '0800' },
];
const fu = (prefix: string, over: Partial<TxView> = {}) =>
  tx({ counterpartyAccount: `${prefix}-1234567890`, counterpartyBankCode: '0710', ...over });

describe('authorityRulesOf', () => {
  it('reads the rule value', () => {
    expect(rules.fu).toEqual({
      bankCode: '0710',
      prefixMap: { '705': 'tax_vat_payment', '2866': 'tax_pausal_advance' },
      vatRefundCategory: 'income_vat_refund',
    });
    expect(rules.accounts).toEqual([
      { account: '1003-1234567899/0800', category: 'ins_social_own' },
    ]);
    expect(rules.nameHints[0]).toEqual({
      pattern: 'ZDRAVOTNI POJISTOVNA',
      category: 'ins_health_own',
    });
    expect(() => authorityRulesOf({})).toThrow('bank.authority_accounts: fu missing');
  });
});

describe('classifyByRules', () => {
  it('FÚ prefixes', () => {
    expect(classifyByRules(fu('705'), rules, [])).toEqual({
      categoryCode: 'tax_vat_payment',
      mode: 'auto',
      reason: 'fu_prefix',
    });
    expect(classifyByRules(fu('2866'), rules, [])).toEqual({
      categoryCode: 'tax_pausal_advance',
      mode: 'auto',
      reason: 'fu_prefix',
    });
    expect(classifyByRules(fu('999'), rules, [])).toBeNull();
    expect(classifyByRules(fu('705', { amount: czk('1200.00') }), rules, [])).toEqual({
      categoryCode: 'income_vat_refund',
      mode: 'suggest',
      reason: 'vat_refund',
    });
    expect(classifyByRules(fu('705', { counterpartyBankCode: '0800' }), rules, [])).toBeNull();
  });
  it('authority account list and name hints', () => {
    const cssz = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    expect(classifyByRules(cssz, rules, [])).toEqual({
      categoryCode: 'ins_social_own',
      mode: 'auto',
      reason: 'authority_account',
    });
    expect(classifyByRules(tx({ counterpartyName: 'OSSZ Praha 3' }), rules, [])).toEqual({
      categoryCode: 'ins_social_own',
      mode: 'suggest',
      reason: 'name_hint',
    });
    expect(
      classifyByRules(tx({ counterpartyName: 'Finanční úřad pro hl. m. Prahu' }), rules, []),
    ).toEqual({ categoryCode: 'tax_other_fees', mode: 'suggest', reason: 'name_hint' });
    expect(
      classifyByRules(tx({ counterpartyName: 'Všeobecná zdravotní pojišťovna ČR' }), rules, []),
    ).toEqual({ categoryCode: 'ins_health_own', mode: 'suggest', reason: 'name_hint' });
    expect(classifyByRules(tx({ counterpartyName: 'VZPX s.r.o.' }), rules, [])).toBeNull();
  });
  it('fees, interest, ATM', () => {
    expect(
      classifyByRules(tx({ amount: czk('-59.00'), message: 'Poplatek za vedení účtu' }), rules, []),
    ).toEqual({ categoryCode: 'exp_bank_fees', mode: 'auto', reason: 'fee' });
    expect(
      classifyByRules(
        tx({
          amount: czk('-59.00'),
          message: 'Poplatek',
          counterpartyAccount: '2400123455',
          counterpartyBankCode: '2010',
        }),
        rules,
        [],
      ),
    ).toBeNull();
    expect(classifyByRules(tx({ amount: czk('0.37'), message: 'Úrok' }), rules, [])).toEqual({
      categoryCode: 'income_interest',
      mode: 'auto',
      reason: 'interest',
    });
    expect(
      classifyByRules(tx({ amount: czk('-0.06'), message: 'Daň z úroku' }), rules, []),
    ).toEqual({ categoryCode: 'tax_other_fees', mode: 'auto', reason: 'interest_tax' });
    expect(
      classifyByRules(tx({ amount: czk('-2000.00'), message: 'Výběr z bankomatu' }), rules, []),
    ).toEqual({ categoryCode: 'transfer_cash_withdrawal', mode: 'auto', reason: 'atm' });
    expect(
      classifyByRules(tx({ amount: czk('2000.00'), message: 'Vklad hotovosti' }), rules, []),
    ).toEqual({ categoryCode: 'transfer_cash_deposit', mode: 'auto', reason: 'cash_deposit' });
    expect(
      classifyByRules(tx({ amount: czk('-2000.00'), message: 'Platba kartou' }), rules, []),
    ).toBeNull();
  });
  it('own transfers by account or IBAN, never to the same account', () => {
    const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
    expect(classifyByRules(t, rules, own)).toEqual({
      categoryCode: 'transfer_own_accounts',
      mode: 'suggest',
      reason: 'own_transfer',
      pairedAccountId: 'acc2',
    });
    const byIban = tx({
      moneyAccountId: 'acc2',
      amount: czk('5000.00'),
      counterpartyIban: 'cz8720100000002400123455',
    });
    expect(classifyByRules(byIban, rules, own)?.pairedAccountId).toBe('acc');
    expect(
      classifyByRules(
        tx({ counterpartyAccount: '2400123455', counterpartyBankCode: '2010' }),
        rules,
        own,
      ),
    ).toBeNull();
  });
});

describe('findOwnTransferPair', () => {
  const t = tx({ counterpartyAccount: '1003-1234567899', counterpartyBankCode: '0800' });
  const pair = (over: Partial<TxView>) =>
    tx({ id: 'p', moneyAccountId: 'acc2', amount: czk('5000.00'), ...over });
  it('pairs the opposite amount within 3 days, nearest first', () => {
    const far = pair({ id: 'far', bookedOn: D('2026-03-13') });
    const near = pair({ id: 'near', bookedOn: D('2026-03-11') });
    expect(findOwnTransferPair(t, 'acc2', [far, near])?.id).toBe('near');
    expect(
      findOwnTransferPair(t, 'acc2', [
        pair({ id: 'b', bookedOn: D('2026-03-09') }),
        pair({ id: 'a', bookedOn: D('2026-03-11') }),
      ])?.id,
    ).toBe('a');
  });
  it('rejects wrong account, amount, sign or distance', () => {
    expect(findOwnTransferPair(t, 'acc2', [pair({ bookedOn: D('2026-03-14') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ amount: czk('4999.00') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ amount: czk('-5000.00') })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [pair({ moneyAccountId: 'acc' })])).toBeNull();
    expect(findOwnTransferPair(t, 'acc2', [])).toBeNull();
  });
});
