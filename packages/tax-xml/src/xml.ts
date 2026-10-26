import type { LegalDate, Money } from '@shoebox/domain';

export type AttrValue = string | null; // null = omitted
export interface VetaNode {
  readonly name: string;
  readonly attrs: ReadonlyArray<readonly [string, AttrValue]>;
}
export interface PisemnostInput {
  readonly form: 'DPHDP3' | 'DPHKH1' | 'DPHSHV';
  readonly verzePis: string;
  readonly appVersion: string;
  readonly vety: readonly VetaNode[];
}

export const NAZEV_SW = 'Shoebox';

// Escapes & < > " and drops control characters below 0x20 except tab, LF and CR,
// which are written as numeric character references so they survive attribute normalisation.
export function escapeAttr(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case '\t':
        out += '&#9;';
        break;
      case '\n':
        out += '&#10;';
        break;
      case '\r':
        out += '&#13;';
        break;
      default:
        if (ch.charCodeAt(0) >= 0x20) out += ch;
    }
  }
  return out;
}

// 'YYYY-MM-DD' -> 'DD.MM.YYYY'
export function dateAttr(date: LegalDate): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

// Whole-Kč Money -> '13700'; zero -> null; throws when haléře are present.
export function intAttr(m: Money): AttrValue {
  const d = m.toDecimal();
  if (!d.isInteger()) throw new Error(`tax-xml: intAttr needs whole Kč, got ${m.toString()}`);
  if (d.isZero()) return null;
  return d.toFixed(0);
}

// Money -> two decimals '11549.94'; zero -> null.
export function dec2Attr(m: Money): AttrValue {
  const d = m.toDecimal();
  if (d.isZero()) return null;
  return d.toFixed(2);
}

// Trimmed text; empty or missing -> null.
export function textAttr(value: string | null | undefined): AttrValue {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function renderAttrs(attrs: VetaNode['attrs']): string {
  let out = '';
  for (const [name, value] of attrs) {
    if (value !== null) out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

// Byte-deterministic EPO document: null attributes dropped, order kept, no spaces around '='.
export function writePisemnost(input: PisemnostInput): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Pisemnost nazevSW="${NAZEV_SW}" verzeSW="${escapeAttr(input.appVersion)}">`,
    `  <${input.form} verzePis="${escapeAttr(input.verzePis)}">`,
  ];
  for (const veta of input.vety) {
    lines.push(`    <${veta.name}${renderAttrs(veta.attrs)}/>`);
  }
  lines.push(`  </${input.form}>`, '</Pisemnost>');
  return `${lines.join('\n')}\n`;
}
