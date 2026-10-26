import { CZK, type DocumentClass, Money } from '@shoebox/domain';
import { esc } from '../xml';
import { type ClassificationVat, resolveAccounting, resolveClassificationVAT } from './mapping';
import type {
  PohodaAgenda,
  PohodaDocument,
  PohodaInput,
  PohodaItemRef,
  PohodaPartner,
  PohodaPaymentMethod,
  PohodaProfile,
  PohodaResult,
  PohodaVatSummaryRow,
  PohodaWarning,
} from './types';

// Max lengths from the vendored Stormware XSD (type.xsd).
const MAX_DOCUMENT_NUMBER = 32; // typ:documentNumberType
const MAX_TEXT = 240; // typ:string240
const MAX_ITEM_TEXT = 90; // typ:string90
const MAX_SYMVAR = 10; // spec §4.7.3 (XSD allows 20)
const MAX_COMPANY = 255;
const MAX_STREET = 64;
const MAX_CITY = 45;
const MAX_ZIP = 15;
const MAX_ICO = 15;
const MAX_DIC = 18;
const MAX_ACCOUNT_NO = 34;
const MAX_BANK_CODE = 11;

const INVOICE_TYPE: Partial<Record<DocumentClass, string>> = {
  received_invoice: 'receivedInvoice',
  received_credit_note: 'receivedCreditNotice',
  issued_invoice: 'issuedInvoice',
  issued_credit_note: 'issuedCreditNotice',
};

const INT_DOC_CLASSES: ReadonlySet<DocumentClass> = new Set([
  'received_advance_tax_doc',
  'platform_statement',
]);

const PAYMENT_TYPE: Record<PohodaPaymentMethod, string> = {
  bank_transfer: 'draft',
  card: 'creditcard',
  cash: 'cash',
  cod: 'delivery',
  platform_offset: 'draft',
  other: 'draft',
};

const RATE_VAT = { standard: 'high', reduced: 'low', zero: 'none', none: 'none' } as const;

function m(value: string): Money {
  return Money.parse(value, CZK);
}

function tag(name: string, value: string): string {
  return `<${name}>${esc(value)}</${name}>`;
}

function agendaOf(doc: PohodaDocument, profile: PohodaProfile): PohodaAgenda | null {
  if (INVOICE_TYPE[doc.class]) return 'invoice';
  if (INT_DOC_CLASSES.has(doc.class)) return 'intDoc';
  if (doc.class === 'received_receipt') {
    return doc.paymentMethod === 'cash' && profile.cashAccount ? 'voucher' : 'intDoc';
  }
  return null;
}

function classificationXml(c: ClassificationVat | null, ns: string): string {
  if (!c) return '';
  const inner =
    c.kind === 'type' ? tag('typ:classificationVATType', c.value) : tag('typ:ids', c.value);
  return `<${ns}:classificationVAT>${inner}</${ns}:classificationVAT>`;
}

function refXml(name: string, ids: string | null): string {
  return ids ? `<${name}>${tag('typ:ids', ids)}</${name}>` : '';
}

interface Group {
  categoryCode: string;
  vatTreatment: PohodaDocument['lines'][number]['vatTreatment'];
  vatRateType: PohodaDocument['lines'][number]['vatRateType'];
  net: Money;
  vat: Money;
}

function groupLines(doc: PohodaDocument): Group[] {
  const map = new Map<string, Group>();
  for (const line of doc.lines) {
    const key = `${line.categoryCode}|${line.vatTreatment}|${line.vatRateType}`;
    const g = map.get(key);
    if (g) {
      g.net = g.net.add(m(line.net));
      g.vat = g.vat.add(m(line.vat));
    } else {
      map.set(key, {
        categoryCode: line.categoryCode,
        vatTreatment: line.vatTreatment,
        vatRateType: line.vatRateType,
        net: m(line.net),
        vat: m(line.vat),
      });
    }
  }
  return [...map.values()];
}

function summaryXml(rows: PohodaVatSummaryRow[], ns: string): string {
  let none = Money.zero(CZK);
  let low = { base: Money.zero(CZK), vat: Money.zero(CZK), seen: false };
  let high = { base: Money.zero(CZK), vat: Money.zero(CZK), seen: false };
  let noneSeen = false;
  for (const r of rows) {
    if (r.vatRateType === 'standard') {
      high = { base: high.base.add(m(r.base)), vat: high.vat.add(m(r.vat)), seen: true };
    } else if (r.vatRateType === 'reduced') {
      low = { base: low.base.add(m(r.base)), vat: low.vat.add(m(r.vat)), seen: true };
    } else {
      none = none.add(m(r.base));
      noneSeen = true;
    }
  }
  const parts: string[] = [];
  if (noneSeen) parts.push(tag('typ:priceNone', none.toFixed2()));
  if (low.seen) {
    parts.push(
      tag('typ:priceLow', low.base.toFixed2()),
      tag('typ:priceLowVAT', low.vat.toFixed2()),
      tag('typ:priceLowSum', low.base.add(low.vat).toFixed2()),
    );
  }
  if (high.seen) {
    parts.push(
      tag('typ:priceHigh', high.base.toFixed2()),
      tag('typ:priceHighVAT', high.vat.toFixed2()),
      tag('typ:priceHighSum', high.base.add(high.vat).toFixed2()),
    );
  }
  return `<${ns}:homeCurrency>${parts.join('')}</${ns}:homeCurrency>`;
}

function symVar(doc: PohodaDocument): string | null {
  for (const source of [doc.variableSymbol, doc.documentNumber]) {
    const digits = (source ?? '').replace(/\D/g, '');
    if (digits.length > 0 && digits.length <= MAX_SYMVAR) return digits;
  }
  return null;
}

function addressXml(
  partner: PohodaPartner | null,
  ns: string,
  fit: (field: string, value: string, max: number) => string,
): string {
  if (!partner) return '';
  const parts: string[] = [];
  parts.push(tag('typ:company', fit('partner.name', partner.name, MAX_COMPANY)));
  if (partner.city) parts.push(tag('typ:city', fit('partner.city', partner.city, MAX_CITY)));
  if (partner.street)
    parts.push(tag('typ:street', fit('partner.street', partner.street, MAX_STREET)));
  if (partner.zip) parts.push(tag('typ:zip', fit('partner.zip', partner.zip, MAX_ZIP)));
  if (partner.ico) parts.push(tag('typ:ico', fit('partner.ico', partner.ico, MAX_ICO)));
  if (partner.dic) parts.push(tag('typ:dic', fit('partner.dic', partner.dic, MAX_DIC)));
  if (partner.country) {
    parts.push(`<typ:country>${tag('typ:ids', partner.country)}</typ:country>`);
  }
  return `<${ns}:partnerIdentity><typ:address>${parts.join('')}</typ:address></${ns}:partnerIdentity>`;
}

function buildItem(
  doc: PohodaDocument,
  profile: PohodaProfile,
  agenda: PohodaAgenda,
  warnings: PohodaWarning[],
): string {
  const itemTag =
    agenda === 'invoice'
      ? 'inv:invoiceItem'
      : agenda === 'intDoc'
        ? 'int:intDocItem'
        : 'vch:voucherItem';
  const ns = agenda === 'invoice' ? 'inv' : agenda === 'intDoc' ? 'int' : 'vch';
  const groups = groupLines(doc);
  let unmappedAccounting = 0;
  const unmappedClassification = new Set<string>();
  let unmappedClassificationCount = 0;
  const itemXml = groups.map((g) => {
    const accounting = resolveAccounting(profile, g.categoryCode);
    if (!accounting) unmappedAccounting += 1;
    const classification = resolveClassificationVAT(profile, g.vatTreatment);
    if (!classification) {
      unmappedClassification.add(g.vatTreatment);
      unmappedClassificationCount += 1;
    }
    return `<${itemTag}>${[
      tag(`${ns}:text`, profile.categoryLabel(g.categoryCode).slice(0, MAX_ITEM_TEXT)),
      tag(`${ns}:quantity`, '1'),
      tag(`${ns}:payVAT`, 'false'),
      tag(`${ns}:rateVAT`, RATE_VAT[g.vatRateType]),
      `<${ns}:homeCurrency>${tag('typ:unitPrice', g.net.toFixed2())}${tag('typ:price', g.net.toFixed2())}${tag('typ:priceVAT', g.vat.toFixed2())}</${ns}:homeCurrency>`,
      refXml(`${ns}:accounting`, accounting),
      classificationXml(classification, ns),
    ].join('')}</${itemTag}>`;
  });
  if (unmappedAccounting > 0) {
    warnings.push({ code: 'unmapped_accounting', documentId: doc.id, count: unmappedAccounting });
  }
  if (unmappedClassificationCount > 0) {
    warnings.push({
      code: 'unmapped_classification',
      documentId: doc.id,
      detail: [...unmappedClassification].join(','),
      count: unmappedClassificationCount,
    });
  }
  return itemXml.join('');
}

function buildDocument(
  doc: PohodaDocument,
  profile: PohodaProfile,
  agenda: PohodaAgenda,
  warnings: PohodaWarning[],
): string {
  const ns = agenda === 'invoice' ? 'inv' : agenda === 'intDoc' ? 'int' : 'vch';
  const platce = profile.vatStatus === 'platce';
  const warn = (field: string) =>
    warnings.push({ code: 'truncated', documentId: doc.id, detail: field });
  const fit = (field: string, value: string, max: number): string => {
    if (value.length <= max) return value;
    warn(field);
    return value.slice(0, max);
  };

  const groups = groupLines(doc);
  const first = groups[0];
  const headerAccounting = first ? resolveAccounting(profile, first.categoryCode) : null;
  const headerClassification = first ? resolveClassificationVAT(profile, first.vatTreatment) : null;

  const h: string[] = [];
  if (agenda === 'invoice') {
    h.push(tag('inv:invoiceType', INVOICE_TYPE[doc.class] ?? 'receivedInvoice'));
  } else if (agenda === 'voucher') {
    h.push(tag('vch:voucherType', 'expense'));
    h.push(refXml('vch:cashAccount', profile.cashAccount ?? null));
  }
  const sv = symVar(doc);
  if (sv && agenda !== 'voucher') h.push(tag(`${ns}:symVar`, sv));
  if (doc.documentNumber) {
    const name =
      agenda === 'invoice'
        ? 'originalDocument'
        : agenda === 'intDoc'
          ? 'originalDocumentNumber'
          : 'originalDocument';
    h.push(tag(`${ns}:${name}`, fit('documentNumber', doc.documentNumber, MAX_DOCUMENT_NUMBER)));
  }
  h.push(tag(`${ns}:date`, doc.issueDate));
  if (agenda === 'voucher') h.push(tag('vch:datePayment', doc.issueDate));
  h.push(tag(`${ns}:dateTax`, doc.duzp ?? doc.issueDate));
  if (agenda !== 'voucher') h.push(tag(`${ns}:dateAccounting`, doc.receivedDate ?? doc.issueDate));
  if (platce && doc.vatPointDate) {
    h.push(tag(`${ns}:dateKHDPH`, doc.vatPointDate));
    if (agenda === 'invoice') h.push(tag('inv:dateApplicationVAT', doc.vatPointDate));
  }
  if (agenda === 'invoice' && doc.dueDate) h.push(tag('inv:dateDue', doc.dueDate));
  h.push(refXml(`${ns}:accounting`, headerAccounting));
  h.push(classificationXml(headerClassification, ns));
  if (doc.summary) h.push(tag(`${ns}:text`, fit('summary', doc.summary, MAX_TEXT)));
  h.push(addressXml(doc.partner, ns, fit));
  if (agenda === 'invoice') {
    if (doc.paymentMethod) {
      h.push(
        `<inv:paymentType>${tag('typ:paymentType', PAYMENT_TYPE[doc.paymentMethod])}</inv:paymentType>`,
      );
    }
    const acc = doc.payToAccount;
    if (
      acc?.accountNumber &&
      acc.bankCode &&
      acc.accountNumber.length <= MAX_ACCOUNT_NO &&
      acc.bankCode.length <= MAX_BANK_CODE &&
      doc.class.startsWith('received_')
    ) {
      h.push(
        `<inv:paymentAccount>${tag('typ:accountNo', acc.accountNumber)}${tag('typ:bankCode', acc.bankCode)}</inv:paymentAccount>`,
      );
    }
  }
  h.push(tag(`${ns}:intNote`, `Shoebox doc ${doc.id} r${doc.revision}`));

  const body = [
    `<${ns}:${agenda === 'invoice' ? 'invoiceHeader' : agenda === 'intDoc' ? 'intDocHeader' : 'voucherHeader'}>${h.join('')}</${ns}:${agenda === 'invoice' ? 'invoiceHeader' : agenda === 'intDoc' ? 'intDocHeader' : 'voucherHeader'}>`,
    `<${ns}:${agenda === 'invoice' ? 'invoiceDetail' : agenda === 'intDoc' ? 'intDocDetail' : 'voucherDetail'}>${buildItem(doc, profile, agenda, warnings)}</${ns}:${agenda === 'invoice' ? 'invoiceDetail' : agenda === 'intDoc' ? 'intDocDetail' : 'voucherDetail'}>`,
    `<${ns}:${agenda === 'invoice' ? 'invoiceSummary' : agenda === 'intDoc' ? 'intDocSummary' : 'voucherSummary'}>${summaryXml(doc.vatSummary, ns)}</${ns}:${agenda === 'invoice' ? 'invoiceSummary' : agenda === 'intDoc' ? 'intDocSummary' : 'voucherSummary'}>`,
  ].join('');
  const root = agenda === 'invoice' ? 'invoice' : agenda === 'intDoc' ? 'intDoc' : 'voucher';
  return `<${ns}:${root} version="2.0">${body}</${ns}:${root}>`;
}

export function pohodaItemId(documentId: string, revision: number): string {
  return `SB${documentId.replace(/-/g, '').slice(0, 12)}-r${revision}`;
}

export function buildPohodaDataPack(input: PohodaInput, profile: PohodaProfile): PohodaResult {
  const warnings: PohodaWarning[] = [];
  const items: PohodaItemRef[] = [];
  const packItems: string[] = [];

  for (const doc of input.documents) {
    const agenda = agendaOf(doc, profile);
    if (!agenda) continue;
    if (doc.currency !== 'CZK') {
      // TODO(pohoda-fx): export foreign currency documents via inv:foreignCurrency.
      warnings.push({ code: 'foreign_currency', documentId: doc.id });
      continue;
    }
    if (doc.class === 'received_receipt' && doc.paymentMethod === 'cash' && !profile.cashAccount) {
      warnings.push({ code: 'cash_account_missing', documentId: doc.id });
    }
    const itemId = pohodaItemId(doc.id, doc.revision);
    items.push({ documentId: doc.id, itemId, agenda });
    packItems.push(
      `<dat:dataPackItem version="2.0" id="${esc(itemId)}">${buildDocument(doc, profile, agenda, warnings)}</dat:dataPackItem>`,
    );
  }

  const packId = `SB-${profile.ico}-${input.periodLabel}-v${input.version}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd" xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd" xmlns:int="http://www.stormware.cz/schema/version_2/intDoc.xsd" xmlns:vch="http://www.stormware.cz/schema/version_2/voucher.xsd" xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd" version="2.0" id="${esc(packId)}" ico="${esc(profile.ico)}" application="Shoebox" note="${esc(`Doklady ${input.periodLabel} v${input.version}`)}">
${packItems.join('\n')}
</dat:dataPack>
`;
  return { xml, items, warnings };
}
