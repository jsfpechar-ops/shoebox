import type { LegalDate } from '@shoebox/domain';

export interface ExportPeriod {
  readonly key: string;
  readonly from: LegalDate;
  readonly to: LegalDate;
}

export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;

const UNSAFE_CHARS = '\\/:*?"<>|';
const PART_MAX = 80;

const MIME_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthPeriod(year: number, month: number): ExportPeriod {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    key: `${year}-${pad(month)}`,
    from: `${year}-${pad(month)}-01` as LegalDate,
    to: `${year}-${pad(month)}-${pad(last)}` as LegalDate,
  };
}

function quarterPeriod(year: number, quarter: number): ExportPeriod {
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return {
    key: `${year}-Q${quarter}`,
    from: `${year}-${pad(first)}-01` as LegalDate,
    to: `${year}-${pad(last)}-${pad(lastDay)}` as LegalDate,
  };
}

function yearPeriod(year: number): ExportPeriod {
  return {
    key: String(year),
    from: `${year}-01-01` as LegalDate,
    to: `${year}-12-31` as LegalDate,
  };
}

function previousMonth(today: LegalDate): ExportPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
}

/** '2026-09' month, '2026-Q3' quarter, '2026' year; anything else → the month before `today`. */
export function parsePeriod(key: string | null, today: LegalDate): ExportPeriod {
  const month = key?.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const m = Number(month[2]);
    if (m >= 1 && m <= 12) return monthPeriod(Number(month[1]), m);
  }
  const quarter = key?.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return quarterPeriod(Number(quarter[1]), Number(quarter[2]));
  if (key !== null && /^\d{4}$/.test(key)) return yearPeriod(Number(key));
  return previousMonth(today);
}

/** Select options, newest first: the last 12 months (this one first), then this quarter and the 3 before it, then this year and last year. */
export function periodOptions(today: LegalDate): ExportPeriod[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const months: ExportPeriod[] = [];
  for (let i = 0; i < 12; i++) {
    const index = year * 12 + (month - 1) - i;
    months.push(monthPeriod(Math.floor(index / 12), (index % 12) + 1));
  }
  const quarters: ExportPeriod[] = [];
  const currentQuarterIndex = year * 4 + Math.floor((month - 1) / 3);
  for (let i = 0; i < 4; i++) {
    const index = currentQuarterIndex - i;
    quarters.push(quarterPeriod(Math.floor(index / 4), (index % 4) + 1));
  }
  return [...months, ...quarters, yearPeriod(year), yearPeriod(year - 1)];
}

function cleanPart(value: string | null): string {
  return [...(value ?? '').trim()]
    .map((ch) => (UNSAFE_CHARS.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .slice(0, PART_MAX)
    .trim();
}

function extensionOf(fileName: string | null, mime: string): string {
  const fromName = fileName?.match(/\.([A-Za-z0-9]{1,10})$/);
  if (fromName) return (fromName[1] ?? '').toLowerCase();
  return MIME_EXT[mime.toLowerCase()] ?? 'bin';
}

/** `2026-09/2026-09-30 Úklid Praha 2026-0412.pdf`; unsafe characters → '_', each part ≤ 80 chars, a repeat gets ' (2)', ' (3)'… before the extension. Adds the name to `used`. */
export function exportEntryName(
  row: { date: LegalDate | null; partner: string | null; number: string | null },
  fileName: string | null,
  mime: string,
  used: Set<string>,
): string {
  const folder = row.date === null ? 'undated' : row.date.slice(0, 7);
  const base =
    [row.date ?? '', cleanPart(row.partner), cleanPart(row.number)]
      .filter((part) => part !== '')
      .join(' ') || 'document';
  const ext = extensionOf(fileName, mime);
  let name = `${folder}/${base}.${ext}`;
  for (let n = 2; used.has(name); n++) {
    name = `${folder}/${base} (${n}).${ext}`;
  }
  used.add(name);
  return name;
}
