// The RLS catalog (M12 §4.4 RLS test suite item 1, 05 §10.2–10.3): the lists the meta-test, the
// generated isolation and role cases and `scripts/check-tenant-sql.ts` read. A new table either has
// `org_id` (then it is a tenant table: RLS, three policies, a testkit factory) or is listed here
// as a global table. Nothing else passes CI (AGENTS rule 3). Names as in 05.

/** Who may read a global table (05 §10.3). Nobody but the service role writes one. */
export type GlobalRead = 'authenticated' | 'service_role';

/** Tables without `org_id` that are allowed to exist, with who may read them (05 §10.3). */
export const GLOBAL_TABLES: Readonly<Record<string, GlobalRead>> = {
  categories: 'authenticated',
  fx_rates: 'authenticated',
  bank_codes: 'authenticated',
  registry_cache: 'service_role',
  rules_overrides: 'service_role',
  staff_users: 'service_role',
  rate_limit_counters: 'service_role',
  // 05 §9.1 Later, listed so the allowlist never has to change for them:
  global_vendor_priors: 'service_role',
  extraction_batches: 'service_role',
};

/** Tenant tables whose org column is not `org_id`. */
export const ORG_COLUMN: Readonly<Record<string, string>> = {
  organizations: 'id',
};

/** Tenant tables with a nullable `org_id` (05 §10.3: users select rows of their orgs). */
export const NULLABLE_ORG_ID: readonly string[] = ['audit_log'];

/**
 * Tenant tables users only read (05 §10.2 derived tables, plus `audit_log`): no insert, update or
 * delete policy for `authenticated`; the worker (`app_worker`) writes them.
 */
export const READ_ONLY_FOR_USERS: readonly string[] = [
  'audit_log',
  'tax_ledger_entries',
  'vat_ledger_entries',
  'filing_entries',
  'llm_usage_daily',
  'extraction_runs',
  'ingest_items',
  'statement_imports',
  'match_suggestions',
];

/**
 * Tenant tables where users may only update (05 §10.2: obligations, state/done_at/done_source; a
 * trigger guards the columns). No user insert or delete policy: the worker writes those rows.
 */
export const USER_UPDATE_ONLY: readonly string[] = ['obligations'];

/** 05 §10.2: written by owners only (a member cannot insert, update or delete). */
export const OWNER_ONLY_TABLES: readonly string[] = [
  'organizations',
  'memberships',
  'taxpayer_profiles',
  'privacy_requests',
];

/** 05 §10.2: selected and written by owners only. */
export const OWNER_ONLY_SELECT_TABLES: readonly string[] = ['privacy_requests'];

/**
 * 05 §10.2 / M12 §4.4 role matrix: the only tenant tables an accountant may write at all
 * (`review_questions` and `accountant_packages` only on named columns, checked by their slice).
 */
export const ACCOUNTANT_WRITABLE: readonly string[] = [
  'comments',
  'review_questions',
  'accountant_packages',
  'export_profiles',
  'export_mappings',
];

/**
 * Tenant tables no user may insert through RLS: a new organization is created by server code
 * (there is no membership yet that could satisfy the owner check).
 */
export const NO_USER_INSERT: readonly string[] = ['organizations'];

/** The org column of a tenant table (`org_id` unless listed in ORG_COLUMN). */
export function orgColumnOf(table: string): string {
  return ORG_COLUMN[table] ?? 'org_id';
}
