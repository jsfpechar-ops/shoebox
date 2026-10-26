# 0356 report: `checkPausalniDan`

Status: review

## Files changed (`git diff --stat`)

- `packages/domain/src/income-tax/pausalni-dan.ts` (new): `pausalniDanLimit`, `fitPausalniDanBand`, `checkPausalniDan` and types, as in brief §4 step 1.
- `packages/domain/test/pausalni-dan.test.ts` (new): brief §4 step 2 verbatim, then reformatted by Biome `--write`.
- `packages/domain/src/index.ts`: one export line added.

## Commands (last lines)

- `pnpm --filter @shoebox/domain exec vitest run test/pausalni-dan.test.ts`: Test Files 1 passed, Tests 12 passed.
- `pnpm --filter @shoebox/domain typecheck`: `tsc -p tsconfig.json` ran with no errors.
- `pnpm exec biome check --write` on the 3 changed files: "Checked 3 files. Fixed 2 files." Re-check without write: "No fixes applied."
- `pnpm depcruise`: "no dependency violations found (639 modules, 1870 dependencies cruised)."

## Acceptance (§7)

- [x] S1: 109 944 = 109 944, band 1, noticeDue 2027-01-11, October due 2026-10-20. Every warning code is produced once in the eligibility test.
- [ ] TA-12 `[verify]` not checked against a primary source in this run. Findings: the code uses the brief defaults (December advance counted by `bookedOn` year; `pd.band_exceeded` and `pd.regime_limit_exceeded` are copy-only warnings, consequences unknown). The `[verify]` stays open.

## Deviations

- `Money` and `CZK` are value imports (not type-only): `Money.parse` needs the value.
- `segmentsInYear` from `./readiness` is used for the vat_payer year filter (same overlap rule as the brief's inline wording).
- The brief's `./income-tax/flat-rate` line does not exist, so the export was added after `./income-tax/answers`, per the brief's fallback (0355 not merged).
- Guards added that the brief did not spell out: `bandRow` throws if a band is missing from the rule; `pausalniDanLimit` throws if no ceiling applies.
- `overview/meters.ts` untouched (per §5). Its ceiling logic is still duplicated, as the brief expects.

## Questions

- None blocking.

## Owner steps left

1. Accountant question (TA-12, see brief Owner steps): consequences of exceeding the band ceiling mid-year, and which year a December advance paid in January belongs to.
