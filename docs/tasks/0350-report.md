# 0350 report

Status: blocked
Done: steps 1 to 3 (createXlsxWorkbook, vat-workbook sheets and tests), step 4 code (worker job, registration, typecheck). Left: step 4 test `apps/worker/test/vat-workbook-job.test.ts` (needs a ledger fixture: copy the profile, entry and document helpers from `apps/worker/test/filing-lifecycle.test.ts`), then step 5 commit.

## Files changed
- packages/exports/src/xlsx.ts: createXlsxWorkbook; createXlsx is a one-sheet wrapper.
- packages/exports/src/index.ts: exports createXlsxWorkbook, XlsxSheet, buildVatWorkbook, vatWorkbookSheets, VatWorkbookInput, WorkbookEntry.
- packages/exports/src/vat-workbook.ts (new), packages/exports/test/vat-workbook.test.ts (new).
- apps/worker/src/vat/workbook.ts (new), apps/worker/src/vat/register.ts, apps/worker/src/vat/service.ts (exports only), apps/worker/package.json (+@shoebox/exports workspace dep), pnpm-lock.yaml.

## Checks
- `pnpm --filter @shoebox/exports test` 16 of 16 passed (includes xlsx and vat-workbook tests).
- `pnpm --filter @shoebox/exports typecheck` passed. `pnpm --filter @shoebox/worker typecheck` passed.
- `pnpm depcruise` no violations. Biome check --write run on every changed file.
- Worker job test not run (not written).

## Deviations
- Ledger sheet has 20 columns: Document ID is first, then the 19 fields of the brief's list. The brief says 19.
- Partner name and received date are always null. readPeriodLedger does not return them. Extending it is a 0343 change, so it needs an owner or orchestrator decision.
- service.ts: exported loadPeriod, resolve, Ctx, Loaded, Skipped, no logic change, so workbook.ts reuses the 0344 period load instead of duplicating it.
- Workbook totals use toFixed2 (decimal strings), not wholeKc.
- Step 2-3 are one commit. Step 4 is committed without its test.

## Questions
- Should readPeriodLedger return partner name and received date for the workbook?
- Should the worker test use the filing-lifecycle fixtures as is?

## Owner steps left
1. Decisions line: "2026-10-26 VAT workbook sheet names/headers in English until cs.json wakes (rule 6)".
