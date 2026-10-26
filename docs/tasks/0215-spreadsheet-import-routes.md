# 0215: Spreadsheet import routes

Status: todo
Ticket: P2-IMP-02 (part 4, the rest of 0214) | Depends on: 0212, 0213, 0214 step 1 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0215-report.md

## 1. Objective

Finish 0214: the HTTP routes for upload + preview, start, undo and status of a spreadsheet import. `buildImportPreview` and `missingRequiredTargets` already exist in `packages/pipeline/src/import/preview.ts`. No UI.

## 2. Context

Read 0214 §2 for the route contract (status codes, bodies, error keys). Facts the 0214 executor lacked:
- The web app talks to the database through the signed-in Supabase client (RLS), not drizzle. Pattern: `apps/web/app/api/documents/route.ts` (origin check, `requireActiveRole(['owner','member'])`, form data) → `apps/web/src/documents/upload.ts` + `supabase-deps.ts` (`putFile` into bucket `org-files`, `source_files` insert with the 23505 → existing-row fallback). Reuse `sha256Hex` and the storage path scheme from `upload.ts`; insert `source_files` with `channel: 'import'`.
- Already imported = a `spreadsheet_imports` row of the org whose `source_file_id` is the existing source file → 409 `{ error: 'import.already', importedAt: created_at }`.
- `spreadsheet_imports` and `import_mappings` rows are written with the same Supabase client (RLS allows owner/member writes; if an insert is refused, stop and report).
- Jobs: add `enqueueImportRun(orgId, importId, fromRow)` and `enqueueImportUndo(orgId, importId)` to `apps/web/src/documents/enqueue.ts`, same pattern as `enqueueDocSplit`.
- Undo runs in the worker (default decision, autonomous run: the web has no tenant drizzle access). Add `importSpreadsheetUndoJob` (`import.spreadsheet.undo`, payload `{importId}`, entityId importId) to `packages/pipeline/src/jobs.ts` (add the name to the job-name list) and a tiny handler in `apps/worker/src/import-run/` that calls `undoImport(ctx.tx, {orgId, importId, now: new Date()})` and logs `{removed, kept}`; register it next to `registerImportRun`. The route checks the 30 days itself (`created_at`) → 410, else enqueues and returns 202 `{ state: 'undoing' }`. GET then shows `undone`.
- Reading the file again for `…/preview`: download it from `org-files` with the Supabase client, `readSpreadsheet` again.

## 3. Files

`apps/web/app/api/v1/imports/route.ts`, `apps/web/app/api/v1/imports/[id]/{route,preview/route,start/route,undo/route}.ts`, `apps/web/src/imports/*.ts`, `apps/web/src/documents/enqueue.ts`, `packages/pipeline/src/jobs.ts`, `apps/worker/src/import-run/*`, `apps/web/test/imports-api.test.ts`, `apps/worker/test/import-run.test.ts` (one undo case), `packages/i18n/messages/en.json`.

## 4. Steps

1. `apps/web/src/imports/handlers.ts`: pure-ish functions `createImport(deps, auth, file)`, `previewImport(deps, auth, id, body)`, `startImport(...)`, `undoImport(...)`, `getImport(...)` returning `{status, body}`; `deps` is an interface (Supabase-backed adapter in `apps/web/src/imports/supabase-deps.ts`), so tests use a fake.
2. Thin route files calling them.
3. Undo job + handler + register.
4. en.json keys from 0214 §2.
5. Tests: `apps/web/test/imports-api.test.ts` with a fake deps: 413, 409 already, 422 unreadable, 200 preview shape, start 422 missing targets, start 409 wrong state, start enqueues `fromRow: 0`, undo 410 after 30 days, undo 202. One worker test: undo job calls `undoImport`.

## 5. Do not touch

Lane A, C and D folders (`packages/domain/src/{taxonomy,vat,ledgers,fx}`, `packages/domain/rules/cz`, `apps/web/app/(app)/**` screens, `apps/worker/src/{doc-split,email-received}`), migrations, `cs.json`. No new dependency.

## 6. Commands

End every command with `| tail -30`. Commands are in section 7.

## 7. Acceptance

- [ ] `pnpm --filter @shoebox/web test -- imports-api 2>&1 | tail -30` and `pnpm --filter @shoebox/worker test -- import-run 2>&1 | tail -30` pass.
- [ ] Typecheck web, worker, pipeline; `pnpm depcruise`; biome on changed files; `python3 scripts/context_lint.py` clean.

## 8. Stop and ask

Stop and report instead of guessing when a named file, column or helper does not exist as described, or a check fails twice for a reason outside these files.

## 9. Report

`docs/tasks/0215-report.md`: files changed, deviations from this brief, the test output tail. Then set this brief's Status to `review` and 0214's Status to `replaced`.
