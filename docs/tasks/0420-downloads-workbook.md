# 0420: Friendly download errors and the VAT workbook download

Status: todo
Ticket: K-D03 | Depends on: 0418, 0419 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Downloads in the VAT and podklady screens become buttons that fetch the file first. When documents changed after the file was made (409 `period_changed`), the user sees a plain sentence and the card refreshes, instead of raw JSON. "Needs an accountant" periods get a working **Download spreadsheet** once the VAT workbook has been prepared. The extra re-confirm step before download is skipped, and that choice is logged in decisions.

## 2. Context (read only these)

- `apps/web/src/vat/filings.ts`: `decideDownload`, `decidePodkladyDownload` (the pattern to copy), `refusalFor`, `DOWNLOADABLE_STATES`, `XLSX_MIME`, `FilingView` (it has `xlsxPath`).
- `apps/web/app/api/v1/filings/[id]/download/route.ts`: the route that calls `decideDownload`. Check how it uses `decision.contentType` and file names. Change it only if a VAT_WORKBOOK would not get the right content type.
- `apps/web/src/vat/periods.ts`: `PeriodCard`, `CardInputs.filings`, `buildPeriodCards` (lines 195–245). Card filings with `type === 'VAT_WORKBOOK'` are skipped at line ~207.
- `apps/web/src/vat/card-view.ts` (`VatAction`, `vatCardView`), `vat-cards.tsx` and `preview-view.tsx` (the `download` action renders as `<a download>`).
- `apps/web/src/podklady/podklady-card.tsx`: the PDF and XLSX links.
- The existing tests for these files: `grep -ln "buildPeriodCards\|decideDownload\|vatCardView" apps/web/test`.

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/vat/filings.ts` | edit: VAT_WORKBOOK download |
| `apps/web/src/vat/periods.ts` | edit: `workbookFilingId` on cards |
| `apps/web/src/vat/card-view.ts` | edit: xlsx download action |
| `apps/web/src/files/download-button.tsx` | new, `'use client'` |
| `apps/web/src/vat/vat-cards.tsx`, `apps/web/src/vat/preview-view.tsx`, `apps/web/src/podklady/podklady-card.tsx` | edit: use `DownloadButton` |
| the existing test files found above | edit: add cases |
| `packages/i18n/messages/en.json` | edit |
| `docs/context/known-issues.md` | edit: delete K-D03 |
| `docs/context/decisions.md` | edit: one line |

## 4. Steps

1. **`filings.ts`**: add `decideWorkbookDownload(filing, currentLedgerHash, format)`, called from `decideDownload` when `filing.type === 'VAT_WORKBOOK'`, right after the PODKLADY branch.
   - Format must be `xlsx`, else 400 `bad_format`.
   - The state must be in `DOWNLOADABLE_STATES`, else 409 `not_generated`.
   - `filing.totals.ledgerHash !== currentLedgerHash` gives 409 `period_changed`.
   - `xlsxPath` null gives 409 `not_generated`.
   - OK gives `paths: [{ path, name: \`DPH-${periodStart.slice(0, 7)}-workbook.xlsx\` }]`, `markDownloaded: filing.state === 'generated'`, `contentType: XLSX_MIME`.
   - Add unit tests next to the existing `decideDownload` tests: ok, changed hash, wrong format.
2. **`periods.ts`**:
   - Add `readonly workbookFilingId: string | null` to `PeriodCard`.
   - In `buildPeriodCards`, first collect `workbooks: Map<periodStart, id>` from active (not `superseded`) filings with `type === 'VAT_WORKBOOK'` and state `generated` or `downloaded`. Keep the one seen last if there are several.
   - Set `workbookFilingId: workbooks.get(periodStart) ?? null` on every card, the `overdue_missing` ones included.
   - Fix every existing test and fixture that builds a `PeriodCard` literal, and add one test showing a workbook row attached to its period's cards.
3. **`card-view.ts`**:
   - Extend the `download` action `label` with `'xlsx'`.
   - For `needs_accountant`: when the main card (or any card of the group) has a `workbookFilingId`, add `{ kind: 'download', href: /api/v1/filings/{id}/download?format=xlsx, label: 'xlsx' }` before the `workbook` action, and keep the `workbook` action (it refreshes the file).
   - Add a test.
4. **`download-button.tsx`**: `DownloadButton({ href, label }: { href: string; label: string })`. It is a `Button` (variant secondary). On click:
   - `fetch(href)`.
   - If `res.ok`: blob → `URL.createObjectURL` → a temporary `<a download={name}>` click → `URL.revokeObjectURL`. Take `name` from the `Content-Disposition` `filename="…"`, or else the last path segment.
   - If 409: read the JSON `error`. For `period_changed`, show `role="alert"` `download.changed` and call `router.refresh()`. For `not_generated`, show `download.not_ready`.
   - On 403, show `download.forbidden`; anything else shows `download.failed`.
   - Busy state: disabled, with the label `download.busy`.
   - Never log the response body.
5. Replace the download `<a>` elements in `vat-cards.tsx`, `preview-view.tsx` and `podklady-card.tsx` with `DownloadButton`. Keep the existing labels; map `xlsx` to the new `vat.action.download_xlsx`.
6. **`en.json`**:
   - `download.busy`: "Preparing download…"
   - `download.changed`: "Your documents changed after this file was made. Prepare it again, then download."
   - `download.not_ready`: "The file isn't ready yet. Try again in a minute."
   - `download.forbidden`: "Your role can't download this file."
   - `download.failed`: "The download didn't work. Try again."
   - `vat.action.download_xlsx`: "Download spreadsheet"
7. **`known-issues.md`**: delete the K-D03 row.
8. **`decisions.md`**: append, keeping the file's line format:
   - `- 2026-10-26 [auth] No extra re-confirm step before filing downloads: login is passkey or e-mail link only (no TOTP), so P3-VAT-12's aal2 step is dropped; revisit if passwords are ever added. (coordinator, under Josef's "finish it all")`
   - Then run the context lint. If it complains about length, shorten the line.

## 5. Do not touch

Routes other than the download route, migrations, `packages/domain`, `cs.json`. No new dependency.

## 6. Commands

- `pnpm --filter @shoebox/web test 2>&1 | tail -30` (the web filter runs the whole web suite; that's fine)
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome check apps/web packages/i18n/messages/en.json --write 2>&1 | tail -20`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -15`
- `python3 scripts/context_lint.py 2>&1 | tail -3`

## 7. Acceptance

- [ ] Web tests and typecheck pass; i18n tests and context lint OK; biome clean.
- [ ] A 409 shows a sentence, never JSON; a `needs_accountant` card offers the spreadsheet once it exists.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0420-report.md`, 150 tokens at most. Set `Status: review`.
