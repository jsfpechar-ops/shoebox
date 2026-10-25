# 0036a: Role matrix, org context and `requireRole`

Status: review
Ticket: P0-AUTH-02 (part a of 2) | Depends on: 0030d merged into phase/0 | Base commit: head of phase/0 | Branch: task/0036a-authz-core | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: HIGH (auth). Every file is given in full; the tests are the spec.

## 1. Objective

Every server action and route can resolve the active organization and check the M12 §4.4 role matrix before RLS does: a pure `authz.ts` (matrix, `authorize`, `resolveActiveOrg`), a server `org-context.ts` (`getOrgContext`, `requireRole(orgId, roles)`, `requireActiveRole(roles)`) that reads the user's memberships under the user's own session, a `setActiveOrg` server action for the switcher of 0036b, and `apps/web/test/authz.test.ts` with one case per row and role of the matrix.

## 2. Context

**How to work (strict):** every file is given in full. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0036a step k"`). Never run `git add` on `apps/web/next-env.d.ts`, `.next/`, `test-results/` or `playwright-report/`. If `tsc` reports an error inside `apps/web/.next/types/`, run `rm -rf apps/web/.next` and rerun once.

**Already in phase/0 (do not change):** 0030a–d (`apps/web/src/auth/{session,schemas,last-seen,actions,guard,login-form,logout-buttons}.ts(x)`, `apps/web/src/supabase/{env,server}.ts` with `createSupabaseServerClient()`, `apps/web/middleware.ts`), P0-DB-02/03 (`memberships(org_id, user_id, role member_role, invited_by, prefs, created_at)`, `organizations(id, name, …)`, RLS policies `memberships_select` / `organizations_select` = rows of the user's own orgs through `app.user_org_ids()`), `@shoebox/domain` exporting `MEMBER_ROLE_VALUES = ['owner','member','accountant','viewer']` and `type MemberRole`. If `apps/web/src/auth/guard.ts` or `apps/web/src/supabase/server.ts` is missing: STOP.

**Spec (pasted):** **M12 §4.4 role matrix** (enforced by RLS; server actions also check and return `forbidden`), columns owner · member · accountant · viewer: Read documents, ledgers, Přehled ✓ ✓ ✓ ✓ · Upload, edit, confirm, delete documents ✓ ✓ – – · Answer review questions ✓ ✓ ✓ – · Comments ✓ ✓ ✓ – · Generate/mark filings, mark obligations done ✓ ✓ – – · Accountant packages ✓ ✓ ✓ – · Profile, settings, members, inbound address ✓ – – – · Export all data, close account, support grant ✓ – – –. The `staff (admin)` column is the `/admin` back-office (M12 §4.9, `staff_users`), not a membership: out of scope. **M12 §4.5:** V1.4 / V4.1 access control server-side, deny by default; V4.2 no information through ids (UUIDs; a non-member gets `forbidden`, never "not found"); V3.2 cookies HttpOnly, Secure, Lax. **M11 §3:** header shows org name + switcher only if the user has > 1 membership. **M11 §13.1:** server actions run under the user session so RLS applies. **04 §1:** users join organizations through memberships with a role (`owner`, `member`, `accountant`, `viewer`). **Backlog P0-AUTH-02 acceptance:** `requireRole(orgId, roles)` returns typed `{ ok: false, code: 'forbidden' }`; active org from cookie with membership check; switcher only with > 1 membership (0036b); `apps/web/test/authz.test.ts` with one case per row and role of the matrix.

**Rules:** 3 (every query org-scoped: the membership query runs under the user's JWT, RLS applies, plus `user_id = auth user`), 4 (no personal data in logs: nothing is logged), 6 (no UI string here), 7 (no dependency: `zod`, `@shoebox/domain`, `react`, `next` are already dependencies of `apps/web`).

**Choices made by the brief writer (verified in a scratch copy: 44 unit tests green, typecheck, biome, lint, depcruise clean, 67 e2e green with 0036b on top; do not change):**
- Paths are `apps/web/src/auth/…` (the repo convention since 0030a), not the `apps/web/lib/…` of the backlog line; the test path `apps/web/test/authz.test.ts` is as in the backlog.
- Memberships are read through the Supabase PostgREST client of the user's session (`from('memberships').select('org_id, role, organizations(name)').eq('user_id', …)`), not through Drizzle: `withTenant(orgId)` needs the org first, and the user session is what M11 §13.1 prescribes for `apps/web`. The rows are parsed with zod (`parseMemberships`); anything that does not parse, a PostgREST error or no PostgREST at all (the e2e fake server) counts as **no membership** (fail closed, never fail open).
- Active org = the `shoebox_org` cookie when it names one of the user's memberships, else the first membership (oldest `created_at`), else `null`. The cookie is HttpOnly/Secure/Lax, 1 year. Default (confirm at gate): the cookie, not a column in `memberships.prefs`, so no migration is needed in Phase 0.
- `AuthzResult` has three failure codes: `unauthenticated` (no user), `no_org` (a user without any membership, only from `requireActiveRole`), `forbidden` (everything else, including a malformed org id, a foreign org and an empty role list).
- `getOrgContext` is wrapped in React `cache()`: one Auth call + one PostgREST call per request however many components ask. TODO (later ticket, with 0030d's `getClaims()` note): read the user from verified JWT claims instead of a second `getUser()` round trip.
- `setActiveOrg` lives in `org-actions.ts` already in this brief (a `'use server'` file may export only async functions, so it cannot share a file with the component of 0036b). An unknown or foreign org id changes nothing and still redirects to `/inbox`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/auth/authz.ts` | new | pure: matrix, `authorize`, `resolveActiveOrg`, `parseMemberships` |
| `apps/web/test/authz.test.ts` | new | 44 tests: 32 matrix cells + authorize + cookie + parsing |
| `apps/web/src/auth/org-context.ts` | new | `getOrgContext`, `requireRole`, `requireActiveRole` |
| `apps/web/src/auth/org-actions.ts` | new | `setActiveOrg` server action |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 54–196
Step 2 code: lines 204–350
Step 3 code: lines 358–415
Step 4 code: lines 423–447

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0036a-authz-core origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/src/auth/guard.ts apps/web/src/supabase/server.ts && grep -c 'MEMBER_ROLE_VALUES' packages/domain/src/enums/index.ts`. Expected: the two paths and a number ≥ 1. Otherwise STOP.

**Step 1: `apps/web/src/auth/authz.ts` (new).**

```ts
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 2: `apps/web/test/authz.test.ts` (new).**

```ts
import { describe, expect, it } from 'vitest';
import {
  AUTHZ_ACTIONS,
  type AuthzAction,
  authorize,
  authorizeActive,
  can,
  MEMBER_ROLES,
  type Membership,
  ORG_COOKIE,
  type OrgContext,
  parseMemberships,
  ROLE_MATRIX,
  resolveActiveOrg,
  rolesFor,
} from '../src/auth/authz';

/** M12 §4.4 role matrix, copied row by row: owner · member · accountant · viewer. */
const M12_ROLE_MATRIX: Readonly<Record<AuthzAction, string>> = {
  read: '✓ ✓ ✓ ✓',
  documents_write: '✓ ✓ – –',
  review_answer: '✓ ✓ ✓ –',
  comments: '✓ ✓ ✓ –',
  filings: '✓ ✓ – –',
  accountant_packages: '✓ ✓ ✓ –',
  org_settings: '✓ – – –',
  org_export: '✓ – – –',
};

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORG_X = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

const a: Membership = { orgId: ORG_A, role: 'owner', orgName: 'Testovací OSVČ A' };
const b: Membership = { orgId: ORG_B, role: 'viewer', orgName: 'Testovací OSVČ B' };
const context: OrgContext = { userId: USER, memberships: [a, b], active: a };

describe('role matrix (M12 §4.4)', () => {
  it('has the eight rows and the four roles of the spec', () => {
    expect(AUTHZ_ACTIONS).toEqual(Object.keys(M12_ROLE_MATRIX));
    expect(Object.keys(ROLE_MATRIX)).toEqual([...AUTHZ_ACTIONS]);
    expect(MEMBER_ROLES).toEqual(['owner', 'member', 'accountant', 'viewer']);
  });

  const cases = AUTHZ_ACTIONS.flatMap((action) =>
    MEMBER_ROLES.map((role, index) => ({
      action,
      role,
      allowed: M12_ROLE_MATRIX[action].split(' ')[index] === '✓',
    })),
  );
  it.each(cases)('$action / $role → $allowed', ({ action, role, allowed }) => {
    expect(can(role, action)).toBe(allowed);
    expect(rolesFor(action).includes(role)).toBe(allowed);
    const result = authorize(
      { userId: USER, memberships: [{ orgId: ORG_A, role, orgName: 'A' }], active: null },
      ORG_A,
      rolesFor(action),
    );
    expect(result).toEqual(
      allowed ? { ok: true, orgId: ORG_A, userId: USER, role } : { ok: false, code: 'forbidden' },
    );
  });
});

describe('authorize (deny by default, M12 §4.5 V1.4 / V4.1)', () => {
  it('no user → unauthenticated', () => {
    expect(authorize(null, ORG_A, ['owner'])).toEqual({ ok: false, code: 'unauthenticated' });
  });
  it('member with an allowed role → ok with org, user and role', () => {
    expect(authorize(context, ORG_B, ['viewer', 'owner'])).toEqual({
      ok: true,
      orgId: ORG_B,
      userId: USER,
      role: 'viewer',
    });
  });
  it('member with another role → forbidden', () => {
    expect(authorize(context, ORG_B, ['owner', 'member'])).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });
  it('not a member → forbidden (never "not found", V4.2)', () => {
    expect(authorize(context, ORG_X, MEMBER_ROLES)).toEqual({ ok: false, code: 'forbidden' });
  });
  it('empty role list or malformed org id → forbidden', () => {
    expect(authorize(context, ORG_A, [])).toEqual({ ok: false, code: 'forbidden' });
    for (const bad of ['', 'x', `${ORG_A} `, ORG_A.toUpperCase().slice(1)]) {
      expect(authorize(context, bad, ['owner']), bad).toEqual({ ok: false, code: 'forbidden' });
    }
  });
  it('authorizeActive uses the active org; no membership at all → no_org', () => {
    expect(authorizeActive(context, ['owner'])).toEqual({
      ok: true,
      orgId: ORG_A,
      userId: USER,
      role: 'owner',
    });
    expect(authorizeActive({ ...context, active: b }, ['owner'])).toEqual({
      ok: false,
      code: 'forbidden',
    });
    expect(authorizeActive({ userId: USER, memberships: [], active: null }, ['owner'])).toEqual({
      ok: false,
      code: 'no_org',
    });
    expect(authorizeActive(null, ['owner'])).toEqual({ ok: false, code: 'unauthenticated' });
  });
});

describe('resolveActiveOrg (cookie shoebox_org, M11 §3 switcher)', () => {
  it('cookie naming an own membership wins', () => {
    expect(ORG_COOKIE).toBe('shoebox_org');
    expect(resolveActiveOrg([a, b], ORG_B)).toBe(b);
  });
  it('no cookie, a foreign org or garbage → the first membership', () => {
    for (const value of [undefined, '', ORG_X, 'not-a-uuid', `${ORG_B}; path=/`]) {
      expect(resolveActiveOrg([a, b], value), String(value)).toBe(a);
    }
  });
  it('no membership → null', () => {
    expect(resolveActiveOrg([], ORG_A)).toBeNull();
    expect(resolveActiveOrg([], undefined)).toBeNull();
  });
});

describe('parseMemberships (PostgREST rows → Membership[])', () => {
  it('maps org_id, role and the joined organization name', () => {
    expect(
      parseMemberships([
        { org_id: ORG_A, role: 'owner', organizations: { name: 'Testovací OSVČ A' } },
        { org_id: ORG_B, role: 'accountant', organizations: null },
      ]),
    ).toEqual([
      { orgId: ORG_A, role: 'owner', orgName: 'Testovací OSVČ A' },
      { orgId: ORG_B, role: 'accountant', orgName: '' },
    ]);
  });
  it('fails closed: an unknown role, a bad id or a non-array → no memberships', () => {
    expect(parseMemberships([{ org_id: ORG_A, role: 'staff', organizations: null }])).toEqual([]);
    expect(parseMemberships([{ org_id: '1', role: 'owner', organizations: null }])).toEqual([]);
    expect(parseMemberships(null)).toEqual([]);
    expect(parseMemberships({ org_id: ORG_A })).toEqual([]);
  });
});
```

Command: `pnpm --filter @shoebox/web exec vitest run test/authz.test.ts 2>&1 | tail -8`. Expected: `Test Files  1 passed (1)`, `Tests  44 passed (44)`. Commit.

**Step 3: `apps/web/src/auth/org-context.ts` (new).**

```ts
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 4: `apps/web/src/auth/org-actions.ts` (new).**

```ts
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
```

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -5`. Expected: no `error TS`. Commit.

**Step 5: format, lint, build (no new file).** Command: `pnpm exec biome check --write apps/web 2>&1 | tail -3 && pnpm lint 2>&1 | tail -6 && pnpm depcruise 2>&1 | tail -3 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -6 && git status --short | tail -5`. Expected: `No fixes applied`, lint without errors (`check:tenant-sql: … no Drizzle call on a tenant table outside withTenant()`), `no dependency violations found`, the route table printed, `git status` lists nothing. Commit if anything changed.

## 5. Do not touch

`apps/web/middleware.ts`, `apps/web/src/auth/{session,schemas,last-seen,actions,guard,login-form,logout-buttons}.*`, `apps/web/src/supabase/**`, `apps/web/app/**`, `apps/web/e2e/**`, `packages/**`, `.github/**`. No dependency. No migration. Hard rules 3, 4, 6, 7, 8.

## 6. Commands

- `pnpm --filter @shoebox/web exec vitest run test/authz.test.ts 2>&1 | tail -30` → 44 passed.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors; `pnpm depcruise 2>&1 | tail -30` → no violations.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build 2>&1 | tail -30` → compiled.

## 7. Acceptance (P0-AUTH-02, part a)

- [ ] `authorize(ctx, orgId, roles)` / `requireRole(orgId, roles)` return `{ ok: true, orgId, userId, role }` or the typed `{ ok: false, code: 'unauthenticated' | 'no_org' | 'forbidden' }`; non-member, wrong role, malformed id and empty role list all give `forbidden`.
- [ ] `ROLE_MATRIX` equals the M12 §4.4 matrix; `authz.test.ts` runs 32 cells (8 rows × 4 roles) plus the `authorize`, `resolveActiveOrg` and `parseMemberships` cases: 44 tests green.
- [ ] `getOrgContext()` reads memberships under the user session with `user_id` filter, picks the active org from `shoebox_org` only when it is one of the user's memberships, and yields no membership on any lookup failure.
- [ ] `setActiveOrg` sets `shoebox_org` HttpOnly/Secure/Lax only for an own membership and redirects to `/inbox`.
- [ ] Typecheck, lint, depcruise, build clean; no file outside §3 changed.

## 8. Stop and ask

Stop, and write the report, if:

- the setup `ls`/`grep` fails;
- a test fails twice, or a test this brief wrote seems wrong;
- `tsc` rejects `z.uuid()` or `z.enum(MEMBER_ROLE_VALUES)` (then zod is not 4.x in `apps/web`: report the version, do not change the schema);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0036a-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0036a report" && git push -u origin task/0036a-authz-core 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `authz.ts`: `ROLE_MATRIX` rows against M12 §4.4 (the test file repeats the matrix as ✓/– strings: both copies must match the spec); `authorize` never returns `ok` without a membership row; `isUuid` gate before any comparison.
- `org-context.ts`: the `.eq('user_id', userId)` filter is present (RLS alone shows every member of the org); errors swallow into "no membership", never into "all"; `cache()` keeps it to one lookup per request.
- `org-actions.ts`: the cookie is set only for `membership !== undefined`; `AUTH_COOKIE_OPTIONS` (HttpOnly, Secure, Lax) spread in; redirect target is the constant, not user input.
- Not verified locally: the real Supabase PostgREST run (the fake e2e server has no `/rest/v1` until 0036b; the query shape is the standard embedded-resource select).

## Owner steps

1. None in this part. After 0036b: run the org switcher e2e against the local Supabase CLI once (0036b owner step 1) to confirm the PostgREST query against real RLS.
