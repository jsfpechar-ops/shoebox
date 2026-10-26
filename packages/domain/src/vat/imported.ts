// M05 §4.11: an imported own DPHDP3 (the filed return) parsed from extracted field values, and its
// comparison with our computation. Pure: no I/O. Money stays in Money; the filed whole-Kč integers
// are compared as exact strings, never as floats.

import { isLegalDate, type LegalDate } from '../dates/index';
import { FILING_KIND_VALUES, type FilingKind } from '../enums/index';
import { CZK, Money } from '../money/index';
import { type Dphdp3Computation, dphdp3Row } from './dphdp3';
import { dicDigits } from './header';

export interface ImportedFilingFields {
  readonly formCode: string;
  readonly periodStart: LegalDate;
  readonly kind: FilingKind;
  readonly filerDicDigits: string;
  readonly rows: Readonly<Record<string, { readonly base?: number; readonly tax?: number }>>;
}

export type ImportedMatch =
  | { readonly matches: true }
  | {
      readonly matches: false;
      readonly differences: ReadonlyArray<{
        row: string;
        attr: 'base' | 'tax';
        filed: number;
        ours: number;
      }>;
    };

const ROW_KEY = /^filing\.rows\.(\d{1,2})\.(base|tax)$/;
const WHOLE_KC = /^-?\d+$/;
const FIRST_ROW = 1;
const LAST_ROW = 66;
/** Rows 62–65 carry a single amount (tax), compared as `tax` with base 0. */
const TAX_ONLY_ROWS: Readonly<Record<string, 'row62' | 'row63' | 'row64' | 'row65'>> = {
  '62': 'row62',
  '63': 'row63',
  '64': 'row64',
  '65': 'row65',
};

function fieldValue(
  fields: ReadonlyArray<{ key: string; value: string | null }>,
  key: string,
): string | null {
  const hit = fields.find((f) => f.key === key);
  const text = hit?.value?.trim() ?? '';
  return text === '' ? null : text;
}

/** Whole-Kč integer; spaces (incl. NBSP) allowed as thousands separators. Null when it does not parse. */
function wholeKcOf(text: string | null): number | null {
  if (text === null) return null;
  const compact = text.replace(/\s/g, '');
  return WHOLE_KC.test(compact) ? Number.parseInt(compact, 10) : null;
}

/** `YYYY-MM` becomes the first day of the month; `YYYY-MM-DD` is taken as is. */
function periodStartOf(text: string | null): LegalDate | null {
  if (text === null) return null;
  const candidate = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
  return isLegalDate(candidate) ? candidate : null;
}

function kindOf(text: string | null): FilingKind | null {
  if (text === null) return 'radne';
  return (FILING_KIND_VALUES as readonly string[]).includes(text) ? (text as FilingKind) : null;
}

/** From dotted field keys → value strings; null unless form_code and period_start parse. */
export function parseImportedFilingFields(
  fields: ReadonlyArray<{ key: string; value: string | null }>,
): ImportedFilingFields | null {
  const formCode = fieldValue(fields, 'filing.form_code');
  const periodStart = periodStartOf(fieldValue(fields, 'filing.period_start'));
  const kind = kindOf(fieldValue(fields, 'filing.kind'));
  if (formCode === null || periodStart === null || kind === null) return null;

  const rows: Record<string, { base?: number; tax?: number }> = {};
  for (const field of fields) {
    const match = ROW_KEY.exec(field.key);
    if (!match) continue;
    const row = Number.parseInt(match[1] ?? '', 10);
    if (row < FIRST_ROW || row > LAST_ROW) continue;
    const amount = wholeKcOf(field.value);
    if (amount === null) continue;
    const cell = rows[String(row)] ?? {};
    if (match[2] === 'base') cell.base = amount;
    else cell.tax = amount;
    rows[String(row)] = cell;
  }

  return {
    formCode,
    periodStart,
    kind,
    filerDicDigits: dicDigits(fieldValue(fields, 'filing.filer_dic')) ?? '',
    rows,
  };
}

/** Our value for a row as {base, tax} Money: rows 62–65 are taxes only. */
function oursOf(ours: Dphdp3Computation, row: string): { base: Money; tax: Money } {
  const taxKey = TAX_ONLY_ROWS[row];
  if (taxKey !== undefined) return { base: Money.zero(CZK), tax: ours[taxKey] };
  const value = dphdp3Row(ours, row);
  return { base: value.base, tax: value.tax };
}

function sameWholeKc(money: Money, filed: number): boolean {
  return money.toFixed2() === `${filed}.00`;
}

/** Compares rows 1–66 present on either side; a row missing on one side counts as 0. */
export function compareWithImported(
  ours: Dphdp3Computation,
  imported: ImportedFilingFields,
): ImportedMatch {
  const differences: Array<{ row: string; attr: 'base' | 'tax'; filed: number; ours: number }> = [];
  for (let n = FIRST_ROW; n <= LAST_ROW; n++) {
    const row = String(n);
    const filed = imported.rows[row] ?? {};
    const mine = oursOf(ours, row);
    const attrs: Array<['base' | 'tax', Money, number | undefined]> = [
      ['base', mine.base, filed.base],
      ['tax', mine.tax, filed.tax],
    ];
    for (const [attr, money, filedValue] of attrs) {
      const expected = filedValue ?? 0;
      if (sameWholeKc(money, expected)) continue;
      differences.push({
        row,
        attr,
        filed: expected,
        ours: Number.parseInt(money.toFixed2(), 10),
      });
    }
  }
  return differences.length === 0 ? { matches: true } : { matches: false, differences };
}

export function importedTotals(imported: ImportedFilingFields): {
  rows: Record<string, { base?: number; tax?: number }>;
  source: 'imported';
} {
  const rows: Record<string, { base?: number; tax?: number }> = {};
  for (const [row, cell] of Object.entries(imported.rows)) {
    const copy: { base?: number; tax?: number } = {};
    if (cell.base !== undefined) copy.base = cell.base;
    if (cell.tax !== undefined) copy.tax = cell.tax;
    rows[row] = copy;
  }
  return { rows, source: 'imported' };
}
