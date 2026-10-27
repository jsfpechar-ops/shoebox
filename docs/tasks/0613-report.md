# 0613 report

Status: review

## Done
- Route `/api/export`: empty period answers 409 `{error:'empty', hint:{first,last,period}}`; every document of the period is included; `NEEDS-REVIEW_` file prefix; `README.txt` (CRLF) with counts and left-out items (missing file, too big, trash, no date). Files over the 200 MB budget are now left out and listed instead of a 413.
- Register sheet: first column "Status" (Ready / Needs review / Not read yet).
- `periodChoices` / `defaultPeriodKey`: months, quarters, years with documents, with counts; default = newest month with documents, not in the future.
- `/ucetni`: new client `ExportForm` (fetch, friendly empty message with links to first and last month); intro sentence updated.
- `loadExportDocs` uses `duzp` when `issue_date` is null.

## Commands
- `pnpm --filter @shoebox/web test -- export register`: 59 files, 389 tests passed.
- `pnpm --filter @shoebox/web typecheck`: clean.
- `pnpm --filter @shoebox/i18n test`: 24 passed. `biome check --write`: clean.

## Deviations
- Existing `registerSheet` test indexes shifted by one (new first column).
- `export.too_big` key is now unused.

## Questions
None. Owner steps: none.
