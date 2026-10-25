import type { Row, TenantFactory } from './registry';

/**
 * Factories of the 05 §2 tenancy tables (migration 0002). Columns are snake_case as in SQL; the
 * RLS suite (packages/db/test/rls) inserts the rows as the service role for org A and org B.
 * Every call yields a row that can be inserted next to the previous ones of the same org.
 */

/** The counter part of an id from `createIdGenerator` (its last 12 hex digits). */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(-12), 16);
}

/** `organizations`: its org column is `id` (05 §10.1), so the row carries `id = ctx.orgId`. */
export const organizationFactory: TenantFactory = (ctx, overrides) => {
  const tag = ctx.orgId.slice(0, 8);
  return {
    id: ctx.orgId,
    name: `Org ${tag}`,
    inbound_email_slug: `org-${tag}`,
    inbound_email_secret: 'ABCDEFGH',
    settings: {},
    ...overrides,
  };
};

/** `memberships`: a viewer with a fresh user id; the suite creates that `auth.users` row. */
export const membershipFactory: TenantFactory = (ctx, overrides) => ({
  org_id: ctx.orgId,
  user_id: ctx.ids.next(),
  role: 'viewer',
  prefs: {},
  ...overrides,
});

/**
 * `taxpayer_profiles`: effective-dated with no overlap per org (exclusion constraint), so each
 * build takes its own closed year, derived from the id counter (build 1 → 2001, build 2 → 2002).
 */
export const taxpayerProfileFactory: TenantFactory = (ctx, overrides) => {
  const id = ctx.ids.next();
  const year = 2000 + (counterOf(id) % 1000);
  return {
    id,
    org_id: ctx.orgId,
    valid_from: `${year}-01-01`,
    valid_to: `${year}-12-31`,
    vat_status: 'neplatce',
    tax_regime: 'pausalni_vydaje',
    legal_name: 'Test s.r.o.',
    ico: '00000000',
    address: {},
    ...overrides,
  };
};

/** Table name → factory, in insert order; registered in `factories/index.ts`. */
export const tenancyFactories: ReadonlyArray<readonly [string, TenantFactory<Row>]> = [
  ['organizations', organizationFactory],
  ['memberships', membershipFactory],
  ['taxpayer_profiles', taxpayerProfileFactory],
];
