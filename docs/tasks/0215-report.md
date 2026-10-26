# 0215 report

Status: review

## Files changed

- apps/web/src/imports/handlers.ts (new): createImport, previewImport, startImport, undoImport, getImport over an injected ImportDeps
- apps/web/src/imports/supabase-deps.ts (new): signed-in Supabase adapter (org-files bucket, source_files channel 'import', spreadsheet_imports, import_mappings)
- apps/web/src/imports/http.ts (new): origin check (writes) + owner/member guard, JSON response helper
- apps/web/app/api/v1/imports/route.ts (new): POST upload
- apps/web/app/api/v1/imports/[id]/route.ts (new): GET status
- apps/web/app/api/v1/imports/[id]/preview/route.ts, start/route.ts, undo/route.ts (new)
- apps/web/src/documents/enqueue.ts: enqueueImportRun, enqueueImportUndo
- apps/web/test/imports-api.test.ts (new, 12 tests, fake deps)
- packages/pipeline/src/jobs.ts: import.spreadsheet.undo name and importSpreadsheetUndoJob
- apps/worker/src/import-run/undo.ts (new): createImportUndoHandler (calls undoImport with ctx.tx)
- apps/worker/src/import-run/register.ts: registers the undo job
- apps/worker/test/import-run.test.ts: one undo case appended
- packages/i18n/messages/en.json: import.* error keys
- docs/tasks/0215-report.md (new), docs/tasks/0215-spreadsheet-import-routes.md (Status review), docs/tasks/0214-spreadsheet-import-api.md (Status replaced)

## Commands (last lines)

- `pnpm --filter @shoebox/web test -- imports-api`: 37 files, 248 tests passed (the filter did not narrow the run; the imports-api file is among them)
- `pnpm --filter @shoebox/worker test -- import-run`: 14 files passed, 2 skipped; 91 tests passed, 7 skipped (pre-existing skips)
- `pnpm --filter @shoebox/web typecheck`, `@shoebox/worker typecheck`, `@shoebox/pipeline typecheck`: no errors
- `pnpm depcruise`: no dependency violations (510 modules)
- `python3 scripts/context_lint.py`: OK (WARN lines are pre-existing overlaps between open briefs)
- `pnpm exec biome check --write` on changed files: fixed formatting in 3 files

## Acceptance (section 7)

- [x] web imports-api and worker import-run tests pass
- [x] typecheck web, worker, pipeline; depcruise; biome; context lint

## Deviations

- Status codes not fixed by 0214: create returns 201, start and undo return 202.
- New error keys beyond 0214: import.unsupported (no file field, 422), import.no_header (422), import.missing_targets (422, with `missing`), import.state (409), import.not_found (404), import.body (400), import.undo_expired (410).
- Start re-reads the file to compute the header signature (the import row does not store it).
- The file of a 413 is refused before reading (file.size check in the route, byte check in the handler).
- Commit trailer: the harness attribution (Claude Haiku 5.5) was used instead of the Opus 5.5 line in the brief.
- Tool calls: about 30, at the cap.

## Questions

- None blocking. The source_files mime type is stored as sent by the browser (or application/octet-stream when empty).

## Owner steps left

- None. No migration and no new dependency. The worker must be deployed with the new job registered (registerImportRun).
