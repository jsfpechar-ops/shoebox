# 0214: Spreadsheet import API

Status: blocked
Ticket: P2-IMP-02 (part 3) | Depends on: 0211, 0212, 0213 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0214-report.md

## 1. Objective

HTTP endpoints so a later screen (P2-IMP-03, lane D) can upload a spreadsheet, see a preview, start the import and undo it. No UI in this brief.

## 2. Context

Routes (M01 §6, owner and member): `POST /api/v1/imports` · `POST /api/v1/imports/{id}/preview` · `POST /api/v1/imports/{id}/start` · `POST /api/v1/imports/{id}/undo` · `GET /api/v1/imports/{id}`. Files under `apps/web/app/api/v1/imports/`. Copy auth, org scoping, blob upload and `source_files` insert from `apps/web/app/api/documents/route.ts`; copy job sending from `apps/web/src/documents/enqueue.ts`.

Default decision (autonomous run): the file is parsed inline in `POST /api/v1/imports` (≤ 5 MiB), not in a separate `import.spreadsheet.parse` job.

- `POST /api/v1/imports` (multipart `file`): over 5 MiB → 413. Store the blob and a `source_files` row with `channel='import'`; the same sha256 already imported by this org → 409 `{ error: 'import.already', importedAt }`. `readSpreadsheet`; an error → 422 `{ error: 'import.<reason>' }`. `findHeaderRow`, headers, `headerSignature`; a saved `import_mappings` row (`kind='documents'`, same signature) preselects its mapping and options, else `suggestMapping`. `createSpreadsheetImport`. Respond `{ id, headers, mapping, options, preview }`.
- `preview` = `{ rows: first 10 data rows as parseImportRow results with their row numbers, counts: { valid, skipped: {reason: n}, duplicateInFile } }`; options default `{direction_mode: 'all_expense', header_row}`. Nothing else is written.
- `POST …/preview` body `{ mapping, options }` (zod) → the same preview for that mapping.
- `POST …/start` body `{ mapping, options }`: both required targets (`issue_date`, `total_gross`) mapped, else 422. Upsert `import_mappings` (org, kind 'documents', signature; set `last_used_at`), set `spreadsheet_imports.mapping_id`, `state='importing'`, send `import.spreadsheet.run` `{orgId, importId, fromRow: 0}`. 409 unless state is `parsed`.
- `POST …/undo` → `undoImport`; null → 410 `{ error: 'import.undo_expired' }`; else `{ removed, kept }`.
- `GET …/{id}` → state and the counts.
- Put the preview computation in a pure function `buildImportPreview(sheet, headerRow, mapping, options)` in `packages/pipeline/src/import/preview.ts` (exported), so it is unit-tested without HTTP.
- Error keys go into `packages/i18n/messages/en.json` (`import.already`, `import.too_large`, `import.unsupported`, `import.undo_expired`, and one per readSpreadsheet error reason). English only.

## 3. Files

`packages/pipeline/src/import/preview.ts` (+ index export), `packages/pipeline/test/import-preview.test.ts`, `apps/web/app/api/v1/imports/**`, `apps/web/src/imports/*`, `apps/web/test/imports-api.test.ts`, `packages/i18n/messages/en.json`.

## 4. Steps

1. `preview.ts` + tests in `packages/pipeline/test/import-preview.test.ts`.
2. The five route files, thin: validate, call helpers, respond. A shared `apps/web/src/imports/` module for the logic if a route grows past ~60 lines.
3. `apps/web/test/imports-api.test.ts` for the request validation and status codes, with the store/blob mocked (pattern: an existing `apps/web/test/*route*` or `register` test).

## 5. Do not touch

Lane A, C and D folders (`packages/domain/src/{taxonomy,vat,ledgers,fx}`, `packages/domain/rules/cz`, `apps/web/app/(app)/**` screens, `apps/worker/src/{doc-split,email-received}`), other migrations, `cs.json`. No new dependency.

## 6. Commands

End every command with `| tail -30`. Commands are in section 7.

## 7. Acceptance

- [ ] `pnpm --filter @shoebox/pipeline test -- import-preview 2>&1 | tail -30`, `pnpm --filter @shoebox/web test -- imports-api 2>&1 | tail -30` pass.
- [ ] Typecheck pipeline + web, `pnpm depcruise`, biome on changed files, `python3 scripts/context_lint.py` clean.

## 8. Stop and ask

Stop and report instead of guessing when a named file, column or helper does not exist as described, or a check fails twice for a reason outside these files.

## 9. Report

`docs/tasks/0214-report.md`: files changed, deviations from this brief, the test output tail. Then set this brief's Status to `review`.
