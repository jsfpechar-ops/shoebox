# 0072 report: review (fix-1 finished 0072 steps 5 to 7)

Branch: task/0072-deadlines. Steps 1 to 4 from the first run, then 0072-fix-1 step 1 (typed import) and step 2 (0072 steps 5 to 7).

## 1. Files changed

- packages/domain/src/rules/cz/deadlines.ts (fix-1 step 1: `import type { RuleSet }`, three constants annotated, no value change)
- packages/domain/test/overview-deadlines.test.ts (new, 0072 §4 step 5, verbatim)
- packages/domain/src/overview/deadlines.ts (new, 0072 §4 step 6: czHolidays, isCzWorkingDay, shiftDate, upcomingDeadlines)
- docs/tasks/0072-deadlines.md and docs/tasks/0072-fix-1.md: Status set to review

## 2. Commands (last lines)

- `pnpm --filter @shoebox/domain test -- rules 2>&1 | tail -30` (after fix step 1): Test Files 9 passed (9); Tests 263 passed (263).
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` (after fix step 1): tsc, no error lines.
- `pnpm --filter @shoebox/domain exec vitest run test/overview-deadlines.test.ts 2>&1 | tail -30`: Tests 8 passed (8).
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30` (final): tsc, no error lines.
- `pnpm exec biome check packages/domain 2>&1 | tail -30`: first run found 2 issues in overview/deadlines.ts (import order, format). `biome check --write` on that one file fixed them. Final run: "Checked 35 files in 2s. No fixes applied." Clean.
- `pnpm --filter @shoebox/domain test -- rules overview-deadlines 2>&1 | tail -30`: Test Files 10 passed (10); Tests 271 passed (271).

## 3. Deviations and unsure

- Step 6 module: biome reformatted it and sorted imports. Logic and exported signatures are as the brief says.
- The purity test passes now because the step 1 import exists. Test files were not edited.
- No PR opened, no push to main or phase/0.

## 4. Owner steps left

- Review the branch and open or merge the PR into phase/0 as the workflow says.
