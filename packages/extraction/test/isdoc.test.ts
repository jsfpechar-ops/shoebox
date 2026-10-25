import { deflateRawSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findIsdoc, IsdocError, isdocToWire, parseXml, readIsdoc, XmlError } from '../src/index';

// Synthetic data only (the repo is public): IČO 12345679 / 11111119 are made-up numbers with a valid check digit.
const NS = 'http://isdoc.cz/namespace/2013';

interface Opts {
  readonly documentType?: string;
  readonly vatApplicable?: boolean;
  readonly foreign?: boolean;
  readonly taxPointDate?: boolean;
  readonly prefix?: string;
}

function isdocXml(o: Opts = {}): string {
  const p = o.prefix ? `${o.prefix}:` : '';
  const xmlns = o.prefix ? `xmlns:${o.prefix}="${NS}"` : `xmlns="${NS}"`;
  const amt = (name: string, czk: string, eur: string) =>
    o.foreign
      ? `<${p}${name}>${czk}</${p}${name}><${p}${name}Curr>${eur}</${p}${name}Curr>`
      : `<${p}${name}>${czk}</${p}${name}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- synthetic test invoice -->
<${p}Invoice ${xmlns} version="6.0.2">
  <${p}DocumentType>${o.documentType ?? '1'}</${p}DocumentType>
  <${p}ID>FV-2026-0042</${p}ID>
  <${p}UUID>3F2504E0-4F89-11D3-9A0C-0305E82C3301</${p}UUID>
  <${p}IssueDate>2026-09-30</${p}IssueDate>
  ${o.taxPointDate === false ? '' : `<${p}TaxPointDate>2026-09-30</${p}TaxPointDate>`}
  <${p}VATApplicable>${o.vatApplicable === false ? 'false' : 'true'}</${p}VATApplicable>
  <${p}Note>Test &amp; demo &lt;only&gt; &#x10C;&#353;</${p}Note>
  <${p}LocalCurrencyCode>CZK</${p}LocalCurrencyCode>
  ${o.foreign ? `<${p}ForeignCurrencyCode>EUR</${p}ForeignCurrencyCode><${p}CurrRate>25</${p}CurrRate><${p}RefCurrRate>1</${p}RefCurrRate>` : ''}
  <${p}AccountingSupplierParty><${p}Party>
    <${p}PartyIdentification><${p}ID>12345679</${p}ID></${p}PartyIdentification>
    <${p}PartyName><${p}Name>Example Supplier s.r.o.</${p}Name></${p}PartyName>
    <${p}PostalAddress><${p}StreetName>Testovací</${p}StreetName><${p}BuildingNumber>1</${p}BuildingNumber><${p}CityName>Praha</${p}CityName><${p}PostalZone>11000</${p}PostalZone><${p}Country><${p}IdentificationCode>CZ</${p}IdentificationCode><${p}Name>Česká republika</${p}Name></${p}Country></${p}PostalAddress>
    <${p}PartyTaxScheme><${p}CompanyID>CZ12345679</${p}CompanyID><${p}TaxScheme>VAT</${p}TaxScheme></${p}PartyTaxScheme>
  </${p}Party></${p}AccountingSupplierParty>
  <${p}AccountingCustomerParty><${p}Party>
    <${p}PartyIdentification><${p}ID>11111119</${p}ID></${p}PartyIdentification>
    <${p}PartyName><${p}Name>Example Buyer</${p}Name></${p}PartyName>
    <${p}PostalAddress><${p}Country><${p}IdentificationCode>CZ</${p}IdentificationCode></${p}Country></${p}PostalAddress>
    <${p}PartyTaxScheme><${p}CompanyID/><${p}TaxScheme>VAT</${p}TaxScheme></${p}PartyTaxScheme>
  </${p}Party></${p}AccountingCustomerParty>
  <${p}InvoiceLines><${p}InvoiceLine><${p}ID>1</${p}ID><${p}LineExtensionAmount>1000.00</${p}LineExtensionAmount></${p}InvoiceLine></${p}InvoiceLines>
  <${p}TaxTotal>
    <${p}TaxSubTotal>
      ${amt('TaxableAmount', '1000.000000', '40.00')}
      ${amt('TaxAmount', '210.00', '8.40')}
      <${p}TaxCategory><${p}Percent>21</${p}Percent></${p}TaxCategory>
    </${p}TaxSubTotal>
    ${amt('TaxAmount', '210.00', '8.40')}
  </${p}TaxTotal>
  <${p}LegalMonetaryTotal>
    ${amt('TaxExclusiveAmount', '1000.00', '40.00')}
    ${amt('TaxInclusiveAmount', '1210.00', '48.40')}
    <${p}PayableRoundingAmount>0</${p}PayableRoundingAmount>
    ${amt('PayableAmount', '1210.00', '48.40')}
  </${p}LegalMonetaryTotal>
  <${p}PaymentMeans><${p}Payment>
    <${p}PaidAmount>1210.00</${p}PaidAmount>
    <${p}PaymentMeansCode>42</${p}PaymentMeansCode>
    <${p}Details><${p}PaymentDueDate>2026-10-14</${p}PaymentDueDate><${p}ID>123456789</${p}ID><${p}BankCode>0100</${p}BankCode><${p}IBAN>CZ6508000000192000145399</${p}IBAN><${p}VariableSymbol>20260042</${p}VariableSymbol></${p}Details>
  </${p}Payment></${p}PaymentMeans>
</${p}Invoice>`;
}

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal ZIP (one entry per file, deflated), enough for the reader's central-directory walk. */
function makeZip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    local.push(lh, nameBytes, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, eocd]));
}

/** A small PDF with one page content stream and, optionally, an embedded file stream. */
function makePdf(
  embedded: string | null,
  options: { flate?: boolean; encrypt?: boolean } = {},
): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Faktura) Tj ET'));
  parts.push(
    Buffer.from(
      `4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`,
      'latin1',
    ),
    content,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  );
  if (embedded !== null) {
    const raw = Buffer.from(embedded, 'utf8');
    const data = options.flate === false ? raw : deflateSync(raw);
    const filter = options.flate === false ? '' : ' /Filter /FlateDecode';
    parts.push(
      Buffer.from(
        `5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${data.length}${filter} >>\nstream\r\n`,
        'latin1',
      ),
      data,
      Buffer.from('\r\nendstream\nendobj\n', 'latin1'),
    );
    parts.push(
      Buffer.from(
        '6 0 obj\n<< /Type /Filespec /F (faktura_0042.isdoc) /EF << /F 5 0 R >> >>\nendobj\n',
        'latin1',
      ),
    );
  }
  const trailer = options.encrypt ? '/Encrypt 9 0 R ' : '';
  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R ${trailer}>>\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

describe('parseXml', () => {
  it('reads local names, namespaces, attributes, entities and CDATA', () => {
    const root = parseXml(
      `﻿<?xml version="1.0"?><a:Root xmlns:a="urn:x" b="1 &amp; 2"><a:C><![CDATA[<raw>]]></a:C><D/></a:Root>`,
    );
    expect(root.name).toBe('Root');
    expect(root.ns).toBe('urn:x');
    expect(root.attrs).toEqual({ b: '1 & 2' });
    expect(root.children.map((c) => c.name)).toEqual(['C', 'D']);
    expect(root.children[0]?.text).toBe('<raw>');
    expect(root.children[1]?.ns).toBe('');
  });

  it('refuses DOCTYPE and ENTITY declarations (no XXE)', () => {
    expect(() =>
      parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'),
    ).toThrow(XmlError);
  });

  it('refuses malformed XML', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow(XmlError);
    expect(() => parseXml('<a>')).toThrow(XmlError);
    expect(() => parseXml('<a/><b/>')).toThrow(XmlError);
    expect(() => parseXml('<a>x & y</a>')).toThrow(XmlError);
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(XmlError);
    expect(() => parseXml('')).toThrow(XmlError);
  });
});

describe('findIsdoc', () => {
  it('finds a plain .isdoc file', () => {
    expect(findIsdoc(enc(isdocXml()))?.container).toBe('xml');
  });

  it('finds the manifest main document in an .isdocx', () => {
    const zip = makeZip({
      'manifest.xml':
        '<manifest xmlns="http://isdoc.cz/namespace/2013/manifest"><maindocument filename="invoice.isdoc"/></manifest>',
      'invoice.isdoc': isdocXml(),
      'invoice.pdf': '%PDF-1.7 not really',
    });
    const found = findIsdoc(zip);
    expect(found?.container).toBe('isdocx');
    expect(found?.xml).toContain('FV-2026-0042');
  });

  it('falls back to a root-level *.isdoc when the .isdocx has no manifest', () => {
    expect(findIsdoc(makeZip({ 'faktura.isdoc': isdocXml() }))?.container).toBe('isdocx');
  });

  it('finds an ISDOC embedded in a PDF, compressed or not', () => {
    expect(findIsdoc(makePdf(isdocXml()))?.container).toBe('pdf');
    expect(findIsdoc(makePdf(isdocXml(), { flate: false }))?.xml).toContain('FV-2026-0042');
  });

  it('returns null for a PDF without ISDOC, an encrypted PDF, other XML and garbage', () => {
    expect(findIsdoc(makePdf(null))).toBeNull();
    expect(findIsdoc(makePdf(isdocXml(), { encrypt: true }))).toBeNull();
    expect(
      findIsdoc(enc('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')),
    ).toBeNull();
    expect(findIsdoc(enc('PK\u0003\u0004 broken zip'))).toBeNull();
    expect(findIsdoc(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});

describe('isdocToWire / readIsdoc', () => {
  it('maps a CZK tax invoice into the reader shape exactly', () => {
    const reading = readIsdoc(enc(isdocXml()));
    expect(reading?.container).toBe('xml');
    const x = reading?.extraction;
    expect(x).toMatchObject({
      kind_hint: 'tax_invoice',
      document_class: 'received_invoice',
      supplier: {
        name: 'Example Supplier s.r.o.',
        ico: '12345679',
        dic: 'CZ12345679',
        vat_id: null,
        country: 'CZ',
      },
      buyer: { name: 'Example Buyer', ico: '11111119', dic: null },
      document: { number: 'FV-2026-0042', variable_symbol: '20260042' },
      dates: { issue_date: '2026-09-30', duzp: '2026-09-30', due_date: '2026-10-14' },
      currency: 'CZK',
      vat_recap: [{ rate_pct: '21', base: '1000.00', vat: '210.00' }],
      totals: { net: '1000.00', vat: '210.00', gross: '1210.00' },
      payment: {
        account_number: '123456789',
        bank_code: '0100',
        iban: 'CZ6508000000192000145399',
        method: 'bank_transfer',
      },
      flags: {
        not_tax_document_text: false,
        non_vat_payer_text: false,
        reverse_charge_text: false,
        paid_text: false,
      },
      not_tax_document: false,
      issues: [],
    });
  });

  it('uses the foreign-currency amounts when ForeignCurrencyCode is present', () => {
    const x = readIsdoc(enc(isdocXml({ foreign: true })))?.extraction;
    expect(x?.currency).toBe('EUR');
    expect(x?.totals).toEqual({ net: '40.00', vat: '8.40', gross: '48.40' });
    expect(x?.vat_recap).toEqual([{ rate_pct: '21', base: '40.00', vat: '8.40' }]);
  });

  it('works with a prefixed namespace', () => {
    expect(readIsdoc(enc(isdocXml({ prefix: 'isdoc' })))?.extraction.document.number).toBe(
      'FV-2026-0042',
    );
  });

  it('leaves DUZP empty when TaxPointDate is absent (never copies the issue date)', () => {
    expect(readIsdoc(enc(isdocXml({ taxPointDate: false })))?.extraction.dates.duzp).toBeNull();
  });

  it('marks a non-VAT invoice and drops its VAT recap', () => {
    const x = readIsdoc(enc(isdocXml({ vatApplicable: false })))?.extraction;
    expect(x?.kind_hint).toBe('invoice');
    expect(x?.flags.non_vat_payer_text).toBe(true);
    expect(x?.not_tax_document).toBe(true);
    expect(x?.vat_recap).toEqual([]);
  });

  it('maps document types to kinds', () => {
    const kind = (t: string) => readIsdoc(enc(isdocXml({ documentType: t })))?.extraction.kind_hint;
    expect([kind('2'), kind('3'), kind('4'), kind('5'), kind('6'), kind('7'), kind('9')]).toEqual([
      'credit_note',
      'credit_note',
      'proforma',
      'advance_tax_document',
      'credit_note',
      'simplified_receipt',
      'other',
    ]);
    expect(readIsdoc(enc(isdocXml({ documentType: '4' })))?.extraction.not_tax_document).toBe(true);
  });

  it('never marks the invoice paid from PaidAmount', () => {
    expect(readIsdoc(enc(isdocXml()))?.extraction.flags.paid_text).toBe(false);
  });

  it('reads the same data from .isdocx and from a PDF attachment', () => {
    const plain = readIsdoc(enc(isdocXml()))?.extraction;
    expect(readIsdoc(makeZip({ 'a.isdoc': isdocXml() }))?.extraction).toEqual(plain);
    expect(readIsdoc(makePdf(isdocXml()))?.extraction).toEqual(plain);
  });

  it('returns null when there is no ISDOC and throws IsdocError when it is unreadable', () => {
    expect(readIsdoc(makePdf(null))).toBeNull();
    const broken = isdocXml().replace('</Invoice>', '');
    expect(() => readIsdoc(enc(broken))).toThrow(IsdocError);
  });

  it('rejects a root that is not an ISDOC Invoice', () => {
    expect(() => isdocToWire(parseXml('<Invoice xmlns="urn:other"/>'))).toThrow(IsdocError);
  });
});
