# 0350: VAT workbook (`VAT_WORKBOOK` XLSX) and `vat.workbook.generate`

Status: todo
Ticket: P3-VAT-11 (part b) | Depends on: 0344, 0349 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 60k tokens

## 1. Objective

For a period that is `not_ready` or `needs_accountant` (and on demand for any period), an XLSX workbook the accountant can work from: every ledger entry with its FX rate, the failed checks with documents, provisional totals labelled unverified. Stored as a `filings` row `type='VAT_WORKBOOK'`.

## 2. Context

M05 §4.10 (pasted): XLSX generated for any period on demand and automatically when the verdict is `needs_accountant`. Sheets: `Souhrn` (period, profile, verdict, reasons with document links, provisional row totals labelled "Neověřený výpočet"), `Evidence DPH` (one row per ledger entry: document number, partner, DIČ/VAT ID, country, dates issue/DUZP/received/vat_point_date, treatment, rate, currency, foreign amount, ČNB rate + date, base CZK, VAT CZK, DPHDP3 rows, KH section, SH code), `Doklady k řešení` (failed checks), `Kurzy ČNB`. Stored as a `filings` row `type='VAT_WORKBOOK'`, `state='generated'` (no XML, no lifecycle beyond downloaded). The spec names sheets in Czech; AGENTS rule 6 → English sheet names and headers now (`Summary`, `VAT ledger`, `Documents to resolve`, `CNB rates`; label "Unverified computation"), `TODO(i18n-cs)`. No `exceljs` (rule 7): `packages/exports/src/xlsx.ts` builds XLSX by hand but supports one sheet (`createXlsx(sheetName, rows, at)`); extend it with `createXlsxWorkbook(sheets: ReadonlyArray<{ name: string; rows: XlsxCell[][] }>, at: Date)` (workbook.xml lists n sheets, rels `rId1..n`, `[Content_Types]` one override per sheet; keep `createXlsx` as a one-sheet wrapper). Sheet names ≤ 31 chars, no `[]:*?/\`.

Inputs for the builder (pure): `PeriodLedger` (0343) mapped to domain (0344 `map.ts`: `toEntryDraft`), `SimpleCheckResult` (0331), `Dphdp3Computation` (0333), document meta (number, partner name, DIČ/VAT ID, country, dates), FX rows used (`fxRate`, `fxRateDate`, `currency` from entries, distinct). Blob path `org/{orgId}/filings/{filingId}/VAT_WORKBOOK.xlsx` (content type `XLSX_MIME`). Filing row: `type 'VAT_WORKBOOK'`, `kind 'radne'`, `state 'generated'`, `xlsx_path`, `simple_check`, `totals { ledgerHash, rows, verdict }`; an open workbook for the period is superseded first (`supersedeOpenFilings`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/exports/src/xlsx.ts` | edit | `createXlsxWorkbook` (+ export in `src/index.ts` if it re-exports by name) |
| `packages/exports/src/vat-workbook.ts` | create | `buildVatWorkbook(input: VatWorkbookInput, at: Date): Uint8Array` + `vatWorkbookSheets(input): Sheet[]` (pure rows for tests) |
| `packages/exports/test/vat-workbook.test.ts` | create | below |
| `apps/worker/src/vat/workbook.ts` | create | `generateWorkbook(tx, orgId, periodStart, requestedBy, deps)` + `createVatWorkbookGenerateHandler`; register in `apps/worker/src/vat/register.ts` (one-line edit) |
| `apps/worker/test/vat-workbook-job.test.ts` | create | fake store: a `needs_accountant` IO period → one `VAT_WORKBOOK` filing with an `xlsx_path`, blob written once, second run supersedes the first |

## 4. Steps

1. `createXlsxWorkbook`; existing `pnpm --filter @shoebox/exports test 2>&1 | tail -30` stays green.
2. `vat-workbook.ts` exports exactly:
```ts
export interface WorkbookEntry { readonly documentId: string; readonly documentNumber: string | null; readonly partnerName: string | null; readonly partnerVatId: string | null; readonly partnerCountry: string | null; readonly issueDate: string | null; readonly duzp: string | null; readonly receivedDate: string | null; readonly vatPointDate: string; readonly vatTreatment: string; readonly vatRatePct: number; readonly currency: string; readonly baseForeign: string | null; readonly fxRate: string | null; readonly fxRateDate: string | null; readonly baseCzk: string; readonly vatCzk: string; readonly dphdp3Rows: readonly string[]; readonly khSection: string | null; readonly shvCode: number | null }
export interface VatWorkbookInput { readonly periodStart: string; readonly periodEnd: string; readonly profile: { readonly legalName: string; readonly dic: string | null; readonly vatStatus: string }; readonly verdict: string; readonly checks: ReadonlyArray<{ code: string; outcome: string; documentIds: readonly string[]; params: Record<string, string | number> }>; readonly rows: Readonly<Record<string, { base: string; tax: string }>>; readonly result: { row62: string; row63: string; row64: string; row65: string }; readonly entries: readonly WorkbookEntry[]; readonly documentNumbers: Readonly<Record<string, string | null>> }
export interface Sheet { readonly name: string; readonly rows: readonly (readonly XlsxCell[])[] }
export const WORKBOOK_SHEETS = ['Summary', 'VAT ledger', 'Documents to resolve', 'CNB rates'] as const;
export function vatWorkbookSheets(input: VatWorkbookInput): Sheet[];
export function buildVatWorkbook(input: VatWorkbookInput, at: Date): Uint8Array;
```
Summary rows: `['Period', start, end]`, `['Taxpayer', legalName, dic ?? '']`, `['VAT status', …]`, `['Verdict', verdict]`, blank, `['Unverified computation']`, then `['Row', 'Base CZK', 'Tax CZK']` + one row per `rows` key (numeric cells `{num}`), then `['Row 62', …64, 65]`. Ledger sheet: header row with the 19 columns in the order of `WorkbookEntry`, numeric cells for amounts/rates, `dphdp3Rows` joined by `,`. Resolve sheet: header `['Check', 'Outcome', 'Document', 'Document number', 'Params']`, one row per (failed check × document) (a check without documents → one row with empty document). Rates sheet: header `['Currency', 'Rate date', 'Rate']`, distinct `(currency, fxRateDate, fxRate)` from entries with a rate, sorted.
3. Test (pure sheets; plus one zip sanity): build an input with two entries (Anthropic EUR with rate, a CZK Booking) and checks `[S_IO_OUTPUT_VAT needs_accountant ['b']]`, assert: 4 sheet names; summary contains `'Unverified computation'` and row `'5'` with `{num:'13700.00'}`; ledger has 3 rows (header + 2) with the FX rate `'24.580000'` on the EUR row; resolve has 2 rows; rates has 2 rows (header + EUR); `buildVatWorkbook(input, new Date(0))` starts with bytes `50 4b` (ZIP) and `createXlsxWorkbook` output contains `xl/worksheets/sheet4.xml` (inspect via the exports `zip` helpers or by searching the bytes for the ASCII name). Command: `pnpm --filter @shoebox/exports test -- vat-workbook 2>&1 | tail -30`.
4. Worker job (`computePeriod` from 0348 if merged; else the 0344 internals) → `VatWorkbookInput` → blob → filing row; handler + registration; test. Command: `pnpm --filter @shoebox/worker test -- vat-workbook-job 2>&1 | tail -30`.
5. Commit `feat: VAT workbook XLSX + vat.workbook.generate (0350)`.

## 5. Do not touch

`createZip`, screens, migrations.

## 6. Commands

`pnpm --filter @shoebox/exports test 2>&1 | tail -30` · `pnpm --filter @shoebox/worker test -- vat-workbook-job 2>&1 | tail -30` · both typechecks

## 7. Acceptance

- [ ] Every ledger entry, every failed check and every FX rate of the period appear in the workbook (M05 §9 #15); worker test green.

## 8. Stop and ask

TEMPLATE §8.

## 9. Report

`docs/tasks/0350-report.md`.

## Risk list

`vat-workbook.ts` (numbers shown to the accountant), `xlsx.ts` change.

## Owner steps

1. Decisions line: "2026-10-26 VAT workbook sheet names/headers in English until cs.json wakes (rule 6)".
