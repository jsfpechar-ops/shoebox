import { addDays, type LegalDate, Money } from '@shoebox/domain';
import { decodeGpcAccount, parseAccount, parseDdmmyy, parseSymbol } from '../normalize';
import type { CanonicalTx, ParsedStatement, ParseWarning } from '../types';

export const GPC_PARSER_VERSION = 1;
export type GpcProfile = 'gpc_fio' | 'gpc_generic';
export interface GpcOptions {
  /** Default 'gpc_generic'. */
  profile?: GpcProfile;
  /** Account currency; default 'CZK'. */
  currency?: string;
}

const RECORD_LENGTH = 128;

const POSTING_CODES: Record<string, { negative: boolean; reversal: boolean }> = {
  '1': { negative: true, reversal: false },
  '2': { negative: false, reversal: false },
  '4': { negative: false, reversal: true },
  '5': { negative: true, reversal: true },
};

const ISO_NUMERIC: Record<string, string> = {
  '203': 'CZK',
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '985': 'PLN',
  '348': 'HUF',
  '756': 'CHF',
};

interface GpcHeader {
  accountField: string;
  accountNumber: string | null;
  periodFrom: LegalDate | undefined;
  periodTo: LegalDate | undefined;
  statementNumber: string;
  opening: Money | undefined;
  closing: Money | undefined;
  debit: Money | undefined;
  credit: Money | undefined;
  postingDate: LegalDate | undefined;
}

/** Haléře digits → Money by string work only (never Number). */
function haleresToMoney(digits: string, negative: boolean, currency: string): Money {
  const padded = digits.replace(/^0+/, '').padStart(3, '0');
  const literal = `${padded.slice(0, -2)}.${padded.slice(-2)}`;
  return Money.parse(`${negative ? '-' : ''}${literal}`, currency);
}

function signedBalance(digits: string, sign: string, currency: string): Money | undefined {
  if (!/^\d{14}$/.test(digits)) return undefined;
  return haleresToMoney(digits, sign === '-', currency);
}

function parseHeader(text: string, profile: GpcProfile, currency: string): GpcHeader {
  const accountField = text.slice(3, 19);
  const oldBalanceDate = parseDdmmyy(text.slice(39, 45));
  const postingDate = parseDdmmyy(text.slice(108, 114));
  const statementRaw = text.slice(105, 108);
  return {
    accountField,
    accountNumber: decodeGpcAccount(accountField),
    periodFrom:
      oldBalanceDate === null
        ? undefined
        : profile === 'gpc_fio'
          ? addDays(oldBalanceDate, 1)
          : oldBalanceDate,
    periodTo: postingDate ?? undefined,
    statementNumber: statementRaw.replace(/^0+/, '') || '0',
    opening: signedBalance(text.slice(45, 59), text.slice(59, 60), currency),
    closing: signedBalance(text.slice(60, 74), text.slice(74, 75), currency),
    debit: signedBalance(text.slice(75, 89), text.slice(89, 90), currency),
    credit: signedBalance(text.slice(90, 104), text.slice(104, 105), currency),
    postingDate: postingDate ?? undefined,
  };
}

export function parseGpc(text: string, options?: GpcOptions): ParsedStatement {
  const profile: GpcProfile = options?.profile ?? 'gpc_generic';
  const currency = options?.currency ?? 'CZK';
  const lines = text.split(/\r?\n/);
  const warnings: ParseWarning[] = [];
  const txs: CanonicalTx[] = [];

  const headerIndex = lines.findIndex((l) => l.slice(0, 3) === '074' && l.length === RECORD_LENGTH);
  if (headerIndex === -1) {
    return {
      format: 'gpc',
      parserVersion: GPC_PARSER_VERSION,
      profile,
      txs,
      warnings: [{ code: 'gpc.no_header' }],
    };
  }
  const header = parseHeader(lines[headerIndex] ?? '', profile, currency);

  let lastTx: CanonicalTx | undefined;
  lines.forEach((text, index) => {
    const line = index + 1;
    if (text.trim() === '') return;
    const type = text.slice(0, 3);

    if (type === '074') {
      if (index !== headerIndex) warnings.push({ line, code: 'gpc.bad_line' });
      lastTx = undefined;
      return;
    }

    if (type === '078' || type === '079') {
      const part = text.slice(3).trim();
      if (lastTx && part !== '') {
        lastTx.message = lastTx.message ? `${lastTx.message} ${part}` : part;
      }
      return;
    }

    lastTx = undefined;
    if (type !== '075' || text.length !== RECORD_LENGTH) {
      warnings.push({ line, code: 'gpc.bad_line' });
      return;
    }

    if (text.slice(3, 19) !== header.accountField) {
      warnings.push({ line, code: 'gpc.account_mismatch' });
      return;
    }

    const rule = POSTING_CODES[text.slice(60, 61)];
    if (!rule) {
      warnings.push({ line, code: 'gpc.posting_code' });
      return;
    }

    const valueDate = parseDdmmyy(text.slice(91, 97));
    const bookedOn = parseDdmmyy(text.slice(122, 128)) ?? valueDate ?? header.postingDate;
    if (bookedOn === undefined) {
      warnings.push({ line, code: 'gpc.no_date' });
      return;
    }

    const isoCode = ISO_NUMERIC[text.slice(118, 122).slice(-3)];
    if (isoCode !== undefined && isoCode !== currency) {
      warnings.push({ line, code: 'gpc.currency_mismatch' });
    }

    const amountDigits = text.slice(48, 60);
    if (!/^\d{12}$/.test(amountDigits)) {
      warnings.push({ line, code: 'gpc.bad_line' });
      return;
    }
    const amount = haleresToMoney(amountDigits, rule.negative, currency);

    const counterparty: CanonicalTx['counterparty'] = {};
    const account = decodeGpcAccount(text.slice(19, 35));
    if (account !== null) counterparty.account = account;

    const ksField = text.slice(71, 81);
    let ks: string | null;
    if (profile === 'gpc_fio') {
      const bankCodeRaw = ksField.slice(2, 6);
      if (bankCodeRaw !== '0000') {
        counterparty.bankCode = bankCodeRaw;
        if (account !== null) {
          const iban = parseAccount(`${account}/${bankCodeRaw}`)?.iban;
          if (iban !== undefined) counterparty.iban = iban;
        }
      }
      ks = parseSymbol(ksField.slice(6, 10));
    } else {
      ks = parseSymbol(ksField);
    }

    const name = text.slice(97, 117).trim();
    if (name !== '') counterparty.name = name;

    const tx: CanonicalTx = {
      bookedOn,
      amount,
      counterparty,
      raw: { line, code: text.slice(60, 61) },
    };
    if (profile === 'gpc_fio') {
      const id = text.slice(35, 48).replace(/^0+/, '');
      if (id !== '') tx.externalId = `gpc:${id}`;
    }
    if (valueDate !== null) tx.valueDate = valueDate;
    const vs = parseSymbol(text.slice(61, 71));
    if (vs !== null) tx.vs = vs;
    if (ks !== null) tx.ks = ks;
    const ss = parseSymbol(text.slice(81, 91));
    if (ss !== null) tx.ss = ss;
    if (rule.reversal) tx.isReversal = true;

    txs.push(tx);
    lastTx = tx;
  });

  const statement: ParsedStatement = {
    format: 'gpc',
    parserVersion: GPC_PARSER_VERSION,
    profile,
    account:
      header.accountNumber === null ? { currency } : { account: header.accountNumber, currency },
    statementNumber: header.statementNumber,
    txs,
    warnings,
  };
  if (header.periodFrom !== undefined) statement.periodFrom = header.periodFrom;
  if (header.periodTo !== undefined) statement.periodTo = header.periodTo;
  if (header.opening !== undefined) statement.openingBalance = header.opening;
  if (header.closing !== undefined) statement.closingBalance = header.closing;
  if (header.debit !== undefined) statement.controlDebit = header.debit;
  if (header.credit !== undefined) statement.controlCredit = header.credit;

  const { opening, closing, debit, credit } = header;
  if (opening && closing && debit && credit) {
    const amounts = txs.map((tx) => tx.amount);
    const endsAt = Money.sum([opening, ...amounts], currency);
    const negatives = Money.sum(
      amounts.filter((a) => a.isNegative()),
      currency,
    ).abs();
    const positives = Money.sum(
      amounts.filter((a) => a.isPositive()),
      currency,
    );
    const ok =
      endsAt.equals(closing) && negatives.equals(debit.abs()) && positives.equals(credit.abs());
    statement.balanceCheck = ok ? 'ok' : 'mismatch';
  }

  return statement;
}
