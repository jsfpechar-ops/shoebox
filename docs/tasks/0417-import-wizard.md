# 0417: Spreadsheet import wizard (P2-IMP-03)

Status: todo
Ticket: lane D, P2-IMP-03, M11 §5 "Spreadsheet import", AC-18 | Depends on: lane B 0214/0215 (merged) | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Sonnet 5.5 (multi-step client UI) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

From the Inbox, "Import from a spreadsheet" opens a 3-step wizard at `/inbox/import`: (1) choose an .xlsx/.csv, (2) check the column mapping (prefilled) with a live 10-row preview that flags bad cells, (3) a summary "We will create 48 records and skip 3 rows" → Import, then progress, the result and an Undo. Fewest buttons: the mapping is already right for most files, so step 2 shows the preview first and the selects below it.

## 2. Context

- API (lane B, `apps/web/src/imports/handlers.ts`; same-origin, owner/member):
  - `POST /api/v1/imports` multipart `file` → 201 `{ id, headers: string[], mapping, options, preview }`; errors `{ error: 'import.*' }` (409 `import.already` with `importedAt`).
  - `POST /api/v1/imports/{id}/preview` JSON `{ mapping, options }` → 200 `{ id, preview }`.
  - `POST /api/v1/imports/{id}/start` same body → 202 `{ id, state: 'importing' }`; 422 `import.missing_targets` with `missing: string[]`.
  - `GET /api/v1/imports/{id}` → `{ state: 'parsed'|'importing'|'done'|'failed'|'undone', rowCount, importedCount, skippedCount, duplicateCount, createdAt }`.
  - `POST /api/v1/imports/{id}/undo` → 202 `{ state: 'undoing' }`; 410 `import.undo_expired`.
- Types from `@shoebox/pipeline`: `IMPORT_TARGETS`, `ImportMapping` (target → column index), `ImportOptions`, `ImportPreview` (`rows[{rowNumber, result: {ok:true, value} | {ok:false, reason}}]`, `counts{valid, skipped: Partial<Record<reason, n>>, duplicateInFile}`). Import types only (`import type`) in client code; if `IMPORT_TARGETS` pulls server-only code into the client bundle (`next build` or typecheck complains about `node:crypto`), copy the 12 target names into `wizard-state.ts` with a comment pointing at `packages/pipeline/src/import/mapping.ts`.
- Existing keys: `import.wizard.step2` and all `import.*` error keys in en.json (read lines 180–200). Copy goes through `t()`, English only, tokens only (07). Existing manual-entry and review pages show the page pattern (`requireActiveRole`, `Card`, `text-title`).
- M11: no new top-level screen; this is a sub-page of Inbox, linked next to "Add by hand" (`manual.cta` link in `apps/web/app/(app)/inbox/page.tsx`).

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/imports/wizard-state.ts` | new: pure helpers |
| `apps/web/test/import-wizard-state.test.ts` | new |
| `apps/web/src/imports/import-wizard.tsx` | new: `'use client'` wizard |
| `apps/web/app/(app)/inbox/import/page.tsx` | new |
| `apps/web/app/(app)/inbox/page.tsx` | edit: one link |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `wizard-state.ts` (pure, tested):
   - `TARGET_ORDER` (the targets in the M11 order: issue_date, partner_name, partner_ico, document_number, total_gross, total_vat, total_net, paid, currency, variable_symbol, due_date, description) and `REQUIRED_TARGETS = ['issue_date', 'total_gross']`.
   - `setTarget(mapping, target, column: number | null): ImportMapping` (null removes; a column chosen for one target is removed from any other target).
   - `skippedTotal(counts): number` (sum of skipped reasons + duplicateInFile).
   - `missingRequired(mapping): string[]`.
   - `isRunning(state)`: `state === 'importing'`; `canUndo(state, createdAt, now)`: state `done` and younger than 30 days.
   Test each, including that `setTarget` moves a column between targets.
2. `en.json` keys (keep `import.wizard.step2`): `import.cta` "Import from a spreadsheet", `import.title` "Import from a spreadsheet", `import.wizard.step1` "Choose an Excel (.xlsx) or CSV file with one document per row.", `import.wizard.choose` "Choose file", `import.wizard.step3` "We will create {valid} records and skip {skipped} rows.", `import.wizard.import` "Import", `import.wizard.back` "Back", `import.wizard.not_used` "Not used", `import.wizard.row` "Row {n}", `import.wizard.running` "Importing… {done} of {total}", `import.wizard.done` "Done: {imported} records created, {skipped} skipped, {duplicates} already in Sysel.", `import.wizard.failed` "The import stopped. Rows already created stay; you can undo them.", `import.wizard.undo` "Undo this import", `import.wizard.undone` "Undone. The imported records were removed.", `import.wizard.open_inbox` "Go to the inbox", one `import.target.<target>` per target (Date, Supplier, Company ID (IČO), Document number, Total, VAT, Total without VAT, Paid, Currency, Payment reference (VS), Due date, Note) and one `import.skip.<reason>` per reason (`missing_issue_date` "No date", `missing_total` "No amount", `bad_amount` "Amount not readable", `bad_date` "Date not readable"), plus `import.skip.duplicate_in_file` "Same as an earlier row".
3. `import-wizard.tsx`: one component with `step` state.
   - Step 1: `<input type="file" accept=".xlsx,.csv">` with a visible label; on change POST multipart; show `t(error)` in `role="alert"` on failure (409: also the date via `formatLegalDate` if easy, else just the key).
   - Step 2: preview table first (columns: `import.wizard.row`, then the mapped targets' values; a failed row shows `t('import.skip.'+reason)` with a muted/warning token style), then one labelled `<select>` per target (`import.wizard.not_used` + each header by index); every change → `setTarget` → POST preview (ignore out-of-order responses: keep a request counter). Below: `import.wizard.step3` with counts and the Import button (disabled while `missingRequired` is not empty; show `import.missing_targets`).
   - Step 3: POST start → poll GET every 2 s while `isRunning`; show `import.wizard.running`, then done/failed text with counts, a link to `/inbox` and the Undo button when `canUndo` (POST undo, then show `import.wizard.undone`). Stop polling on unmount.
   - Keyboard and screen reader: headings per step, `aria-live="polite"` on the status line, focus the step heading when the step changes.
4. `inbox/import/page.tsx`: `requireActiveRole(['owner', 'member'])`; not ok → a `Card` with `t('manual.forbidden')` if that key exists, else redirect to `/inbox`. Title `import.title`, then `<ImportWizard />`. `inbox/page.tsx`: next to the `manual.cta` link add `<Link href="/inbox/import" className="text-body underline">{t('import.cta')}</Link>` (wrap both links in `<div className="flex flex-wrap gap-4">`).
5. Checks: `pnpm --filter @shoebox/web test -- import-wizard-state 2>&1 | tail -8`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -10`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web/src/imports "apps/web/app/(app)/inbox" apps/web/test/import-wizard-state.test.ts packages/i18n 2>&1 | tail -10` (fix with `--write`), `pnpm --filter @shoebox/web build 2>&1 | tail -15`.

## 5. Do not touch

The `/api/v1/imports` routes and `src/imports/handlers.ts` / `http.ts` / `supabase-deps.ts` (lane B), migrations. Hard rules 6, 7.

## 6. Commands

As in step 5.

## 7. Acceptance

- [ ] wizard-state tests pass; typecheck 0; i18n tests pass; biome clean; web build succeeds.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0417-report.md`, 200 tokens at most. Set `Status: review`.
