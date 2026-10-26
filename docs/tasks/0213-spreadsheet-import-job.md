# 0213: Spreadsheet import run job

Status: todo
Ticket: P2-IMP-02 (part 2) | Depends on: 0211, 0212 | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0213-report.md

## 1. Objective

The worker job `import.spreadsheet.run` that imports the valid rows of one uploaded spreadsheet, 200 rows per job run, using 0211's pure functions and 0212's db helpers.

## 2. Context

- Job name `import.spreadsheet.run` is already listed in `packages/pipeline/src/jobs.ts`. Define it like `docSplitJob`: `payload: tenantPayload({ importId: z.uuid(), fromRow: z.number().int().min(0) })`, `version: 1`, `entityId: (p) => \`${p.importId}:${p.fromRow}\``. Retry 2, timeout 120 s (M01 §6.3).
- The import row (`spreadsheet_imports`, 0212) points to `source_file_id` (the file's blob) and `mapping_id` → `import_mappings.mapping` (`{target: columnIndex}`) and `options` (`{direction_mode: 'all_expense' | 'all_income' | 'by_sign', header_row: number, sheet_name?: string}`).
- Handler steps, one transaction (`ctx.tx`) per run:
  1. Load the import; stop (log, no throw) unless `state='importing'`.
  2. Read the blob (copy how `apps/worker/src/doc-split/handler.ts` gets file bytes) and `readSpreadsheet(bytes, fileName)`; data rows = rows after `header_row`.
  3. For rows `fromRow … fromRow+199`: skip entirely empty rows silently; `parseImportRow(cells, mapping)`; a failure → skipped `{row, reason}`; a row whose (partner IČO or folded name, document number, gross) equals an EARLIER row of the same file → skipped `duplicate_in_file` (compute over the whole file each run, it is ≤ 5 000 rows); else direction (`by_sign`: negative gross = expense and the amount made positive; else the mode) and `insertImportedRow(...)` with `today` = Prague today (copy how doc-extract gets it).
  4. If rows remain: `enqueue` the same job with `fromRow+200` (inject `enqueueNext` like `enqueueRead` in `doc-split/register.ts`). Else `finishImport` (state `done`, counts summed over runs: read the current counts and add) and stop.
  Counts per run are added to the row (`imported_count`, `skipped_count`, `duplicate_count` when status came back `duplicate`, `skipped_rows` appended).
- Org IČO/DIČ for checks: load like doc-extract does (`ProtoOrg`).
- No document content in logs: log only ids and counts.

## 3. Steps

1. Job definition in `packages/pipeline/src/jobs.ts` (+ export).
2. `apps/worker/src/import-run/handler.ts` (`createImportRunHandler(deps)`) and `register.ts` (needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; no Anthropic key). Register it where `registerDocSplit` is called.
3. `apps/worker/test/import-run.test.ts` with a fake store/blob (pattern: `apps/worker/test/doc-split*.test.ts` or the doc-extract handler test): a 3-row CSV (one valid, one missing total, one repeating the first) → 1 insert, skipped `missing_total` and `duplicate_in_file`, `finishImport` called; a 450-row CSV → first run inserts 200 and enqueues `fromRow: 200`; state not `importing` → nothing happens. Build CSV bytes in the test with synthetic names (no real IČO; use `12345678`-style values that pass `icoChecksumValid`, e.g. compute one in the test).

## 4. Acceptance

- [ ] `pnpm --filter @shoebox/worker test -- import-run 2>&1 | tail -30` and `pnpm --filter @shoebox/pipeline test 2>&1 | tail -30` pass.
- [ ] Typecheck worker + pipeline, `pnpm depcruise`, biome on changed files, `python3 scripts/context_lint.py` clean.
- [ ] Report: files, deviations, test tail.
