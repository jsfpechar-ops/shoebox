import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface SuggestionRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly document_ids: readonly string[];
  /** numeric columns may arrive as numbers or strings. */
  readonly amounts: readonly (string | number)[];
}
export interface PaymentTransactionRow {
  readonly id: string;
  readonly booked_on: string;
  readonly amount: string | number;
  readonly currency: string;
  readonly counterparty_name: string | null;
}

/** Data access for the payment card; every call is scoped to one org. */
export interface PaymentStore {
  /** Open document/multi_document suggestions that include the document, best first, at most 3. */
  openSuggestions(documentId: string): Promise<SuggestionRow[]>;
  transactions(ids: readonly string[]): Promise<PaymentTransactionRow[]>;
  paidAt(documentId: string): Promise<string | null>;
}

export interface FoundPayment {
  readonly suggestionId: string;
  readonly bookedOn: string;
  readonly amount: string;
  readonly currency: string;
  readonly counterparty: string | null;
}
export interface PaymentView {
  readonly paidAt: string | null;
  readonly found: FoundPayment[];
}

const amountText = (v: string | number): string => (typeof v === 'number' ? v.toFixed(2) : v);

/** Pure: what the card shows. The amount is the suggestion's share for this document. */
export function paymentView(input: {
  paidAt: string | null;
  suggestions: readonly SuggestionRow[];
  transactions: readonly PaymentTransactionRow[];
  documentId: string;
}): PaymentView {
  const found: FoundPayment[] = [];
  for (const s of input.suggestions) {
    const i = s.document_ids.indexOf(input.documentId);
    const tx = input.transactions.find((t) => t.id === s.transaction_id);
    const amount = i >= 0 ? s.amounts[i] : undefined;
    if (tx === undefined || amount === undefined) continue;
    found.push({
      suggestionId: s.id,
      bookedOn: tx.booked_on,
      amount: amountText(amount),
      currency: tx.currency,
      counterparty: tx.counterparty_name,
    });
  }
  return { paidAt: input.paidAt, found };
}

/** Never throws: a store error means no card. */
export async function loadPaymentView(
  store: PaymentStore,
  documentId: string,
): Promise<PaymentView | null> {
  try {
    const paidAt = await store.paidAt(documentId);
    const suggestions = paidAt === null ? await store.openSuggestions(documentId) : [];
    const transactions =
      suggestions.length > 0
        ? await store.transactions(suggestions.map((s) => s.transaction_id))
        : [];
    return paymentView({ paidAt, suggestions, transactions, documentId });
  } catch {
    return null;
  }
}

export function supabasePaymentStore(supabase: SupabaseLike, orgId: string): PaymentStore {
  return {
    async openSuggestions(documentId) {
      const { data, error } = await supabase
        .from('match_suggestions')
        .select('id, transaction_id, document_ids, amounts')
        .eq('org_id', orgId)
        .eq('state', 'open')
        .in('kind', ['document', 'multi_document'])
        .contains('document_ids', [documentId])
        .order('score', { ascending: false })
        .limit(3);
      if (error) throw new Error('suggestions read failed');
      return (data ?? []) as SuggestionRow[];
    },
    async transactions(ids) {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, booked_on, amount, currency, counterparty_name')
        .eq('org_id', orgId)
        .in('id', [...ids]);
      if (error) throw new Error('transactions read failed');
      return (data ?? []) as PaymentTransactionRow[];
    },
    async paidAt(documentId) {
      const { data, error } = await supabase
        .from('documents')
        .select('paid_at')
        .eq('org_id', orgId)
        .eq('id', documentId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error('document read failed');
      return typeof data?.paid_at === 'string' ? data.paid_at : null;
    },
  };
}
