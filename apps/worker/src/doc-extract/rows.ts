import { Money } from '@shoebox/domain';
import type { ProtoExtraction, ProtoPaymentMethod } from '@shoebox/extraction';
import type { ValidationRow } from '@shoebox/validation';

export { type ValidationRow, validationRowsOf } from '@shoebox/validation';

export interface VatRates {
  readonly standard: number;
  readonly reduced: number;
}

export type DbDocumentClass =
  | 'received_invoice'
  | 'received_receipt'
  | 'received_credit_note'
  | 'received_proforma'
  | 'received_advance_tax_doc'
  | 'order_confirmation'
  | 'settlement_statement'
  | 'government_filing'
  | 'non_document'
  | 'unknown';

export interface DocumentPatch {
  readonly class: DbDocumentClass;
  readonly classSource: 'llm';
  readonly direction: 'in';
  readonly taxDocStatus: 'full_tax_document' | 'not_tax_document' | 'unknown';
  readonly partnerSnapshot: {
    name: string | null;
    ico: string | null;
    dic: string | null;
    vat_id: string | null;
    country: string | null;
  } | null;
  readonly buyerSnapshot: { name: string | null; ico: string | null; dic: string | null } | null;
  readonly documentNumber: string | null;
  readonly variableSymbol: string | null;
  readonly issueDate: string | null;
  readonly duzp: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string | null;
  readonly totalVat: string | null;
  readonly totalGross: string | null;
  readonly paymentMethod: 'bank_transfer' | 'card' | 'cash' | 'cod' | 'other' | null;
  readonly payToAccount: {
    account: string | null;
    bank_code: string | null;
    iban: string | null;
  } | null;
  readonly isPaidPerDocument: boolean | null;
}

export interface VatSummaryRow {
  readonly vatRateType: 'standard' | 'reduced' | 'zero' | 'none';
  readonly vatRatePct: string;
  readonly base: string;
  readonly vat: string;
}

export interface FieldRow {
  readonly fieldKey: string;
  readonly valueText: string;
  readonly source: 'llm' | 'isdoc' | 'qr' | 'pdf_text';
}

export type StatusAfterRead = 'ready' | 'needs_review' | 'supporting';

function mapPaymentMethod(method: ProtoPaymentMethod | null): DocumentPatch['paymentMethod'] {
  switch (method) {
    case null:
      return null;
    case 'cash_on_delivery':
      return 'cod';
    case 'bank_transfer':
    case 'card':
    case 'cash':
    case 'other':
      return method;
  }
}

export function documentPatchOf(x: ProtoExtraction): DocumentPatch {
  const cls: DbDocumentClass = x.document_class === 'unreadable' ? 'unknown' : x.document_class;

  let taxDocStatus: DocumentPatch['taxDocStatus'] = 'unknown';
  if (x.not_tax_document) {
    taxDocStatus = 'not_tax_document';
  } else if (
    (cls === 'received_invoice' ||
      cls === 'received_credit_note' ||
      cls === 'received_advance_tax_doc') &&
    x.vat_recap.length > 0
  ) {
    taxDocStatus = 'full_tax_document';
  }

  const s = x.supplier;
  const partnerSnapshot =
    s.name === null && s.ico === null && s.dic === null && s.vat_id === null && s.country === null
      ? null
      : { name: s.name, ico: s.ico, dic: s.dic, vat_id: s.vat_id, country: s.country };

  const b = x.buyer;
  const buyerSnapshot =
    b.name === null && b.ico === null && b.dic === null
      ? null
      : { name: b.name, ico: b.ico, dic: b.dic };

  const p = x.payment;
  const payToAccount =
    p.account_number === null && p.bank_code === null && p.iban === null
      ? null
      : { account: p.account_number, bank_code: p.bank_code, iban: p.iban };

  return {
    class: cls,
    classSource: 'llm',
    direction: 'in',
    taxDocStatus,
    partnerSnapshot,
    buyerSnapshot,
    documentNumber: x.document.number,
    variableSymbol: x.document.variable_symbol,
    issueDate: x.dates.issue_date,
    duzp: x.dates.duzp,
    dueDate: x.dates.due_date,
    currency: x.currency ?? 'CZK',
    totalNet: x.totals.net,
    totalVat: x.totals.vat,
    totalGross: x.totals.gross,
    paymentMethod: mapPaymentMethod(p.method),
    payToAccount,
    isPaidPerDocument: x.flags.paid_text ? true : null,
  };
}

export function vatSummaryOf(x: ProtoExtraction, rates: VatRates): VatSummaryRow[] {
  const currency = x.currency ?? 'CZK';
  const groups = new Map<
    string,
    { type: VatSummaryRow['vatRateType']; pct: string; base: Money; vat: Money }
  >();

  for (const line of x.vat_recap) {
    const rate = Number(line.rate_pct);
    let type: VatSummaryRow['vatRateType'] = 'none';
    if (rate === rates.standard) {
      type = 'standard';
    } else if (rate === rates.reduced) {
      type = 'reduced';
    } else if (rate === 0) {
      type = 'zero';
    }

    const pct = String(rate);
    const key = `${type}|${pct}`;
    const base = Money.parse(line.base, currency);
    const vat = Money.parse(line.vat, currency);
    const existing = groups.get(key);
    if (existing) {
      existing.base = existing.base.add(base);
      existing.vat = existing.vat.add(vat);
    } else {
      groups.set(key, { type, pct, base, vat });
    }
  }

  return [...groups.values()].map((g) => ({
    vatRateType: g.type,
    vatRatePct: g.pct,
    base: g.base.toString(),
    vat: g.vat.toString(),
  }));
}

export function fieldsOf(x: ProtoExtraction, source: FieldRow['source'] = 'llm'): FieldRow[] {
  const pairs: Array<[string, string | null]> = [
    ['supplier.name', x.supplier.name],
    ['supplier.ico', x.supplier.ico],
    ['supplier.dic', x.supplier.dic],
    ['supplier.vat_id', x.supplier.vat_id],
    ['supplier.country', x.supplier.country],
    ['buyer.name', x.buyer.name],
    ['buyer.ico', x.buyer.ico],
    ['buyer.dic', x.buyer.dic],
    ['document.number', x.document.number],
    ['document.variable_symbol', x.document.variable_symbol],
    ['dates.issue_date', x.dates.issue_date],
    ['dates.duzp', x.dates.duzp],
    ['dates.due_date', x.dates.due_date],
    ['currency', x.currency],
    ['totals.net', x.totals.net],
    ['totals.vat', x.totals.vat],
    ['totals.gross', x.totals.gross],
    ['payment.account_number', x.payment.account_number],
    ['payment.bank_code', x.payment.bank_code],
    ['payment.iban', x.payment.iban],
    ['payment.method', x.payment.method],
  ];
  x.vat_recap.forEach((line, i) => {
    pairs.push([`vat_recap[${i}].rate_pct`, line.rate_pct]);
    pairs.push([`vat_recap[${i}].base`, line.base]);
    pairs.push([`vat_recap[${i}].vat`, line.vat]);
  });
  pairs.push(['flags.non_vat_payer_text', String(x.flags.non_vat_payer_text)]);
  pairs.push(['flags.reverse_charge_text', String(x.flags.reverse_charge_text)]);
  pairs.push(['flags.paid_text', String(x.flags.paid_text)]);

  const rows: FieldRow[] = [];
  for (const [fieldKey, value] of pairs) {
    if (value !== null) {
      rows.push({ fieldKey, valueText: value, source });
    }
  }
  return rows;
}

export function statusAfterRead(
  x: ProtoExtraction,
  rows: readonly ValidationRow[],
): StatusAfterRead {
  if (x.document_class === 'non_document') {
    return 'supporting';
  }
  if (x.document_class === 'unreadable' || x.document_class === 'unknown') {
    return 'needs_review';
  }
  if (rows.some((r) => r.severity === 'blocking')) {
    return 'needs_review';
  }
  return 'ready';
}
