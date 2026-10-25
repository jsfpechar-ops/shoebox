import { describe, expect, it } from 'vitest';
import { editKeyOf, isEditKey, normalizeInput, planCorrection } from '../src/documents/correction';

const fields = {
  'supplier.ico': '27082440',
  'supplier.dic': 'CZ27082440',
  'supplier.country': 'CZ',
  'dates.issue_date': '2026-10-01',
  'dates.duzp': '2026-10-01',
  'dates.due_date': '2026-10-15',
  currency: 'CZK',
  'totals.net': '1000',
  'totals.vat': '210',
  'totals.gross': '1210',
  'vat_recap[0].rate_pct': '21',
  'vat_recap[0].base': '1000',
  'vat_recap[0].vat': '210',
  'flags.non_vat_payer_text': 'false',
  'flags.reverse_charge_text': 'false',
  'flags.paid_text': 'false',
};
const today = '2026-10-20' as never;

describe('normalizeInput', () => {
  it('accepts Czech-style amounts and pads cents', () => {
    expect(normalizeInput('money', ' 1 210,5 ')).toEqual({ ok: true, value: '1210.50' });
    expect(normalizeInput('money', '1210')).toEqual({ ok: true, value: '1210.00' });
    expect(normalizeInput('money', '12.345')).toEqual({ ok: false, error: 'doc.fix.error.money' });
  });
  it('checks dates and empty input', () => {
    expect(normalizeInput('date', '2026-10-25')).toEqual({ ok: true, value: '2026-10-25' });
    expect(normalizeInput('date', '25.10.2026')).toEqual({
      ok: false,
      error: 'doc.fix.error.date',
    });
    expect(normalizeInput('text', '   ')).toEqual({ ok: false, error: 'doc.fix.error.empty' });
  });
});

describe('edit keys', () => {
  it('maps labels to keys and rejects unknown keys', () => {
    expect(editKeyOf('proto.field.total_gross')).toBe('totals.gross');
    expect(editKeyOf('proto.field.supplier_name')).toBeNull();
    expect(isEditKey('totals.gross')).toBe(true);
    expect(isEditKey('toString')).toBe(false);
  });
});

describe('planCorrection', () => {
  it('a wrong total blocks, and fixing it makes the document ready', () => {
    const broken = planCorrection({
      fields,
      documentClass: 'received_invoice',
      editKey: 'totals.gross',
      value: '1300.00',
      org: null,
      today,
    });
    expect(broken.status).toBe('needs_review');
    expect(broken.rows.some((r) => r.severity === 'blocking')).toBe(true);
    const fixed = planCorrection({
      fields: broken.fields,
      documentClass: 'received_invoice',
      editKey: 'totals.gross',
      value: '1210.00',
      org: null,
      today,
    });
    expect(fixed.status).toBe('ready');
    expect(fixed.fields['totals.gross']).toBe('1210.00');
  });
  it('an unknown class stays in review', () => {
    expect(
      planCorrection({
        fields,
        documentClass: 'unknown',
        editKey: 'totals.gross',
        value: '1210.00',
        org: null,
        today,
      }).status,
    ).toBe('needs_review');
  });
});
