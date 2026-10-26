# 0360: Podklady XLSX workbook (`buildPodkladyXlsx`)

Status: todo
Ticket: P4-POD-04 (XLSX) | Depends on: 0359, 0350 (`createXlsxWorkbook`) | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 18 tool calls, 50k tokens

## 1. Objective

The accountant's workbook from a `PodkladySummary` (M06 §4.9): entry-level income and expenses with the business/private split, a category pivot, assets, private use, payments by month, the paušální daň table, the warnings and the checklist. Haléře everywhere (general criterion 1). Pure sheet rows + one ZIP sanity test.

## 2. Context

M06 §4.9 sheets (Czech names in the spec; rule 6 → English now, `TODO(i18n-cs)`): `Summary`, `Income` (entry level), `Expenses` (entry level with share, business part, private part), `Categories` (pivot by `category_code` × `tax_effect`), `Assets`, `Small assets`, `Private`, `Tax and insurance payments` (by category and month), `Flat-rate tax` (only `pausalni_dan`), `Missing` (readiness and asset warnings with document ids), `Checklist`, `Unpaid at year end` (provisional entries, M06 §8 #1). Amounts as numeric cells (`{ num: money.toFixed2() }`), frozen header rows are not supported by the hand-built writer (note `TODO(xlsx-freeze)`), document links are the app URL `{appOrigin}/documents/{documentId}` as text (accountant role required to open).

Writer: `createXlsxWorkbook(sheets, at)` from `packages/exports/src/xlsx.ts` (0350; if 0350 is not merged, implement it there exactly as 0350 §2 describes: n sheets, rels `rId1..n`, one content-type override per sheet, keep `createXlsx` as a one-sheet wrapper). `XlsxCell = string | { num: string } | null`. `Sheet = { name, rows }` (export it from `xlsx.ts` if 0350 did not). Sheet names ≤ 31 chars.

Summary types: `PodkladySummary` from `@shoebox/domain` (0359). Category labels: `findCategory(code)?.labelEn ?? code` (`@shoebox/domain`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/exports/src/podklady-xlsx.ts` | create | `PODKLADY_SHEETS`, `podkladySheets`, `buildPodkladyXlsx` |
| `packages/exports/src/index.ts` | edit | `export { buildPodkladyXlsx, PODKLADY_SHEETS, podkladySheets } from './podklady-xlsx';` |
| `packages/exports/test/podklady-xlsx.test.ts` | create | below |

## 4. Steps

1. `podklady-xlsx.ts` exports exactly:
```ts
import type { PodkladySummary } from '@shoebox/domain';
import type { Sheet } from './xlsx';
export const PODKLADY_SHEETS = ['Summary', 'Income', 'Expenses', 'Categories', 'Assets', 'Small assets', 'Private', 'Tax and insurance payments', 'Flat-rate tax', 'Missing', 'Checklist', 'Unpaid at year end'] as const;
export interface PodkladyXlsxOptions { readonly appOrigin: string; readonly label: (key: string) => string }   // label = i18n lookup for checklist/readiness keys (the caller passes en.json messages; tests pass identity)
export function podkladySheets(s: PodkladySummary, o: PodkladyXlsxOptions): Sheet[];
export function buildPodkladyXlsx(s: PodkladySummary, o: PodkladyXlsxOptions, at: Date): Uint8Array;
```
Rows (first row = header where listed):
- `Summary`: `['Taxpayer', legalName, ico ?? '']`, `['Year', String(year)]`, `['Regime', regime]`, `['Generated', generatedOn]`, `['Interim', watermark ? 'yes' : 'no']`, blank, `['Income', {num}]`, `['Expenses', {num}]` (label `'Flat-rate expenses'` when `headline.label === 'flat'`), `['Base before adjustments', {num}]`, `['Advances paid', {num}]`, `['Private part', {num totals.privatePart}]`, `['Non-deductible', {num}]`, then for a flat-rate comparison: `['Flat rate %', {num}]`, `['Flat-rate expenses', {num flat}]`, `['Cap reached', yes/no]`, `['Base with flat rate', {num}]`, `['Base with actual expenses', {num}]`, `['Better', better]`, `['Difference', {num}]`; last `['Disclaimer', label(disclaimerKey)]`.
- `Income` / `Expenses` / `Unpaid at year end`: header `['Date', 'Category', 'Label', 'Document', 'Link', 'Amount CZK', 'Share %', 'Business CZK', 'Private CZK']`, one row per drill-down entry of `totals.income` + `totals.nonTaxableIncome` (Income), `totals.deductible` + `totals.nonDeductible` + `totals.privateItems` (Expenses), `totals.provisional` (Unpaid). `Share %` is `{num: businessSharePct}`.
- `Categories`: header `['Category', 'Label', 'Tax effect', 'Entries', 'Amount CZK', 'Business CZK', 'Private CZK']`, every `CategoryTotal` of every bucket (income, nonTaxableIncome, deductible, nonDeductible, privateItems, assets, passThrough, taxAndInsurancePayments), then a blank row and `['Income total', '', '', '', {num}]`, `['Deductible total', '', '', '', '', {num}]`.
- `Assets` / `Small assets`: header `['Date', 'Supplier', 'Description', 'Document', 'Price CZK', 'Paid in year CZK', 'Share %', 'Car', 'Link']`; after the rows of `Assets`: `[label('podklady.assets.note')]`.
- `Private`: `['Personal documents', {num count}, {num sum}]`, blank, header `['Document', 'Line', 'Description', 'Total CZK', 'Share %', 'Business CZK', 'Private CZK']` + partial shares, blank, `['Car regime', carRegime, carBusinessSharePct ?? '']`.
- `Tax and insurance payments`: header `['Category', 'Label', 'Total CZK', 'Jan', …, 'Dec']`, one row per `payments[]`.
- `Flat-rate tax` (only when `pausalniDan`): `['Band', band]`, `['Fits band', fitBand ?? 'none']`, `['Limit CZK', {num}]`, `['Expected CZK', {num}]`, `['Paid CZK', {num}]`, `['Difference CZK', {num delta}]`, `['Notice deadline', noticeDue]`, blank, header `['Month', 'Due', 'Expected CZK', 'Paid CZK']` + 12 rows, blank, one row per warning `[code, JSON.stringify(params)]`. Omit the sheet for other regimes (the sheet list then has 11 names).
- `Missing`: header `['Code', 'Severity', 'Text', 'Document']`: readiness checks (`Document` empty) then asset warnings (`documentId`); `vatNote.registrationWarning` → a row `['podklady.vat.registration_warning', 'warning', label(...), '']`.
- `Checklist`: one row per `checklistKeys` entry `[key, label(key)]`.
2. Test file verbatim (the fixture builds a summary through the domain function so numbers come from one place):
```ts
import { buildPodkladySummary, CZK, EMPTY_ANSWERS, Money, createCzRules, parseLegalDate, type PodkladyInput } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { buildPodkladyXlsx, PODKLADY_SHEETS, podkladySheets } from '../src/podklady-xlsx';

const rules = createCzRules();
const d = parseLegalDate;
const czk = (s: string) => Money.parse(s, CZK);
let n = 0;
const e = (categoryCode: string, taxEffect: PodkladyInput['entries'][number]['taxEffect'], amount: string, o: Partial<PodkladyInput['entries'][number]> = {}) => ({
  entryDate: d('2026-04-10'), taxYear: 2026, basis: 'payment' as const, documentId: `doc-${(n += 1)}`, lineId: `l-${n}`, categoryCode, taxEffect, amountCzk: amount, businessSharePct: '100', businessAmountCzk: amount, ...o,
});
const input: PodkladyInput = {
  year: 2026, taxpayer: { legalName: 'Josef Novák', ico: '87654321' },
  profiles: [{ validFrom: d('2026-08-03'), validTo: null, entityType: 'osvc', taxRegime: 'danova_evidence', vatStatus: 'identifikovana_osoba', pausalRate: null, pausalDanBand: null, hasAccountant: true },
             { validFrom: d('2025-01-01'), validTo: d('2026-08-02'), entityType: 'osvc', taxRegime: 'danova_evidence', vatStatus: 'neplatce', pausalRate: null, pausalDanBand: null, hasAccountant: true }],
  entries: [
    e('income_accommodation', 'taxable_income', '180000.00'), e('income_services', 'taxable_income', '60000.00'),
    e('exp_cleaning', 'deductible_expense', '11600.00'), e('exp_cleaning', 'deductible_expense', '8150.00'),
    e('exp_property_management', 'deductible_expense', '12960.84'), e('exp_property_management', 'deductible_expense', '9749.44'),
    e('exp_platform_commission', 'deductible_expense', '13699.77'), e('exp_platform_commission', 'deductible_expense', '11549.94'),
    e('exp_small_assets', 'deductible_expense', '26990.00'), e('exp_material', 'deductible_expense', '1198.00'), e('exp_material', 'deductible_expense', '117.00'),
    e('exp_hosting_domains', 'deductible_expense', '226.50'), e('exp_software_saas', 'deductible_expense', '2218.32'),
    e('pt_tourist_fee', 'pass_through', '3500.00'), e('pt_tourist_fee', 'pass_through', '4150.00'),
    e('exp_other_deductible', 'private', '249.00', { documentId: 'decathlon', businessSharePct: '0', businessAmountCzk: '0.00' }),
    e('income_services', 'taxable_income', '5000.00', { basis: 'provisional', entryDate: d('2026-12-20') }),
  ],
  assetLines: [{ documentId: 'macbook', lineId: 'mac-1', documentNumber: 'UA30417938', partnerName: 'Apple', description: 'MacBook', issueDate: d('2026-03-02'), paidAt: d('2026-03-02'), categoryCode: 'exp_small_assets', net: null, gross: czk('26990.00'), businessSharePct: '100', vatDeducted: false, carFlag: false, paidInYear: czk('26990.00') }],
  privateUse: { personalDocuments: [{ documentId: 'decathlon', paidAt: d('2026-10-09'), amountCzk: czk('249.00') }], partialShareLines: [], carRegimeAnswers: [] },
  vatFilings: [{ periodStart: d('2026-08-01'), row64: czk('2877.00'), state: 'marked_filed' }],
  transactions: [{ categoryCode: 'tax_vat_payment', bookedOn: d('2026-09-25'), amount: czk('-2877.00') }, { categoryCode: 'tax_vat_payment', bookedOn: d('2026-10-25'), amount: czk('-2471.00') }],
  readiness: { ledger: { staleEntries: 0, documentsFinalizedAfterBuild: 0 }, pendingDocuments: 2, unpaidIssued: 0, unexplainedTransactions: { count: 0, sum: czk('0') }, businessFlagUnknown: { count: 0, sum: czk('0') } },
  answers: { ...EMPTY_ANSWERS, comparisonRate: 60 }, partialXmlAvailable: false,
};
const summary = buildPodkladySummary(input, rules, d('2027-02-10'));
const opts = { appOrigin: 'https://app.example', label: (k: string) => `[${k}]` };
const sheets = podkladySheets(summary, opts);
const sheet = (name: string) => sheets.find((s) => s.name === name)?.rows ?? [];
const row = (name: string, first: string) => sheet(name).find((r) => r[0] === first);

describe('podkladySheets S4 (M06 §9, haléře)', () => {
  it('11 sheets for a DE user (no Flat-rate tax); names from PODKLADY_SHEETS', () => {
    expect(sheets.map((s) => s.name)).toEqual(PODKLADY_SHEETS.filter((s) => s !== 'Flat-rate tax'));
    expect(sheets.every((s) => s.name.length <= 31)).toBe(true);
  });
  it('Summary: income 240 000,00; expenses 98 459,81; base 141 540; flat comparison at 60 %; disclaimer text', () => {
    expect(row('Summary', 'Income')).toEqual(['Income', { num: '240000.00' }]);
    expect(row('Summary', 'Expenses')).toEqual(['Expenses', { num: '98459.81' }]);
    expect(row('Summary', 'Base before adjustments')).toEqual(['Base before adjustments', { num: '141540.00' }]);
    expect(row('Summary', 'Flat-rate expenses')).toEqual(['Flat-rate expenses', { num: '144000.00' }]);
    expect(row('Summary', 'Difference')).toEqual(['Difference', { num: '45540.00' }]);
    expect(row('Summary', 'Disclaimer')).toEqual(['Disclaimer', '[podklady.disclaimer]']);
  });
  it('Income has 2 entries; Expenses 12 (11 deductible + Decathlon private); Unpaid has the provisional 5 000', () => {
    expect(sheet('Income')).toHaveLength(3);
    expect(sheet('Expenses')).toHaveLength(13);
    const dec = sheet('Expenses').find((r) => r[3] === 'decathlon');
    expect(dec?.slice(5)).toEqual([{ num: '249.00' }, { num: '0' }, { num: '0.00' }, { num: '249.00' }]);
    expect(sheet('Expenses').some((r) => r[4] === 'https://app.example/documents/decathlon')).toBe(true);
    expect(sheet('Unpaid at year end')).toHaveLength(2);
    expect(sheet('Unpaid at year end')[1]?.[5]).toEqual({ num: '5000.00' });
  });
  it('Categories: tourist fee 7 650 as pass_through; totals rows', () => {
    const fee = sheet('Categories').find((r) => r[0] === 'pt_tourist_fee');
    expect(fee?.[2]).toBe('pass_through');
    expect(fee?.[4]).toEqual({ num: '7650.00' });
    expect(row('Categories', 'Income total')?.[4]).toEqual({ num: '240000.00' });
    expect(row('Categories', 'Deductible total')?.[5]).toEqual({ num: '98459.81' });
  });
  it('Assets empty with the note; Small assets has the MacBook; Private has Decathlon; payments has VAT by month', () => {
    expect(sheet('Assets')).toEqual([['Date', 'Supplier', 'Description', 'Document', 'Price CZK', 'Paid in year CZK', 'Share %', 'Car', 'Link'], ['[podklady.assets.note]']]);
    expect(sheet('Small assets')[1]?.slice(0, 5)).toEqual(['2026-03-02', 'Apple', 'MacBook', 'UA30417938', { num: '26990.00' }]);
    expect(sheet('Private')[0]).toEqual(['Personal documents', { num: '1' }, { num: '249.00' }]);
    const vat = sheet('Tax and insurance payments').find((r) => r[0] === 'tax_vat_payment');
    expect([vat?.[2], vat?.[3 + 8], vat?.[3 + 9]]).toEqual([{ num: '5348.00' }, { num: '2877.00' }, { num: '2471.00' }]);
  });
  it('Missing lists the pending-documents warning; Checklist has the accommodation item and no depreciation twice', () => {
    expect(sheet('Missing').some((r) => r[0] === 'P_PENDING_DOCUMENTS' && r[2] === '[podklady.readiness.P_PENDING_DOCUMENTS]')).toBe(true);
    const keys = sheet('Checklist').map((r) => r[0]);
    expect(keys).toContain('podklady.checklist.accommodation');
    expect(keys).toContain('podklady.checklist.depreciation');
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('buildPodkladyXlsx is a ZIP with one worksheet per sheet', () => {
    const bytes = buildPodkladyXlsx(summary, opts, new Date(0));
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('xl/worksheets/sheet11.xml');
    expect(text).not.toContain('xl/worksheets/sheet12.xml');
  });
});
```
Command: `pnpm --filter @shoebox/exports test -- podklady-xlsx 2>&1 | tail -30`. (The `TextDecoder('latin1')` search works because the ZIP writer stores entries uncompressed; if `createZip` deflates, search the central directory names instead — they are always plain.)
3. Index export; `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`.
4. Commit `feat(exports): podklady XLSX workbook (0360)`.

## 5. Do not touch

`createZip`, `isdoc/`, `vat-workbook.ts`, domain functions.

## 6. Commands

`pnpm --filter @shoebox/exports test -- podklady-xlsx 2>&1 | tail -30` · `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] S4 totals to the haléř in the workbook (240 000,00 / 98 459,81 / 7 650,00 / 249,00; general 1); 11 or 12 sheets; ZIP sanity.

## 8. Stop and ask

TEMPLATE §8. Stop if `createXlsxWorkbook` is missing and 0350's description of it is not enough to add it in ≤ 40 lines.

## 9. Report

`docs/tasks/0360-report.md`.

## Risk list

Numbers the accountant types into their software.

## Owner steps

1. Decisions line (if 0350's line is not there yet): "2026-10-26 XLSX sheet names/headers in English until cs.json wakes; hand-built writer, no exceljs in exports".
