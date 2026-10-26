import { type Currency, isLegalDate, type LegalDate, Money } from '@shoebox/domain';
import { czAccountToIban, czAccountValid, ibanValid } from '@shoebox/validation';
import type { AccountRef } from './types';

/** Amount text → Money; null when it is not an amount. */
export function parseAmount(text: string, currency: Currency): Money | null {
  const cleaned = text.replace(/[\s  ']/g, '');
  const sign = cleaned.startsWith('-') ? '-' : '';
  const body = cleaned.replace(/^[+-]/, '');
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;

  let intPart = body;
  let fracPart = '';
  const decimal = body.match(/^(.*)[.,](\d{1,2})$/);
  if (decimal) {
    intPart = decimal[1] ?? '';
    fracPart = decimal[2] ?? '';
  }
  const intDigits = intPart.replace(/[.,]/g, '') || '0';
  const literal = `${sign}${intDigits}${fracPart ? `.${fracPart}` : ''}`;
  return Money.parse(literal, currency);
}

/** VS/KS/SS: every non-digit dropped, leading zeros stripped; null when empty, all zeros, or > 10 digits. */
export function parseSymbol(text: string | null | undefined): string | null {
  if (text == null) return null;
  const stripped = text.replace(/\D/g, '').replace(/^0+/, '');
  if (stripped === '' || stripped.length > 10) return null;
  return stripped;
}

/** `prefix-number`/`number` without leading zeros; prefix omitted when it is all zeros or empty. */
export function formatAccount(prefix: string | null, number: string): string {
  const p = (prefix ?? '').replace(/^0+/, '');
  const n = number.replace(/^0+/, '');
  return p === '' ? n : `${p}-${n}`;
}

/** 'prefix-number/bank', 'number/bank' or an IBAN (spaces allowed, any case). null when invalid. */
export function parseAccount(text: string): AccountRef | null {
  const t = text.replace(/\s/g, '').toUpperCase();

  if (/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(t)) {
    if (!ibanValid(t)) return null;
    if (!t.startsWith('CZ')) return { iban: t };
    const bankCode = t.slice(4, 8);
    const prefix = t.slice(8, 14).replace(/^0+/, '') || null;
    const number = t.slice(14, 24).replace(/^0+/, '');
    if (!czAccountValid(prefix, number, bankCode)) return null;
    return { account: formatAccount(prefix, number), bankCode, iban: t };
  }

  const m = t.match(/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/);
  if (!m) return null;
  const prefix = (m[1] ?? '').replace(/^0+/, '') || null;
  const number = (m[2] ?? '').replace(/^0+/, '');
  const bankCode = m[3] ?? '';
  if (!czAccountValid(prefix, number, bankCode)) return null;
  const iban = czAccountToIban(prefix, number, bankCode);
  if (!iban) return null;
  return { account: formatAccount(prefix, number), bankCode, iban };
}

/** GPC 16-digit account field in `edicni` encoding (prefix 6 + number 10). null when all zeros or not 16 digits. */
export function decodeGpcAccount(field: string): string | null {
  if (!/^\d{16}$/.test(field)) return null;
  const number = field.slice(6).replace(/^0+/, '');
  if (number === '') return null;
  return formatAccount(field.slice(0, 6), field.slice(6));
}

/** 'DDMMYY' → LegalDate (century 20YY); null for '000000' or an impossible date. */
export function parseDdmmyy(text: string): LegalDate | null {
  if (!/^\d{6}$/.test(text) || text === '000000') return null;
  const iso = `20${text.slice(4, 6)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
  return isLegalDate(iso) ? iso : null;
}

/** 'YYMMDD' → LegalDate (century 20YY); null for '000000' or an impossible date. */
export function parseYymmdd(text: string): LegalDate | null {
  if (!/^\d{6}$/.test(text) || text === '000000') return null;
  const iso = `20${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4, 6)}`;
  return isLegalDate(iso) ? iso : null;
}

/** VS/KS/SS found in free text with the M07 §4.3.2 regexes, each through parseSymbol. */
export function symbolsFromText(text: string): { vs?: string; ks?: string; ss?: string } {
  const out: { vs?: string; ks?: string; ss?: string } = {};
  const vs = parseSymbol(text.match(/(?:^|\/)VS[:/]?\s*(\d{1,10})/)?.[1]);
  const ks = parseSymbol(text.match(/(?:^|\/)KS[:/]?\s*(\d{1,10})/)?.[1]);
  const ss = parseSymbol(text.match(/(?:^|\/)SS[:/]?\s*(\d{1,10})/)?.[1]);
  if (vs) out.vs = vs;
  if (ks) out.ks = ks;
  if (ss) out.ss = ss;
  return out;
}
