# 0402: ZIP and XLSX writers without a dependency

Status: todo
Ticket: lane D (register Excel, accountant ZIP) | Depends on: none | Base commit: see branch | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`packages/exports` can write a ZIP file and a one-sheet Excel file (XLSX) in memory, with no new dependency (owner 2026-10-26). The register download (0404) and the accountant ZIP (0408) use them.

## 2. Context

- ZIP "stored" method (no compression), UTF-8 names (flag bit 11), one central directory, no ZIP64 (≤ 65 535 entries, each < 4 GiB). Little-endian integers.
- XLSX = a ZIP of 5 XML parts; text as inline strings, numbers as `<v>`. Money arrives as a decimal string ("1234.50"), never a float (hard rule 1).

## 3. Files

| Path | Action |
|---|---|
| `packages/exports/src/zip.ts` | new (code below) |
| `packages/exports/src/xlsx.ts` | new (code below) |
| `packages/exports/src/index.ts` | edit |
| `packages/exports/test/zip.test.ts` | new (test below) |
| `packages/exports/test/xlsx.test.ts` | new (test below) |

## 4. Steps

1. New `packages/exports/src/zip.ts`:
   ```ts
   /** In-memory ZIP writer, stored method (no compression), UTF-8 names. No ZIP64. */
   export interface ZipEntry {
     readonly name: string;
     readonly data: Uint8Array;
   }

   const CRC_TABLE = (() => {
     const table = new Uint32Array(256);
     for (let n = 0; n < 256; n++) {
       let c = n;
       for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
       table[n] = c >>> 0;
     }
     return table;
   })();

   export function crc32(data: Uint8Array): number {
     let c = 0xffffffff;
     for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
     return (c ^ 0xffffffff) >>> 0;
   }

   function dosTime(at: Date): { time: number; date: number } {
     const year = Math.max(at.getUTCFullYear(), 1980);
     return {
       time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
       date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
     };
   }

   export function createZip(entries: readonly ZipEntry[], at: Date): Uint8Array {
     if (entries.length > 0xffff) throw new Error('zip_too_many_entries');
     const encoder = new TextEncoder();
     const { time, date } = dosTime(at);
     const locals: Uint8Array[] = [];
     const centrals: Uint8Array[] = [];
     let offset = 0;
     for (const entry of entries) {
       const name = encoder.encode(entry.name);
       const crc = crc32(entry.data);
       const size = entry.data.length;
       const local = new Uint8Array(30 + name.length);
       const lv = new DataView(local.buffer);
       lv.setUint32(0, 0x04034b50, true);
       lv.setUint16(4, 20, true);
       lv.setUint16(6, 0x0800, true);
       lv.setUint16(8, 0, true);
       lv.setUint16(10, time, true);
       lv.setUint16(12, date, true);
       lv.setUint32(14, crc, true);
       lv.setUint32(18, size, true);
       lv.setUint32(22, size, true);
       lv.setUint16(26, name.length, true);
       lv.setUint16(28, 0, true);
       local.set(name, 30);
       const central = new Uint8Array(46 + name.length);
       const cv = new DataView(central.buffer);
       cv.setUint32(0, 0x02014b50, true);
       cv.setUint16(4, 20, true);
       cv.setUint16(6, 20, true);
       cv.setUint16(8, 0x0800, true);
       cv.setUint16(10, 0, true);
       cv.setUint16(12, time, true);
       cv.setUint16(14, date, true);
       cv.setUint32(16, crc, true);
       cv.setUint32(20, size, true);
       cv.setUint32(24, size, true);
       cv.setUint16(28, name.length, true);
       cv.setUint32(42, offset, true);
       central.set(name, 46);
       locals.push(local, entry.data);
       centrals.push(central);
       offset += local.length + size;
     }
     const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
     const end = new Uint8Array(22);
     const ev = new DataView(end.buffer);
     ev.setUint32(0, 0x06054b50, true);
     ev.setUint16(8, entries.length, true);
     ev.setUint16(10, entries.length, true);
     ev.setUint32(12, centralSize, true);
     ev.setUint32(16, offset, true);
     const out = new Uint8Array(offset + centralSize + end.length);
     let at2 = 0;
     for (const part of [...locals, ...centrals, end]) {
       out.set(part, at2);
       at2 += part.length;
     }
     return out;
   }
   ```
2. New `packages/exports/src/xlsx.ts`:
   ```ts
   import { createZip } from './zip';

   /** A text cell, a number cell (decimal string, never a float) or an empty cell. */
   export type XlsxCell = string | { readonly num: string } | null;

   const NUMBER = /^-?\d+(\.\d+)?$/;
   // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 forbids these characters
   const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

   export function escapeXml(text: string): string {
     return text
       .replace(XML_FORBIDDEN, '')
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;');
   }

   /** 0 → A, 25 → Z, 26 → AA. */
   export function columnName(index: number): string {
     let n = index + 1;
     let name = '';
     while (n > 0) {
       const rest = (n - 1) % 26;
       name = String.fromCharCode(65 + rest) + name;
       n = Math.floor((n - 1) / 26);
     }
     return name;
   }

   function cellXml(cell: XlsxCell, ref: string): string {
     if (cell === null || cell === '') return '';
     if (typeof cell === 'object') {
       return NUMBER.test(cell.num)
         ? `<c r="${ref}"><v>${cell.num}</v></c>`
         : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.num)}</t></is></c>`;
     }
     return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
   }

   function sheetXml(rows: readonly (readonly XlsxCell[])[]): string {
     const body = rows
       .map((row, r) => {
         const cells = row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('');
         return `<row r="${r + 1}">${cells}</row>`;
       })
       .join('');
     return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
   }

   const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
   const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
   const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

   function workbookXml(sheetName: string): string {
     const name = escapeXml(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)) || 'Sheet1';
     return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
   }

   export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

   export function createXlsx(
     sheetName: string,
     rows: readonly (readonly XlsxCell[])[],
     at: Date,
   ): Uint8Array {
     const enc = new TextEncoder();
     return createZip(
       [
         { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
         { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
         { name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheetName)) },
         { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
         { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(rows)) },
       ],
       at,
     );
   }
   ```
3. `packages/exports/src/index.ts`: keep the existing line and append
   ```ts
   export { crc32, createZip, type ZipEntry } from './zip';
   export { columnName, createXlsx, escapeXml, XLSX_MIME, type XlsxCell } from './xlsx';
   ```
4. New `packages/exports/test/zip.test.ts` (do not edit after writing):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { crc32, createZip } from '../src';

   const enc = new TextEncoder();
   const dec = new TextDecoder();

   /** Reads the stored entries back by walking the local headers. */
   function readZip(zip: Uint8Array): Array<{ name: string; text: string; crc: number }> {
     const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
     const out: Array<{ name: string; text: string; crc: number }> = [];
     let p = 0;
     while (view.getUint32(p, true) === 0x04034b50) {
       const crc = view.getUint32(p + 14, true);
       const size = view.getUint32(p + 18, true);
       const nameLength = view.getUint16(p + 26, true);
       const name = dec.decode(zip.subarray(p + 30, p + 30 + nameLength));
       const data = zip.subarray(p + 30 + nameLength, p + 30 + nameLength + size);
       out.push({ name, text: dec.decode(data), crc });
       p += 30 + nameLength + size;
     }
     return out;
   }

   describe('crc32', () => {
     it('matches the reference values', () => {
       expect(crc32(enc.encode('hello'))).toBe(0x3610a686);
       expect(crc32(new Uint8Array())).toBe(0);
     });
   });

   describe('createZip', () => {
     const at = new Date(Date.UTC(2026, 9, 26, 10, 30, 0));
     const zip = createZip(
       [
         { name: 'register.xlsx', data: enc.encode('sheet') },
         { name: 'doklady/2026-09 Účtenka.pdf', data: enc.encode('%PDF-1.7') },
       ],
       at,
     );

     it('stores every entry with its UTF-8 name, data and CRC', () => {
       const entries = readZip(zip);
       expect(entries.map((e) => e.name)).toEqual(['register.xlsx', 'doklady/2026-09 Účtenka.pdf']);
       expect(entries[1]?.text).toBe('%PDF-1.7');
       expect(entries[0]?.crc).toBe(crc32(enc.encode('sheet')));
     });

     it('ends with an end-of-central-directory record that counts the entries', () => {
       const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
       const end = zip.length - 22;
       expect(view.getUint32(end, true)).toBe(0x06054b50);
       expect(view.getUint16(end + 10, true)).toBe(2);
       const centralOffset = view.getUint32(end + 16, true);
       expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
     });

     it('an empty archive is just the end record', () => {
       expect(createZip([], at).length).toBe(22);
     });
   });
   ```
5. New `packages/exports/test/xlsx.test.ts` (do not edit after writing):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { columnName, createXlsx, escapeXml } from '../src';

   const dec = new TextDecoder();

   function part(zip: Uint8Array, wanted: string): string {
     const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
     let p = 0;
     while (view.getUint32(p, true) === 0x04034b50) {
       const size = view.getUint32(p + 18, true);
       const nameLength = view.getUint16(p + 26, true);
       const name = dec.decode(zip.subarray(p + 30, p + 30 + nameLength));
       if (name === wanted) return dec.decode(zip.subarray(p + 30 + nameLength, p + 30 + nameLength + size));
       p += 30 + nameLength + size;
     }
     throw new Error(`no part ${wanted}`);
   }

   describe('xlsx helpers', () => {
     it('names columns like Excel', () => {
       expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
     });
     it('escapes XML and drops forbidden control characters', () => {
       expect(escapeXml('a<b & "c"\u0001')).toBe('a&lt;b &amp; &quot;c&quot;');
     });
   });

   describe('createXlsx', () => {
     const zip = createXlsx(
       'Documents 2026',
       [
         ['Date', 'Partner', 'Amount'],
         ['2026-09-30', 'Úklid & spol.', { num: '8150.00' }],
         ['2026-09-10', null, { num: 'n/a' }],
       ],
       new Date(Date.UTC(2026, 9, 26)),
     );

     it('has the five parts a spreadsheet app needs', () => {
       for (const name of [
         '[Content_Types].xml',
         '_rels/.rels',
         'xl/workbook.xml',
         'xl/_rels/workbook.xml.rels',
         'xl/worksheets/sheet1.xml',
       ])
         expect(part(zip, name).startsWith('<?xml')).toBe(true);
       expect(part(zip, 'xl/workbook.xml')).toContain('name="Documents 2026"');
     });

     it('writes text inline, decimal strings as numbers, skips empty cells', () => {
       const sheet = part(zip, 'xl/worksheets/sheet1.xml');
       expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Úklid &amp; spol.</t></is></c>');
       expect(sheet).toContain('<c r="C2"><v>8150.00</v></c>');
       expect(sheet).not.toContain('r="B3"');
       expect(sheet).toContain('<c r="C3" t="inlineStr"><is><t xml:space="preserve">n/a</t></is></c>');
     });
   });
   ```
6. Run `pnpm --filter @shoebox/exports test 2>&1 | tail -30` (all pass), `pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30` (0 errors), `pnpm exec biome check packages/exports 2>&1 | tail -15` (fix formatting with `--write` on these files only).

## 5. Do not touch

Everything outside §3. No new dependency (hard rule 7).

## 6. Commands

As in step 6.

## 7. Acceptance

- [ ] exports tests and typecheck pass; biome clean.

## 8. Stop and ask

As TEMPLATE §8. If a given test fails because the given code is wrong, fix the code (never the test) once; then stop.

## 9. Report

`docs/tasks/0402-report.md`, 150 tokens at most. Set `Status: review`.
