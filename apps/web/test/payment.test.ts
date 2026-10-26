import { describe, expect, it } from 'vitest';
import { loadPaymentView, type PaymentStore, paymentView } from '../src/documents/payment';

const tx = (id: string, name: string | null = 'Alfa s.r.o.') => ({
  id,
  booked_on: '2026-03-10',
  amount: '-1500.00',
  currency: 'CZK',
  counterparty_name: name,
});

describe('paymentView', () => {
  it('shows a paid invoice', () => {
    const v = paymentView({
      paidAt: '2026-03-10',
      suggestions: [],
      transactions: [],
      documentId: 'd1',
    });
    expect(v).toEqual({ paidAt: '2026-03-10', found: [] });
  });

  it('shows one found payment', () => {
    const v = paymentView({
      paidAt: null,
      suggestions: [{ id: 's1', transaction_id: 't1', document_ids: ['d1'], amounts: ['1210.00'] }],
      transactions: [tx('t1')],
      documentId: 'd1',
    });
    expect(v.found).toEqual([
      {
        suggestionId: 's1',
        bookedOn: '2026-03-10',
        amount: '1210.00',
        currency: 'CZK',
        counterparty: 'Alfa s.r.o.',
      },
    ]);
  });

  it('a multi-document suggestion shows this document share', () => {
    const v = paymentView({
      paidAt: null,
      suggestions: [
        { id: 's1', transaction_id: 't1', document_ids: ['d1', 'd2'], amounts: [1000, 500] },
      ],
      transactions: [tx('t1', null)],
      documentId: 'd2',
    });
    expect(v.found[0]?.amount).toBe('500.00');
    expect(v.found[0]?.counterparty).toBeNull();
  });

  it('is empty when nothing is found and unpaid', () => {
    const v = paymentView({ paidAt: null, suggestions: [], transactions: [], documentId: 'd1' });
    expect(v).toEqual({ paidAt: null, found: [] });
  });

  it('loadPaymentView never throws', async () => {
    const store: PaymentStore = {
      openSuggestions: async () => {
        throw new Error('boom');
      },
      transactions: async () => [],
      paidAt: async () => null,
    };
    expect(await loadPaymentView(store, 'd1')).toBeNull();
  });
});
