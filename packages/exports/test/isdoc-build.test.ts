import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIsdoc, type IsdocExportInput, isdocUuid } from '../src/index';

// Synthetic values only (hard rule 4).
const ORG = '0b8f6e1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const DOC = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9';

const INPUT: IsdocExportInput = {
  orgId: ORG,
  documentId: DOC,
  documentType: '1',
  number: '2026001',
  issueDate: '2026-09-12',
  duzp: '2026-09-12',
  dueDate: '2026-09-26',
  currency: 'CZK',
  supplier: { ico: '25596641', dic: 'CZ25596641', name: 'Test & syn s.r.o.', country: 'CZ' },
  customer: { ico: '00006947', dic: null, name: 'Jan OSVČ', country: 'CZ' },
  vatRows: [{ ratePct: '21', base: '1000.00', vat: '210.00' }],
  totalGross: '1210.00',
  notTaxDocument: false,
  payment: {
    method: 'bank_transfer',
    accountNumber: '19-2000145399',
    bankCode: '0800',
    iban: 'CZ6508000000192000145399',
    variableSymbol: '2026001',
  },
};

const UUID = isdocUuid(ORG, DOC);

const EXPECTED = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>2026001</ID>
  <UUID>${UUID}</UUID>
  <IssuingSystem>Sysel</IssuingSystem>
  <IssueDate>2026-09-12</IssueDate>
  <TaxPointDate>2026-09-12</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification>
        <ID>25596641</ID>
      </PartyIdentification>
      <PartyName>
        <Name>Test &amp; syn s.r.o.</Name>
      </PartyName>
      <PostalAddress>
        <StreetName></StreetName>
        <BuildingNumber></BuildingNumber>
        <CityName></CityName>
        <PostalZone></PostalZone>
        <Country>
          <IdentificationCode>CZ</IdentificationCode>
          <Name></Name>
        </Country>
      </PostalAddress>
      <PartyTaxScheme>
        <CompanyID>CZ25596641</CompanyID>
        <TaxScheme>VAT</TaxScheme>
      </PartyTaxScheme>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyIdentification>
        <ID>00006947</ID>
      </PartyIdentification>
      <PartyName>
        <Name>Jan OSVČ</Name>
      </PartyName>
      <PostalAddress>
        <StreetName></StreetName>
        <BuildingNumber></BuildingNumber>
        <CityName></CityName>
        <PostalZone></PostalZone>
        <Country>
          <IdentificationCode>CZ</IdentificationCode>
          <Name></Name>
        </Country>
      </PostalAddress>
    </Party>
  </AccountingCustomerParty>
  <InvoiceLines>
    <InvoiceLine>
      <ID>1</ID>
      <LineExtensionAmount>1000.00</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>1210.00</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>210.00</LineExtensionTaxAmount>
      <UnitPrice>1000.00</UnitPrice>
      <UnitPriceTaxInclusive>1210.00</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory>
        <Percent>21</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </ClassifiedTaxCategory>
      <Item>
        <Description>21 %</Description>
      </Item>
    </InvoiceLine>
  </InvoiceLines>
  <TaxTotal>
    <TaxSubTotal>
      <TaxableAmount>1000.00</TaxableAmount>
      <TaxAmount>210.00</TaxAmount>
      <TaxInclusiveAmount>1210.00</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>1000.00</DifferenceTaxableAmount>
      <DifferenceTaxAmount>210.00</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>1210.00</DifferenceTaxInclusiveAmount>
      <TaxCategory>
        <Percent>21</Percent>
      </TaxCategory>
    </TaxSubTotal>
    <TaxAmount>210.00</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>1000.00</TaxExclusiveAmount>
    <TaxInclusiveAmount>1210.00</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>1000.00</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>1210.00</DifferenceTaxInclusiveAmount>
    <PayableRoundingAmount>0.00</PayableRoundingAmount>
    <PaidDepositsAmount>0</PaidDepositsAmount>
    <PayableAmount>1210.00</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      <PaidAmount>1210.00</PaidAmount>
      <PaymentMeansCode>42</PaymentMeansCode>
      <Details>
        <PaymentDueDate>2026-09-26</PaymentDueDate>
        <ID>19-2000145399</ID>
        <BankCode>0800</BankCode>
        <Name></Name>
        <IBAN>CZ6508000000192000145399</IBAN>
        <BIC></BIC>
        <VariableSymbol>2026001</VariableSymbol>
      </Details>
    </Payment>
  </PaymentMeans>
</Invoice>
`;

const XSD = join(import.meta.dirname, '..', 'xsd', 'isdoc-invoice-6.0.2.xsd');

function validate(xml: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'isdoc-')), 'a.isdoc');
  writeFileSync(file, xml);
  return execFileSync('xmllint', ['--noout', '--schema', XSD, file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('isdocUuid', () => {
  it('is a stable uppercase UUIDv5', () => {
    expect(UUID).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    expect(isdocUuid(ORG, DOC)).toBe(UUID);
    expect(isdocUuid(ORG, '00000000-0000-4000-8000-000000000000')).not.toBe(UUID);
  });
});

describe('buildIsdoc', () => {
  it('writes the expected XML', () => {
    expect(buildIsdoc(INPUT)).toBe(EXPECTED);
  });

  it('validates against the ISDOC 6.0.2 XSD', () => {
    expect(() => validate(buildIsdoc(INPUT) ?? '')).not.toThrow();
  });

  it('handles two rates, rounding, card payment, no DUZP, not a tax document', () => {
    const xml =
      buildIsdoc({
        ...INPUT,
        duzp: null,
        notTaxDocument: true,
        vatRows: [
          { ratePct: '21.00', base: '100.00', vat: '21.00' },
          { ratePct: '12', base: '50.00', vat: '6.00' },
        ],
        totalGross: '177.00',
        payment: {
          method: 'card',
          accountNumber: null,
          bankCode: null,
          iban: null,
          variableSymbol: null,
        },
      }) ?? '';
    expect(xml).not.toContain('<TaxPointDate>');
    expect(xml).toContain('<VATApplicable>false</VATApplicable>');
    expect(xml).toContain('<PayableRoundingAmount>0.00</PayableRoundingAmount>');
    expect(xml).toContain('<TaxAmount>27.00</TaxAmount>\n  </TaxTotal>');
    expect(xml).toContain('<PaymentMeansCode>48</PaymentMeansCode>');
    expect(xml).not.toContain('<Details>');
    expect(() => validate(xml)).not.toThrow();
  });

  it('puts a printed rounding difference into PayableRoundingAmount', () => {
    const xml = buildIsdoc({ ...INPUT, totalGross: '1210.40' }) ?? '';
    expect(xml).toContain('<PayableRoundingAmount>0.40</PayableRoundingAmount>');
    expect(xml).toContain('<PayableAmount>1210.40</PayableAmount>');
  });

  it('returns null for a foreign currency', () => {
    expect(buildIsdoc({ ...INPUT, currency: 'EUR' })).toBeNull();
  });
});
