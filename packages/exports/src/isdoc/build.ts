import { createHash } from 'node:crypto';
import { Money } from '@shoebox/domain';

export interface IsdocParty {
  readonly ico: string | null;
  readonly dic: string | null;
  readonly name: string;
  readonly country: string; // 2 letters
}

export interface IsdocExportInput {
  readonly orgId: string;
  readonly documentId: string;
  readonly documentType: '1' | '2' | '5' | '7'; // invoice, credit note, advance tax doc, simplified
  readonly number: string;
  readonly issueDate: string;
  readonly duzp: string | null;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly supplier: IsdocParty;
  readonly customer: IsdocParty;
  readonly vatRows: readonly {
    readonly ratePct: string;
    readonly base: string;
    readonly vat: string;
  }[];
  readonly totalGross: string;
  readonly notTaxDocument: boolean;
  readonly payment: {
    readonly method: 'bank_transfer' | 'card' | 'cash' | 'cod' | 'other' | null;
    readonly accountNumber: string | null; // "2000145399" or "19-2000145399"
    readonly bankCode: string | null;
    readonly iban: string | null;
    readonly variableSymbol: string | null;
  };
}

const CZK = 'CZK';

const PAYMENT_CODE: Record<NonNullable<IsdocExportInput['payment']['method']>, string> = {
  bank_transfer: '42',
  card: '48',
  cash: '10',
  cod: '50',
  other: '97',
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 4122 UUIDv5 (SHA-1, node:crypto) of `documentId` in the namespace `orgId` (a UUID), uppercase. */
export function isdocUuid(orgId: string, documentId: string): string {
  const namespace = Buffer.from(orgId.replace(/-/g, ''), 'hex');
  const bytes = Buffer.from(
    createHash('sha1').update(namespace).update(documentId, 'utf8').digest().subarray(0, 16),
  );
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex').toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function partyLines(party: IsdocParty): string[] {
  return [
    '    <Party>',
    ...(party.ico
      ? [
          '      <PartyIdentification>',
          `        <ID>${esc(party.ico)}</ID>`,
          '      </PartyIdentification>',
        ]
      : []),
    '      <PartyName>',
    `        <Name>${esc(party.name)}</Name>`,
    '      </PartyName>',
    '      <PostalAddress>',
    '        <StreetName></StreetName>',
    '        <BuildingNumber></BuildingNumber>',
    '        <CityName></CityName>',
    '        <PostalZone></PostalZone>',
    '        <Country>',
    `          <IdentificationCode>${esc(party.country)}</IdentificationCode>`,
    '          <Name></Name>',
    '        </Country>',
    '      </PostalAddress>',
    ...(party.dic
      ? [
          '      <PartyTaxScheme>',
          `        <CompanyID>${esc(party.dic)}</CompanyID>`,
          '        <TaxScheme>VAT</TaxScheme>',
          '      </PartyTaxScheme>',
        ]
      : []),
    '    </Party>',
  ];
}

/** ISDOC 6.0.2 XML, or null for a non-CZK document. Text is XML-escaped (& < > " '). */
export function buildIsdoc(input: IsdocExportInput): string | null {
  if (input.currency !== CZK) return null;

  const zero = Money.parse('0.00', CZK);
  const rows = input.vatRows.map((row) => ({
    ratePct: row.ratePct.replace(/\.00$/, ''),
    base: Money.parse(row.base, CZK),
    vat: Money.parse(row.vat, CZK),
    gross: Money.parse(row.base, CZK).add(Money.parse(row.vat, CZK)),
  }));
  const sumBase = rows.reduce((acc, row) => acc.add(row.base), zero);
  const sumVat = rows.reduce((acc, row) => acc.add(row.vat), zero);
  const gross = Money.parse(input.totalGross, CZK);
  const rounding = gross.subtract(sumBase.add(sumVat));
  const vatApplicable = !input.notTaxDocument && rows.some((row) => row.vat.isPositive());
  const f = (money: Money): string => money.toFixed2();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">',
    `  <DocumentType>${input.documentType}</DocumentType>`,
    `  <ID>${esc(input.number)}</ID>`,
    `  <UUID>${isdocUuid(input.orgId, input.documentId)}</UUID>`,
    '  <IssuingSystem>Sysel</IssuingSystem>',
    `  <IssueDate>${esc(input.issueDate)}</IssueDate>`,
    ...(input.duzp ? [`  <TaxPointDate>${esc(input.duzp)}</TaxPointDate>`] : []),
    `  <VATApplicable>${vatApplicable}</VATApplicable>`,
    '  <ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference>',
    '  <LocalCurrencyCode>CZK</LocalCurrencyCode>',
    '  <CurrRate>1</CurrRate>',
    '  <RefCurrRate>1</RefCurrRate>',
    '  <AccountingSupplierParty>',
    ...partyLines(input.supplier),
    '  </AccountingSupplierParty>',
    '  <AccountingCustomerParty>',
    ...partyLines(input.customer),
    '  </AccountingCustomerParty>',
    '  <InvoiceLines>',
    ...rows.flatMap((row, index) => [
      '    <InvoiceLine>',
      `      <ID>${index + 1}</ID>`,
      `      <LineExtensionAmount>${f(row.base)}</LineExtensionAmount>`,
      `      <LineExtensionAmountTaxInclusive>${f(row.gross)}</LineExtensionAmountTaxInclusive>`,
      `      <LineExtensionTaxAmount>${f(row.vat)}</LineExtensionTaxAmount>`,
      `      <UnitPrice>${f(row.base)}</UnitPrice>`,
      `      <UnitPriceTaxInclusive>${f(row.gross)}</UnitPriceTaxInclusive>`,
      '      <ClassifiedTaxCategory>',
      `        <Percent>${esc(row.ratePct)}</Percent>`,
      '        <VATCalculationMethod>0</VATCalculationMethod>',
      '      </ClassifiedTaxCategory>',
      '      <Item>',
      `        <Description>${esc(row.ratePct)} %</Description>`,
      '      </Item>',
      '    </InvoiceLine>',
    ]),
    '  </InvoiceLines>',
    '  <TaxTotal>',
    ...rows.flatMap((row) => [
      '    <TaxSubTotal>',
      `      <TaxableAmount>${f(row.base)}</TaxableAmount>`,
      `      <TaxAmount>${f(row.vat)}</TaxAmount>`,
      `      <TaxInclusiveAmount>${f(row.gross)}</TaxInclusiveAmount>`,
      '      <AlreadyClaimedTaxableAmount>0</AlreadyClaimedTaxableAmount>',
      '      <AlreadyClaimedTaxAmount>0</AlreadyClaimedTaxAmount>',
      '      <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>',
      `      <DifferenceTaxableAmount>${f(row.base)}</DifferenceTaxableAmount>`,
      `      <DifferenceTaxAmount>${f(row.vat)}</DifferenceTaxAmount>`,
      `      <DifferenceTaxInclusiveAmount>${f(row.gross)}</DifferenceTaxInclusiveAmount>`,
      '      <TaxCategory>',
      `        <Percent>${esc(row.ratePct)}</Percent>`,
      '      </TaxCategory>',
      '    </TaxSubTotal>',
    ]),
    `    <TaxAmount>${f(sumVat)}</TaxAmount>`,
    '  </TaxTotal>',
    '  <LegalMonetaryTotal>',
    `    <TaxExclusiveAmount>${f(sumBase)}</TaxExclusiveAmount>`,
    `    <TaxInclusiveAmount>${f(gross)}</TaxInclusiveAmount>`,
    '    <AlreadyClaimedTaxExclusiveAmount>0</AlreadyClaimedTaxExclusiveAmount>',
    '    <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>',
    `    <DifferenceTaxExclusiveAmount>${f(sumBase)}</DifferenceTaxExclusiveAmount>`,
    `    <DifferenceTaxInclusiveAmount>${f(gross)}</DifferenceTaxInclusiveAmount>`,
    `    <PayableRoundingAmount>${f(rounding)}</PayableRoundingAmount>`,
    '    <PaidDepositsAmount>0</PaidDepositsAmount>',
    `    <PayableAmount>${f(gross)}</PayableAmount>`,
    '  </LegalMonetaryTotal>',
  ];

  const { payment } = input;
  if (payment.method) {
    lines.push('  <PaymentMeans>', '    <Payment>', `      <PaidAmount>${f(gross)}</PaidAmount>`);
    lines.push(`      <PaymentMeansCode>${PAYMENT_CODE[payment.method]}</PaymentMeansCode>`);
    if (payment.method === 'bank_transfer') {
      lines.push('      <Details>');
      if (input.dueDate)
        lines.push(`        <PaymentDueDate>${esc(input.dueDate)}</PaymentDueDate>`);
      lines.push(
        `        <ID>${esc(payment.accountNumber ?? '')}</ID>`,
        `        <BankCode>${esc(payment.bankCode ?? '')}</BankCode>`,
        '        <Name></Name>',
        `        <IBAN>${esc(payment.iban ?? '')}</IBAN>`,
        '        <BIC></BIC>',
      );
      if (payment.variableSymbol)
        lines.push(`        <VariableSymbol>${esc(payment.variableSymbol)}</VariableSymbol>`);
      lines.push('      </Details>');
    }
    lines.push('    </Payment>', '  </PaymentMeans>');
  }

  lines.push('</Invoice>');
  return `${lines.join('\n')}\n`;
}
