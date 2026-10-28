import { czAccountToIban, ibanValid } from '@shoebox/validation';

export interface PayToAccount {
  readonly account?: string | null;
  readonly bank_code?: string | null;
  readonly iban?: string | null;
  readonly bic?: string | null;
}

export type PayToResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'ok'; iban: string; bankCode: string };

/**
 * Printed IBAN when valid (spaces removed, upper case); else built from
 * account/bank_code ("19-2000145399" = prefix 19); mod-11 failure → invalid.
 */
export function payToIban(payTo: PayToAccount | null): PayToResult {
  if (payTo === null) return { kind: 'none' };
  const printed = (payTo.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (printed.length > 0) {
    if (ibanValid(printed)) return { kind: 'ok', iban: printed, bankCode: printed.slice(4, 8) };
  }
  const account = (payTo.account ?? '').replace(/\s+/g, '');
  const bankCode = (payTo.bank_code ?? '').trim();
  if (account.length === 0 || bankCode.length === 0)
    return printed.length > 0 ? { kind: 'invalid' } : { kind: 'none' };
  const dash = account.indexOf('-');
  const prefix = dash >= 0 ? account.slice(0, dash) : '';
  const number = dash >= 0 ? account.slice(dash + 1) : account;
  const iban = czAccountToIban(prefix.length === 0 ? null : prefix, number, bankCode);
  if (iban === null) return { kind: 'invalid' };
  return { kind: 'ok', iban, bankCode };
}
