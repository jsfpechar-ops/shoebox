import { describe, expect, it } from 'vitest';
import { detailOf } from '../src/documents/detail-data';

const doc = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'needs_review',
  class: 'received_invoice',
  currency: 'CZK',
  total_net: '100.00',
  total_vat: '30.00',
  total_gross: '130.00',
  issue_date: '2026-09-12',
  duzp: '2026-09-12',
  due_date: null,
  document_number: 'SYN-1',
  variable_symbol: null,
  partner_snapshot: { name: 'Synthetic s.r.o.', ico: '27082440', dic: null },
  pay_to_account: { account: '100', bank_code: '0100', iban: null },
  created_at: '2026-10-25T10:00:00Z',
  source_files: [
    { storage_path: 'org/x/files/abc', mime_type: 'application/pdf', original_filename: 'f.pdf' },
  ],
};

describe('detailOf', () => {
  it('lists what was read, in order, skipping empty values', () => {
    const detail = detailOf(doc, [{ vat_rate_pct: '21.00', base: '100.00', vat: '30.00' }], []);
    expect(detail?.title).toBe('Synthetic s.r.o.');
    expect(detail?.fields.map((f) => f.label)).toEqual([
      'proto.field.supplier_name',
      'proto.field.supplier_ico',
      'proto.field.document_number',
      'proto.field.issue_date',
      'doc.field.duzp',
      'proto.field.total_net',
      'proto.field.total_vat',
      'proto.field.total_gross',
      'proto.field.account',
    ]);
    expect(detail?.fields.find((f) => f.label === 'proto.field.account')?.value).toBe('100/0100');
    expect(detail?.fields.find((f) => f.label === 'proto.field.total_gross')).toEqual({
      label: 'proto.field.total_gross',
      value: '130.00',
      kind: 'money',
      trust: 'checked',
    });
    expect(detail?.vatLines).toEqual([{ rate: '21.00', base: '100.00', vat: '30.00' }]);
    expect(detail?.file).toEqual({
      path: 'org/x/files/abc',
      mimeType: 'application/pdf',
      name: 'f.pdf',
    });
  });

  it('keeps checks with a known message key, blocking first, and translates the field param', () => {
    const detail = detailOf(
      doc,
      [],
      [
        {
          rule_id: 'PROTO_DIC_FORMAT',
          severity: 'warning',
          params: { messageKey: 'proto.check.dic_format.warn', dic: 'DE1' },
        },
        { rule_id: 'PROTO_X', severity: 'blocking', params: { messageKey: 'no.such.key' } },
        {
          rule_id: 'PROTO_VAT_RATE_MATH',
          severity: 'blocking',
          params: {
            messageKey: 'proto.check.vat_rate_math.fail',
            rate: '21',
            vat: '30.00',
            base: '100.00',
            expected: '21.00',
          },
        },
        {
          rule_id: 'PROTO_DATE_DUE',
          severity: 'blocking',
          params: { messageKey: 'proto.check.date.fail_invalid', field: 'due_date' },
        },
      ],
    );
    expect(detail?.checks.map((c) => c.key)).toEqual([
      'proto.check.vat_rate_math.fail',
      'proto.check.date.fail_invalid',
      'proto.check.dic_format.warn',
    ]);
    expect(detail?.checks[0]?.params).toEqual({
      rate: '21',
      vat: '30.00',
      base: '100.00',
      expected: '21.00',
    });
    expect(detail?.checks[1]?.params.field).toBe('Due date');
  });

  it('says when the values came from ISDOC data, from the latest run', () => {
    expect(detailOf(doc, [], [], [{ method: 'isdoc' }])?.readBy).toBe('isdoc');
    expect(detailOf(doc, [], [], [{ method: 'llm' }])?.readBy).toBe('model');
    expect(detailOf(doc, [], [])?.readBy).toBeNull();
  });

  it('marks each value by its source and by the open checks', () => {
    const detail = detailOf(
      doc,
      [],
      [
        {
          rule_id: 'PROTO_ICO_CHECKSUM',
          severity: 'warning',
          params: { messageKey: 'proto.check.ico_checksum.fail' },
        },
      ],
      [],
      [
        { field_key: 'totals.gross', source: 'isdoc' },
        { field_key: 'supplier.ico', source: 'isdoc' },
        { field_key: 'document.number', source: 'llm' },
      ],
    );
    expect(detail?.fields.find((f) => f.label === 'proto.field.total_gross')?.trust).toBe('exact');
    expect(detail?.fields.find((f) => f.label === 'proto.field.supplier_ico')?.trust).toBe('check');
    expect(detail?.fields.find((f) => f.label === 'proto.field.document_number')?.trust).toBe(
      'checked',
    );
  });

  it('returns null for a malformed document', () => {
    expect(detailOf(null, [], [])).toBeNull();
    expect(detailOf({ id: 3 }, [], [])).toBeNull();
  });
});
