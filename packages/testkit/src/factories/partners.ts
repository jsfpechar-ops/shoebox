import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §3 / §5 tenant tables (migration 0004): partners, partner_bank_accounts,
 * vendor_profiles. Columns are snake_case as in SQL. A child row points its foreign key at a
 * fresh id from `ctx.ids`; the RLS suite's `ensureParentRows()` creates that parent row (with the
 * parent's own factory) before the child is inserted, so every build is insertable on its own.
 * Array columns (`email_domains`) are left to their SQL default: the suite sends arrays as json.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `partners`: unique (org_id, ico), so the IČO is derived from the id counter. */
export const partnerFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const n = counterOf(id);
  return {
    id,
    org_id: ctx.orgId,
    name: `Partner ${n}`,
    ico: String(10000000 + (n % 90000000)),
    country: 'CZ',
    ...overrides,
  };
};

/** `partner_bank_accounts`: one account of a fresh partner. */
export const partnerBankAccountFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  return {
    id,
    org_id: ctx.orgId,
    partner_id: ctx.ids.next(),
    account_number: String(1000000000 + (counterOf(id) % 1000000000)),
    bank_code: '0800',
    iban: `CZ6508000000${String(1000000000 + (counterOf(id) % 1000000000))}`,
    ...overrides,
  };
};

/** `vendor_profiles`: unique (org_id, partner_id), so each build has its own fresh partner. */
export const vendorProfileFactory: TenantFactory = (ctx, overrides) => ({
  id: ctx.ids.next(),
  org_id: ctx.orgId,
  partner_id: ctx.ids.next(),
  confirmations: 0,
  pinned: false,
  multi_category: false,
  extraction_hints: {},
  ...overrides,
});

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const partnerFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['partners', partnerFactory],
  ['partner_bank_accounts', partnerBankAccountFactory],
  ['vendor_profiles', vendorProfileFactory],
];
