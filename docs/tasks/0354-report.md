# 0354 report

Status: review
Branch: wt-0354 (not pushed, no PR)

## Files changed

- `packages/domain/src/income-tax/answers.ts` (new): `podkladyAnswersSchema`, `PodkladyAnswers`, `EMPTY_ANSWERS`, `FLAT_RATES`, `FlatRate`, `YES_NO_UNKNOWN`
- `packages/domain/src/income-tax/readiness.ts` (new): `ProfileSegment`, `ReadinessInput`, `ReadinessCheck`, `segmentsInYear`, `checkPodkladyReadiness`, `isBlocked`
- `packages/domain/test/readiness.test.ts` (new, verbatim from brief)
- `packages/domain/src/index.ts` (+2 export lines)

## Commands (last 5 lines each)

- `pnpm --filter @shoebox/domain exec vitest run test/readiness.test.ts 2>&1 | tail -30`
  ```
   Test Files  1 passed (1)
        Tests  7 passed (7)
  ```
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`
  ```
  > @shoebox/domain@0.0.0 typecheck /home/user/wt-0354/packages/domain
  > tsc -p tsconfig.json
  ```
  (no errors)
- `pnpm exec biome check --write <4 changed paths> 2>&1 | tail -30`
  ```
  Checked 4 files in 1188ms. Fixed 3 files.
  ```
  Re-check after: `Checked 4 files in 442ms. No fixes applied.`
- `pnpm depcruise 2>&1 | tail -3`
  ```
  ✔ no dependency violations found (620 modules, 1794 dependencies cruised)
  ```

## Brief §7 acceptance

- [x] Every `P_*` code is produced by a test. `P_REGIME_UNSUPPORTED` is the only blocking code. `rodneCislo` never parses (schema is `z.strictObject`).

## Deviations

- Commits: steps 1 to 3 committed as `0354 step k` (executor rule). Step 4 and 5 are one commit with the brief's feat message, on `index.ts`.
- `packages/domain/src/index.ts`: biome sorted the two new export lines to after `./fx`, not after `./ledgers/tax` as the brief said. Biome is the repo lint, so I kept its order.
- Biome reformatted `answers.ts`, `readiness.ts` and the test (formatting only, no behavior change).
- The brief gave signatures only for `checkPodkladyReadiness`, `segmentsInYear` and `isBlocked`. I wrote the bodies from the §2 table (table order, `[validFrom, validTo ?? ∞]` overlap, `toFixed2()` for sums).
- Test run used `exec vitest run test/readiness.test.ts` (the executor check form) instead of `test -- readiness`.

## Questions

None.

## Owner steps left

None.
