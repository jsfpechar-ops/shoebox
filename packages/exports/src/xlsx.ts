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

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const WORKSHEET_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const ROOT_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SHEET_CONTENT_TYPE}"/>`,
  ).join('');
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets}</Types>`;
}

function workbookRelsXml(sheetCount: number): string {
  const rels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${WORKSHEET_REL}" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function sheetTitle(sheetName: string): string {
  return escapeXml(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)) || 'Sheet1';
}

function workbookXml(sheetNames: readonly string[]): string {
  const sheets = sheetNames
    .map((name, i) => `<sheet name="${sheetTitle(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxSheet {
  readonly name: string;
  readonly rows: readonly (readonly XlsxCell[])[];
}

/** A workbook with one sheet per entry, in order. Sheet names are cut to 31 characters. */
export function createXlsxWorkbook(sheets: readonly XlsxSheet[], at: Date): Uint8Array {
  if (sheets.length === 0) throw new Error('createXlsxWorkbook needs at least one sheet');
  const enc = new TextEncoder();
  return createZip(
    [
      { name: '[Content_Types].xml', data: enc.encode(contentTypesXml(sheets.length)) },
      { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheets.map((sheet) => sheet.name))) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRelsXml(sheets.length)) },
      ...sheets.map((sheet, i) => ({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: enc.encode(sheetXml(sheet.rows)),
      })),
    ],
    at,
  );
}

export function createXlsx(
  sheetName: string,
  rows: readonly (readonly XlsxCell[])[],
  at: Date,
): Uint8Array {
  return createXlsxWorkbook([{ name: sheetName, rows }], at);
}
