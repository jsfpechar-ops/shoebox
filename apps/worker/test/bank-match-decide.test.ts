import type { PaymentLinkInsert, SuggestionForDecision, TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import { type BankMatchDecideDeps, createBankMatchDecideHandler } from '../src/bank-match/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000119';
const USER = 'ffffffff-0000-4000-8000-000000000119';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };

interface World {
  suggestion: SuggestionForDecision | null;
  links: PaymentLinkInsert[];
  decided: string[];
  refreshed: string[];
  paidAt: Map<string, string | null>;
}
function setup(suggestion: SuggestionForDecision | null) {
  const w: World = { suggestion, links: [], decided: [], refreshed: [], paidAt: new Map() };
  const due: Record<string, string> = { d1: '1000.00', d2: '500.00' };
  const deps: BankMatchDecideDeps = {
    store: {
      loadSuggestion: async () => w.suggestion,
      decide: async (_tx, _org, _id, state) => {
        if (w.suggestion === null || w.suggestion.state !== 'open') return false;
        w.suggestion = { ...w.suggestion, state };
        w.decided.push(state);
        return true;
      },
      insertLinks: async (_tx, _org, rows) => {
        w.links.push(...rows);
        return rows.map((_, i) => `l${i}`);
      },
      refreshTransaction: async (_tx, _org, id) => {
        w.refreshed.push(id);
      },
      loadDocumentLinks: async (_tx, _org, docId) =>
        w.links
          .filter((l) => l.documentId === docId)
          .map((l, i) => ({
            link_type: l.linkType,
            amount: l.amount,
            booked_on: '2026-03-10',
            created_at: `2026-03-20T10:00:0${i}Z`,
          })),
      loadDocumentPaidView: async (_tx, _org, docId) => ({
        amount_due: due[docId] ?? '0',
        currency: 'CZK',
        issue_date: '2026-03-01',
        is_paid_per_document: null,
        paid_at: w.paidAt.get(docId) ?? null,
      }),
      setPaidAt: async (_tx, _org, docId, paidAt) => {
        if ((w.paidAt.get(docId) ?? null) === paidAt) return false;
        w.paidAt.set(docId, paidAt);
        return true;
      },
    },
  };
  return { w, run: createBankMatchDecideHandler(deps) };
}
const open = (over: Partial<SuggestionForDecision> = {}): SuggestionForDecision => ({
  id: 's1',
  transaction_id: 't1',
  kind: 'multi_document',
  document_ids: ['d1', 'd2'],
  amounts: ['1000.00', '500.00'],
  state: 'open',
  score: '0.800',
  ...over,
});
const payload = (decision: 'accept' | 'reject') => ({
  orgId: ORG,
  suggestionId: 's1',
  decision,
  userId: USER,
});

describe('bank.match.decide', () => {
  it('reject marks rejected and writes no link', async () => {
    const { w, run } = setup(open());
    await run(payload('reject'), ctx);
    expect(w.decided).toEqual(['rejected']);
    expect(w.links).toHaveLength(0);
  });

  it('accept writes one manual user link per document and sets paid_at', async () => {
    const { w, run } = setup(open());
    await run(payload('accept'), ctx);
    expect(w.decided).toEqual(['accepted']);
    expect(w.links.map((l) => [l.documentId, l.amount, l.amountAccountCurrency])).toEqual([
      ['d1', '1000.00', '1000.00'],
      ['d2', '500.00', '500.00'],
    ]);
    for (const l of w.links) {
      expect(l.matchMethod).toBe('manual');
      expect(l.createdBy).toBe('user');
      expect(l.confirmedBy).toBe(USER);
      expect(l.confidence).toBe('0.800');
    }
    expect(w.refreshed).toEqual(['t1']);
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
    expect(w.paidAt.get('d2')).toBe('2026-03-10');
  });

  it('a second accept writes nothing', async () => {
    const { w, run } = setup(open());
    await run(payload('accept'), ctx);
    await run(payload('accept'), ctx);
    expect(w.links).toHaveLength(2);
    expect(w.refreshed).toHaveLength(1);
  });

  it('a missing suggestion is a no-op', async () => {
    const { w, run } = setup(null);
    await run(payload('accept'), ctx);
    expect(w.links).toHaveLength(0);
    expect(w.decided).toHaveLength(0);
  });

  it('accepting a transfer only marks the state', async () => {
    const { w, run } = setup(open({ kind: 'transfer', document_ids: [], amounts: [] }));
    await run(payload('accept'), ctx);
    expect(w.decided).toEqual(['accepted']);
    expect(w.links).toHaveLength(0);
  });
});
