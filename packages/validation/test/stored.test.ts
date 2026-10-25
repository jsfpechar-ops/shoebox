import { describe, expect, it } from 'vitest';
import { checkInputFromFields, validationRowsOf } from '../src';

describe('checkInputFromFields', () => {
  it('rebuilds the input from flat keys, keeping only whole recap lines in index order', () => {
    const input = checkInputFromFields(
      {
        'supplier.ico': '27082440',
        'dates.issue_date': '2026-10-01',
        currency: 'CZK',
        'totals.gross': '1210',
        'vat_recap[10].rate_pct': '12',
        'vat_recap[10].base': '100',
        'vat_recap[10].vat': '12',
        'vat_recap[2].rate_pct': '21',
        'vat_recap[2].base': '1000',
        'vat_recap[2].vat': '210',
        'vat_recap[3].rate_pct': '21',
        'flags.paid_text': 'true',
      },
      'received_invoice',
    );
    expect(input).toEqual({
      document_class: 'received_invoice',
      supplier: { ico: '27082440', dic: null, country: null },
      buyer: { ico: null, dic: null },
      dates: { issue_date: '2026-10-01', duzp: null, due_date: null },
      currency: 'CZK',
      totals: { gross: '1210', vat: null },
      vat_recap: [
        { rate_pct: '21', base: '1000', vat: '210' },
        { rate_pct: '12', base: '100', vat: '12' },
      ],
      payment: { method: null },
      flags: { non_vat_payer_text: false, reverse_charge_text: false, paid_text: true },
      issues: [],
    });
  });

  it('leaves flags and the class out when they were never stored', () => {
    const input = checkInputFromFields({});
    expect(input.flags).toBeUndefined();
    expect('document_class' in input).toBe(false);
    expect(input.vat_recap).toEqual([]);
  });
});

describe('validationRowsOf', () => {
  it('drops passes, maps severities and keeps the message key', () => {
    expect(
      validationRowsOf([
        { id: 'ico', severity: 'pass', key: 'proto.check.ico.pass', params: {} },
        {
          id: 'vat_rate_math',
          severity: 'fail',
          key: 'proto.check.vat_rate_math.fail',
          params: { rate: '21' },
        },
        { id: 'dic_format', severity: 'warn', key: 'proto.check.dic_format.warn', params: {} },
      ] as never),
    ).toEqual([
      {
        ruleId: 'PROTO_VAT_RATE_MATH',
        ruleVersion: 1,
        severity: 'blocking',
        params: { rate: '21', messageKey: 'proto.check.vat_rate_math.fail' },
      },
      {
        ruleId: 'PROTO_DIC_FORMAT',
        ruleVersion: 1,
        severity: 'warning',
        params: { messageKey: 'proto.check.dic_format.warn' },
      },
    ]);
  });
});
