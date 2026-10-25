'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isUuid, ORG_COOKIE, ORG_COOKIE_MAX_AGE_S } from './authz';
import { getOrgContext } from './org-context';
import { AUTH_COOKIE_OPTIONS, DEFAULT_AFTER_LOGIN, loginUrl } from './session';

/**
 * Org switcher (M11 §3): sets the `shoebox_org` cookie to one of the user's own memberships and goes
 * back to the default screen. An unknown or foreign org id changes nothing (no error, no information).
 */
export async function setActiveOrg(formData: FormData): Promise<void> {
  const context = await getOrgContext();
  if (context === null) redirect(loginUrl());
  const orgId = formData.get('orgId');
  const membership = isUuid(orgId) ? context.memberships.find((m) => m.orgId === orgId) : undefined;
  if (membership !== undefined) {
    (await cookies()).set(ORG_COOKIE, membership.orgId, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: ORG_COOKIE_MAX_AGE_S,
    });
  }
  redirect(DEFAULT_AFTER_LOGIN);
}
