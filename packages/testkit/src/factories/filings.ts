import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §8 filing tables (migration 0043): filings, filing_documents, filing_entries.
 * `filing_entries` is select-only for users; the RLS suite inserts it with the service connection.
 * `filing_id` and `document_id` are fresh ids that `ensureParentRows()` turns into parent rows.
 * Money is a numeric string (never a float). `dphdp3_rows` is an array literal (text[]).
 */
/**
 * One calendar month per id, from 2026-08 on: `filings_one_open_per_kind` allows one open filing per
 * (org, type, period, kind), and the RLS suite inserts several rows of one org. The month is the
 * id's counter (its last 12 hex digits); id 0 gives the default 2026-08-01..2026-08-31.
 */
function monthOf(id: string): { start: string; end: string } {
  const n = Number.parseInt(id.slice(-12), 16);
  const first = new Date(Date.UTC(2026, 7 + n, 1));
  const last = new Date(Date.UTC(2026, 8 + n, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

export const filingFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const period = monthOf(id);
  return {
    id,
    org_id: ctx.orgId,
    type: 'DPHDP3',
    kind: 'radne',
    origin: 'generated',
    period_start: period.start,
    period_end: period.end,
    state: 'draft',
    totals: {},
    inputs: {},
    simple_check: {},
    ...overrides,
  };
};

export const filingDocumentFactory: TenantFactory = (ctx, overrides) => ({
  filing_id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  document_revision: 1,
  ...overrides,
});

export const filingEntryFactory: TenantFactory = (ctx, overrides) => ({
  filing_id: ctx.ids.next(),
  org_id: ctx.orgId,
  document_id: ctx.ids.next(),
  document_revision: 1,
  vat_treatment: 'rcv_eu_service_reverse_charge',
  vat_rate_type: 'standard',
  dphdp3_rows: '{5}',
  vat_point_date: '2026-08-03',
  base_czk: '13699.77',
  vat_czk: '2876.95',
  ...overrides,
});

/**
 * 05 §8 obligations (migration 0044): one VAT return deadline; the worker writes it, users update
 * state only. The period is the id's month (as filingFactory), so the unique (org, kind, period) holds.
 */
export const obligationFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const period = monthOf(id);
  return {
    id,
    org_id: ctx.orgId,
    kind: 'vat_return',
    period_start: period.start,
    period_end: period.end,
    legal_due_date: '2026-09-25',
    due_date: '2026-09-25',
    state: 'open',
    source_rule: 'm05.vat_obligations.v1',
    ...overrides,
  };
};

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const filingFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['filings', filingFactory],
  ['filing_documents', filingDocumentFactory],
  ['filing_entries', filingEntryFactory],
  ['obligations', obligationFactory],
];
