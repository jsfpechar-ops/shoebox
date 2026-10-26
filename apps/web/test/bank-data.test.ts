import { describe, expect, it } from 'vitest';
import { type AccountRow, bankView, type ImportRow, type TxRow } from '../src/settings/bank-data';

const acc = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a1',
  name: 'Bank account',
  currency: 'CZK',
  account_number: '2400123455',
  bank_code: '2010',
  iban: 'CZ8720100000002400123455',
  ...over,
});
const imp = (over: Partial<ImportRow>): ImportRow => ({
  id: 'i',
  money_account_id: 'a1',
  period_from: '2026-09-01',
  period_to: '2026-09-30',
  tx_new: 5,
  state: 'parsed',
  created_at: '2026-10-01T10:00:00Z',
  ...over,
});
const tx = (over: Partial<TxRow>): TxRow => ({
  id: 't',
  money_account_id: 'a1',
  booked_on: '2026-09-15',
  amount: '-89.00',
  currency: 'CZK',
  counterparty_name: null,
  message: null,
  ...over,
});

describe('bankView', () => {
  it('labels accounts and picks the newest good import', () => {
    const view = bankView(
      [acc(), acc({ id: 'a2', account_number: null, bank_code: null }), acc({ id: 'a3', account_number: null, bank_code: null, iban: null, name: 'Cash' })],
      [
        imp({ id: 'old', period_from: '2026-08-01', period_to: '2026-08-31', created_at: '2026-09-01T10:00:00Z' }),
        imp({ id: 'new', tx_new: 7 }),
        imp({ id: 'bad', state: 'failed', created_at: '2026-10-02T10:00:00Z' }),
      ],
      [],
    );
    expect(view.accounts).toEqual([
      { id: 'a1', label: '2400123455/2010', lastImport: { from: '2026-09-01', to: '2026-09-30', added: 7 } },
      { id: 'a2', label: 'CZ8720100000002400123455', lastImport: null },
      { id: 'a3', label: 'Cash', lastImport: null },
    ]);
  });

  it('lists at most three problems, newest first', () => {
    const view = bankView(
      [acc()],
      [
        imp({ id: 'p1', money_account_id: null, state: 'needs_mapping', created_at: '2026-10-01T10:00:00Z' }),
        imp({ id: 'p2', money_account_id: null, state: 'failed', created_at: '2026-10-02T10:00:00Z' }),
        imp({ id: 'p3', money_account_id: null, state: 'needs_account', created_at: '2026-10-03T10:00:00Z' }),
        imp({ id: 'p4', money_account_id: null, state: 'failed', created_at: '2026-09-01T10:00:00Z' }),
        imp({ id: 'ok', state: 'duplicate_file' }),
      ],
      [],
    );
    expect(view.problems).toEqual([
      { id: 'p3', message: 'settings.bank.problem.needs_account', at: '2026-10-03T10:00:00Z' },
      { id: 'p2', message: 'settings.bank.problem.failed', at: '2026-10-02T10:00:00Z' },
      { id: 'p1', message: 'settings.bank.problem.needs_mapping', at: '2026-10-01T10:00:00Z' },
    ]);
  });

  it('shows the latest payments with who paid or what for', () => {
    const view = bankView(
      [acc()],
      [],
      [
        tx({ id: 't1', booked_on: '2026-09-14', counterparty_name: 'ODBERATEL SRO', amount: '12100.00' }),
        tx({ id: 't2', booked_on: '2026-09-16', message: '  NAKUP: KAVARNA PRAHA A MOC DLOUHY TEXT ZA NIM  ' }),
        tx({ id: 't3', booked_on: '2026-09-16' }),
      ],
    );
    expect(view.payments).toEqual([
      { id: 't3', date: '2026-09-16', who: '', amount: '-89.00', currency: 'CZK' },
      { id: 't2', date: '2026-09-16', who: 'NAKUP: KAVARNA PRAHA A MOC DLOUHY TEXT Z', amount: '-89.00', currency: 'CZK' },
      { id: 't1', date: '2026-09-14', who: 'ODBERATEL SRO', amount: '12100.00', currency: 'CZK' },
    ]);
  });
});
