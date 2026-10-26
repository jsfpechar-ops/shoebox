# 0116 report

Status: review

## 1. Files changed (`git diff --stat b4e8477 HEAD`)

- New: `packages/bank/src/matcher/assign.ts`, `subset-sum.ts`, `paid-at.ts`, `classify.ts`
- New tests: `packages/bank/test/matcher-assign.test.ts`, `subset-sum.test.ts`, `paid-at.test.ts`, `classify.test.ts`
- Edited: `packages/bank/src/matcher/index.ts` (4 re-exports), `packages/bank/src/matcher/types.ts` (1 line, see Deviations)
- 10 files, +1115 / -1. Commits `0116 step 1` to `0116 step 5` (a26dabd to 11d9af1), plus this report.

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/bank exec vitest run test/matcher-assign.test.ts`: `Test Files 1 passed (1)`, `Tests 10 passed (10)`
- `... test/subset-sum.test.ts`: `Test Files 1 passed (1)`, `Tests 6 passed (6)`
- `... test/paid-at.test.ts`: `Test Files 1 passed (1)`, `Tests 10 passed (10)` (1000 seeded runs included)
- `... test/classify.test.ts`: `Test Files 1 passed (1)`, `Tests 7 passed (7)`
- Regression: `test/matcher-score.test.ts` 18 passed, `test/matcher-candidates.test.ts` 19 passed
- `pnpm --filter @shoebox/bank typecheck`: no output after `tsc -p tsconfig.json` (clean)
- `pnpm biome check packages/bank`: `Checked 40 files in 3s. No fixes applied.` (0 errors)
- Acceptance grep for `Number(` / `parseFloat` in subset-sum, paid-at, assign: no output.

## 3. Section 7

- [x] Four test files pass (assertions unchanged)
- [x] `assign` idempotent test passes
- [x] No `Number(` / `parseFloat` in the three files
- [x] Category codes are those of section 2 only

## 4. Deviations

1. `SuggestionDraft` has an extra `documentId: string` field next to `documentIds`. The brief's `ids()` helper in the verbatim test reads `.documentId` on suggestions; without the field three assign tests fail.
2. `types.ts` (outside section 3): `CandidateScore.dueDate` is now `LegalDate | undefined`. The verbatim test passes `dueDate: undefined` and typecheck fails under `exactOptionalPropertyTypes`.
3. Test files: non-null assertions replaced to satisfy biome `noNonNullAssertion`. `]!.` became `]?.`; one `types[...]!` became `?? 'payment'` (paid-at property test). No assertion changed.
4. Biome `--write` reformatted the new files (formatting only).

## 5. Questions

- The caps 0.89 (unique) and 0.75 (ambiguous) in `subset-sum.ts` are named constants, not `MATCHER_CONFIG` entries. Rule 1 puts rates in `packages/domain/rules`; should they move there?
- `paidThreshold` for foreign currency relies on `Money.toFixed2` rounding half-up (250.50 EUR gives 248.00 in the test). The test passes.

## 6. Owner steps left

None.
