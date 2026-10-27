# 0620 report

Status: review

## Files changed (git diff --stat vs 7f8afb2)

- packages/db/src/document-lines-of-reading.ts (new, 82 lines)
- packages/db/test/document-lines-of-reading.test.ts (new, 108 lines)
- packages/db/src/document-reading.ts (+67 lines: imports, lines block after the recap)
- packages/db/src/index.ts (+1 export)
- packages/db/test/document-reading.db.test.ts (+35 lines: lines assertion, new re-read test)

## Commands (last 5 lines)

- `pnpm --filter @shoebox/db exec vitest run test/document-lines-of-reading.test.ts`: "Test Files 1 passed (1)", "Tests 5 passed (5)".
- `pnpm --filter @shoebox/db typecheck`: no errors (tsc exit 0).
- `pnpm exec biome ci packages/db`: "Checked 86 files ... No fixes applied." exit 0.

The db test in `document-reading.db.test.ts` was not run (CI only, per brief §4 step 5).

## §7 acceptance

- [x] linesOfReading exported; 5 unit tests pass.
- [x] saveDocumentReading deletes and re-inserts document_lines after the recap, rounding line last.
- [x] Category carry-over for classification_source = 'user' with same (position, gross) is in code; not exercised by a run (db test is CI only).
- [x] Typecheck and biome clean.

## Deviations

1. index.ts: brief §4 says insert before `export * from './document-categorize';`. That placement fails biome's sort rule. The export is placed directly after `./document-categorize` (sorted). Same line, same module.
2. Biome formatting applied to the two new files (brief §6 allows this). Commit `0620 step 5`.
3. Brief header says Base commit 6e7c134; the branch HEAD at start was 7f8afb2. Worked on 7f8afb2 as found.
4. Worktree: the environment named wt-0622 as primary, but the brief and instructions said wt-0620. Worked in wt-0620 only.

## Questions

- None blocking. The db test seeds a `categories` row via `select code from categories limit 1`; CI must confirm that table has seed data.

## Owner steps left

- Review the branch exec-0620 and open the PR (not done by the executor).
