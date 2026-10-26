# 0348 report

Status: review

Done: steps 1 to 4. `computePeriod` factored out (step 1); `amendment-detect.ts`, `updateFilingTotals`, register, detect enqueue in `evaluatePeriod`, five-case test.

## Files changed

`apps/worker/src/vat/service.ts`, `amendment-detect.ts` (new), `register.ts`, `packages/db/src/filings.ts`, `apps/worker/test/amendment-detect.test.ts` (new), `test/helpers/vat-store.ts` (new, 0344 store and fixtures moved), `test/filing-lifecycle.test.ts` (imports only).

## Checks

- `vitest run amendment-detect filing-lifecycle registry`: all pass (5 new, 8 unchanged).
- worker and db `typecheck`: clean. `biome check`: clean. `pnpm depcruise`: no violations.
- DB tests not run (the new db helpers have no DB test).

## Deviations

- `computePeriod`, `resolve`, `formInfo`, `stateChanged` and their types are now exported from `service.ts`; `computePeriod` takes the internal `Ctx`.
- `evaluatePeriod` also computes `kh` for simple payer periods; `generateBundle` computes before the header check (step 1).
- Extra db helpers in `filings.ts`: `readFilingDocuments` and `upsertAmendmentObligation` (the existing obligation upsert cannot write `filing_id` or the `vat_amendment` kinds). They live in a separate `AmendStore` (in `amendment-detect.ts`, injected via `deps.amendStore`) so `VatStore` and the 0344 test stay unchanged.
- Filed KH/SHV snapshots are rebuilt from `filing_entries` using the live ledger's document lookup (country, duzp). Not covered by tests; the five cases are DPHDP3 only.
- No SHV obligation is created (the brief names only `vat_amendment` and `kh_nasledne`). Obligation `legal_due_date` = proposal due date.
- Re-detect on a `generated` or `downloaded` amendment returns it as proposed but does not modify it.

## Questions

None. Not pushed.
