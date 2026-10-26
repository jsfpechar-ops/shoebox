import { Money } from '@shoebox/domain';
import type { ImportMapping, ImportTarget } from './mapping';
import { parseDateText } from './sheet';

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
  | {
      readonly ok: false;
      readonly reason: 'missing_issue_date' | 'missing_total' | 'bad_amount' | 'bad_date';
    };

const YES = new Set(['ano', 'yes', 'x', '✓', '1', 'true']);
const NO = new Set(['ne', 'no', '0', 'false', '']);

interface ParsedAmount {
  /** Decimal literal with a sign and exactly two decimals, e.g. `-99.90`. */
  readonly literal: string;
  readonly currency: string | null;
}

/** Czech and English amounts; `.` `,` `Kč` `€` tokens. Never a float. */
function parseAmountText(raw: string): ParsedAmount | null {
  let currency: string | null = null;
  if (/€|EUR/i.test(raw)) currency = 'EUR';
  else if (/Kč|Kc|CZK/i.test(raw)) currency = 'CZK';

  let body = raw.replace(/Kč|Kc|CZK|€|EUR/gi, '').replace(/[\s  ]/g, '');
  let negative = false;
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1);
  }
  if (!/^\d+(?:[.,]\d+)*$/.test(body)) return null;

  const dots = body.split('.').length - 1;
  const commas = body.split(',').length - 1;
  let intPart: string;
  let fracPart = '';
  if (dots > 0 && commas > 0) {
    const cut = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'));
    intPart = body.slice(0, cut).replace(/[.,]/g, '');
    fracPart = body.slice(cut + 1);
  } else if (commas > 0) {
    if (commas === 1) {
      const cut = body.indexOf(',');
      intPart = body.slice(0, cut);
      fracPart = body.slice(cut + 1);
    } else {
      intPart = body.replace(/,/g, '');
    }
  } else if (dots > 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
      intPart = body.replace(/\./g, '');
    } else if (dots === 1) {
      const cut = body.indexOf('.');
      intPart = body.slice(0, cut);
      fracPart = body.slice(cut + 1);
    } else {
      return null;
    }
  } else {
    intPart = body;
  }
  if (fracPart.length > 2) return null;
  return { literal: `${negative ? '-' : ''}${intPart}.${fracPart.padEnd(2, '0')}`, currency };
}

function toMoneyString(literal: string, currency: string): string | null {
  try {
    return Money.parse(literal, currency).toFixed2();
  } catch {
    return null;
  }
}

function currencyFromColumn(raw: string): string | null {
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : null;
}

function parsePaid(raw: string): { readonly paid: boolean | null; readonly paidOn: string | null } {
  const key = raw.trim().toLowerCase();
  if (YES.has(key)) return { paid: true, paidOn: null };
  if (NO.has(key)) return { paid: false, paidOn: null };
  const date = parseDateText(raw, true);
  if (date !== null) return { paid: true, paidOn: date };
  return { paid: null, paidOn: null };
}

/** null for a fully empty row. Currency from the column (3 letters) else from a currency token in the amount, else CZK. */
export function parseImportRow(
  row: readonly string[],
  mapping: ImportMapping,
): ImportRowResult | null {
  if (row.every((c) => c.trim() === '')) return null;
  const cell = (t: ImportTarget): string => {
    const i = mapping[t];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const optional = (t: ImportTarget): string | null => {
    const v = cell(t);
    return v === '' ? null : v;
  };

  const dateRaw = cell('issue_date');
  if (dateRaw === '') return { ok: false, reason: 'missing_issue_date' };
  const issueDate = parseDateText(dateRaw, true);
  if (issueDate === null) return { ok: false, reason: 'bad_date' };

  const grossRaw = cell('total_gross');
  if (grossRaw === '') return { ok: false, reason: 'missing_total' };
  const gross = parseAmountText(grossRaw);
  if (gross === null) return { ok: false, reason: 'bad_amount' };

  const currency = currencyFromColumn(cell('currency')) ?? gross.currency ?? 'CZK';
  const totalGross = toMoneyString(gross.literal, currency);
  if (totalGross === null) return { ok: false, reason: 'bad_amount' };

  const optionalMoney = (t: ImportTarget): string | null => {
    const raw = cell(t);
    if (raw === '') return null;
    const parsed = parseAmountText(raw);
    return parsed === null ? null : toMoneyString(parsed.literal, currency);
  };

  const dueRaw = optional('due_date');
  let dueDate: string | null = null;
  if (dueRaw !== null) {
    dueDate = parseDateText(dueRaw, true);
    if (dueDate === null) return { ok: false, reason: 'bad_date' };
  }

  const paid = mapping.paid === undefined ? { paid: null, paidOn: null } : parsePaid(cell('paid'));

  return {
    ok: true,
    value: {
      issue_date: issueDate,
      total_gross: totalGross,
      currency,
      partner_name: optional('partner_name'),
      partner_ico: optional('partner_ico'),
      document_number: optional('document_number'),
      total_vat: optionalMoney('total_vat'),
      total_net: optionalMoney('total_net'),
      variable_symbol: optional('variable_symbol'),
      due_date: dueDate,
      description: optional('description'),
      paid: paid.paid,
      paid_on: paid.paidOn,
    },
  };
}
