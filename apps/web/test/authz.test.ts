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
