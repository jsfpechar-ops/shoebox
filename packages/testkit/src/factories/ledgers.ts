import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §7 ledger tables (migration 0041). Both are select-only for users; the RLS
 * suite inserts them with the service connection. `document_id` is a fresh id that
 * `ensureParentRows()` turns into a document; `category_code` is a code seeded by 0040.
 * Money is a numeric string (never a float). `dphdp3_rows` is an array literal (text[]).
 */
export const taxLedgerEntryFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  entry_date: '2026-09-15',
  tax_year: 2026,
  basis: 'payment',
  document_id: ctx.ids.next(),
  category_code: 'exp_other_deductible',
  tax_effect: 'deductible_expense',
  amount_czk: '100.00',
  business_share_pct: '100.00',
  business_amount_czk: '100.00',
  build_version: 1,
  ...overrides,
});

export const vatLedgerEntryFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  vat_point_date: '2026-08-03',
  vat_point_rule: 'issue_date',
  document_id: ctx.ids.next(),
  vat_treatment: 'rcv_eu_service_reverse_charge',
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  base_czk: '100.00',
  vat_czk: '21.00',
  dphdp3_rows: '{5}',
  build_version: 1,
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const ledgerFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['tax_ledger_entries', taxLedgerEntryFactory],
  ['vat_ledger_entries', vatLedgerEntryFactory],
];
