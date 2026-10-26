# 0403: Register data ("All" tab) and its Excel rows

Status: todo
Ticket: lane D, M11 §5.1 tab "All" | Depends on: 0402 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A pure, tested module that loads the org's documents as register rows, filters them (year, paid, search text) and turns them into spreadsheet rows. It replaces the Excel list small OSVČ keep today. The screen (0404) and the download route use it.

## 2. Context

- M11 §5.1: register columns Date, Partner, Number, Amount, VAT, Paid, File; the Excel file adds IČO, DIČ, variable symbol, due date, date of taxable supply, amount without VAT, currency. Exactly the filtered view, ≤ 10 000 rows.
- `documents` columns used: `id, status, class, entry_mode, source_file_id, partner_snapshot (jsonb: name, ico, dic), document_number, variable_symbol, issue_date, duzp, due_date, currency, total_net, total_vat, total_gross, is_paid_per_document, paid_at, created_at, deleted_at`. Money columns arrive as decimal strings; keep them strings (hard rule 1).
- Pattern to copy: `apps/web/src/documents/inbox-data.ts` (`SupabaseLike`, `textOf`, `objectOf`, errors give an empty list).
- Strings through `packages/i18n` (`en.json` only; cs.json dormant).

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/register-data.ts` | new |
| `apps/web/test/register-data.test.ts` | new (below) |
| `packages/i18n/messages/en.json` | edit: add keys |
| `apps/web/package.json` | edit: add `"@shoebox/exports": "workspace:*"` to dependencies (alphabetical, after `@shoebox/domain`), then `pnpm install 2>&1 | tail -3` |

## 4. Steps

1. `apps/web/package.json` dependency + `pnpm install` (lockfile updates; no new external package).
2. `en.json`: add after the `"inbox.tabs.trash"` line:
   ```
     "register.col.date": "Date",
     "register.col.partner": "Partner",
     "register.col.ico": "Company ID (IČO)",
     "register.col.dic": "VAT ID (DIČ)",
     "register.col.number": "Number",
     "register.col.variable_symbol": "Payment reference (VS)",
     "register.col.gross": "Amount",
     "register.col.net": "Amount without VAT",
     "register.col.vat": "VAT",
     "register.col.currency": "Currency",
     "register.col.due": "Due",
     "register.col.duzp": "Date of supply (DUZP)",
     "register.col.paid": "Paid",
     "register.col.file": "File",
     "register.paid.yes": "Paid",
     "register.paid.no": "Not paid",
     "register.paid.none": "—",
     "register.file.yes": "File",
     "register.file.manual": "Typed in",
     "register.sheet_name": "Documents",
   ```
   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -10`.
3. New `apps/web/src/documents/register-data.ts`, exact exports:
   ```ts
   export type PaidFilter = 'all' | 'paid' | 'unpaid';
   export interface RegisterFilter { readonly year: number | null; readonly paid: PaidFilter; readonly q: string }
   export interface RegisterRow {
     readonly id: string; readonly status: DocumentStatus; readonly cls: DocumentClass;
     readonly date: LegalDate | null;            // issue_date ?? duzp ?? null
     readonly partner: string | null; readonly ico: string | null; readonly dic: string | null;
     readonly number: string | null; readonly variableSymbol: string | null;
     readonly gross: string | null; readonly net: string | null; readonly vat: string | null;
     readonly currency: string; readonly due: LegalDate | null; readonly duzp: LegalDate | null;
     readonly paid: 'paid' | 'unpaid' | 'none';  // paid_at or is_paid_per_document → paid; else gross present → unpaid; else none
     readonly paidAt: LegalDate | null;
     readonly hasFile: boolean;                  // source_file_id not null
     readonly manual: boolean;                   // entry_mode === 'manual'
   }
   export const REGISTER_LIMIT = 10_000;
   export function parseRegisterFilter(params: URLSearchParams): RegisterFilter;
   export function registerRowOf(raw: unknown): RegisterRow | null;
   export function applyRegisterFilter(rows: readonly RegisterRow[], filter: RegisterFilter): RegisterRow[];
   export function registerSheet(rows: readonly RegisterRow[]): XlsxCell[][];
   export function registerFileName(filter: RegisterFilter): string;
   export async function loadRegister(supabase: SupabaseLike, orgId: string): Promise<RegisterRow[]>;
   ```
   Rules: `parseRegisterFilter`: `year` = `params.get('year')` if it is 4 digits between 2000 and 2100, else null; `paid` = 'paid'|'unpaid' else 'all'; `q` = trimmed `params.get('q')` cut to 100 chars, '' if missing. `applyRegisterFilter`: year matches `date` year (a row with null date passes only when year is null); paid 'paid' keeps paid rows, 'unpaid' keeps unpaid rows; q (case-insensitive) matches partner, number, variableSymbol, ico or dic. Order stays as given. `registerSheet`: header row with `t()` of the 14 `register.col.*` keys in this order: date, partner, ico, dic, number, variable_symbol, gross, net, vat, currency, due, duzp, paid, file; then one row per document: dates as `YYYY-MM-DD` text, money as `{ num }` (null when missing), paid as `t('register.paid.yes'|'no'|'none')`, file as `t('register.file.yes')` when hasFile else `t('register.file.manual')`. `registerFileName`: `sysel-documents-<year>.xlsx` or `sysel-documents.xlsx`. `loadRegister`: select the §2 columns from `documents`, `.eq('org_id', orgId).is('deleted_at', null).order('issue_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(REGISTER_LIMIT)`; map with `registerRowOf`; any error → `[]`.
   Imports: `DocumentClass, DocumentStatus, LegalDate` from `@shoebox/domain`, `t` from `@shoebox/i18n`, `type XlsxCell` from `@shoebox/exports`.
4. New `apps/web/test/register-data.test.ts` (do not edit after writing):
   ```ts
   import { describe, expect, it } from 'vitest';
   import {
     applyRegisterFilter,
     parseRegisterFilter,
     type RegisterRow,
     registerFileName,
     registerRowOf,
     registerSheet,
   } from '../src/documents/register-data';

   const raw = {
     id: '33333333-3333-4333-8333-333333333333',
     status: 'ready',
     class: 'received_invoice',
     entry_mode: 'captured',
     source_file_id: '44444444-4444-4444-8444-444444444444',
     partner_snapshot: { name: 'Úklid Praha s.r.o.', ico: '27082440', dic: 'CZ27082440' },
     document_number: '2026-0412',
     variable_symbol: '20260412',
     issue_date: '2026-09-30',
     duzp: '2026-09-30',
     due_date: '2026-10-14',
     currency: 'CZK',
     total_net: '6735.54',
     total_vat: '1414.46',
     total_gross: '8150.00',
     is_paid_per_document: null,
     paid_at: null,
     created_at: '2026-10-01T08:00:00Z',
   };

   const row = registerRowOf(raw) as RegisterRow;
   const manual = registerRowOf({
     ...raw,
     id: '55555555-5555-4555-8555-555555555555',
     entry_mode: 'manual',
     source_file_id: null,
     partner_snapshot: { name: 'Parkoviště' },
     document_number: null,
     variable_symbol: null,
     issue_date: '2025-12-09',
     duzp: null,
     total_net: null,
     total_vat: null,
     total_gross: '350.00',
     is_paid_per_document: true,
   }) as RegisterRow;

   describe('registerRowOf', () => {
     it('maps a read invoice', () => {
       expect(row).toMatchObject({
         date: '2026-09-30',
         partner: 'Úklid Praha s.r.o.',
         ico: '27082440',
         number: '2026-0412',
         gross: '8150.00',
         paid: 'unpaid',
         hasFile: true,
         manual: false,
       });
     });
     it('a manual cash receipt is paid and has no file', () => {
       expect(manual).toMatchObject({ paid: 'paid', hasFile: false, manual: true, ico: null });
     });
     it('falls back to the date of supply, and rejects a row without id', () => {
       expect(registerRowOf({ ...raw, issue_date: null })?.date).toBe('2026-09-30');
       expect(registerRowOf({ ...raw, id: null })).toBeNull();
     });
     it('a document without an amount has paid none', () => {
       expect(registerRowOf({ ...raw, total_gross: null })?.paid).toBe('none');
     });
   });

   describe('parseRegisterFilter', () => {
     it('reads year, paid and search text, and ignores junk', () => {
       expect(parseRegisterFilter(new URLSearchParams('year=2026&paid=unpaid&q=%20alza%20'))).toEqual({
         year: 2026,
         paid: 'unpaid',
         q: 'alza',
       });
       expect(parseRegisterFilter(new URLSearchParams('year=26&paid=x'))).toEqual({
         year: null,
         paid: 'all',
         q: '',
       });
     });
   });

   describe('applyRegisterFilter', () => {
     const rows = [row, manual];
     it('filters by year', () => {
       expect(applyRegisterFilter(rows, { year: 2025, paid: 'all', q: '' })).toEqual([manual]);
     });
     it('filters by paid', () => {
       expect(applyRegisterFilter(rows, { year: null, paid: 'unpaid', q: '' })).toEqual([row]);
     });
     it('searches partner, number, VS and IČO, ignoring case', () => {
       for (const q of ['úklid', '0412', '20260412', '27082440'])
         expect(applyRegisterFilter(rows, { year: null, paid: 'all', q }), q).toEqual([row]);
     });
   });

   describe('registerSheet', () => {
     it('has a header and one row per document, money as numbers', () => {
       const sheet = registerSheet([row, manual]);
       expect(sheet).toHaveLength(3);
       expect(sheet[0]?.[0]).toBe('Date');
       expect(sheet[0]).toHaveLength(14);
       expect(sheet[1]?.[6]).toEqual({ num: '8150.00' });
       expect(sheet[1]?.[12]).toBe('Not paid');
       expect(sheet[2]?.[7]).toBeNull();
       expect(sheet[2]?.[13]).toBe('Typed in');
     });
   });

   describe('registerFileName', () => {
     it('names the file by year', () => {
       expect(registerFileName({ year: 2026, paid: 'all', q: '' })).toBe('sysel-documents-2026.xlsx');
       expect(registerFileName({ year: null, paid: 'all', q: '' })).toBe('sysel-documents.xlsx');
     });
   });
   ```
   Implement until it passes: `pnpm --filter @shoebox/web test -- register-data 2>&1 | tail -30`.
5. `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (0 errors); `pnpm exec biome check apps/web/src/documents apps/web/test 2>&1 | tail -15` (fix formatting of your files with `--write`).

## 5. Do not touch

Other files. Hard rules 1, 3 (org-scoped query), 6.

## 6. Commands

As in steps 4–5.

## 7. Acceptance

- [ ] register-data tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0403-report.md`, 150 tokens at most. Set `Status: review`.
