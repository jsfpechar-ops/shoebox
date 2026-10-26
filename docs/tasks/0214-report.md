# 0214 report

Status: blocked (step 1 done; steps 2 and 3 left)

## Files changed

- packages/pipeline/src/import/preview.ts (new): buildImportPreview, missingRequiredTargets, ImportOptions
- packages/pipeline/src/import/index.ts: export * from './preview'
- packages/pipeline/test/import-preview.test.ts (new, 4 tests)
- docs/tasks/0214-spreadsheet-import-api.md: Status blocked
- docs/tasks/0214-report.md (new)

## Commands (last lines)

- `pnpm --filter @shoebox/pipeline test -- import-preview 2>&1 | tail -30`: Test Files 4 passed, Tests 36 passed.
- `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30`: clean, no errors.
- `pnpm exec biome check --write` on the 3 pipeline files: fixed formatting in 3 files.

## Acceptance (section 7)

- [x] pipeline import-preview tests pass
- [ ] web imports-api tests: not run (step 3 not done)
- [x] pipeline typecheck
- [ ] web typecheck, depcruise, context_lint: not run

## Deviations

- Done: step 1. Left: steps 2 to 3 (five routes, apps/web/src/imports, imports-api test, en.json keys). Stopped at the tool-call cap.
- Brief says to copy blob upload and source_files insert from apps/web/app/api/documents/route.ts. That route only delegates to apps/web/src/documents/upload.ts and supabase-deps.ts. Those were not read yet.
- Job sender: enqueue.ts (apps/web/src/documents) keeps its pg-boss instance private and is not in the brief's file list.
- Assumptions in preview.ts: direction_mode only 'all_expense'. duplicateInFile = a row with the same issue_date, total_gross, currency, partner_ico and document_number as an earlier valid row; it is not counted as valid. Row numbers are 1-based sheet lines.

## Questions

- Which direction_mode values exist besides 'all_expense'?
- May enqueue of import.spreadsheet.run live in apps/web/src/imports/ (own pg-boss sender), or should enqueue.ts be extended?
- Which tenant-transaction helper do the routes use to call the db helpers?

## Owner steps left

- None yet.
