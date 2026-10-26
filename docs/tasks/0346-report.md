# 0346 report

Status: review

## Done

- Domain steps 1–2: `packages/domain/src/vat/imported.ts` (parse, compare, totals), `packages/domain/test/imported-filing.test.ts`, export in `packages/domain/src/index.ts`.
- DB helper (owner-approved option a): `packages/db/src/imported-filing.ts` (`readGovernmentFilingFields`, `insertDocumentLinks`, org-scoped), exported from `packages/db/src/index.ts`.
- Worker step 3: `apps/worker/src/vat/imported.ts` (`registerImportedFilings`, no drizzle import), hook in `apps/worker/src/vat/service.ts` (`evaluatePeriod` registers the filing, sets `EvaluateResult.matchesFiled`, logs `filing.matches_filed` / `filing.amendment_needed`). Two optional `VatStore` deps; without them the check is skipped.
- Worker test `apps/worker/test/imported-filing.test.ts`: first run registers one imported filing and links; second run no duplicate; foreign DIČ ignored.

## Checks

- domain vitest `imported-filing`: 2 passed. worker vitest `imported-filing`: 3 passed. worker `filing-lifecycle`: 8 passed.
- typecheck: domain, db, worker clean.
- biome: clean on all changed paths.
- `pnpm depcruise`: no dependency violations.

## Deviations

- `document_fields` columns are `field_key`, `value_text`, `is_current` (brief said `key`); `documents.class` used for `government_filing`.
- `registerImportedFilings` runs before the verdict branch, so the filing is registered even when the period is not `simple`; `matchesFiled` is only set when our DP3 is computed.
- Link direction: from = ledger document, to = government_filing document.

## Owner steps left

None.
