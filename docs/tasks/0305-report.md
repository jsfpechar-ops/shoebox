# 0305 report

Status: review
Brief: docs/tasks/0305-vat-point-date.md | Worktree: wt-0305 | Not pushed, no PR.

## Files changed (git diff --stat 31f3746 HEAD)

- packages/domain/test/vat-point-date.test.ts (new, 13 tests; step 1 verbatim, then biome formatting only)
- packages/domain/src/vat/point-date.ts (new, step 2; biome formatting and class-precedence constants in step 3)
- packages/domain/src/index.ts (+1 export line, step 3)

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- vat-point-date`: exit 0. `Test Files 18 passed (18)`, `Tests 379 passed (379)`. Note: the filter did not restrict vitest, so all 18 domain files ran; the 13 new tests are among the 379.
- `pnpm --filter @shoebox/domain typecheck`: exit 0, no errors.
- `pnpm exec biome check packages/domain`: exit 0. `Checked 50 files ... No fixes applied.`

Before step 1 the test run failed as expected (`Cannot find module '../src/vat/point-date'`).

## Section 7

- [x] Test file green, unchanged in content (formatting only; trailing-comma normalized diff against step 1 is empty).
- [~] `62` absent from point-date.ts. The literal `2` appears only in `padStart(2, '0')` date formatting, not as a rule value.
- [x] Commits `0305 step 1..3`; no push.

## Commits

- 9cba169 0305 step 1
- 7c1dc3b 0305 step 2
- c46262e 0305 step 3
- e557524 0305 biome format test
- this commit: 0305 report

## Deviations

- `deriveVatPointDate` returns null before calling `profileAt` when both `duzp` and `issue_date` are missing. The profile is requested at `duzp ?? issue_date`, so there is no date to ask for.
- Class precedence uses the named constants `self_assessed`, `domestic`, `issued` instead of numbers (no behavior change). The "62-day" comment wording became "service-span guard".
- Biome formatting was applied to the test file (`--write`), as allowed.

## Questions

- None blocking.

## [verify] items (not checked by the executor, for the reviewer)

- M04 §4.8: "long prepaid periods fall back to issue/payment date" (advisor).
- M05 §4.1: "SH always monthly".

## Owner steps left

- None.
