# 0613: Accountant ZIP holds everything, labels what needs review, never empty

Status: ready
Ticket: REAL-DATA (owner test 2026-10-27, Josef) | Depends on: none | Base commit: d5c65a1 | Branch: claude/project-thread-w656wo | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Owner philosophy (2026-10-27): the user is lazy; they upload everything and later send one ZIP to the accountant. Today the 2026-09 ZIP held only an empty `documents-2026-09.xlsx`, because every uploaded document is dated June 2025 and the period list (`periodOptions`: last 12 months, 4 quarters, this and last year) offered no month with documents. Fix:

1. Never serve an empty ZIP. When the period has no documents, the route answers 409 `{ error: 'empty', hint }`; the page shows a plain message: "No documents are dated {period}. Your documents are dated {first} to {last}." with links that pick those months.
2. The period list on `/ucetni` also offers every month (and quarter, year) that has at least one document, newest first, each with its document count ("June 2025 · 14 documents"). Default selection = the newest month with documents that is not in the future.
3. Every document of the period goes in, whatever its status. The register (XLSX) gets a first column "Status" with "Ready" or "Needs review" (also "Not read yet" for documents still reading). Files of documents that need review get the prefix `NEEDS-REVIEW_` in their ZIP name, so the accountant sees it in Explorer.
4. The ZIP includes `README.txt` (plain English, CRLF line ends): period, counts (ready / needs review / not read yet), which files are what (register, PDFs, `isdoc/`, Pohoda XML), and every left-out item with its reason (file missing in storage, too big, in trash, no date). No personal data beyond what the register already holds.
5. Keep ZIP (not gzip): accountants use Windows, and a ZIP holds many files and opens with a double-click.
6. The page text above the button says in one sentence what the ZIP contains.

## 2. Context

- Route `apps/web/app/api/export/route.ts` (builds entries, register, ISDOC, Pohoda; counts `skipped`); `apps/web/src/documents/export-data.ts` (`loadExportDocs`, filters `issue_date` in period, excludes trash); `export-period.ts` (`parsePeriod`, `periodOptions`, `exportEntryName`); `register-data.ts` (`registerSheet`, rows incl. `status`); page `apps/web/app/(app)/ucetni/page.tsx` (plain GET form).
- `apps/web/src/files/download-button.tsx` `DownloadButton` already shows a friendly message on 409: reuse it (submit the selected period as the href) instead of the raw form, or copy its pattern.
- The register on the Inbox page also uses `registerSheet`: the new Status column is fine there too.
- A document with no `issue_date` falls out of every period: count those and list them in README as "no date, fix in Sysel". Use `duzp` when `issue_date` is null.

## 3. Do not touch

Pohoda and ISDOC builders, money values. Hard rules 1, 3, 4, 6.

## 4. Commands

`pnpm --filter @shoebox/web test -- export register 2>&1 | tail -30`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. Add tests: empty → 409; needs-review prefix; README counts; period options include a month with documents from 16 months ago.

## 5. Report

`docs/tasks/0613-report.md` (600 tokens max), `Status: review`, commit `0613: accountant ZIP with everything, status column, README, never empty`. Do not push.
