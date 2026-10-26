# 0211: Spreadsheet import core: read, map, parse rows

Status: review
Ticket: P2-IMP-01 | Depends on: none | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0211-report.md

## 1. Objective

Pure functions that read a user's old XLSX/CSV list of documents, find the header row, suggest which column is which (no AI), and turn each row into document values or a skip reason. A later brief adds the preview, the import job and the screen. OSVČ users switching from a spreadsheet keep their history without retyping.

## 2. Context

M01 §4.13 (pasted, trimmed):
- Limits: 5 MiB, 5 000 rows, 50 columns. `.xls` is unsupported ("save it as .xlsx").
- XLSX via `exceljs` (decision D-12 default; first sheet). CSV: UTF-8 if there is a BOM or the bytes are valid UTF-8, else windows-1250 (`new TextDecoder('windows-1250')`, Node has full ICU). Delimiter = the most frequent of `;` `,` `\t` in the first 20 lines. Quotes `"…"` with `""` escapes.
- Header row = the first of the first 10 rows with ≥ 3 non-empty cells that are not numbers or dates.
- Mapping, headers folded (lowercase, NFD, strip `\p{M}`, trim, collapse spaces), first synonym match wins, a column is used once:

| Target | Synonyms (folded, whole header equals one of them) | Value sniff when no header matched |
|---|---|---|
| `issue_date` (required) | datum, datum vystaveni, vystaveno, date, issue date | first unused column with ≥ 80 % dates |
| `partner_name` | dodavatel, odberatel, firma, partner, nazev, protistrana, supplier | – |
| `partner_ico` | ico, ic | ≥ 80 % 8-digit values passing `icoChecksumValid` |
| `document_number` | cislo, cislo faktury, c. dokladu, cislo dokladu, doklad, invoice no, faktura | – |
| `total_gross` (required) | castka, celkem, s dph, castka s dph, cena, amount, total | – |
| `total_vat` | dph, dan, vat | – |
| `total_net` | bez dph, zaklad, castka bez dph | – |
| `paid` | zaplaceno, uhrazeno, datum uhrady, paid | – |
| `currency` | mena, currency | – |
| `variable_symbol` | vs, variabilni symbol | – |
| `due_date` | splatnost, datum splatnosti, due date | – |
| `description` | popis, poznamka, description, note | – |

- Header signature = sha256 hex (node:crypto) of the folded headers joined with `\u001f`.
- Values: amounts `1 234,50`, `1.234,50`, `1234.5`, `1234,5`, optional `Kč`/`Kc`/`CZK`/`€`/`EUR`, leading `-` → Money string with 2 decimals; both `,` and `.` → the last one is the decimal separator; only `.` and pattern `^\d{1,3}(\.\d{3})+$` → thousands. Dates `1. 3. 2026`, `01.03.2026`, `2026-03-01`, Excel serials (a whole number 20000–80000 in a date column = days since 1899-12-30). Paid: `ano/yes/x/✓/1/true` → true, `ne/no/0/false/""` → false, a date → true with `paid_on`.
- A row missing a required value is skipped with its reason; a fully empty row is ignored (returns `null`).

Money: `Money` from `@shoebox/domain` (`Money.parse(text, currency)` then `toFixed2()`), never floats on amounts (hard rule 1). Add `"@shoebox/domain": "workspace:*"` and `"@shoebox/validation": "workspace:*"` (for `icoChecksumValid`) and `"exceljs": "4.4.0"` (exact, decision D-12) to `packages/pipeline/package.json`, then `pnpm install`. Numbers in XLSX cells are JS numbers: convert them with `String(n)` only (exceljs returns what the user typed; never do arithmetic on them).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/package.json`, `pnpm-lock.yaml` | edit | three dependencies |
| `packages/pipeline/src/import/sheet.ts` | new | `readSpreadsheet`, `findHeaderRow` |
| `packages/pipeline/src/import/mapping.ts` | new | `suggestMapping`, `headerSignature`, `foldHeader` |
| `packages/pipeline/src/import/row.ts` | new | `parseImportRow` |
| `packages/pipeline/src/import/index.ts` | new | re-exports |
| `packages/pipeline/test/import.test.ts` | new | test below, verbatim |
| `packages/pipeline/src/index.ts` | edit | `export * from './import';` |

## 4. Steps

1. Exports, exactly:

```ts
// sheet.ts
export type SheetRead =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: 'xls_unsupported' | 'too_large' | 'unreadable' };
export const IMPORT_LIMITS = { bytes: 5 * 1024 * 1024, rows: 5000, columns: 50 } as const;
/** Every cell as a trimmed string; XLSX dates as YYYY-MM-DD; rows beyond the limits → too_large. */
export function readSpreadsheet(bytes: Uint8Array, fileName: string): Promise<SheetRead>;
export function findHeaderRow(rows: readonly (readonly string[])[]): number | null;

// mapping.ts
export const IMPORT_TARGETS = ['issue_date', 'partner_name', 'partner_ico', 'document_number', 'total_gross', 'total_vat', 'total_net', 'paid', 'currency', 'variable_symbol', 'due_date', 'description'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];
export type ImportMapping = Readonly<Partial<Record<ImportTarget, number>>>; // target → column index
export function foldHeader(text: string): string;
export function headerSignature(headers: readonly string[]): string;
export function suggestMapping(headers: readonly string[], sample: readonly (readonly string[])[]): ImportMapping;

// row.ts
export interface ImportedValues {
  readonly issue_date: string;
  readonly total_gross: string;
  readonly currency: string; // default 'CZK'
  readonly partner_name: string | null;
  readonly partner_ico: string | null;
  readonly document_number: string | null;
  readonly total_vat: string | null;
  readonly total_net: string | null;
  readonly variable_symbol: string | null;
  readonly due_date: string | null;
  readonly description: string | null;
  readonly paid: boolean | null; // null when no paid column
  readonly paid_on: string | null;
}
export type ImportRowResult =
  | { readonly ok: true; readonly value: ImportedValues }
  | { readonly ok: false; readonly reason: 'missing_issue_date' | 'missing_total' | 'bad_amount' | 'bad_date' };
/** null for a fully empty row. Currency from the column (3 letters) else from a currency token in the amount, else CZK. */
export function parseImportRow(row: readonly string[], mapping: ImportMapping): ImportRowResult | null;
```

2. Test file `packages/pipeline/test/import.test.ts`, verbatim:

```ts
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  findHeaderRow,
  headerSignature,
  parseImportRow,
  readSpreadsheet,
  suggestMapping,
} from '../src/index';

// Synthetic values only (hard rule 4).
const CP1250: Record<string, number> = { Č: 0xc8, í: 0xed, á: 0xe1, ř: 0xf8, ě: 0xec };
function cp1250(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => CP1250[c] ?? c.charCodeAt(0)));
}

const CSV = [
  'Moje evidence 2025;;;;;;',
  'Datum;Dodavatel;IČO;Číslo faktury;Částka;DPH;Zaplaceno',
  '1. 3. 2025;Testovací s.r.o.;25596641;2025-0001;1 210,00 Kč;210,00;ano',
  '02.03.2025;Jiná firma;00006947;2025-0002;117,00;;ne',
  ';;;;;;',
  ';Bez data;;X;50;;',
].join('\r\n');

describe('readSpreadsheet', () => {
  it('reads a windows-1250 CSV with ; delimiter', async () => {
    const r = await readSpreadsheet(cp1250(CSV), 'evidence-2025.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[1]).toEqual(['Datum', 'Dodavatel', 'IČO', 'Číslo faktury', 'Částka', 'DPH', 'Zaplaceno']);
    expect(findHeaderRow(r.rows)).toBe(1);
  });

  it('reads UTF-8 with a BOM and quoted commas', async () => {
    const text = '﻿Datum,Firma,Částka\n2025-03-01,"Firma, s.r.o.","1 234,50"\n';
    const r = await readSpreadsheet(new TextEncoder().encode(text), 'a.csv');
    expect(r.ok && r.rows[1]).toEqual(['2025-03-01', 'Firma, s.r.o.', '1 234,50']);
  });

  it('reads the first sheet of an XLSX, dates as ISO', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Doklady');
    ws.addRow(['Datum', 'Dodavatel', 'Celkem']);
    ws.addRow([new Date(Date.UTC(2025, 2, 1)), 'Testovací s.r.o.', 1210.5]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await readSpreadsheet(bytes, 'a.xlsx');
    expect(r.ok && r.rows).toEqual([
      ['Datum', 'Dodavatel', 'Celkem'],
      ['2025-03-01', 'Testovací s.r.o.', '1210.5'],
    ]);
  });

  it('refuses .xls and oversized files', async () => {
    expect(await readSpreadsheet(new Uint8Array([0xd0, 0xcf]), 'old.xls')).toEqual({ ok: false, reason: 'xls_unsupported' });
    expect(await readSpreadsheet(new Uint8Array(5 * 1024 * 1024 + 1), 'big.csv')).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('suggestMapping', () => {
  const headers = ['Datum', 'Dodavatel', 'IČO', 'Číslo faktury', 'Částka', 'DPH', 'Zaplaceno'];
  it('maps all 7 columns from the headers', () => {
    expect(suggestMapping(headers, [])).toEqual({
      issue_date: 0,
      partner_name: 1,
      partner_ico: 2,
      document_number: 3,
      total_gross: 4,
      total_vat: 5,
      paid: 6,
    });
  });
  it('sniffs an unnamed date column and an IČO column', () => {
    const m = suggestMapping(['Kdy', 'Komu', 'Id', 'Celkem'], [
      ['1.3.2025', 'A', '25596641', '10'],
      ['2.3.2025', 'B', '00006947', '20'],
    ]);
    expect(m).toEqual({ issue_date: 0, partner_ico: 2, total_gross: 3 });
  });
  it('signature ignores case and diacritics', () => {
    expect(headerSignature(['Částka', 'DPH'])).toBe(headerSignature(['castka', 'dph']));
    expect(headerSignature(['Částka', 'DPH'])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseImportRow', () => {
  const m = { issue_date: 0, partner_name: 1, partner_ico: 2, document_number: 3, total_gross: 4, total_vat: 5, paid: 6 };
  it('parses a full row', () => {
    expect(parseImportRow(['1. 3. 2025', 'Testovací s.r.o.', '25596641', '2025-0001', '1 210,00 Kč', '210,00', 'ano'], m)).toEqual({
      ok: true,
      value: {
        issue_date: '2025-03-01',
        total_gross: '1210.00',
        currency: 'CZK',
        partner_name: 'Testovací s.r.o.',
        partner_ico: '25596641',
        document_number: '2025-0001',
        total_vat: '210.00',
        total_net: null,
        variable_symbol: null,
        due_date: null,
        description: null,
        paid: true,
        paid_on: null,
      },
    });
  });
  it.each([
    ['1.234,50', '1234.50'],
    ['1234.5', '1234.50'],
    ['1234,5', '1234.50'],
    ['1.234', '1234.00'],
    ['-99,90', '-99.90'],
    ['12,50 €', '12.50'],
  ])('amount %s → %s', (raw, out) => {
    const r = parseImportRow(['2025-03-01', '', '', '', raw, '', ''], m);
    expect(r?.ok && r.value.total_gross).toBe(out);
  });
  it('reads EUR from the amount and dates from Excel serials and paid dates', () => {
    const r = parseImportRow(['45717', '', '', '', '12,50 €', '', '15.03.2025'], m);
    expect(r?.ok && r.value).toMatchObject({ issue_date: '2025-03-01', currency: 'EUR', paid: true, paid_on: '2025-03-15' });
  });
  it('skips rows with a reason and ignores empty rows', () => {
    expect(parseImportRow(['', 'Bez data', '', 'X', '50', '', ''], m)).toEqual({ ok: false, reason: 'missing_issue_date' });
    expect(parseImportRow(['2025-03-01', 'A', '', '', '', '', ''], m)).toEqual({ ok: false, reason: 'missing_total' });
    expect(parseImportRow(['2025-03-01', 'A', '', '', 'abc', '', ''], m)).toEqual({ ok: false, reason: 'bad_amount' });
    expect(parseImportRow(['31.02.2025', 'A', '', '', '10', '', ''], m)).toEqual({ ok: false, reason: 'bad_date' });
    expect(parseImportRow(['', '', '', '', '', '', ''], m)).toBeNull();
  });
});
```

   Implement until it passes; do not edit the test file (biome formatting allowed). If exceljs needs a different import form under this TypeScript setup, STOP (§8).

## 5. Do not touch

Everything outside §3. `packages/pipeline` categorize/ledger stages (lane C). Hard rules 1, 4.

## 6. Commands

```
pnpm --filter @shoebox/pipeline test 2>&1 | tail -30
pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30
pnpm depcruise 2>&1 | tail -30
pnpm exec biome check --write packages/pipeline 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0211-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`row.ts` amount parsing (money), `package.json` exact versions.
