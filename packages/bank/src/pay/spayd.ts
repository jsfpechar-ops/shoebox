import { crc32 } from 'node:zlib';
import { compareLegalDates, type LegalDate, type Money } from '@shoebox/domain';

export interface SpaydInput {
  readonly iban: string;
  readonly bic?: string;
  readonly amount: Money;
  readonly vs?: string;
  readonly ks?: string;
  readonly ss?: string;
  readonly dueDate?: LegalDate;
  readonly message?: string;
  readonly recipientName?: string;
}

/** NFD, combining marks removed, `*` → `%2A`, whitespace collapsed, trimmed; case kept. */
export function spaydFold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\*/g, '%2A')
    .trim();
}

/** Digits of `vs` when 1–10 of them; else digits of `documentNumber` when 1–10; else undefined. */
export function spaydSymbol(vs: string | null, documentNumber: string | null): string | undefined {
  const from = digits(vs);
  if (from !== undefined) return from;
  return digits(documentNumber);
}

function digits(s: string | null): string | undefined {
  const d = (s ?? '').replace(/\D+/g, '');
  return d.length >= 1 && d.length <= 10 ? d : undefined;
}

/** Uppercase 8-hex CRC32 of ['SPD*1.0', ...attrs sorted].join('*'); attrs are `KEY:VALUE` without CRC32. */
export function spaydCrc32(attrs: readonly string[]): string {
  const signed = ['SPD*1.0', ...[...attrs].sort()].join('*');
  return crc32(Buffer.from(signed, 'utf8')).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * `today` decides whether DT is written (omitted when dueDate < today); without
 * `today` DT is always written. Throws RangeError unless amount.currency === 'CZK'.
 */
export function buildSpayd(i: SpaydInput, today?: LegalDate): string {
  if (i.amount.currency !== 'CZK')
    throw new RangeError(`SPAYD supports CZK only, got ${i.amount.currency}`);
  const attrs: string[] = [];
  attrs.push(`ACC:${i.iban}${i.bic === undefined ? '' : `+${i.bic}`}`);
  attrs.push(`AM:${i.amount.toFixed2()}`);
  attrs.push('CC:CZK');
  if (
    i.dueDate !== undefined &&
    (today === undefined || compareLegalDates(i.dueDate, today) >= 0)
  ) {
    attrs.push(`DT:${i.dueDate.replaceAll('-', '')}`);
  }
  const message = i.message === undefined ? undefined : spaydFold(i.message);
  if (message !== undefined && message.length > 0) attrs.push(`MSG:${message.slice(0, 60)}`);
  const name = i.recipientName === undefined ? undefined : spaydFold(i.recipientName);
  if (name !== undefined && name.length > 0) attrs.push(`RN:${name.slice(0, 35)}`);
  const ks = i.ks === undefined ? undefined : digits(i.ks);
  if (ks !== undefined) attrs.push(`X-KS:${ks}`);
  const ss = i.ss === undefined ? undefined : digits(i.ss);
  if (ss !== undefined) attrs.push(`X-SS:${ss}`);
  const vs = i.vs === undefined ? undefined : digits(i.vs);
  if (vs !== undefined) attrs.push(`X-VS:${vs}`);
  return ['SPD*1.0', ...attrs.sort(), `CRC32:${spaydCrc32(attrs)}`].join('*');
}
