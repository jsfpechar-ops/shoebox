import type { Row, TenantFactory } from './registry';

/**
 * Factory of the M06 §4.11 cached tax reserve (migration 0045): tax_reserve_estimates, one row per
 * org (org_id is the primary key). The worker writes it; users only select. Money in `payload` is a
 * decimal string (never a float).
 */
export const taxReserveEstimateFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  as_of: '2026-09-30',
  tax_year: 2026,
  kind: 'estimate',
  payload: {},
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const reserveFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['tax_reserve_estimates', taxReserveEstimateFactory],
];
