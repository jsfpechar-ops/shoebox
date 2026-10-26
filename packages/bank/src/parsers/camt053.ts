import { isLegalDate, type LegalDate, Money } from '@shoebox/domain';
import { parseAccount, parseAmount, symbolsFromText } from '../normalize';
import type { AccountRef, CanonicalTx, ParsedStatement, ParseWarning } from '../types';
import { at, child, childrenNamed, parseXml, textAt, type XmlElement } from '../xml';

export const CAMT053_PARSER_VERSION = 1;

const DEFAULT_CURRENCY = 'CZK';

type Symbols = { vs?: string; ks?: string; ss?: string };

function date10(text: string): LegalDate | null {
  const iso = text.slice(0, 10);
  return isLegalDate(iso) ? iso : null;
}

/** Amount element → Money in `currency`, negated for DBIT; null when it is not an amount. */
function amountOf(el: XmlElement | null, negative: boolean, currency: string): Money | null {
  if (el === null) return null;
  const money = parseAmount(el.text, currency);
  if (money === null) return null;
  return negative ? money.negate() : money;
}

/** The detail amount: TxDtls/Amt, or TxDtls/AmtDtls/TxAmt/Amt. */
function detailAmount(detail: XmlElement | null): XmlElement | null {
  return child(detail, 'Amt') ?? at(detail, 'AmtDtls', 'TxAmt', 'Amt');
}

function counterparty(detail: XmlElement | null, credit: boolean): CanonicalTx['counterparty'] {
  const party = at(detail, 'RltdPties', credit ? 'Dbtr' : 'Cdtr');
  const acct = at(detail, 'RltdPties', credit ? 'DbtrAcct' : 'CdtrAcct');
  const out: CanonicalTx['counterparty'] = {};
  const name = textAt(party, 'Nm') || textAt(party, 'Pty', 'Nm');
  if (name !== '') out.name = name;
  const value = textAt(acct, 'Id', 'IBAN') || textAt(acct, 'Id', 'Othr', 'Id');
  if (value !== '') {
    const ref: AccountRef | null = parseAccount(value);
    Object.assign(out, ref ?? { account: value });
  }
  return out;
}

/** VS from a bare 1–10 digit reference first; then KS/SS/VS found in the texts, first value per key wins. */
function symbolsOf(cdtrRef: string, endToEnd: string, ustrd: readonly string[]): Symbols {
  const out: Symbols = {};
  const direct = [cdtrRef, endToEnd].find((t) => /^\d{1,10}$/.test(t));
  if (direct !== undefined) out.vs = direct;
  for (const text of [cdtrRef, endToEnd, ...ustrd]) {
    const found = symbolsFromText(text);
    if (out.vs === undefined && found.vs !== undefined) out.vs = found.vs;
    if (out.ks === undefined && found.ks !== undefined) out.ks = found.ks;
    if (out.ss === undefined && found.ss !== undefined) out.ss = found.ss;
  }
  return out;
}

export function parseCamt053(text: string, options?: { currency?: string }): ParsedStatement {
  const fallback = options?.currency ?? DEFAULT_CURRENCY;
  const warnings: ParseWarning[] = [];

  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch {
    warnings.push({ code: 'camt.bad_xml' });
    return { format: 'camt053', parserVersion: CAMT053_PARSER_VERSION, txs: [], warnings };
  }

  const stmt = at(root, 'BkToCstmrStmt', 'Stmt');
  if (stmt === null) {
    return { format: 'camt053', parserVersion: CAMT053_PARSER_VERSION, txs: [], warnings };
  }

  const currency = textAt(stmt, 'Acct', 'Ccy') || fallback;
  const iban = textAt(stmt, 'Acct', 'Id', 'IBAN');
  const parsedAccount = iban !== '' ? parseAccount(iban) : null;
  const account = { ...(parsedAccount ?? {}), currency };

  let opening: Money | undefined;
  let closing: Money | undefined;
  for (const bal of childrenNamed(stmt, 'Bal')) {
    const code = textAt(bal, 'Tp', 'CdOrPrtry', 'Cd');
    const value = amountOf(child(bal, 'Amt'), textAt(bal, 'CdtDbtInd') === 'DBIT', currency);
    if (value === null) continue;
    if (code === 'OPBD') opening = value;
    if (code === 'CLBD') closing = value;
  }

  const txs: CanonicalTx[] = [];
  for (const ntry of childrenNamed(stmt, 'Ntry')) {
    if (textAt(ntry, 'Sts', 'Cd') !== 'BOOK' && textAt(ntry, 'Sts') !== 'BOOK') continue;
    const bookedOn = date10(textAt(ntry, 'BookgDt', 'Dt') || textAt(ntry, 'BookgDt', 'DtTm'));
    if (bookedOn === null) continue;
    const valueDate = date10(textAt(ntry, 'ValDt', 'Dt') || textAt(ntry, 'ValDt', 'DtTm'));
    const negative = textAt(ntry, 'CdtDbtInd') === 'DBIT';
    const entryAmt = child(ntry, 'Amt');
    const entryCcy = entryAmt?.attrs.Ccy || currency;
    const entryRef = textAt(ntry, 'AcctSvcrRef') || textAt(ntry, 'NtryRef');
    const isReversal = textAt(ntry, 'RvslInd') === 'true';
    const details = childrenNamed(child(ntry, 'NtryDtls'), 'TxDtls');
    const split = details.length > 1 && details.every((d) => detailAmount(d) !== null);
    const parts: Array<XmlElement | null> = split ? [...details] : [details[0] ?? null];

    parts.forEach((detail, index) => {
      const amount = split
        ? amountOf(detailAmount(detail), negative, currency)
        : amountOf(entryAmt, negative, currency);
      if (amount === null) return;

      const detailRef = textAt(detail, 'Refs', 'AcctSvcrRef') || textAt(detail, 'Refs', 'TxId');
      let externalId: string | undefined;
      if (split) {
        if (detailRef !== '') externalId = `camt:${detailRef}`;
        else if (entryRef !== '') externalId = `camt:${entryRef}:${index + 1}`;
      } else {
        const ref = entryRef || detailRef;
        if (ref !== '') externalId = `camt:${ref}`;
      }

      const tx: CanonicalTx = {
        bookedOn,
        amount,
        counterparty: counterparty(detail, !negative),
        raw: { ref: externalId ?? null },
      };
      if (externalId !== undefined) tx.externalId = externalId;
      if (valueDate !== null) tx.valueDate = valueDate;
      if (isReversal) tx.isReversal = true;

      const rmtInf = child(detail, 'RmtInf');
      const ustrd = childrenNamed(rmtInf, 'Ustrd')
        .map((el) => el.text.trim())
        .filter((t) => t !== '');
      if (ustrd.length > 0) tx.message = ustrd.join(' ');
      const symbols = symbolsOf(
        textAt(rmtInf, 'Strd', 'CdtrRefInf', 'Ref'),
        textAt(detail, 'Refs', 'EndToEndId'),
        ustrd,
      );
      if (symbols.vs !== undefined) tx.vs = symbols.vs;
      if (symbols.ks !== undefined) tx.ks = symbols.ks;
      if (symbols.ss !== undefined) tx.ss = symbols.ss;

      const instd = at(detail, 'AmtDtls', 'InstdAmt', 'Amt');
      const origCcy = instd?.attrs.Ccy ?? '';
      if (instd !== null && origCcy !== '' && origCcy !== entryCcy) {
        const original = amountOf(instd, negative, origCcy);
        if (original !== null) tx.amountOriginal = original;
      }

      const scheme = textAt(ntry, 'BkTxCd', 'Domn', 'Fmly', 'Cd');
      if (scheme === 'CCRD' || scheme === 'MCRD') {
        const msg = tx.message ?? '';
        const merchant = tx.counterparty.name ?? msg.slice(0, 40);
        if (merchant !== '') tx.cardMerchant = merchant;
        const last4 = /(?:\*|XXXX)(\d{4})/.exec(msg)?.[1];
        if (last4 !== undefined) tx.cardLast4 = last4;
      }

      txs.push(tx);
    });
  }

  const statement: ParsedStatement = {
    format: 'camt053',
    parserVersion: CAMT053_PARSER_VERSION,
    account,
    txs,
    warnings,
  };
  const statementNumber = textAt(stmt, 'Id');
  if (statementNumber !== '') statement.statementNumber = statementNumber;
  const periodFrom = date10(textAt(stmt, 'FrToDt', 'FrDtTm'));
  if (periodFrom !== null) statement.periodFrom = periodFrom;
  const periodTo = date10(textAt(stmt, 'FrToDt', 'ToDtTm'));
  if (periodTo !== null) statement.periodTo = periodTo;
  if (opening !== undefined) statement.openingBalance = opening;
  if (closing !== undefined) statement.closingBalance = closing;
  if (opening !== undefined && closing !== undefined) {
    const sum = Money.sum([opening, ...txs.map((tx) => tx.amount)], currency);
    statement.balanceCheck = sum.equals(closing) ? 'ok' : 'mismatch';
  }
  return statement;
}
