# 0327 report

Status: blocked

## Files changed
- apps/web/src/overview/ledger.ts (new): LEDGER_SELECT, toLedgerEntry
- apps/web/src/overview/view.ts: ledgerEntries input, merged totals, unused OverviewTotals import removed
- apps/web/src/overview/load.ts: fourth org-scoped query on tax_ledger_entries
- apps/web/test/overview-ledger.test.ts (new, brief verbatim, unchanged)

## Commands
- `pnpm --filter @shoebox/web typecheck`: clean (no output)
- `pnpm --filter @shoebox/web test -- overview-ledger`: 37 files, 239 tests passed
- `pnpm --filter @shoebox/web test -- overview`: 37 files, 239 tests passed
- `pnpm exec biome check` on the 4 files: 3 errors in brief test file, 1 format issue in it

## Brief section 7
- [x] New and existing overview tests pass; typecheck clean
- [x] The ledger query carries the org filter and the year window

## Deviations
- Stopped at the lint stop condition (brief sec 8, executor rule): the brief-given test file fails biome lint.
  - apps/web/test/overview-ledger.test.ts:24:22 noNonNullAssertion (`toOverviewDocument(docRow)!`)
  - apps/web/test/overview-ledger.test.ts:28:87 noNonNullAssertion (`toLedgerEntry({...})!`)
  - apps/web/test/overview-ledger.test.ts:28:212 noNonNullAssertion (second `toLedgerEntry({...})!`)
  - plus a format-only diff in the same file. Test file left verbatim; `biome check --write` not applied to it.
- Commit labels are not one-to-one with brief steps: step 1 commit holds ledger.ts and view.ts edits, step 2 commit holds load.ts, then format and unused-import follow-ups.
- Test runner filter ignored: `vitest run -- <name>` ran all 37 web test files.

## Questions
- Should the test file's `!` assertions be replaced (e.g., `?? fail()`) or the biome rule allowed for test files? Brief says never edit a brief test, so owner or orchestrator decides.

## Owner steps left
- None. Tell lane D: `totals.source === 'documents'` means no ledger rows for this year yet.
