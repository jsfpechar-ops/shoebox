# 0212: Spreadsheet import tables and row writer

Status: review
Ticket: P2-IMP-02 (part 1) | Depends on: 0211 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0212-report.md

## 1. Objective

Create the two tables a spreadsheet import needs, with RLS, and a db helper that turns one parsed row (from 0211's `parseImportRow`) into an imported document, plus undo. Brief 0213 adds the job and the API on top.

## 2. Context

05 §6 (already designed, copy it): `import_mappings` and `spreadsheet_imports`, then `alter table documents add constraint documents_import_fk foreign key (import_id) references spreadsheet_imports(id) on delete set null;`. `documents.import_id`, `documents.import_row` and the unique index `documents_import_row (import_id, import_row) where import_id is not null` already exist (0005).
- `import_mappings.money_account_id`: there is no `money_accounts` table yet. Keep the column as plain `uuid` with no FK and `-- TODO(M07): FK to money_accounts` in the SQL. Edit 05 to note that the FK lands with M07.

M01 §4.13 step 6 (what one imported row becomes):
- `documents`: `entry_mode='imported'`, `source_file_id=null`, `import_id`, `import_row`; class: expense → `received_invoice` when there is a document number, else `received_receipt`; income → `issued_invoice`; `class_source='user'`; `direction` 'in' for expense, 'out' for income; `received_date` = today (Prague); `partner_snapshot` {name, ico} (only keys that are present); `issue_date`, `due_date`, `currency`, `total_gross`, `total_vat`, `total_net`, `document_number`, `variable_symbol`; `is_paid_per_document` = paid === true.
- `document_fields` with `source='user'`, `set_by` = the importing user: same key grammar as manual entry (`apps/web/src/documents/manual-entry.ts` `manualFields`: `supplier.*` for expense, `buyer.*` for income, `dates.issue_date`, `dates.due_date`, `totals.gross`, `totals.vat`, `totals.net`, `currency`, `document_number`, `payment.variable_symbol`, `payment.paid_on`). Check the real key names in `packages/validation/src/proto-checks/stored.ts` `checkInputFromFields` and use those.
- one `document_lines` row: position 1, description, gross.
- Then checks: `checkInputFromFields(fields, class)` → `runProtoChecks(input, {today, org})` → `validationRowsOf` → insert `validation_results` (copy the column mapping from `apps/web/src/documents/manual-entry-actions.ts`). Status: `needs_review` if any row is blocking, else `ready`.
- Then `markIfSemanticDuplicate(tx, orgId, documentId)` (`packages/db/src/semantic-dedupe.ts`); a hit sets status `duplicate` itself.
- Idempotent: a second call with the same `(importId, row)` returns the existing document id and writes nothing (rely on the unique index: select first).

Undo (step 8): soft-delete (`deleted_at = now()`, the same column trash uses) every document of the import whose status is not `finalized` and that has no `document_fields` row with `source='user'` and `set_by`/`updated_at` later than the import's `created_at` — simpler, allowed: no field row whose `updated_at` is after `spreadsheet_imports.finished_at`. Set the import `state='undone'`, `undone_at=now()`. Return `{ removed: number, kept: number }`. Refuse (return null) when the import is older than 30 days.

## 3. Files

`packages/db/migrations/0030_spreadsheet_imports.sql`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/imports.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/imports.ts`, `packages/db/src/index.ts`, `packages/testkit/src/factories/*`, `packages/db/test/imports.db.test.ts`, `docs/v3/05-data-model.md` (one line).

## 4. Steps

1. `packages/db/migrations/0030_spreadsheet_imports.sql`: both tables (05 text), the FK, `select app.apply_tenant_rls('import_mappings'); select app.apply_tenant_rls('spreadsheet_imports');` (copy the pattern of `0060_document_pages.sql`). Add the journal entry in `packages/db/migrations/meta/_journal.json` with `"when"` = the current `Date.now()` value (larger than every other entry), tag `0030_spreadsheet_imports`.
2. Drizzle schema `packages/db/src/schema/imports.ts`, exported from `schema/index.ts`.
3. Factories in `packages/testkit/src/factories/` for both tables (pattern: `documentPageFactory`), registered like the others, so the RLS meta test covers them.
4. `packages/db/src/imports.ts`, exported from `packages/db/src/index.ts`:
   - `createSpreadsheetImport(tx, {orgId, sourceFileId, rowCount, userId}) → id`
   - `insertImportedRow(tx, {orgId, importId, row, values: ImportedValues, direction: 'expense'|'income', userId, today, org: ProtoOrg|undefined}) → {documentId, status, created: boolean}`
   - `finishImport(tx, {orgId, importId, imported, skipped, duplicates, skippedRows})`
   - `undoImport(tx, {orgId, importId, now}) → {removed, kept} | null`
   `ImportedValues` comes from `@shoebox/pipeline`; if that creates a dependency cycle (check depcruise), declare a structurally identical interface in db instead.
5. `packages/db/test/imports.db.test.ts` (pattern: `semantic-dedupe.db.test.ts`): a row → one `ready` document with fields source user; same row again → `created:false`; a row repeating an existing live doc (same supplier IČO, number, gross) → `duplicate`; undo removes an untouched doc and keeps a finalized one.
6. Edit 05 (one line) for the money_account_id FK note.

## 5. Do not touch

Lane A, C and D folders (`packages/domain/src/{taxonomy,vat,ledgers,fx}`, `packages/domain/rules/cz`, `apps/web/app/(app)/**` screens, `apps/worker/src/{doc-split,email-received}`), other migrations, `cs.json`. No new dependency.

## 6. Commands

End every command with `| tail -30`. Commands are in section 7.

## 7. Acceptance

- [ ] `pnpm --filter @shoebox/db test -- imports 2>&1 | tail -30` passes (db tests need `DATABASE_URL`; run `packages/db/scripts/local-pg.sh` if the sandbox has it, else report "db tests skipped locally").
- [ ] `pnpm --filter @shoebox/db typecheck`, `pnpm --filter @shoebox/testkit typecheck`, `pnpm depcruise`, `pnpm exec biome check packages/db packages/testkit`, `python3 scripts/context_lint.py` clean.
- [ ] No money as float: amounts stay decimal strings into `numeric` columns.

## 8. Stop and ask

Stop and report instead of guessing when a named file, column or helper does not exist as described, or a check fails twice for a reason outside these files.

## 9. Report

`docs/tasks/0212-report.md`: files changed, deviations from this brief, the test output tail. Then set this brief's Status to `review`.
