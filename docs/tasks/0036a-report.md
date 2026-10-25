# 0036a report: role matrix, org context and requireRole

Status: review
Branch: task/0036a-authz-core (base origin/phase/0)

## Files changed (`git diff --stat origin/phase/0`)

```
apps/web/src/auth/authz.ts       | 143 +++++
apps/web/src/auth/org-actions.ts |  25 +++
apps/web/src/auth/org-context.ts |  58 +++
apps/web/test/authz.test.ts      | 147 +++
4 files changed, 373 insertions(+)
```

## Commands (last lines)

- `pnpm --filter @shoebox/web test test/authz.test.ts` (same suite as the brief's `exec vitest run`): `Test Files 1 passed (1)`, `Tests 44 passed (44)`.
- `pnpm --filter @shoebox/web typecheck`: no output, no `error TS`.
- `pnpm exec biome check --write apps/web`: `Checked 56 files in 4s. No fixes applied.`
- `pnpm lint`: `check:tenant-sql: 108 files, no Drizzle call on a tenant table outside withTenant()`
- `pnpm depcruise`: `no dependency violations found (251 modules, 505 dependencies cruised)`
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @shoebox/web build`: compiled, route table printed (Middleware 95.6 kB).
- `git status --short`: empty.

## Section 7 acceptance

- [x] authorize / requireRole return typed results; non-member, wrong role, malformed id, empty role list give `forbidden`.
- [x] ROLE_MATRIX equals M12 §4.4; 44 tests green.
- [x] getOrgContext reads memberships under the user session with the user_id filter; cookie used only when it is an own membership; lookup failure gives no membership.
- [x] setActiveOrg sets the cookie only for an own membership and redirects to DEFAULT_AFTER_LOGIN (the brief says `/inbox`; the constant is used as the brief's code gives it).
- [x] Typecheck, lint, depcruise, build clean; no file outside section 3 changed.

## Deviations

- Done: steps 1 to 5 (all). Commits: step 1 262b290, step 2 081b982, step 3 f7ace2b, step 4 688e5df, step 5 no changes.
- Test command: used `pnpm --filter @shoebox/web test test/authz.test.ts` per the executor instruction (the brief's `exec vitest run` form gives the same result).
- No PR opened (per orchestrator instruction).

## Questions

- None.

## Owner steps left

- None in this part. After 0036b: run the org switcher e2e against the local Supabase CLI once to confirm the PostgREST query against real RLS.
