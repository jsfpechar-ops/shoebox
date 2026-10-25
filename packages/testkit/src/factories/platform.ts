import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §9 Platform tenant tables (migration 0007): audit_log, llm_usage_daily,
 * privacy_requests. The global tables of 0007 (rules_overrides, staff_users, rate_limit_counters)
 * have no factory: the RLS suite iterates tenant tables only. Columns are snake_case as in SQL;
 * money is a numeric string (never a float). `requested_by` is a fresh id from `ctx.ids`; the RLS
 * suite's `ensureAuthUsers()` creates that auth.users row. `actor_user_id` stays null (no FK).
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `audit_log` has a bigserial `id` (left to the database) and no foreign keys. */
export const auditLogFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  actor_kind: 'system',
  entity: 'documents',
  entity_id: ctx.ids.next(),
  action: 'test.touch',
  ...overrides,
});

/** `llm_usage_daily` has no `id`: its key is (org_id, day, model), so `model` varies per build. */
export const llmUsageDailyFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  day: '2026-01-15',
  model: `test-model-${counterOf(ctx.ids.next())}`,
  calls: 1,
  input_tokens: 1000,
  output_tokens: 200,
  cost_usd: '0.0100',
  ...overrides,
});

export const privacyRequestFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  kind: 'export',
  requested_by: ctx.ids.next(),
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const platformFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['audit_log', auditLogFactory],
  ['llm_usage_daily', llmUsageDailyFactory],
  ['privacy_requests', privacyRequestFactory],
];
