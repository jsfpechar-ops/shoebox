# 0348 report

Status: blocked

Done: step 1 (refactor of `apps/worker/src/vat/service.ts`: `computePeriod` factored out, used by `evaluatePeriod` and `generateBundle`).
Left: steps 2 to 4 (`amendment-detect.ts`, `updateFilingTotals` in `packages/db/src/filings.ts`, the five-case test with the 0344 store helper, register and the detect enqueue in `evaluatePeriod`).

## Files changed (step 1)

- `apps/worker/src/vat/service.ts` (49 insertions, 22 deletions)

## Checks

- `pnpm --filter @shoebox/worker exec vitest run filing-lifecycle 2>&1 | tail -30`: 8 passed, 8 total.
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`: clean.
- `pnpm exec biome check --write apps/worker/src/vat/service.ts 2>&1 | tail -30`: no fixes.
- `pnpm depcruise 2>&1 | tail -3`: no dependency violations.

## Deviations

- `computePeriod` takes the internal `Ctx` instead of `VatDeps`, and returns `profile` too (via the `Loaded` spread), because `generateBundle` needs the profile for the header.
- `evaluatePeriod` now also computes `kh` (via `computeKh`) when the verdict is simple and the status is `platce`. Before, only `dp3` and SHV were computed there. A throw in `computeKh` would now surface on the evaluate path too. Not observed in tests.
- In `generateBundle`, the pure `dp3`/`kh`/SHV computation now runs before the header-missing check instead of after it.

## Questions

- None for step 1. The remaining steps need the filed-snapshot reconstruction (`filing_documents`, `filing_entries`) and the 0344 in-memory store helper. Both were out of this session's budget.

## Owner steps left

- None.

Not pushed. No PR opened (the instructions say not to push).
