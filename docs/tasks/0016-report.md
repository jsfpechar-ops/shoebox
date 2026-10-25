# 0016 report: named rounding functions

Status: review. Branch `task/0016-rounding`, base `phase/0` at c2c0a46 (verified an ancestor of origin/phase/0).

## Files changed (`git diff --stat origin/phase/0`)

- `packages/domain/src/money/errors.ts`: +12 (InvalidVatRateError)
- `packages/domain/src/money/index.ts`: export the new error and rounding functions
- `packages/domain/src/money/rounding.ts`: new, 107 lines
- `packages/domain/test/rounding.test.ts`: new, 402 lines
- `docs/tasks/0016-rounding.md`: Status set to review
- `docs/tasks/0016-report.md`: this report

`src/index.ts`, `money.ts`, `package.json` and `pnpm-lock.yaml` are untouched.

## Commands (last lines)

1. `pnpm --filter @shoebox/domain test rounding`: `Test Files 1 passed (1)`, `Tests 26 passed (26)`.
2. `pnpm --filter @shoebox/domain test money`: `Test Files 1 passed (1)`, `Tests 31 passed (31)`. The brief expected 32; the count is 31 and all pass (see Deviations).
3. `pnpm --filter @shoebox/domain typecheck`: exit 0, no `error TS`.
4. `pnpm lint`: `Checked 129 files`, `Found 1 info`, no errors. The info is the existing Biome config migration notice.
5. `pnpm depcruise`: `no dependency violations found (90 modules, 97 dependencies cruised)`.
6. `pnpm test:unit`: `Test Files 30 passed (30)`, `Tests 230 passed (230)`. Coverage Lines 99.52 % (416/418) for the domain package and all others; gate ≥ 90 % met.

## Section 7 (acceptance)

- [x] Examples for vatForRate, round0, floor100, roundingLineAllowed and roundCash are in the test file and pass.
- [x] Property tests pass with the brief's numRuns.
- [x] `@ts-expect-error` lines compile under typecheck.
- [x] `rounding test` green (26 tests); unit coverage ≥ 90 % lines.
- [x] `pnpm lint` and `pnpm depcruise` pass.
- [x] Reachable through the existing `export * from './money/index'`; `src/index.ts` not edited.

## Deviations

- Step 2 and step 3 were committed together as `0016 step 2` (one commit covers rounding.ts plus index.ts). Step 1 is `0016 step 1`, step 4 is `0016 step 4`.
- The money test count is 31, not 32 as §6 states. No test was edited; the count in the brief is off by one.

## Questions

- None. The three reviewer decisions in the brief's risk list (sign handling of floor*, roundingLineAllowed currency rule, InvalidVatRateError) are as written.

## Owner steps left

- Orchestrator opens the PR `task/0016-rounding` into `phase/0` and merges after CI.
