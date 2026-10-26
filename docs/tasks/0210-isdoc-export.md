# 0210: ISDOC 6.0.2 export of one document

Status: todo
Ticket: P2 M10 §4.8 ISDOC export | Depends on: none | Base commit: branch claude/project-thread-90sd7q | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Report: docs/tasks/0210-report.md

## 1. Objective

`buildIsdoc(input)` writes a valid ISDOC 6.0.2 invoice from a read document, so the accountant can import it into any Czech accounting program without retyping. It validates against the official XSD.

## 2. Context

M10 §4.8 (pasted, trimmed): `UUID` = UUIDv5(namespace = org id, name = document id); `IssuingSystem` = "Sysel"; `TaxPointDate` = DUZP (optional element, omit when null); `VATApplicable` = any VAT > 0 and not a "not a tax document"; `LocalCurrencyCode` CZK, `CurrRate` and `RefCurrRate` both 1 for CZK documents; supplier/customer `PartyIdentification/ID` = IČO, `PartyTaxScheme/CompanyID` = DIČ (omit `PartyTaxScheme` without a DIČ); one `InvoiceLine` per VAT rate when no item lines exist; `TaxTotal/TaxAmount` = Σ subtotals; `PayableRoundingAmount` = gross − Σ(base + VAT); `PayableAmount` = gross; `PaymentMeansCode` 42 bank transfer, 48 card, 10 cash, 50 COD, 97 other; element order follows the XSD.

The XSD is vendored at `packages/exports/xsd/isdoc-invoice-6.0.2.xsd` (official, isdoc.cz, downloaded 2026-10-26). The orchestrator validated this exact shape against it with `xmllint` (it passes); the test's `EXPECTED` string is that file. Empty `StreetName`, `BuildingNumber`, `CityName`, `PostalZone`, `Country/Name`, `Details/Name` and `Details/BIC` are required by the XSD and may be empty. `CZK` documents only in this brief: any other currency → `buildIsdoc` returns `null` (TODO(decision-isdoc-fx): foreign currency needs the ČNB rate).

Money: use `Money` from `@shoebox/domain` (`Money.parse(text, 'CZK')`, `add`, `subtract`, `isZero`, `toFixed2`); never floats (hard rule 1). Add `"@shoebox/domain": "workspace:*"` to `packages/exports/package.json` and run `pnpm install`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/exports/package.json`, `pnpm-lock.yaml` | edit | workspace dependency |
| `packages/exports/src/isdoc/build.ts` | new | `buildIsdoc`, `isdocUuid` |
| `packages/exports/test/isdoc-build.test.ts` | new | test below, verbatim |
| `packages/exports/src/index.ts` | edit | `export * from './isdoc/build';` |

## 4. Steps

1. `build.ts` exports exactly:

```ts
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
  readonly vatRows: readonly { readonly ratePct: string; readonly base: string; readonly vat: string }[];
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
/** RFC 4122 UUIDv5 (SHA-1, node:crypto) of `documentId` in the namespace `orgId` (a UUID), uppercase. */
export function isdocUuid(orgId: string, documentId: string): string;
/** ISDOC 6.0.2 XML, or null for a non-CZK document. Text is XML-escaped (& < > " '). */
export function buildIsdoc(input: IsdocExportInput): string | null;
```

   Layout: exactly the `EXPECTED` string of the test (2-space indent, one element per line as shown, a trailing newline). `PaymentMeans` only when `payment.method` is not null; `Details` only for `bank_transfer` (`ID` = account number, `BankCode`, `Name` empty, `IBAN` (empty when null), `BIC` empty, `VariableSymbol` (omit when null), `PaymentDueDate` first inside `Details` (omit when null)). For other methods `Payment` holds `PaidAmount` and `PaymentMeansCode` only. Percent: drop trailing `.00` (`"21.00"` → `21`, `"12"` → `12`).

2. Test file, verbatim:

```ts
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
  return execFileSync('xmllint', ['--noout', '--schema', XSD, file], { encoding: 'utf8', stdio: 'pipe' });
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
        payment: { method: 'card', accountNumber: null, bankCode: null, iban: null, variableSymbol: null },
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
```

   Implement until it passes; do not edit the test file (biome formatting allowed). If `xmllint` is missing in your shell, STOP (§8).

## 5. Do not touch

Everything outside §3. The XSD file. Hard rules 1, 4, 7.

## 6. Commands

```
pnpm --filter @shoebox/exports test 2>&1 | tail -30
pnpm --filter @shoebox/exports typecheck 2>&1 | tail -30
pnpm exec biome check --write packages/exports 2>&1 | tail -30
```

## 7. Acceptance

- [ ] §6 passes.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0210-report.md`, 200 tokens at most. Set `Status: review`.

## Risk list (for the reviewer)

`build.ts` sums (Money) and rounding.
