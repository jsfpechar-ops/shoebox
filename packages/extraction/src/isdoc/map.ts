import {
  type ProtoExtraction,
  type ProtoKindHint,
  type ProtoPaymentMethod,
  parseProtoExtraction,
} from '../proto/schema';
import { findIsdoc, ISDOC_NS, type IsdocContainer } from './find';
import { at, childrenNamed, parseXml, textAt, type XmlElement } from './xml';

/** Recorded as the prompt version of an ISDOC reading, so runs can be told apart. */
export const ISDOC_READER_VERSION = 'isdoc-6-v1';

export class IsdocError extends Error {
  constructor(detail: string) {
    super(`isdoc: ${detail}`);
    this.name = 'IsdocError';
  }
}

export interface IsdocReading {
  readonly extraction: ProtoExtraction;
  readonly container: IsdocContainer;
}

/** "1210.500000" → "1210.50": same value, at least 2 and at most the needed decimals (wire format allows 4). */
function dec(text: string): string {
  const m = /^(-?\d+)\.(\d\d)(\d*?)0*$/.exec(text);
  return m ? `${m[1]}.${m[2]}${m[3]}` : text;
}

/** xs:date may carry a zone ("2026-10-01+02:00"); the wire format wants YYYY-MM-DD. */
function day(text: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

/** ISDOC DocumentType (§7.2) → the prototype's kind hint. */
function kindOf(documentType: string, vatApplicable: boolean): ProtoKindHint {
  switch (documentType) {
    case '1':
      return vatApplicable ? 'tax_invoice' : 'invoice';
    case '2':
    case '3':
    case '6':
      return 'credit_note';
    case '4':
      return 'proforma';
    case '5':
      return 'advance_tax_document';
    case '7':
      return 'simplified_receipt';
    default:
      return 'other';
  }
}

/** PaymentMeansCode → payment method (M02 §4.2). */
function methodOf(code: string): ProtoPaymentMethod | '' {
  switch (code) {
    case '':
      return '';
    case '10':
      return 'cash';
    case '31':
    case '42':
    case '49':
      return 'bank_transfer';
    case '48':
      return 'card';
    case '50':
      return 'cash_on_delivery';
    default:
      return 'other';
  }
}

function party(root: XmlElement, role: 'AccountingSupplierParty' | 'AccountingCustomerParty') {
  let p = at(root, role, 'Party');
  if (p === null && role === 'AccountingSupplierParty')
    p = at(root, 'SellerSupplierParty', 'Party');
  const id = textAt(p, 'PartyIdentification', 'ID');
  const country = textAt(p, 'PostalAddress', 'Country', 'IdentificationCode').toUpperCase();
  const companyId = textAt(p, 'PartyTaxScheme', 'CompanyID').replace(/\s/g, '').toUpperCase();
  const isCz = country === '' || country === 'CZ';
  return {
    name: textAt(p, 'PartyName', 'Name'),
    ico: isCz && /^\d{8}$/.test(id) ? id : '',
    dic: companyId.startsWith('CZ') ? companyId : '',
    vat_id: companyId !== '' && !companyId.startsWith('CZ') ? companyId : '',
    country,
  };
}

/** Builds the wire JSON of the prototype schema (strings, "" = missing) from an ISDOC tree. */
export function isdocToWire(root: XmlElement): Record<string, unknown> {
  if (root.name !== 'Invoice' || root.ns !== ISDOC_NS) {
    throw new IsdocError('root is not an ISDOC Invoice');
  }
  const foreign = textAt(root, 'ForeignCurrencyCode');
  const local = textAt(root, 'LocalCurrencyCode');
  // With a foreign currency the document's own amounts are the `…Curr` elements.
  const amount = (el: XmlElement | null, name: string): string =>
    dec(textAt(el, foreign !== '' ? `${name}Curr` : name));

  const vatApplicable = textAt(root, 'VATApplicable').toLowerCase() !== 'false';
  const supplier = party(root, 'AccountingSupplierParty');
  const buyerFull = party(root, 'AccountingCustomerParty');
  const buyer = {
    name: buyerFull.name,
    ico: buyerFull.ico,
    dic: buyerFull.dic || buyerFull.vat_id,
  };

  const taxTotal = at(root, 'TaxTotal');
  const vatRecap = childrenNamed(taxTotal, 'TaxSubTotal').map((sub) => ({
    rate_pct: dec(textAt(sub, 'TaxCategory', 'Percent')),
    base: amount(sub, 'TaxableAmount'),
    vat: amount(sub, 'TaxAmount'),
  }));
  const totals = at(root, 'LegalMonetaryTotal');
  const payment = at(root, 'PaymentMeans', 'Payment');
  const details = at(payment, 'Details');

  return {
    kind_hint: kindOf(textAt(root, 'DocumentType'), vatApplicable),
    supplier,
    buyer,
    document: {
      number: textAt(root, 'ID'),
      variable_symbol: textAt(details, 'VariableSymbol'),
    },
    dates: {
      issue_date: day(textAt(root, 'IssueDate')),
      // Absent on non-payer invoices: stays empty, never copied from the issue date.
      duzp: day(textAt(root, 'TaxPointDate')),
      due_date: day(textAt(details, 'PaymentDueDate')),
    },
    currency: foreign !== '' ? foreign : local,
    vat_recap: vatApplicable ? vatRecap : [],
    totals: {
      net: amount(totals, 'TaxExclusiveAmount'),
      // TaxTotal/TaxAmount has a Curr variant too (ISDOC 6.0.2 TaxTotal: TaxAmountCurr).
      vat: amount(taxTotal, 'TaxAmount'),
      gross: amount(totals, 'TaxInclusiveAmount'),
    },
    payment: {
      account_number: textAt(details, 'ID'),
      bank_code: textAt(details, 'BankCode'),
      iban: textAt(details, 'IBAN').replace(/\s/g, ''),
      method: methodOf(textAt(payment, 'PaymentMeansCode')),
    },
    flags: {
      not_tax_document_text: textAt(root, 'DocumentType') === '4',
      non_vat_payer_text: !vatApplicable,
      reverse_charge_text: false,
      // PaidAmount is never trusted as "paid": real files carry PaidAmount = PayableAmount on unpaid invoices.
      paid_text: false,
    },
  };
}

/**
 * Reads an uploaded file's ISDOC data, when it has any, into the same `ProtoExtraction` shape the
 * LLM reader produces. Returns null when the file holds no ISDOC. Throws `IsdocError` when ISDOC
 * is present but cannot be read (the caller then falls back to the LLM).
 */
export function readIsdoc(bytes: Uint8Array): IsdocReading | null {
  const found = findIsdoc(bytes);
  if (found === null) return null;
  let root: XmlElement;
  try {
    root = parseXml(found.xml);
  } catch (error) {
    throw new IsdocError(error instanceof Error ? error.message : 'unreadable XML');
  }
  return { extraction: parseProtoExtraction(isdocToWire(root)), container: found.container };
}
