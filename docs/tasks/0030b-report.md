# 0030b report: login page and magic-link callback

Status: review. Branch task/0030b-login-page, base origin/phase/0.

## Files changed (`git diff --stat origin/phase/0`)

```
 apps/web/app/(auth)/layout.tsx          |  19 ++++++
 apps/web/app/(auth)/prihlaseni/page.tsx |  34 ++++++++++
 apps/web/app/auth/callback/route.ts     |  39 ++++++++++++
 apps/web/src/auth/actions.ts            |  94 +++++++++++++++++++++++++++
 apps/web/src/auth/login-form.tsx        | 109 ++++++++++++++++++++++++++++++++
 5 files changed, 295 insertions(+)
```

Commits: `0030b step 1` (858eae6), `step 2` (78daca3), `step 3` (6e93618), `step 4` (c7eb5ae), `step 5` (1da9d1b).

## Commands (§6), last lines

- `pnpm --filter @shoebox/web typecheck`: no `error TS` lines after each step (checked in steps 1 to 5).
- `pnpm lint`: check:tenant-sql passed, "95 files, no Drizzle call on a tenant table outside withTenant()". No lint errors shown in the tail.
- `pnpm depcruise`: `no dependency violations found (225 modules, 436 dependencies cruised)`.
- `next build` (web): routes listed include `ƒ /auth/callback` and `ƒ /prihlaseni` (25 kB, 148 kB first load).
- `pnpm exec biome check --write apps/web`: "Checked 40 files in 2s. No fixes applied." `git status` clean after the build.
- `playwright test --project desktop-chromium --project mobile-chromium`: `32 passed (55.2s)`, 0 failed.

## Acceptance (§7)

- [x] Build lists `/prihlaseni` and `/auth/callback`.
- [x] `actions.ts`: zod schemas, `mapAuthError`, `touchLastSeen` and `safeNextPath` as written in the brief (code copied verbatim).
- [x] `/auth/callback` failure path redirects to `/prihlaseni?reason=link` (code copied verbatim; not exercised by a test in this ticket).
- [x] No literal strings in JSX (lint passed); no `@shoebox/ui` import in a server component.
- [x] Existing E2E: passes (see deviation on count).

## Deviations

- The brief expects `36 passed`; the run reports `32 passed`, 0 failed, 0 skipped shown. Not investigated (no explore rule). Owner or orchestrator to decide whether the expected count is stale.
- `git add` was run per file, not `git add -A`, to avoid accidental files.
- No screenshots (no UI test run requested by §6/§7 for this brief).

## Questions

- Confirm the E2E expected count (36 vs 32).

## Owner steps

None yet (env names and the Supabase settings come with 0030d).
