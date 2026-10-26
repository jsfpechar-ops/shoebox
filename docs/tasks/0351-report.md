# 0351 report

Status: blocked (step 1 done; steps 2 and the entryRowToDraft move need an answer first)

## Done

- Step 1: `apps/web/src/vat/periods.ts` created with the exact exported signatures. Commit `4a3f680` (`feat(web): VAT period cards and request parsers (0351 step 1)`).
- Step 3: `apps/web/test/vat-periods.test.ts` created from the brief's verbatim test. Biome reformatted it (formatting only, no assertion changed).

## Files changed

- `apps/web/src/vat/periods.ts` (new)
- `apps/web/test/vat-periods.test.ts` (new)
- `docs/tasks/0351-report.md` (new)

## Checks

- `pnpm --filter @shoebox/web exec vitest run vat-periods`: 5 passed, 5 tests.
- `pnpm --filter @shoebox/web typecheck`: clean.
- `pnpm exec biome check` on both new files: clean.
- `pnpm depcruise`: no violations.
- Not run: `@shoebox/worker` typecheck. No worker file has changed yet.

## Not done (questions for the owner or orchestrator)

1. **`entryRowToDraft` move.** The brief has no numbered step for it. `toEntryDraft` (`apps/worker/src/vat/map.ts:81`) uses module-local helpers: `MapError`, `oneOf`, `legalDate`, `optionalDate`, `SHV_CODES`, `VAT_POINT_RULES`. Should those move into `packages/db/src/filings.ts` too, or should the worker keep them and export them?
2. **Enqueue payloads.** The brief does not give the filing-generate payload shape (`vatFilingGenerateJob`). The workbook payload is `{ orgId, periodStart }` (`apps/worker/src/vat/service.ts:243`). Which fields does the filing payload take (`kind`, `discoveredOn`, `periodStart`)?
3. **Preview loaders and routes.** Step 2 names the four routes but not the loader functions or the Supabase query shapes. I would write them from `apps/web/app/api/v1/filings/` and `apps/web/src/vat/filings.ts`, but that is a guess.

## Deviations and assumptions in step 1

- Overdue card: "obligation past today" is read as `dueDate < today`.
- Overdue card `periodEnd` is the month end. The inputs carry no monthly or quarterly flag, so quarterly filers would get the wrong end date. Needs an answer.
- `status` is accepted but not used by `buildPeriodCards`.
- A filing in a state no rule covers (for example `failed`) gets no card.
- `amountDue` is set only when `row64` is a string or an integer; no float is ever produced.

## Owner steps left

- Answer questions 1 to 3 above, then the executor can finish steps 2 and 4.
