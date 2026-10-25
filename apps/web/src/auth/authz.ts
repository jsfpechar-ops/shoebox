import { MEMBER_ROLE_VALUES, type MemberRole } from '@shoebox/domain';
import { z } from 'zod';

/**
 * Authorization rules (M12 §4.4 role matrix, §4.5 V1.4 / V4.1 deny by default). Pure: no Next, Node
 * or Supabase import, so it runs in server actions, route handlers and unit tests. RLS enforces the
 * same matrix in the database; server code checks here first and answers `forbidden` without a query.
 */

export type { MemberRole };
export const MEMBER_ROLES: readonly MemberRole[] = MEMBER_ROLE_VALUES;

/** The rows of the M12 §4.4 role matrix for user roles. `staff` is the /admin back-office (M12 §4.9), not a membership. */
export const AUTHZ_ACTIONS = [
  /** Read documents, ledgers, Přehled */
  'read',
  /** Upload, edit, confirm, delete documents */
  'documents_write',
  /** Answer review questions */
  'review_answer',
  /** Comments */
  'comments',
  /** Generate/mark filings, mark obligations done */
  'filings',
  /** Accountant packages (generate, send, acknowledge) */
  'accountant_packages',
  /** Profile, settings, members, inbound address */
  'org_settings',
  /** Export all data, close account, support grant */
  'org_export',
] as const;
export type AuthzAction = (typeof AUTHZ_ACTIONS)[number];

/** M12 §4.4: which roles may do which row. Change only with a spec change. */
export const ROLE_MATRIX: Readonly<Record<AuthzAction, readonly MemberRole[]>> = {
  read: ['owner', 'member', 'accountant', 'viewer'],
  documents_write: ['owner', 'member'],
  review_answer: ['owner', 'member', 'accountant'],
  comments: ['owner', 'member', 'accountant'],
  filings: ['owner', 'member'],
  accountant_packages: ['owner', 'member', 'accountant'],
  org_settings: ['owner'],
  org_export: ['owner'],
};

/** The roles allowed for a matrix row, for `requireRole(orgId, rolesFor('documents_write'))`. */
export function rolesFor(action: AuthzAction): readonly MemberRole[] {
  return ROLE_MATRIX[action];
}

export function can(role: MemberRole, action: AuthzAction): boolean {
  return ROLE_MATRIX[action].includes(role);
}

/** One row of `memberships` joined with the organization name (05 §2). */
export interface Membership {
  orgId: string;
  role: MemberRole;
  orgName: string;
}

/** One PostgREST row of `select org_id, role, organizations(name)` (the join follows the FK). */
const membershipRowSchema = z.object({
  org_id: z.uuid(),
  role: z.enum(MEMBER_ROLE_VALUES),
  organizations: z.object({ name: z.string() }).nullable(),
});

/** Rows from PostgREST → Membership[]; anything that does not match the schema counts as no rows (fail closed). */
export function parseMemberships(data: unknown): Membership[] {
  const rows = z.array(membershipRowSchema).safeParse(data);
  if (!rows.success) return [];
  return rows.data.map((row) => ({
    orgId: row.org_id,
    role: row.role,
    orgName: row.organizations?.name ?? '',
  }));
}

/** The signed-in user's memberships and the active one (from the `shoebox_org` cookie, else the first). */
export interface OrgContext {
  userId: string;
  memberships: readonly Membership[];
  active: Membership | null;
}

export type AuthzResult =
  | { ok: true; orgId: string; userId: string; role: MemberRole }
  /** `unauthenticated`: no user; `no_org`: a user without any membership; `forbidden`: everything else. */
  | { ok: false; code: 'unauthenticated' | 'no_org' | 'forbidden' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Deny by default: `ok` only when the user is a member of `orgId` with one of `roles`. A non-member
 * gets `forbidden`, never "not found", so the answer does not reveal whether the org exists (V4.2).
 */
export function authorize(
  context: OrgContext | null,
  orgId: string,
  roles: readonly MemberRole[],
): AuthzResult {
  if (context === null) return { ok: false, code: 'unauthenticated' };
  if (!isUuid(orgId)) return { ok: false, code: 'forbidden' };
  const membership = context.memberships.find((m) => m.orgId === orgId);
  if (membership === undefined || !roles.includes(membership.role)) {
    return { ok: false, code: 'forbidden' };
  }
  return { ok: true, orgId: membership.orgId, userId: context.userId, role: membership.role };
}

/** Like `authorize`, against the active org; `no_org` when the user has no membership at all. */
export function authorizeActive(
  context: OrgContext | null,
  roles: readonly MemberRole[],
): AuthzResult {
  if (context === null) return { ok: false, code: 'unauthenticated' };
  if (context.active === null) return { ok: false, code: 'no_org' };
  return authorize(context, context.active.orgId, roles);
}

/** Org id of the active organization; HttpOnly, Secure, Lax like the auth cookies (M12 §4.5 V3.2). */
export const ORG_COOKIE = 'shoebox_org';
export const ORG_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/**
 * The cookie wins when it names one of the user's memberships; otherwise the first membership
 * (oldest, as the query orders them); no membership → null. A malformed or stale cookie is ignored.
 */
export function resolveActiveOrg(
  memberships: readonly Membership[],
  cookieValue: string | undefined,
): Membership | null {
  if (isUuid(cookieValue)) {
    const chosen = memberships.find((m) => m.orgId === cookieValue);
    if (chosen !== undefined) return chosen;
  }
  return memberships[0] ?? null;
}
