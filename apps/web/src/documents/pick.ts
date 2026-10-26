import type { FixKind } from './correction';

export const PICK_EVENT = 'sysel:pick';
export const LOCATE_EVENT = 'sysel:locate';

/** Asks the PDF viewer to highlight where a value sits. The value is never logged. */
export function requestLocate(kind: FixKind, value: string): void {
  window.dispatchEvent(new CustomEvent(LOCATE_EVENT, { detail: { kind, value } }));
}

let active: string | null = null;

/** The open Fix input that last had focus receives picks. */
export function setPickTarget(id: string | null): void {
  active = id;
}

export function isPickTarget(id: string): boolean {
  return active === id;
}

const MONEY = /^-?\d+(\.\d{1,2})?$/;
const DATE_CZ = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/;
const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const TEXT_MAX = 200;

/** Picked words → the input's format: money '8 150,00 Kč' → '8150.00'; date '30. 9. 2026' or '30.09.2026' → '2026-09-30'; text trimmed, spaces collapsed, ≤ 200 chars. null when nothing usable. */
export function cleanPicked(kind: FixKind, raw: string): string | null {
  if (kind === 'money') return cleanMoney(raw);
  if (kind === 'date') return cleanDate(raw);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.slice(0, TEXT_MAX);
}

function cleanMoney(raw: string): string | null {
  let s = raw.replace(/[^\d,.-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // The last separator is the decimal mark; the other one is grouping.
    const dec = Math.max(lastComma, lastDot);
    s = `${s.slice(0, dec).replace(/[,.]/g, '')}.${s.slice(dec + 1)}`;
  } else if (lastComma !== -1) {
    // A single comma is the decimal mark (more commas stay and fail the match below).
    s = s.replace(',', '.');
  }
  if (!MONEY.test(s)) return null;
  if (!s.includes('.')) return s;
  const [whole, frac = ''] = s.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

function cleanDate(raw: string): string | null {
  const cz = DATE_CZ.exec(raw);
  if (cz) {
    const [, d, m, y] = cz;
    return `${y}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
  }
  const iso = DATE_ISO.exec(raw);
  if (iso) return iso[0];
  return null;
}
