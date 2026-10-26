import { daysBetween } from './dates';
import { foldText } from './text';
import type { TxView } from './types';

export interface AuthorityRules {
  readonly fu: {
    readonly bankCode: string;
    readonly prefixMap: Readonly<Record<string, string>>;
    readonly vatRefundCategory: string;
  };
  /** `[prefix-]number/bank` → category (ČSSZ, insurers, municipalities). */
  readonly accounts: readonly { readonly account: string; readonly category: string }[];
  /** Folded upper-case whole-word patterns → suggested category; longest first. */
  readonly nameHints: readonly { readonly pattern: string; readonly category: string }[];
}

interface AuthorityGroup {
  readonly category: string;
  readonly accounts?: readonly string[];
}

interface AuthorityRuleValue {
  readonly fu?: {
    readonly bank_code?: string;
    readonly prefix_map?: Readonly<Record<string, string>>;
    readonly vat_refund_category?: string;
  };
  readonly cssz?: AuthorityGroup;
  readonly insurers?: AuthorityGroup;
  readonly municipalities?: AuthorityGroup;
  readonly name_hints?: Readonly<Record<string, string>>;
}

/** Reads the `bank.authority_accounts` rule value (shape seeded in 0117); throws otherwise. */
export function authorityRulesOf(value: Readonly<Record<string, unknown>>): AuthorityRules {
  const v = value as AuthorityRuleValue;
  const fu = v.fu;
  if (!fu) throw new Error('bank.authority_accounts: fu missing');
  const accounts = [v.cssz, v.insurers, v.municipalities].flatMap((g) =>
    g ? (g.accounts ?? []).map((account) => ({ account, category: g.category })) : [],
  );
  const nameHints = Object.entries(v.name_hints ?? {})
    .map(([pattern, category]) => ({ pattern, category }))
    .sort((a, b) => b.pattern.length - a.pattern.length);
  return {
    fu: {
      bankCode: fu.bank_code ?? '',
      prefixMap: fu.prefix_map ?? {},
      vatRefundCategory: fu.vat_refund_category ?? '',
    },
    accounts,
    nameHints,
  };
}

export interface OwnAccount {
  readonly id: string;
  readonly account?: string;
  readonly bankCode?: string;
  readonly iban?: string;
}

export type RuleReason =
  | 'own_transfer'
  | 'fu_prefix'
  | 'vat_refund'
  | 'authority_account'
  | 'name_hint'
  | 'fee'
  | 'interest'
  | 'interest_tax'
  | 'atm'
  | 'cash_deposit';

export interface RuleOutcome {
  readonly categoryCode: string;
  readonly mode: 'auto' | 'suggest';
  readonly reason: RuleReason;
  readonly pairedAccountId?: string;
}

const OWN_TRANSFER_DAYS = 3;

const hasOwn = (map: Readonly<Record<string, string>>, key: string): boolean =>
  Object.hasOwn(map, key);
const cmpStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

export function classifyByRules(
  t: TxView,
  rules: AuthorityRules,
  own: readonly OwnAccount[],
): RuleOutcome | null {
  const txAccount =
    t.counterpartyAccount && t.counterpartyBankCode
      ? `${t.counterpartyAccount}/${t.counterpartyBankCode}`
      : undefined;
  const msg = foldText(t.message ?? '');
  const out = t.amount.isNegative();
  const inc = t.amount.isPositive();
  const noCounterparty = !t.counterpartyAccount && !t.counterpartyIban;

  // 1. Own transfer (never to the same account).
  const self = own.find(
    (o) =>
      o.id !== t.moneyAccountId &&
      ((o.account && o.bankCode && `${o.account}/${o.bankCode}` === txAccount) ||
        (o.iban &&
          t.counterpartyIban &&
          o.iban.toUpperCase() === t.counterpartyIban.toUpperCase())),
  );
  if (self) {
    return {
      categoryCode: 'transfer_own_accounts',
      mode: 'suggest',
      reason: 'own_transfer',
      pairedAccountId: self.id,
    };
  }

  // 2. FÚ (tax office) by account prefix.
  const fuAccount = t.counterpartyAccount;
  if (fuAccount && t.counterpartyBankCode === rules.fu.bankCode) {
    const dash = fuAccount.indexOf('-');
    const prefix = dash >= 0 ? fuAccount.slice(0, dash) : undefined;
    const cat =
      prefix !== undefined && hasOwn(rules.fu.prefixMap, prefix)
        ? rules.fu.prefixMap[prefix]
        : undefined;
    if (cat !== undefined) {
      if (out) return { categoryCode: cat, mode: 'auto', reason: 'fu_prefix' };
      if (inc)
        return { categoryCode: rules.fu.vatRefundCategory, mode: 'suggest', reason: 'vat_refund' };
    }
  }

  // 3. Authority account list.
  const authority =
    out && txAccount ? rules.accounts.find((a) => a.account === txAccount) : undefined;
  if (authority)
    return { categoryCode: authority.category, mode: 'auto', reason: 'authority_account' };

  // 4. Name hint.
  const name = foldText(t.counterpartyName ?? '').replace(/\s+/g, ' ');
  const hint = rules.nameHints.find((h) => ` ${name} `.includes(` ${h.pattern} `));
  if (hint) return { categoryCode: hint.category, mode: 'suggest', reason: 'name_hint' };

  // 5. Tax on interest.
  if (noCounterparty && out && /DAN Z UROKU/.test(msg)) {
    return { categoryCode: 'tax_other_fees', mode: 'auto', reason: 'interest_tax' };
  }

  // 6. Bank fees.
  if (noCounterparty && out && /^(POPLATEK|CENA ZA|VEDENI UCTU|MESICNI POPLATEK|FEE)\b/.test(msg)) {
    return { categoryCode: 'exp_bank_fees', mode: 'auto', reason: 'fee' };
  }

  // 7. Interest income.
  if (noCounterparty && inc && /\bUROK|\bINTEREST\b/.test(msg)) {
    return { categoryCode: 'income_interest', mode: 'auto', reason: 'interest' };
  }

  // 8. Cash withdrawal / deposit.
  if (out && /VYBER Z BANKOMATU|VYBER HOTOVOSTI|\bATM\b/.test(msg)) {
    return { categoryCode: 'transfer_cash_withdrawal', mode: 'auto', reason: 'atm' };
  }
  if (inc && /VKLAD HOTOVOSTI|VKLAD NA UCET|\bATM\b/.test(msg)) {
    return { categoryCode: 'transfer_cash_deposit', mode: 'auto', reason: 'cash_deposit' };
  }

  return null;
}

/** The opposite amount on `pairedAccountId` within 3 days; nearest date, then lexical id. */
export function findOwnTransferPair(
  t: TxView,
  pairedAccountId: string,
  candidates: readonly TxView[],
): TxView | null {
  const want = t.amount.negate();
  const dist = (c: TxView): number => Math.abs(daysBetween(t.bookedOn, c.bookedOn));
  const near = candidates
    .filter(
      (c) =>
        c.moneyAccountId === pairedAccountId &&
        c.amount.equals(want) &&
        dist(c) <= OWN_TRANSFER_DAYS,
    )
    .sort((x, y) => dist(x) - dist(y) || cmpStr(x.id, y.id));
  return near[0] ?? null;
}
