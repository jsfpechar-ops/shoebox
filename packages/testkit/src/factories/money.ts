import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §6 money tables (migration 0020). Columns are snake_case as in SQL. A child
 * row points its foreign key at a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()`
 * creates that parent with the parent's factory.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

export const moneyAccountFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  type: 'bank',
  name: 'Business account',
  currency: 'CZK',
  ...overrides,
});

export const importMappingFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    kind: 'documents',
    header_signature: counterOf(id).toString(16).padStart(64, '0'),
    mapping: {},
    ...overrides,
  };
};

export const spreadsheetImportFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  source_file_id: ctx.ids.next(),
  ...overrides,
});

export const statementImportFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  channel: 'statement_file',
  format: 'gpc',
  parser_version: 1,
  state: 'parsed',
  ...overrides,
});

export const transactionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  money_account_id: ctx.ids.next(),
  source: 'statement_file',
  booked_on: '2026-01-15',
  amount: '-1210.00',
  currency: 'CZK',
  ...overrides,
});

export const paymentLinkFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  transaction_id: ctx.ids.next(),
  document_id: ctx.ids.next(),
  amount: '1210.00',
  amount_account_currency: '1210.00',
  match_method: 'vs_amount',
  ...overrides,
});

export const matchSuggestionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  transaction_id: ctx.ids.next(),
  kind: 'category',
  score: '0.900',
  features: {},
  matcher_version: 1,
  ...overrides,
});

export const counterpartyAliasFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    partner_id: ctx.ids.next(),
    kind: 'name',
    value_normalized: `supplier ${counterOf(id)}`,
    ...overrides,
  };
};

export const paymentOrderFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  kind: 'qr',
  total: '1210.00',
  item_count: 1,
  ...overrides,
});

/** `payment_order_items` has no `id`: its key is (order_id, document_id). */
export const paymentOrderItemFactory: TenantFactory = (ctx, overrides) => ({
  order_id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  amount: '1210.00',
  account: '2400123455/2010',
  checks: {},
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const moneyFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['money_accounts', moneyAccountFactory],
  ['import_mappings', importMappingFactory],
  ['spreadsheet_imports', spreadsheetImportFactory],
  ['statement_imports', statementImportFactory],
  ['transactions', transactionFactory],
  ['payment_links', paymentLinkFactory],
  ['match_suggestions', matchSuggestionFactory],
  ['counterparty_aliases', counterpartyAliasFactory],
  ['payment_orders', paymentOrderFactory],
  ['payment_order_items', paymentOrderItemFactory],
];
