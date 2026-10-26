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
