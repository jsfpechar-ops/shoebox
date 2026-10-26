# 0308 report: buildTaxLedgerEntries

Status: review
Executor: Haiku 5.5 | Branch: wt-0308 | Commits: 0308 step 1, step 2, step 3, 0308 report (no push, no PR)

## Files changed

- `packages/domain/test/tax-ledger.test.ts` (create; extracted verbatim from the brief, then biome formatting only)
- `packages/domain/src/ledgers/tax.ts` (create)
- `packages/domain/src/index.ts` (one export line; biome also reordered the two existing `vat/*` export lines)

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- tax-ledger`: `Test Files 22 passed (22)`, `Tests 506 passed (506)`. The filter ran the whole domain package; `tax-ledger` is included.
- `pnpm --filter @shoebox/domain typecheck`: exit 0, no errors.
- `pnpm exec biome check packages/domain`: `Checked 58 files`, no errors.

## Acceptance (§7)

- [x] Test file green and unchanged after formatting (AC-9a, 9g, 9i, 9j, 9k, 9l, AC-11, credit-note netting).
- [x] Numeric literals in `tax.ts`: only ±1, 0, 100 and the `REMAINDER_TOLERANCE = '0.01'` with its TODO. `LEDGER_ALGO_VERSION = 1` exported.
- [x] Commits `0308 step 1..3`; no push.

## Deviations

- Brief silent, chosen: a foreign-currency provisional or synthetic amount is converted at the ČNB rate on the plan's date (same as rule 2/3).
- Brief silent, chosen: "no links" means no non-`fx_difference` links.
- Brief silent, chosen: a document with no `vatPointDate` and no `issueDate` (or no due/paid date where needed) throws `LedgerInputError`.
- `convertToCzk` does not round, so the result is wrapped in `round2`.
- Biome `organizeImports` reordered `vat/treatment` and `vat/point-date` in `index.ts`. Only a reorder of existing lines.
- Biome reformatted the test file (line breaks only, about 375 changed lines). No assertion changed.
- The first typecheck run printed truncated output. Reruns exit 0, and the only cause I can see is the biome fix to `taxYear` (`Number()` replaced by `Number.parseInt`, required by no-number-money).

## [verify] findings (not checked against a primary source; no web check was run)

- TA-06: VAT as cost per §4.11.1 (IO and non-payers). No separate income-tax expense line for self-assessed VAT is produced. Needs a primary-source check by the owner or reviewer.
- TA-07: tourist fee (`pass_through`) is excluded from income and expense totals by the statement golden test.

## Questions

- Should a foreign-currency provisional remainder use the ČNB rate on `dueDate ?? issueDate`? This is the implemented choice.

## Owner steps left

None.
