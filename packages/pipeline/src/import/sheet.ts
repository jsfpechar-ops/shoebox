import ExcelJS from 'exceljs';

export type SheetRead =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: 'xls_unsupported' | 'too_large' | 'unreadable' };

export const IMPORT_LIMITS = { bytes: 5 * 1024 * 1024, rows: 5000, columns: 50 } as const;

const NUMBER_LIKE = /^[-+]?[\d\s.,]+(\s*(Kč|Kc|CZK|€|EUR))?$/i;

const CZ_DATE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function toIsoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null;
  return d.toISOString().slice(0, 10);
}

/** Czech `1. 3. 2026`, `01.03.2026`, ISO `2026-03-01`; optionally an Excel serial (20000–80000). */
export function parseDateText(text: string, allowSerial = false): string | null {
  const t = text.trim();
  const cz = CZ_DATE.exec(t);
  if (cz) return toIsoDate(Number(cz[3]), Number(cz[2]), Number(cz[1]));
  const iso = ISO_DATE.exec(t);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (allowSerial && /^\d+$/.test(t)) {
    const serial = Number(t);
    if (serial >= 20000 && serial <= 80000) {
      return new Date(EXCEL_EPOCH_MS + serial * 86400000).toISOString().slice(0, 10);
    }
  }
  return null;
}

function looksNumericOrDate(text: string): boolean {
  if (parseDateText(text) !== null) return true;
  return /\d/.test(text) && NUMBER_LIKE.test(text);
}

/** Every cell as a trimmed string; XLSX dates as YYYY-MM-DD; rows beyond the limits → too_large. */
export async function readSpreadsheet(bytes: Uint8Array, fileName: string): Promise<SheetRead> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xls')) return { ok: false, reason: 'xls_unsupported' };
  if (bytes.byteLength > IMPORT_LIMITS.bytes) return { ok: false, reason: 'too_large' };
  return lower.endsWith('.xlsx') ? readXlsx(bytes) : readCsv(bytes);
}

async function readXlsx(bytes: Uint8Array): Promise<SheetRead> {
  try {
    const wb = new ExcelJS.Workbook();
    const data = Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0];
    await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    if (ws === undefined) return { ok: false, reason: 'unreadable' };
    if (ws.rowCount > IMPORT_LIMITS.rows || ws.columnCount > IMPORT_LIMITS.columns) {
      return { ok: false, reason: 'too_large' };
    }
    const rows: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part: unknown) =>
          typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '',
        )
        .join('')
        .trim();
    }
  }
  return '';
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of head) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  let best = ';';
  let bestCount = -1;
  for (const d of [';', ',', '\t']) {
    const n = counts[d] ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

function readCsv(bytes: Uint8Array): SheetRead {
  let text: string;
  try {
    text = decodeText(bytes).replace(/^﻿/, '');
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length > IMPORT_LIMITS.rows || rows.some((r) => r.length > IMPORT_LIMITS.columns)) {
    return { ok: false, reason: 'too_large' };
  }
  return { ok: true, rows };
}

/** The first of the first 10 rows with at least 3 non-empty cells that are not numbers or dates. */
export function findHeaderRow(rows: readonly (readonly string[])[]): number | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] ?? [];
    const texts = row.filter((c) => c.trim() !== '' && !looksNumericOrDate(c.trim()));
    if (texts.length >= 3) return i;
  }
  return null;
}
