# 0408: ZIP for the accountant

Status: todo
Ticket: lane D, M11 §5.3 (Phase 1 export block), 02 Phase 1 §9 | Depends on: 0403, 0404 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On "For the accountant" the user picks a period (month, quarter or year; last month preselected) and clicks one button: a ZIP downloads with every original file of that period, named consistently by month, plus the Excel register of the same documents. This is what an OSVČ hands the accountant today by hand.

## 2. Context

- ZIP and XLSX writers: `createZip(entries, at)`, `createXlsx(name, rows, at)` from `@shoebox/exports`. Register: `registerRowOf`, `registerSheet`, `type RegisterRow` from `apps/web/src/documents/register-data.ts` (its column list is the string constant used in `loadRegister`; read it).
- `source_files`: `storage_path, mime_type, byte_size, original_filename`; bucket `org-files` (`supabase.storage.from('org-files').download(path)` returns `{ data: Blob | null, error }`).
- Guard: at most 200 MiB of originals per ZIP (the web service has 512 MB RAM on the free tier); above that the route answers 413 and the page says to pick a shorter period.
- Roles: owner, member, accountant may export; viewer too (read-only data). Today from `pragueToday({ now: () => Date.now() })` (`@shoebox/domain`).

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/export-period.ts` | new (pure) |
| `apps/web/test/export-period.test.ts` | new (below) |
| `apps/web/src/documents/export-data.ts` | new (loader) |
| `apps/web/app/api/export/route.ts` | new |
| `apps/web/app/(app)/ucetni/page.tsx` | edit (replace body) |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json` keys (after the `review.*` block):
   ```
     "export.intro": "Everything your accountant needs for a period in one file: the original documents, sorted by month, and a spreadsheet listing them.",
     "export.period": "Period",
     "export.download": "Download ZIP",
     "export.too_big": "That period is too large for one download. Pick a month or a quarter.",
     "export.month": "{label}",
     "export.quarter": "Q{q} {year}",
     "export.year": "Whole year {year}",
   ```
2. New `apps/web/src/documents/export-period.ts`:
   ```ts
   import type { LegalDate } from '@shoebox/domain';
   export interface ExportPeriod { readonly key: string; readonly from: LegalDate; readonly to: LegalDate }
   /** '2026-09' month, '2026-Q3' quarter, '2026' year; anything else → the month before `today`. */
   export function parsePeriod(key: string | null, today: LegalDate): ExportPeriod;
   /** Select options, newest first: the last 12 months (this one first), then this quarter and the 3 before it, then this year and last year. */
   export function periodOptions(today: LegalDate): ExportPeriod[];
   /** `2026-09/2026-09-30 Úklid Praha 2026-0412.pdf`; unsafe characters → '_', each part ≤ 80 chars, a repeat gets ' (2)', ' (3)'… before the extension. Adds the name to `used`. */
   export function exportEntryName(row: { date: LegalDate | null; partner: string | null; number: string | null }, fileName: string | null, mime: string, used: Set<string>): string;
   export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;
   ```
   Extension: from `fileName` (`.pdf`, `.jpg`…, lower-case) else from mime (`application/pdf` → pdf, `image/jpeg` → jpg, `image/png` → png, `image/heic` → heic, `application/xml` or `text/xml` → xml, else `bin`). Folder = `YYYY-MM` of the date, `undated` when null. Base = date, partner, number joined by one space (missing parts left out), `document` when all are missing. Unsafe = `/[\\/:*?"<>|\u0000-\u001f]/g`. Test `apps/web/test/export-period.test.ts` (do not edit):
   ```ts
   import type { LegalDate } from '@shoebox/domain';
   import { describe, expect, it } from 'vitest';
   import { exportEntryName, parsePeriod, periodOptions } from '../src/documents/export-period';

   const today = '2026-10-26' as LegalDate;

   describe('parsePeriod', () => {
     it('reads a month, a quarter and a year', () => {
       expect(parsePeriod('2026-09', today)).toEqual({ key: '2026-09', from: '2026-09-01', to: '2026-09-30' });
       expect(parsePeriod('2026-02', today).to).toBe('2026-02-28');
       expect(parsePeriod('2024-02', today).to).toBe('2024-02-29');
       expect(parsePeriod('2026-Q4', today)).toEqual({ key: '2026-Q4', from: '2026-10-01', to: '2026-12-31' });
       expect(parsePeriod('2025', today)).toEqual({ key: '2025', from: '2025-01-01', to: '2025-12-31' });
     });
     it('defaults to last month, also across a new year', () => {
       expect(parsePeriod(null, today).key).toBe('2026-09');
       expect(parsePeriod('junk', '2026-01-15' as LegalDate).key).toBe('2025-12');
     });
   });

   describe('periodOptions', () => {
     it('lists 12 months, 4 quarters and 2 years', () => {
       const keys = periodOptions(today).map((p) => p.key);
       expect(keys).toHaveLength(18);
       expect(keys.slice(0, 2)).toEqual(['2026-10', '2026-09']);
       expect(keys).toContain('2026-Q4');
       expect(keys).toContain('2026-Q1');
       expect(keys.slice(-2)).toEqual(['2026', '2025']);
     });
   });

   describe('exportEntryName', () => {
     it('names by month folder, date, partner and number', () => {
       const used = new Set<string>();
       const row = { date: '2026-09-30' as LegalDate, partner: 'Úklid Praha s.r.o.', number: '2026/0412' };
       expect(exportEntryName(row, 'scan.PDF', 'application/pdf', used)).toBe('2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412.pdf');
       expect(exportEntryName(row, null, 'application/pdf', used)).toBe('2026-09/2026-09-30 Úklid Praha s.r.o. 2026_0412 (2).pdf');
     });
     it('handles missing data', () => {
       expect(exportEntryName({ date: null, partner: null, number: null }, null, 'image/jpeg', new Set())).toBe('undated/document.jpg');
     });
   });
   ```
3. New `export-data.ts`: `export interface ExportDoc { row: RegisterRow; file: { path: string; mime: string; size: number; name: string | null } | null }` and `export async function loadExportDocs(supabase, orgId, period: ExportPeriod): Promise<ExportDoc[]>`: the register columns plus `source_files(storage_path, mime_type, byte_size, original_filename)` from live documents of the org with `issue_date` between `from` and `to` (`.gte` / `.lte`), ordered by `issue_date`, limit 10 000; rows through `registerRowOf`; errors → `[]`.
4. New `apps/web/app/api/export/route.ts` (`runtime = 'nodejs'`, `GET`): auth (all four roles; not ok → 401/403 JSON as in `api/register`); `period = parsePeriod(url.searchParams.get('period'), today)`; `docs = await loadExportDocs(…)`; if the sum of `file.size` > `EXPORT_MAX_BYTES` → `Response.json({ error: 'too_big' }, { status: 413 })`; for each doc with a file, download it (skip a failed download, count it), name it with `exportEntryName`; add `documents-<period.key>.xlsx` at the root (`createXlsx(t('register.sheet_name'), registerSheet(docs.map((d) => d.row)), new Date())`); respond `createZip(entries, new Date())` with `Content-Type: application/zip`, `Content-Disposition: attachment; filename="sysel-<period.key>.zip"`, `Cache-Control: no-store`. Never log file names or content.
5. `ucetni/page.tsx`: keep the metadata; render `<h1>`, `<p className="text-body">` `export.intro`, and a `Card` with `<form method="get" action="/api/export" className="flex flex-wrap items-end gap-3">`: a labelled native `<select name="period">` from `periodOptions(pragueToday(…))` (default = `parsePeriod(null, today).key`; option text: month → `formatMonth` is not available, so use `t('export.month', { label: key })` for months, `t('export.quarter', { q, year })`, `t('export.year', { year })`) and a submit `Button` `export.download`. Style the select like 0404's. Below the form `<p className="text-body">` explaining the limit is not needed; the 413 JSON is fine for now.
6. `pnpm --filter @shoebox/web test -- export-period 2>&1 | tail -20`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`).

## 5. Do not touch

`packages/exports` (done in 0402), `register-data.ts`. Hard rules 3, 4 (no file names or content in logs), 6.

## 6. Commands

As in step 6.

## 7. Acceptance

- [ ] export-period tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0408-report.md`, 150 tokens at most. Set `Status: review`.
