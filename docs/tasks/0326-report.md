# 0326 report

Status: review

## Files changed
- packages/domain/src/overview/ledger-totals.ts (new): computeLedgerTotals, mergeOverviewTotals
- packages/domain/test/overview-ledger-totals.test.ts (new, brief text verbatim, biome-formatted only)
- packages/domain/src/index.ts (one export line after overview/totals)

## Commands
- `pnpm --filter @shoebox/domain test -- overview-ledger-totals`: Test Files 24 passed (24), Tests 533 passed (533). The package script ignores the filter, so the whole domain package ran.
- `pnpm --filter @shoebox/domain typecheck`: clean, no errors.
- `pnpm --filter @shoebox/domain test -- overview`: same run, 533 passed.
- `pnpm exec biome check --write` on the 3 files: formatting only.

## Checklist (§7)
- [x] Tests pass; typecheck clean; existing overview tests unchanged.
- [x] No `Number(` in the new file.

## Deviations
- The brief's step 1 gave signatures only (no bodies). I implemented the bodies. Kept signatures and types as given.
- `Money` is a value import, not `import type`, since `Money.parse` and `Money.zero` are used. `CZK` constant used instead of the string 'CZK'.
- Expense and income effect sets: expenses are `deductible_expense` only, as the test requires (`asset`, `private`, `non_deductible_expense` excluded). `entryCount` counts all rows in the ytd window, including excluded effects, as the test requires (8).
- `provisional` in the merge result always comes from the ledger (zero when empty).

## Questions
None.

## Owner steps left
None.

Commits: step 1 (7c8442f), step 2 (test), step 3 (index), step 2 biome format (8651afd), report (see below).
