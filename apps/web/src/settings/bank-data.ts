import type { LegalDate } from '@shoebox/domain';
import type { MessageKey } from '@shoebox/i18n';
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
}
export interface ImportRow {
  id: string;
  money_account_id: string | null;
  period_from: string | null;
  period_to: string | null;
  tx_new: number;
  state: string;
  created_at: string;
}
export interface TxRow {
  id: string;
  money_account_id: string;
  booked_on: string;
  amount: string;
  currency: string;
  counterparty_name: string | null;
  message: string | null;
}
export interface BankView {
  readonly accounts: readonly {
    id: string;
    /** '2400123455/2010', else the IBAN, else the name. */
    label: string;
    lastImport: { from: LegalDate | null; to: LegalDate | null; added: number } | null;
  }[];
  /** Latest imports that need the user (failed, needs_mapping, needs_account), newest first, at most 3. */
  readonly problems: readonly { id: string; message: MessageKey; at: string }[];
  /** Latest 10 transactions, newest booked_on first. */
  readonly payments: readonly {
    id: string;
    date: LegalDate;
    who: string;
    amount: string;
    currency: string;
  }[];
}

const PROBLEM_KEYS: Readonly<Record<string, MessageKey>> = {
  failed: 'settings.bank.problem.failed' as MessageKey,
  needs_mapping: 'settings.bank.problem.needs_mapping' as MessageKey,
  needs_account: 'settings.bank.problem.needs_account' as MessageKey,
};

function accountLabel(account: AccountRow): string {
  if (account.account_number !== null && account.bank_code !== null) {
    return `${account.account_number}/${account.bank_code}`;
  }
  return account.iban ?? account.name;
}

/** Pure: builds the card's view from rows (imports and txs in any order). */
export function bankView(
  accounts: readonly AccountRow[],
  imports: readonly ImportRow[],
  txs: readonly TxRow[],
): BankView {
  const newestFirst = [...imports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const goodStates = new Set(['parsed', 'partially_parsed']);

  const accountViews = accounts.map((account) => {
    const last = newestFirst.find(
      (i) => i.money_account_id === account.id && goodStates.has(i.state),
    );
    return {
      id: account.id,
      label: accountLabel(account),
      lastImport:
        last === undefined
          ? null
          : {
              from: last.period_from as LegalDate | null,
              to: last.period_to as LegalDate | null,
              added: last.tx_new,
            },
    };
  });

  const problems: { id: string; message: MessageKey; at: string }[] = [];
  for (const i of newestFirst) {
    const message = PROBLEM_KEYS[i.state];
    if (message === undefined) continue;
    problems.push({ id: i.id, message, at: i.created_at });
    if (problems.length === 3) break;
  }

  const sortedTxs = [...txs].sort((a, b) => {
    if (a.booked_on !== b.booked_on) return a.booked_on < b.booked_on ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const payments = sortedTxs.slice(0, 10).map((tx) => ({
    id: tx.id,
    date: tx.booked_on as LegalDate,
    who: (tx.counterparty_name ?? tx.message ?? '').trim().slice(0, 40),
    amount: tx.amount,
    currency: tx.currency,
  }));

  return { accounts: accountViews, problems, payments };
}

/** Reads the three tables for the org (imports newest 50, transactions newest 10) and calls bankView. */
export async function loadBankView(supabase: SupabaseLike, orgId: string): Promise<BankView> {
  const [accRes, impRes, txRes] = await Promise.all([
    supabase
      .from('money_accounts')
      .select('id, name, currency, account_number, bank_code, iban')
      .eq('org_id', orgId),
    supabase
      .from('statement_imports')
      .select('id, money_account_id, period_from, period_to, tx_new, state, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('transactions')
      .select('id, money_account_id, booked_on, amount, currency, counterparty_name, message')
      .eq('org_id', orgId)
      .order('booked_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(10),
  ]);

  // On a read error the card shows the empty state rather than failing the whole page.
  const accounts = accRes.error || !Array.isArray(accRes.data) ? [] : (accRes.data as AccountRow[]);
  const imports = impRes.error || !Array.isArray(impRes.data) ? [] : (impRes.data as ImportRow[]);
  const txs = txRes.error || !Array.isArray(txRes.data) ? [] : (txRes.data as TxRow[]);

  return bankView(accounts, imports, txs);
}
