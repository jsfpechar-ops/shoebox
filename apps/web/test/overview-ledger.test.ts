import { createCzRules, parseLegalDate } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { LEDGER_SELECT, toLedgerEntry } from '../src/overview/ledger';
import { toOverviewDocument, toOverviewProfile } from '../src/overview/rows';
import { buildOverviewView } from '../src/overview/view';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('fixture row did not map');
  return value;
}

const rules = createCzRules();
const asOf = parseLegalDate('2026-10-25');

describe('toLedgerEntry', () => {
  it('parses a row and rejects bad ones', () => {
    expect(
      toLedgerEntry({
        entry_date: '2026-10-05',
        basis: 'payment',
        tax_effect: 'taxable_income',
        business_amount_czk: '50000.00',
      }),
    ).toEqual({
      entryDate: '2026-10-05',
      basis: 'payment',
      taxEffect: 'taxable_income',
      businessAmountCzk: '50000.00',
    });
    expect(
      toLedgerEntry({
        entry_date: '2026-10-05',
        basis: 'payment',
        tax_effect: 'taxable_income',
        business_amount_czk: 50000,
      }),
    ).toBeNull();
    expect(
      toLedgerEntry({
        entry_date: '05.10.2026',
        basis: 'payment',
        tax_effect: 'taxable_income',
        business_amount_czk: '1.00',
      }),
    ).toBeNull();
    expect(
      toLedgerEntry({
        entry_date: '2026-10-05',
        basis: 'cash',
        tax_effect: 'taxable_income',
        business_amount_czk: '1.00',
      }),
    ).toBeNull();
    expect(toLedgerEntry(null)).toBeNull();
    expect(LEDGER_SELECT).toContain('business_amount_czk::text');
  });
});

describe('buildOverviewView with ledger rows', () => {
  const docRow = {
    status: 'ready',
    class: 'issued_invoice',
    direction: 'out',
    business_flag: 'business',
    deleted_at: null,
    duzp: '2026-10-05',
    issue_date: '2026-10-05',
    received_date: null,
    service_period_to: null,
    currency: 'CZK',
    fx_rate: null,
    total_gross: '1000.00',
    partners: { country: 'CZ', vat_id: null },
    document_lines: [
      {
        line_type: 'item',
        net: '1000.00',
        gross: '1000.00',
        vat_treatment: null,
        business_share_pct: '100.00',
        categories: { tax_effect: 'taxable_income' },
      },
    ],
  };
  const profileRow = {
    vat_status: 'neplatce',
    vat_period: null,
    tax_regime: 'pausalni_vydaje',
    pausal_rate: 60,
    pausal_dan_band: null,
    has_accountant: false,
  };
  const documents = [must(toOverviewDocument(docRow))];
  const profile = toOverviewProfile(profileRow, true);

  it('takes month/ytd from the ledger and keeps turnover and counted from documents', () => {
    const view = buildOverviewView({
      profile,
      documents,
      asOf,
      rules,
      ledgerEntries: [
        must(
          toLedgerEntry({
            entry_date: '2026-10-05',
            basis: 'payment',
            tax_effect: 'taxable_income',
            business_amount_czk: '800.00',
          }),
        ),
        must(
          toLedgerEntry({
            entry_date: '2026-02-01',
            basis: 'document_evidence',
            tax_effect: 'deductible_expense',
            business_amount_czk: '300.00',
          }),
        ),
      ],
    });
    expect(view.totals.source).toBe('ledger');
    expect(view.totals.ytd.income.toString()).toBe('800');
    expect(view.totals.ytd.expenses.toString()).toBe('300');
    expect(view.totals.month.income.toString()).toBe('800');
    expect(view.totals.turnoverYtd.toString()).toBe('1000');
    expect(view.totals.countedCount).toBe(1);
  });
  it('without ledger rows the document totals apply', () => {
    const view = buildOverviewView({ profile, documents, asOf, rules });
    expect(view.totals.source).toBe('documents');
    expect(view.totals.ytd.income.toString()).toBe('1000');
  });
});
