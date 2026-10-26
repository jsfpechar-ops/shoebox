import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §4 detail tables (migration 0006): document_links, document_lines,
 * document_vat_summary, document_fields, extraction_runs, validation_results, review_questions.
 * Columns are snake_case as in SQL; money and percentages are numeric strings (never floats).
 * Every `document_id` is a fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()` creates
 * that document with `documentFactory`. `category_code` stays null (categories is a global table
 * without a factory). Array columns stay at their SQL default.
 */

/** `document_links` has no `id`: its key is (from_document_id, to_document_id, kind). */
export const documentLinkFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  from_document_id: ctx.ids.next(),
  to_document_id: ctx.ids.next(),
  kind: 'supports',
  ...overrides,
});

export const documentLineFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  position: 1,
  description: 'TEST line',
  quantity: '1.0000',
  unit_price: '100.0000',
  net: '100.00',
  vat: '21.00',
  gross: '121.00',
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  ...overrides,
});

/** `document_vat_summary` has no `id`: its key is (document_id, vat_rate_type, vat_rate_pct). */
export const documentVatSummaryFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  vat_rate_type: 'standard',
  vat_rate_pct: '21.00',
  base: '100.00',
  vat: '21.00',
  ...overrides,
});

export const documentFieldFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  field_key: 'document_number',
  value_text: 'TEST-0001',
  source: 'rule',
  confidence: '0.900',
  ...overrides,
});

export const extractionRunFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  stage: 'extract',
  method: 'llm',
  ok: true,
  ...overrides,
});

export const validationResultFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  rule_id: 'MATH_VAT_RECAP',
  rule_version: 1,
  severity: 'warning',
  ...overrides,
});

export const reviewQuestionFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  kind: 'confirm_total',
  payload: { field_key: 'total_gross', value: '121.00' },
  ...overrides,
});

/** `document_pages` has no `id`: its key is (document_id, position). */
export const documentPageFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  position: 1,
  source_file_id: ctx.ids.next(),
  file_page: 1,
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const documentDetailFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['document_links', documentLinkFactory],
  ['document_lines', documentLineFactory],
  ['document_vat_summary', documentVatSummaryFactory],
  ['document_fields', documentFieldFactory],
  ['extraction_runs', extractionRunFactory],
  ['validation_results', validationResultFactory],
  ['review_questions', reviewQuestionFactory],
  ['document_pages', documentPageFactory],
];
