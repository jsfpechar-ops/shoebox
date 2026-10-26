import { isLegalDate, type LegalDate, Money } from '@shoebox/domain';
import { parseAccount, parseAmount, parseYymmdd, symbolsFromText } from '../normalize';
import type { AccountRef, CanonicalTx, ParsedStatement, ParseWarning } from '../types';

export const MT940_PARSER_VERSION = 1;

const DEFAULT_CURRENCY = 'CZK';
const TAG_LINE = /^:(\d{2}[A-Z]?):(.*)$/;
const BALANCE = /^([CD])(\d{6})([A-Z]{3})(\d+,\d{0,2})$/;
const STATEMENT_LINE =
  /^(\d{6})(\d{4})?(RC|RD|C|D)[A-Z]?(\d+,\d{0,2})(?:[NSF][A-Z0-9]{3})?([^/]*)(?:\/\/(.*))?$/;

interface Field {
  tag: string;
  value: string;
  line: number;
}

/** A tag line starts a field; following lines without a tag continue it (joined with no separator). */
function readFields(text: string): Field[] {
  const fields: Field[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const tag = TAG_LINE.exec(line);
    if (tag) {
      fields.push({ tag: tag[1] ?? '', value: tag[2] ?? '', line: index + 1 });
      return;
    }
    const last = fields[fields.length - 1];
    if (last !== undefined) last.value += line;
  });
  return fields;
}

/** Entry date MMDD, year taken from the value date; December/January entries roll over the year end. */
function bookingDate(valueDate: LegalDate, entry: string): LegalDate {
  const valueYear = Number(valueDate.slice(0, 4));
  const valueMonth = valueDate.slice(5, 7);
  const entryMonth = entry.slice(0, 2);
  let year = valueYear;
  if (valueMonth === '12' && entryMonth === '01') year = valueYear + 1;
  if (valueMonth === '01' && entryMonth === '12') year = valueYear - 1;
  const iso = `${year}-${entry.slice(0, 2)}-${entry.slice(2, 4)}`;
  return isLegalDate(iso) ? iso : valueDate;
}

export function parseMt940(text: string, options?: { currency?: string }): ParsedStatement {
  const warnings: ParseWarning[] = [];
  const txs: CanonicalTx[] = [];
  let currency = options?.currency ?? DEFAULT_CURRENCY;
  let account: AccountRef | undefined;
  let statementNumber: string | undefined;
  let periodFrom: LegalDate | undefined;
  let periodTo: LegalDate | undefined;
  let opening: Money | undefined;
  let closing: Money | undefined;
  /** The transaction whose :61: line was the previous field; only its :86: is attached. */
  let lastTx: CanonicalTx | null = null;

  for (const field of readFields(text)) {
    const attach = lastTx;
    lastTx = null;
    const value = field.value.trim();

    if (field.tag === '25') {
      if (value !== '') account = parseAccount(value) ?? { account: value };
    } else if (field.tag === '28C') {
      statementNumber = value;
    } else if (field.tag === '60F' || field.tag === '60M') {
      const m = BALANCE.exec(value);
      const date = m ? parseYymmdd(m[2] ?? '') : null;
      if (m && date !== null) {
        currency = m[3] ?? currency;
        const amount = parseAmount(m[4] ?? '', currency);
        if (amount !== null) opening = m[1] === 'D' ? amount.negate() : amount;
        periodFrom = date;
      }
    } else if (field.tag === '62F') {
      const m = BALANCE.exec(value);
      const date = m ? parseYymmdd(m[2] ?? '') : null;
      if (m && date !== null) {
        const amount = parseAmount(m[4] ?? '', m[3] ?? currency);
        if (amount !== null) closing = m[1] === 'D' ? amount.negate() : amount;
        periodTo = date;
      }
    } else if (field.tag === '61') {
      const m = STATEMENT_LINE.exec(field.value);
      const valueDate = m ? parseYymmdd(m[1] ?? '') : null;
      const amount = m && valueDate !== null ? parseAmount(m[4] ?? '', currency) : null;
      if (!m || valueDate === null || amount === null) {
        warnings.push({ line: field.line, code: 'mt940.bad_line' });
        continue;
      }
      const code = m[3] ?? '';
      const signed = code === 'C' || code === 'RD' ? amount : amount.negate();
      const tx: CanonicalTx = {
        bookedOn: m[2] ? bookingDate(valueDate, m[2]) : valueDate,
        valueDate,
        amount: signed,
        counterparty: {},
        raw: { line: field.line },
      };
      const ref = (m[6] ?? '').trim();
      if (ref !== '') {
        tx.externalId = `mt940:${ref}`;
      }
      if (code.startsWith('R')) tx.isReversal = true;
      txs.push(tx);
      lastTx = tx;
    } else if (field.tag === '86' && attach !== null) {
      attachDetails(attach, field.value);
    }
  }

  const statement: ParsedStatement = {
    format: 'mt940',
    parserVersion: MT940_PARSER_VERSION,
    account: { ...(account ?? {}), currency },
    txs,
    warnings,
  };
  if (statementNumber !== undefined && statementNumber !== '') {
    statement.statementNumber = statementNumber;
  }
  if (periodFrom !== undefined) statement.periodFrom = periodFrom;
  if (periodTo !== undefined) statement.periodTo = periodTo;
  if (opening !== undefined) statement.openingBalance = opening;
  if (closing !== undefined) statement.closingBalance = closing;
  if (opening !== undefined && closing !== undefined) {
    const sum = Money.sum([opening, ...txs.map((tx) => tx.amount)], currency);
    statement.balanceCheck = sum.equals(closing) ? 'ok' : 'mismatch';
  }
  return statement;
}

/** :86: text: ?20–?29 → message, ?32 and ?33 → counterparty name, ?31 → account; no subfields → whole text is the message. */
function attachDetails(tx: CanonicalTx, value: string): void {
  let message = '';
  let name = '';
  let account: AccountRef | null = null;
  if (/\?\d{2}/.test(value)) {
    const parts = value.split(/\?(\d{2})/);
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const sub = parts[i] ?? '';
      const content = parts[i + 1] ?? '';
      if (sub >= '20' && sub <= '29') message += content;
      else if (sub === '32' || sub === '33') name = [name, content].filter((s) => s !== '').join(' ');
      else if (sub === '31') account = parseAccount(content);
    }
  } else {
    message = value;
  }
  message = message.trim();
  if (message !== '') {
    tx.message = message;
    const symbols = symbolsFromText(message);
    if (symbols.vs !== undefined) tx.vs = symbols.vs;
    if (symbols.ks !== undefined) tx.ks = symbols.ks;
    if (symbols.ss !== undefined) tx.ss = symbols.ss;
  }
  if (name !== '') tx.counterparty = { ...tx.counterparty, name };
  if (account !== null) tx.counterparty = { ...tx.counterparty, ...account };
}
