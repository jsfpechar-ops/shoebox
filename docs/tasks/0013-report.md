# 0013 report: testkit scaffold (P0-TEST-01)

Status: review. Branch `task/0013-testkit-factories`, base `phase/0` (HEAD 89c392d).

## 1. Files changed (`git diff --stat origin/phase/0`)

```
packages/testkit/package.json              |   3 +
packages/testkit/src/clock.ts              |  37 ++++++++
packages/testkit/src/factories/index.ts    |  16 ++++
packages/testkit/src/factories/registry.ts |  68 ++++++++++++++
packages/testkit/src/ids.ts                |  30 ++++++
packages/testkit/src/index.ts              |   3 +
packages/testkit/test/factories.test.ts    | 141 +++++++++++++++++++++++++++++
pnpm-lock.yaml                             |   4 +
```

## 2. Commands

- `pnpm install --frozen-lockfile`: `Done in 1.3s`. After step 1, `pnpm install`: lockfile diff is the testkit importer only (4 lines, `link:../domain`).
- `pnpm --filter @shoebox/testkit test -- factories 2>&1 | tail -8`: `Test Files 2 passed (2)`, `Tests 15 passed (15)`. The filter also matched one pre-existing test file; the 14 tests in `factories.test.ts` all pass.
- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`: no `error TS` (exit 0).
- `pnpm lint 2>&1 | tail -30`: exit 0; one `info` line (biome config migration hint, pre-existing), no errors.
- `pnpm depcruise 2>&1 | tail -30`: `no dependency violations found (88 modules, 89 dependencies cruised)`.

## 3. Section 7 ticked

- [x] `factoryFor(table)` throws for an unknown table (fresh registry and shared `factoryFor`).
- [x] Fake clock advances deterministically and only when told.
- [x] typecheck, lint and depcruise clean.
- [x] `git diff --stat origin/phase/0` lists only §3 files.

## 4. Deviations and findings

- Step 8 (formatting): lint reported no formatting issues, so no `biome --write` run and no step-8 commit.
- The brief said "`Tests 14 passed`" for the filter; the filter also ran one pre-existing testkit test file, so the total is 15. Not a failure.
- Step 6 and step 1 edits used Edit after a Read of the one-line `index.ts` and `package.json` (the tool requires a Read before Edit).
- Brief 0004 lockfile interaction: not exercised here (phase/0 at 89c392d already includes Money). No conflict.

## 5. Questions

None.

## 6. Owner steps left

None. Orchestrator opens and merges the PR into `phase/0`.
