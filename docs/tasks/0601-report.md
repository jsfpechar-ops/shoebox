# 0601 report
Status: review

## Files changed (git diff --stat claude/project-thread-owbjjp)
 packages/domain/src/vat/kh.ts                 |  40 +-
 packages/domain/test/classify-period.test.ts  |   6 +-
 packages/domain/test/dphdp3-deduction.test.ts | 122 ------
 packages/domain/test/kh-deduction.test.ts     |  87 ----
 packages/domain/test/rules-values.test.ts     |   2 +-
 packages/exports/src/podklady-xlsx.ts         |   7 +-
 packages/exports/test/podklady-xlsx.test.ts   |   8 +-
 21 files changed, 161 insertions(+), 924 deletions(-)

## Commands
- exports typecheck: clean. exports test podklady-xlsx / podklady-pdf: Test Files 8 passed, Tests 51 passed (both).
- db typecheck: clean. web typecheck: clean.
- db test podklady: 3 files passed, 32 skipped, 29 passed, 171 skipped (no DATABASE_URL). DB test not run here, CI runs it.

## Acceptance
- [x] XLSX Summary: Expenses 98460.00, Expenses before rounding 98459.81 (xlsx test green)
- [ ] EUR 100 at 25 -> 2500.00 and ledger-based totalCzk: assertions written, DB test not run here, CI runs it
- [x] Typechecks green; exports tests green

## Deviations
- Steps 1 and 2 share one commit (0601 step 1). Step 4 commit has no other callers to fix.
- Step 5d: used destructured privateUseFxMissing from read(A) instead of rows.privateUseFxMissing.
- Seed D_EUR uses status finalized (no existing personal row to copy).
- Money.fromDecimal and domain exports (resolveFxRate, convertToCzk, round2, Currency) worked as given.

## Questions
- None.
