# 0316 report

Status: blocked

## Files changed
- `packages/domain/src/taxonomy/summary.ts` (new): `buildSummary`, `monthLabel`, `periodLabel`, `SUMMARY_MAX_LENGTH`, `MONTH_NAMES_EN`, `SummaryInput`.
- `packages/domain/test/summary.test.ts` (new, verbatim from brief, not edited).

## Commands
- `pnpm --filter @shoebox/domain test -- summary 2>&1 | tail -30`: 8 of 9 pass. Fails: `payer with deduction, quarterly period label, year suffix when not the asOf year`.
- Not run (stopped before): step 3 typecheck, `pnpm eval --quick`.

## Stop condition (brief 8, a test seems wrong)
The failing test expects a 133-character string:
`AI tool subscription for November–December 2025 – tax-deductible expense, you declare and deduct VAT 21 % in the return for Q4 2025`
The brief's rule says the summary is at most 120 characters and the subject is truncated with "…" first. Every truncation rule that respects 120 cuts the subject `AI tool subscription` to about 7 characters, so the expected string cannot be produced. The brief's "never exceeds 120" test and this golden contradict each other. Owner decision needed: which one wins.

## Deviations
- Step 1 implementation was written from the brief's signatures and rules (the brief gave no body). Choices not specified in the brief: `deductible_expense` with `not_applicable` renders "expense"; a self-assessed VAT with no `vatPeriod` renders "you pay VAT x % yourself" without a return clause.
- Added: VAT clause is omitted when `taxEffect` is `private` (needed for golden h, Decathlon). Test now passes.
- Commit `0316 step 2` includes that fix.
- Done: steps 1 and 2. Left: step 3 (index export and typecheck), commands in §6.

## Questions
1. Should the 120-character limit or the golden `AI tool subscription ...` (133 characters) win? Options: (a) keep 120 and change the test expectation to a truncated subject; (b) allow the VAT and period clauses to exceed 120 and cap only the subject.

## Owner steps left
None.
