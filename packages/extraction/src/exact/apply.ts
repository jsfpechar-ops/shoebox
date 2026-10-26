import { czDicValid, ibanValid, icoChecksumValid } from '@shoebox/validation';
import type { ProtoExtraction } from '../proto/schema';
import { parseQrPayload, type QrInvoice, type QrPayment } from '../qr/payload';
import type { DocumentScan } from '../scan/scan';
import { findIdentifiers } from '../text/identifiers';

export type ExactSource = 'qr' | 'pdf_text';

export interface ExactDataResult {
  readonly extraction: ProtoExtraction;
  /** field key (M02 grammar, e.g. 'supplier.ico') → source, for every value set from exact data. */
  readonly sources: Readonly<Record<string, ExactSource>>;
  /** QR amount (2 decimals) to check against the total; null when no QR or QRs disagree. */
  readonly qrAmount: string | null;
}

function distinctAmounts(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

/**
 * Exact data wins over the model (M02 §4.7.2): payment QR, then a good PDF text layer.
 * Returns a new extraction; the input is never mutated.
 */
export function applyExactData(
  x: ProtoExtraction,
  scan: DocumentScan,
  org: { readonly ico: string | null; readonly dic: string | null },
  options?: { readonly keepIdentifiers?: boolean },
): ExactDataResult {
  const decoded: Array<QrPayment | QrInvoice> = [];
  for (const text of scan.qrTexts) {
    const result = parseQrPayload(text);
    if (result.ok) decoded.push(result.value);
  }
  const payments = decoded.filter((v): v is QrPayment => v.kind === 'spayd');
  const sids = decoded.filter((v): v is QrInvoice => v.kind === 'sid');
  const invoices: QrInvoice[] = [
    ...sids,
    ...payments.flatMap((p) => (p.invoice === null ? [] : [p.invoice])),
  ];

  // QR amount: exactly one distinct payment amount; without a payment, one distinct SID amount.
  const paymentAmounts = distinctAmounts(payments.map((p) => p.amount));
  const sidAmounts = distinctAmounts(sids.map((s) => s.amount));
  let qrAmount: string | null = null;
  if (paymentAmounts.length === 1) qrAmount = paymentAmounts[0] ?? null;
  else if (paymentAmounts.length === 0 && sidAmounts.length === 1) qrAmount = sidAmounts[0] ?? null;

  if (options?.keepIdentifiers === true) {
    return { extraction: x, sources: {}, qrAmount };
  }

  const next: Record<string, string | null> = {
    'supplier.ico': x.supplier.ico,
    'supplier.dic': x.supplier.dic,
    'document.number': x.document.number,
    'document.variable_symbol': x.document.variable_symbol,
    'dates.due_date': x.dates.due_date,
    'payment.iban': x.payment.iban,
  };
  const sources: Record<string, ExactSource> = {};
  const fromQr = new Set<string>();
  const put = (key: string, value: string, source: ExactSource): void => {
    if (source === 'qr') fromQr.add(key);
    if (next[key] !== value) {
      next[key] = value;
      sources[key] = source;
    }
  };

  // 1. Payment QR.
  const payment = payments[0];
  if (payment !== undefined) {
    if (payment.iban !== null && ibanValid(payment.iban)) put('payment.iban', payment.iban, 'qr');
    if (payment.variable_symbol !== null)
      put('document.variable_symbol', payment.variable_symbol, 'qr');
    if (x.dates.due_date === null && payment.due_date !== null)
      put('dates.due_date', payment.due_date, 'qr');
  }

  // 2. Invoice QR (SID, or the X-INV of a payment): identifiers and number.
  const invoice = invoices[0];
  if (invoice !== undefined) {
    const ico = invoice.supplier_ico;
    if (ico !== null && icoChecksumValid(ico) && ico !== org.ico) put('supplier.ico', ico, 'qr');
    const dic = invoice.supplier_dic;
    if (dic !== null && czDicValid(dic) && dic !== org.dic) put('supplier.dic', dic, 'qr');
    if (invoice.number !== null && x.document.number === null)
      put('document.number', invoice.number, 'qr');
  }

  // 3. Good PDF text layer: identifiers the model misread or missed.
  if (scan.textGood && scan.text !== null) {
    const ids = findIdentifiers(scan.text, org);
    const icoNow = next['supplier.ico'] ?? null;
    if (
      !fromQr.has('supplier.ico') &&
      ids.supplierIco !== null &&
      (icoNow === null || !icoChecksumValid(icoNow) || !ids.icos.includes(icoNow))
    ) {
      put('supplier.ico', ids.supplierIco, 'pdf_text');
    }
    const dicNow = next['supplier.dic'] ?? null;
    if (
      !fromQr.has('supplier.dic') &&
      ids.supplierDic !== null &&
      (dicNow === null || !czDicValid(dicNow) || !ids.dics.includes(dicNow))
    ) {
      put('supplier.dic', ids.supplierDic, 'pdf_text');
    }
    if (
      !fromQr.has('document.variable_symbol') &&
      next['document.variable_symbol'] === null &&
      ids.variableSymbols.length === 1
    ) {
      put('document.variable_symbol', ids.variableSymbols[0] ?? '', 'pdf_text');
    }
    if (!fromQr.has('payment.iban') && next['payment.iban'] === null && ids.ibans.length === 1) {
      put('payment.iban', ids.ibans[0] ?? '', 'pdf_text');
    }
  }

  const extraction: ProtoExtraction = {
    ...x,
    supplier: {
      ...x.supplier,
      ico: next['supplier.ico'] ?? null,
      dic: next['supplier.dic'] ?? null,
    },
    document: {
      ...x.document,
      number: next['document.number'] ?? null,
      variable_symbol: next['document.variable_symbol'] ?? null,
    },
    dates: { ...x.dates, due_date: next['dates.due_date'] ?? null },
    payment: { ...x.payment, iban: next['payment.iban'] ?? null },
  };
  return { extraction, sources, qrAmount };
}
