# 0601 report
Status: review

## Files changed (diff vs base bdd3ded; diff vs claude/project-thread-owbjjp also shows unrelated divergence)
 apps/web/src/podklady/load.ts               |  8 ++-
 packages/db/src/podklady.ts                 | 81 +++++++++++++++++++++++++----
 packages/db/test/podklady.db.test.ts        | 14 +++--
 packages/exports/src/podklady-xlsx.ts       |  7 ++-
 packages/exports/test/podklady-xlsx.test.ts |  8 ++-
 5 files changed, 101 insertions(+), 17 deletions(-)

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
