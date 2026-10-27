import type { ProtoExtraction } from '@shoebox/extraction';
import { checkInputFromFields, type ProtoCheckResult, runProtoChecks } from '@shoebox/validation';
import { describe, expect, it } from 'vitest';
import {
  documentPatchOf,
  fieldsOf,
  statusAfterRead,
  validationRowsOf,
  vatSummaryOf,
} from '../src/doc-extract/rows';

const RATES = { standard: 21, reduced: 12 };

function reading(overrides: Partial<ProtoExtraction> = {}): ProtoExtraction {
  return {
    schema_version: 'm02-proto-v3',
    kind_hint: 'invoice',
    document_class: 'received_invoice',
    supplier: {
      name: 'Dodavatel s.r.o.',
      ico: '27082440',
      dic: 'CZ27082440',
      vat_id: null,
      country: 'CZ',
    },
    buyer: { name: null, ico: null, dic: null },
    document: { number: 'FV2026-001', variable_symbol: '2026001' },
    dates: { issue_date: '2026-10-01', duzp: '2026-10-01', due_date: '2026-10-15' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '1000', vat: '210' }],
    totals: { net: '1000', vat: '210', gross: '1210' },
    payment: {
      account_number: '123456789',
      bank_code: '0100',
      iban: null,
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
    ...overrides,
  } as ProtoExtraction;
}

function check(id: string, severity: 'pass' | 'warn' | 'fail'): ProtoCheckResult {
  return { id, severity, key: 'proto.check.x', params: { a: 1 } } as unknown as ProtoCheckResult;
}

describe('documentPatchOf', () => {
  it('stores the rounding within 1 Kč and 0.00 beyond it', () => {
    const totals = (net: string, vat: string, gross: string) => ({
      ...reading().totals,
      net,
      vat,
      gross,
    });
    expect(
      documentPatchOf(reading({ totals: totals('13654.88', '2867.52', '16522.00') })).rounding,
    ).toBe('-0.40');
    expect(
      documentPatchOf(reading({ totals: totals('1000.00', '210.00', '1212.00') })).rounding,
    ).toBe('0.00');
  });
  it('maps a full invoice', () => {
    const patch = documentPatchOf(reading());
    expect(patch).toEqual({
      class: 'received_invoice',
      classSource: 'llm',
      direction: 'in',
      taxDocStatus: 'full_tax_document',
      partnerSnapshot: {
        name: 'Dodavatel s.r.o.',
        ico: '27082440',
        dic: 'CZ27082440',
        vat_id: null,
        country: 'CZ',
      },
      buyerSnapshot: null,
      documentNumber: 'FV2026-001',
      variableSymbol: '2026001',
      issueDate: '2026-10-01',
      duzp: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'CZK',
      totalNet: '1000',
      totalVat: '210',
      totalGross: '1210',
      rounding: '0.00',
      paymentMethod: 'bank_transfer',
      payToAccount: { account: '123456789', bank_code: '0100', iban: null },
      isPaidPerDocument: null,
    });
  });

  it('marks card, cash and receipts as paid per document, transfers not', () => {
    const pay = (method: 'card' | 'cash' | 'bank_transfer') => ({
      account_number: null,
      bank_code: null,
      iban: null,
      method,
    });
    expect(documentPatchOf(reading({ payment: pay('card') })).isPaidPerDocument).toBe(true);
    expect(documentPatchOf(reading({ payment: pay('cash') })).isPaidPerDocument).toBe(true);
    expect(
      documentPatchOf(reading({ payment: pay('bank_transfer') })).isPaidPerDocument,
    ).toBeNull();
    expect(
      documentPatchOf(
        reading({ document_class: 'received_receipt', payment: pay('bank_transfer') }),
      ).isPaidPerDocument,
    ).toBe(true);
  });

  it('maps unreadable to unknown, cash on delivery to cod, defaults the currency', () => {
    const patch = documentPatchOf(
      reading({
        document_class: 'unreadable',
        currency: null,
        payment: { account_number: null, bank_code: null, iban: null, method: 'cash_on_delivery' },
        flags: {
          not_tax_document_text: false,
          non_vat_payer_text: false,
          reverse_charge_text: false,
          paid_text: true,
        },
      }),
    );
    expect(patch.class).toBe('unknown');
    expect(patch.currency).toBe('CZK');
    expect(patch.paymentMethod).toBe('cod');
    expect(patch.payToAccount).toBeNull();
    expect(patch.isPaidPerDocument).toBe(true);
    expect(patch.taxDocStatus).toBe('unknown');
  });

  it('marks a non-tax document', () => {
    expect(documentPatchOf(reading({ not_tax_document: true })).taxDocStatus).toBe(
      'not_tax_document',
    );
  });

  it('a receipt without a recap is unknown', () => {
    const patch = documentPatchOf(reading({ document_class: 'received_receipt', vat_recap: [] }));
    expect(patch.taxDocStatus).toBe('unknown');
  });
});

describe('vatSummaryOf', () => {
  it('types each rate from the rules and sums duplicate rates exactly', () => {
    const rows = vatSummaryOf(
      reading({
        vat_recap: [
          { rate_pct: '21', base: '100.10', vat: '21.02' },
          { rate_pct: '12', base: '50', vat: '6' },
          { rate_pct: '21', base: '0.20', vat: '0.04' },
          { rate_pct: '0', base: '10', vat: '0' },
          { rate_pct: '15', base: '1', vat: '0.15' },
        ],
      }),
      RATES,
    );
    expect(rows).toEqual([
      { vatRateType: 'standard', vatRatePct: '21', base: '100.3', vat: '21.06' },
      { vatRateType: 'reduced', vatRatePct: '12', base: '50', vat: '6' },
      { vatRateType: 'zero', vatRatePct: '0', base: '10', vat: '0' },
      { vatRateType: 'none', vatRatePct: '15', base: '1', vat: '0.15' },
    ]);
  });

  it('is empty without a recap', () => {
    expect(vatSummaryOf(reading({ vat_recap: [] }), RATES)).toEqual([]);
  });
});

describe('fieldsOf', () => {
  it('lists every non-null value with the M02 key grammar, in order', () => {
    const keys = fieldsOf(reading()).map((f) => f.fieldKey);
    expect(keys).toEqual([
      'supplier.name',
      'supplier.ico',
      'supplier.dic',
      'supplier.country',
      'document.number',
      'document.variable_symbol',
      'dates.issue_date',
      'dates.duzp',
      'dates.due_date',
      'currency',
      'totals.net',
      'totals.vat',
      'totals.gross',
      'payment.account_number',
      'payment.bank_code',
      'payment.method',
      'vat_recap[0].rate_pct',
      'vat_recap[0].base',
      'vat_recap[0].vat',
      'flags.non_vat_payer_text',
      'flags.reverse_charge_text',
      'flags.paid_text',
    ]);
    expect(fieldsOf(reading())[1]).toEqual({
      fieldKey: 'supplier.ico',
      valueText: '27082440',
      source: 'llm',
    });
  });
});

describe('validationRowsOf and statusAfterRead', () => {
  it('drops passes and maps severities', () => {
    const rows = validationRowsOf([
      check('vat_sum', 'pass'),
      check('ico_checksum', 'fail'),
      check('dic_format', 'warn'),
    ]);
    expect(rows).toEqual([
      {
        ruleId: 'PROTO_ICO_CHECKSUM',
        ruleVersion: 1,
        severity: 'blocking',
        params: { a: 1, messageKey: 'proto.check.x' },
      },
      {
        ruleId: 'PROTO_DIC_FORMAT',
        ruleVersion: 1,
        severity: 'warning',
        params: { a: 1, messageKey: 'proto.check.x' },
      },
    ]);
  });

  it('is ready only without a blocking row', () => {
    expect(statusAfterRead(reading(), validationRowsOf([check('dic_format', 'warn')]))).toBe(
      'ready',
    );
    expect(statusAfterRead(reading(), validationRowsOf([check('vat_sum', 'fail')]))).toBe(
      'needs_review',
    );
  });

  it('sends non-documents to supporting and unknown classes to review', () => {
    expect(statusAfterRead(reading({ document_class: 'non_document' }), [])).toBe('supporting');
    expect(statusAfterRead(reading({ document_class: 'unreadable' }), [])).toBe('needs_review');
    expect(statusAfterRead(reading({ document_class: 'unknown' }), [])).toBe('needs_review');
  });
});

describe('re-check from stored fields', () => {
  it('gives the same results as the fresh reading', () => {
    const today = '2026-10-20' as never;
    const x = reading({
      flags: {
        not_tax_document_text: false,
        non_vat_payer_text: true,
        reverse_charge_text: false,
        paid_text: false,
      },
    } as never);
    const stored = Object.fromEntries(fieldsOf(x).map((f) => [f.fieldKey, f.valueText]));
    const again = runProtoChecks(checkInputFromFields(stored, x.document_class), { today });
    expect(again).toEqual(runProtoChecks(x, { today }));
  });
});
