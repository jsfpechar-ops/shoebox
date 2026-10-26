# 0351 report

Status: review

## Done

- `entryRowToDraft` (plus `MapError`, `oneOf`, `legalDate`, `optionalDate`) moved to `packages/db/src/vat-entry-map.ts`, exported from `packages/db/src/index.ts`; `toEntryDraft` is an alias. `apps/worker/src/vat/map.ts` imports and re-exports `MapError`, `oneOf`, `toEntryDraft`.
- `apps/web/src/vat/periods.ts`: cards, parsers, loaders (`loadPeriodCardInputs`, `loadPreviewInputs`) and `computePreview`. Overdue card uses the obligation's own `period_end` (falls back to month end only when the input has none, as in the brief's test).
- `apps/web/src/documents/enqueue.ts`: `enqueueVatFilingGenerate`, `enqueueVatWorkbookGenerate` (zod payloads from `@shoebox/pipeline`).
- Four routes under `apps/web/app/api/v1/vat/periods/`.
- Tests: brief's `vat-periods.test.ts` unchanged, plus `vat-periods-data.test.ts` (loaders via mocks, preview).

## Checks

- Typecheck web, worker, db clean; biome clean; depcruise no violations.
- Full worker suite (153 passed, 7 skipped) and web suite (267 passed) green.

## Deviations

- Numeric columns are cast to text in the Supabase selects so money never passes through a JSON number.
- Quarterly SHV preview merges the monthly computations into one.
- `status` unused in `buildPeriodCards`; a state no rule covers gets no card.
- Routes have no dedicated route tests (loaders and pure logic are tested).
