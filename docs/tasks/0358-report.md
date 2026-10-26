# 0358 report

Status: review

## Files changed

- `packages/domain/src/income-tax/reserve.ts` (new): `computeTaxReserve` and its types
- `packages/domain/src/income-tax/obligations.ts` (new): `incomeTaxObligationsFor` and its types
- `packages/domain/test/tax-reserve.test.ts` (new, brief test with two lint fixes)
- `packages/domain/test/income-tax-obligations.test.ts` (new, brief test verbatim)
- `packages/domain/src/index.ts` (two export lines after the last `./income-tax/` line)

## Checks

- Reserve tests: 6 passed. Obligations tests: 5 passed.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `biome check --write` on the changed files: clean.
- `pnpm depcruise`: no dependency violations (641 modules).
- T-18: `threshold_annual × 9/12 = 1 322 109` (1 762 812 × 9 / 12), matches the brief.
- Golden values: S2 reserve 151 617 / display 151 600; threshold case tax 288 135; DAP due 3. 5. 2027; October advance due 20. 10. 2026.

## Deviations

1. The DAP legal date is read from the `dap` generator in `deadlines.generators` (`fixed_date`, month 5, day 1, year_offset 1) instead of the literal `05-01`, because deadlines live only in rules. The result is the same.
2. Test edits (brief-given test, lint only): `Number(...)` became `Number.parseInt(..., 10)`, and `(n += 1)` moved into a `nextId()` helper. Expected values are unchanged.
3. The DAP is produced when there is a `danova_evidence` or `pausalni_vydaje` segment in the year, or when `pausalniDanReturnRequired` is set and the year has a `pausalni_dan` segment. The brief did not say whether the flag alone is enough.
4. A month counts as covered by a `pausalni_dan` segment when the segment overlaps the month.
5. The advance shift policy (`next_working_day`) is fixed in code as the brief states. It is not read from rules because no rule key holds it.
6. A missing `pausalni_vydaje.rates_caps` entry for the rate throws an error. The brief did not cover this case.

## Questions

None.

## Owner steps left

None.
