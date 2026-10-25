import { cookies } from 'next/headers';
import { cache } from 'react';
import { createSupabaseServerClient } from '../supabase/server';
import {
  type AuthzResult,
  authorize,
  authorizeActive,
  type MemberRole,
  type Membership,
  ORG_COOKIE,
  type OrgContext,
  parseMemberships,
  resolveActiveOrg,
} from './authz';

/**
 * The active org and role of the signed-in user, once per request (React `cache`). Runs under the
 * user's session, so RLS (`memberships_select`: own orgs only) applies; the `user_id` filter keeps
 * other members of the same org out. Fails closed: a failed lookup means no membership, never all.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const supabase = await createSupabaseServerClient();
  let userId: string | undefined;
  try {
    userId = (await supabase.auth.getUser()).data.user?.id;
  } catch {
    userId = undefined;
  }
  if (userId === undefined) return null;

  let memberships: Membership[] = [];
  try {
    const { data, error } = await supabase
      .from('memberships')
      .select('org_id, role, organizations(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error === null) memberships = parseMemberships(data);
  } catch {
    // No PostgREST (e2e fake server) or network error: fail closed, see above.
  }

  const cookieValue = (await cookies()).get(ORG_COOKIE)?.value;
  return { userId, memberships, active: resolveActiveOrg(memberships, cookieValue) };
});

/** Server-side role check for a named org (M12 §4.4). Call it first in every server action and route. */
export async function requireRole(
  orgId: string,
  roles: readonly MemberRole[],
): Promise<AuthzResult> {
  return authorize(await getOrgContext(), orgId, roles);
}

/** The same check against the active org (the usual case for the four screens). */
export async function requireActiveRole(roles: readonly MemberRole[]): Promise<AuthzResult> {
  return authorizeActive(await getOrgContext(), roles);
}
