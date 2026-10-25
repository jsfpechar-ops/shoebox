import { describe, expect, expectTypeOf, it } from 'vitest';
import { ENUMS, type FilingKind, isEnumValue, type VatStatus } from '../src/index';

// Pasted verbatim from docs/v3/05-data-model.md §1 Enums. If 05 changes, paste the new block here.
const SQL_05_ENUMS = `
create type vat_status         as enum ('neplatce','identifikovana_osoba','platce');
create type vat_period         as enum ('monthly','quarterly');
create type tax_regime         as enum ('danova_evidence','pausalni_vydaje','pausalni_dan','ucetnictvi');
create type member_role        as enum ('owner','member','accountant','viewer');
create type document_class     as enum ('received_invoice','received_receipt','received_credit_note','received_advance_tax_doc',
  'received_proforma','issued_invoice','issued_credit_note','platform_statement','settlement_statement','order_confirmation',
  'delivery_note','bank_statement','government_filing','contract','other_supporting','non_document','unknown');
create type document_status    as enum ('received','splitting','classifying','extracting','validating','categorizing',
  'needs_review','ready','finalized','supporting','duplicate','failed');
  -- 'supporting' = kept and linked, never booked (all non-bookable classes, 04 §2.4). Renamed from 'rejected' on 2026-10-18.
create type tax_doc_status     as enum ('full_tax_document','simplified_tax_document','not_tax_document','foreign_document','unknown');
create type direction          as enum ('in','out');             -- in = expense side (received), out = income side (issued)
create type line_type          as enum ('item','discount','shipping','fee','rounding','advance_deduction','deposit','text');
create type vat_rate_type      as enum ('standard','reduced','zero','none');
create type vat_treatment      as enum ('rcv_domestic_vat','rcv_domestic_no_vat','rcv_eu_service_reverse_charge',
  'rcv_non_eu_service_reverse_charge','rcv_eu_goods_acquisition','rcv_domestic_reverse_charge','rcv_import_customs',
  'rcv_foreign_vat_charged','rcv_out_of_scope','iss_domestic_vat','iss_eu_service','iss_eu_goods','iss_non_eu_service',
  'iss_export_goods','iss_domestic_reverse_charge','iss_exempt','iss_no_vat');
create type tax_effect         as enum ('taxable_income','non_taxable_income','deductible_expense','non_deductible_expense',
  'asset','pass_through','transfer','tax_or_insurance_payment','private');
create type field_source       as enum ('isdoc','qr','pdf_text','template','llm','llm_escalated','registry','rule','vendor_memory','user','derived');
  -- typed (manual entry) and spreadsheet-imported values are 'user' (04 §2.2a)
create type severity           as enum ('blocking','warning','info');
create type validation_state   as enum ('open','resolved','dismissed');
create type money_account_type as enum ('bank','cash','card','platform');
create type tx_source          as enum ('statement_file','email_notice','bank_api','manual','document_evidence');
create type link_type          as enum ('payment','refund','fee','fx_difference','platform_payout','offset');
create type match_method       as enum ('vs_amount','vs_only','amount_date_counterparty','card_merchant_fuzzy',
  'platform_statement','manual','document_evidence');
create type doc_link_kind      as enum ('duplicate_of','corrects','settles','supports','fulfills','reported_in','same_period_reconciles');
create type filing_type        as enum ('DPHDP3','DPHKH1','DPHSHV','DPFDP7_PARTIAL','PODKLADY_DPFO','VAT_WORKBOOK');
create type filing_kind        as enum ('radne','opravne','dodatecne','nasledne');
create type filing_state       as enum ('draft','generated','downloaded','marked_filed','superseded');
create type filing_origin      as enum ('generated','imported');  -- imported = the user's own filed return (M05 §4.11)
create type package_state      as enum ('draft','ready','sent','acknowledged');
`;

function parse05(sql: string): Record<string, string[]> {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const out: Record<string, string[]> = {};
  for (const m of withoutComments.matchAll(/create type\s+(\w+)\s+as enum\s*\(([^)]*)\)/g)) {
    const name = m[1] ?? '';
    out[name] = [...(m[2] ?? '').matchAll(/'([^']*)'/g)].map((v) => v[1] ?? '');
  }
  return out;
}

const expected = parse05(SQL_05_ENUMS);

describe('enums mirror 05 §1', () => {
  it('parses all 25 enums from the 05 block', () => {
    expect(Object.keys(expected)).toHaveLength(25);
  });

  it('has exactly the 05 enum names, in 05 order', () => {
    expect(Object.keys(ENUMS)).toEqual(Object.keys(expected));
  });

  for (const [name, values] of Object.entries(expected)) {
    it(`${name} has the 05 values in 05 order`, () => {
      expect([...ENUMS[name as keyof typeof ENUMS]]).toEqual(values);
    });
  }

  it('unions are derived from the value lists', () => {
    expectTypeOf<VatStatus>().toEqualTypeOf<'neplatce' | 'identifikovana_osoba' | 'platce'>();
    expectTypeOf<FilingKind>().toEqualTypeOf<'radne' | 'opravne' | 'dodatecne' | 'nasledne'>();
  });

  it('isEnumValue narrows only members of the named enum', () => {
    expect(isEnumValue('document_status', 'supporting')).toBe(true);
    expect(isEnumValue('document_status', 'rejected')).toBe(false);
    expect(isEnumValue('direction', 'in')).toBe(true);
    expect(isEnumValue('direction', 'IN')).toBe(false);
  });
});
