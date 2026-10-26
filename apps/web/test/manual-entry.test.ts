import { describe, expect, it } from 'vitest';
import { manualDocumentColumns, manualFields, parseManualEntry } from '../src/documents/manual-entry';

const base = { kind: 'received_receipt', partner: 'Parkoviště Anděl', date: '2026-09-09', amount: '350', paid: 'cash' };

describe('parseManualEntry', () => {
  it('reads a cash receipt', () => {
    const r = parseManualEntry(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: 'received_receipt', partnerName: 'Parkoviště Anděl', partnerIco: null, date: '2026-09-09', paid: 'cash', note: null, substituteReason: null });
  });
  it('an 8-digit partner is a company ID', () => {
    const r = parseManualEntry({ ...base, partner: ' 27082440 ' });
    expect(r.ok && r.value.partnerIco).toBe('27082440');
  });
  it('needs a partner, a date and an amount', () => {
    const r = parseManualEntry({ ...base, partner: ' ', date: 'yesterday', amount: 'abc' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.partner).toBe('manual.error.partner');
    expect(r.errors.date).toBeDefined();
    expect(r.errors.amount).toBeDefined();
  });
  it('the reason counts only when the document is marked missing', () => {
    const off = parseManualEntry({ ...base, reason: 'lost' });
    expect(off.ok && off.value.substituteReason).toBeNull();
    const on = parseManualEntry({ ...base, missing: 'on', reason: 'bogus' });
    expect(on.ok && on.value.substituteReason).toBe('other');
  });
});

describe('rows', () => {
  it('a received receipt fills supplier fields and an expense document', () => {
    const r = parseManualEntry({ ...base, partner: '27082440', paid: 'unpaid', kind: 'received_invoice' });
    if (!r.ok) throw new Error('parse');
    expect(manualFields(r.value)).toEqual({ 'supplier.ico': '27082440', 'dates.issue_date': '2026-09-09', 'totals.gross': r.value.amount, currency: 'CZK' });
    expect(manualDocumentColumns(r.value)).toMatchObject({ entry_mode: 'manual', class: 'received_invoice', direction: 'in', payment_method: null, is_paid_per_document: false, partner_snapshot: { ico: '27082440' } });
  });
  it('an issued invoice is income with buyer fields', () => {
    const r = parseManualEntry({ ...base, kind: 'issued_invoice', paid: 'bank_transfer' });
    if (!r.ok) throw new Error('parse');
    expect(manualFields(r.value)['buyer.name']).toBe('Parkoviště Anděl');
    expect(manualFields(r.value)['payment.method']).toBe('bank_transfer');
    expect(manualDocumentColumns(r.value)).toMatchObject({ direction: 'out', is_paid_per_document: true });
  });
});
