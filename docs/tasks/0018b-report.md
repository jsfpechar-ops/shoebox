# 0018b report: fake registries in testkit

Status: review. Branch `task/0018b-fake-registries`, based on `origin/phase/0` (ed0f917 rebased onto 85c3f6e, which includes 0014b).

## 1. Files changed (vs origin/phase/0)

- `packages/testkit/package.json` (+1 dependency `@shoebox/registries: workspace:*`)
- `pnpm-lock.yaml` (+3, testkit importer only)
- `packages/testkit/src/registries/fakes.ts` (new, 170 lines)
- `packages/testkit/src/registries/index.ts` (new)
- `packages/testkit/src/index.ts` (+1 export line)
- `packages/testkit/test/registries-fakes.test.ts` (new, 197 lines, unchanged from the brief)
- `docs/tasks/0018b-fake-registries.md` (Status: review)
- `docs/tasks/0018b-report.md` (this file)

## 2. Commands

- `pnpm --filter @shoebox/testkit test registries-fakes`: `Tests 14 passed (14)`
- `pnpm --filter @shoebox/testkit test`: `Test Files 3 passed (3)`, `Tests 29 passed (29)`
- `pnpm --filter @shoebox/testkit typecheck`: no `error TS` (tsc exited with no output)
- `pnpm lint`: biome `Checked 153 files ... No fixes applied.` then `Found 1 info.` The info is a biome config migration hint (`biome migrate`), not an error. The i18n check after it passed (24 tests).
- `pnpm depcruise`: `no dependency violations found (118 modules, 163 dependencies cruised)`

## 3. Acceptance (§7)

- [x] Known IČO returns the recorded subject (test passes).
- [x] `simulate('unavailable')` returns `unavailable` with `reason: 'http_error'`.
- [x] CRPDPH status codes 1/2/3 representable (1 ok with statusCode 1, 2 `crpdph_outage`, 3 `crpdph_unavailable`).
- [x] Testkit typecheck, lint and depcruise clean (lint info only, see above).
- [x] Diff lists only the §3 files plus the reports.

## 4. Deviations

- Setup: used `origin/phase/0` as the brief's step 0 said (per the executor instruction), not `task/0018-registries`. Rebased onto `origin/phase/0` after 0014b merged into it during the run; no conflicts.
- Commit `0018b status` (not in the brief) carries the Status line change.
- No `[verify]` items in this brief.

## 5. Questions

None.

## 6. Owner steps left

Open the PR `task/0018b-fake-registries` into `phase/0` (not done by the executor).
