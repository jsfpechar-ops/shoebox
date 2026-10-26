import type { RadarQuestionRow, RadarTxRow, TenantTx } from '@shoebox/db';
import { describe, expect, it } from 'vitest';
import {
  type BankRadarStore,
  createBankRadarNightlyHandler,
  createBankRadarRefreshHandler,
  senderAddress,
} from '../src/bank-radar/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000120';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
const TODAY_MS = Date.parse('2026-10-26T10:00:00Z');

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface World {
  txs: Mutable<RadarTxRow>[];
  questions: (Mutable<RadarQuestionRow> & { payload?: unknown })[];
  applied: { id: string; category: string | null }[];
}
const tx = (over: Partial<RadarTxRow> = {}): RadarTxRow => ({
  id: 't1',
  amount: '-1210.00',
  currency: 'CZK',
  booked_on: '2026-10-19',
  match_state: 'unmatched',
  category_code: null,
  is_pending: false,
  is_business: true,
  linked_amount: '0',
  counterparty: 'Alza.cz a.s.',
  variable_symbol: '123',
  ...over,
});

function setup(txs: RadarTxRow[], now = TODAY_MS) {
  const w: World = { txs, questions: [], applied: [] };
  let n = 0;
  const store: BankRadarStore = {
    loadTransactions: async () => w.txs.filter((t) => t.match_state !== 'no_document_needed'),
    loadQuestions: async () => w.questions.map((q) => ({ ...q })),
    insertQuestion: async (_tx, _org, transactionId, payload) => {
      w.questions.push({
        id: `q${++n}`,
        transaction_id: transactionId,
        answered_at: null,
        answer: null,
        payload,
      });
    },
    resolveQuestion: async (_tx, _org, id) => {
      const q = w.questions.find((x) => x.id === id);
      if (q) {
        q.answer = { resolved: 'auto' };
        q.answered_at = 'now';
      }
    },
    markApplied: async (_tx, _org, id) => {
      const q = w.questions.find((x) => x.id === id);
      if (q) q.answer = { ...(q.answer as object), applied: true };
    },
    applyAnswer: async (_tx, _org, id, category) => {
      const t = w.txs.find((x) => x.id === id);
      if (!t || (t.match_state !== 'unmatched' && t.match_state !== 'partial')) return false;
      t.match_state = 'no_document_needed';
      w.applied.push({ id, category });
      return true;
    },
    loadOrgDetails: async () => ({ name: 'Jan Novak', ico: '12345678', dic: null, address: null }),
    loadSupplierSender: async () => 'Alza <fakturace@alza.example>',
  };
  const handler = createBankRadarRefreshHandler({ store, clock: { now: () => now } });
  const run = () => handler({ orgId: ORG }, ctx);
  return { w, run };
}
const answer = (w: World, value: string) => {
  const q = w.questions[0];
  if (q) {
    q.answer = { value };
    q.answered_at = 'now';
  }
};

describe('bank.radar.refresh', () => {
  it('asks after the grace period and builds the payload', async () => {
    const { w, run } = setup([tx()]);
    await run();
    expect(w.questions).toHaveLength(1);
    const p = w.questions[0]?.payload as {
      params: Record<string, string>;
      options: { value: string }[];
      suggested?: unknown;
    };
    expect(p.params.amount).toBe('1210.00');
    expect(p.params.date).toBe('2026-10-19');
    expect((p.params.mailto ?? '').startsWith('mailto:fakturace@alza.example?subject=')).toBe(true);
    expect(p.options.map((o) => o.value)).toEqual(['upload', 'no_document', 'private']);
    expect(p.suggested).toBeUndefined();
  });
  it('does not ask before the grace period', async () => {
    const { w, run } = setup([tx({ booked_on: '2026-10-20' })]);
    await run();
    expect(w.questions).toHaveLength(0);
  });
  it('is idempotent', async () => {
    const { w, run } = setup([tx()]);
    await run();
    await run();
    expect(w.questions).toHaveLength(1);
  });
  it('auto-resolves when the transaction gets matched', async () => {
    const { w, run } = setup([tx()]);
    await run();
    const t = w.txs[0];
    if (t) t.match_state = 'matched';
    await run();
    expect(w.questions[0]?.answer).toEqual({ resolved: 'auto' });
    expect(w.questions).toHaveLength(1);
  });
  it('no_document answer updates the transaction once and asks nothing new', async () => {
    const { w, run } = setup([tx()]);
    await run();
    answer(w, 'no_document');
    await run();
    await run();
    expect(w.applied).toEqual([{ id: 't1', category: null }]);
    expect(w.questions).toHaveLength(1);
  });
  it('private answer sets state and category', async () => {
    const { w, run } = setup([tx()]);
    await run();
    answer(w, 'private');
    await run();
    expect(w.applied).toEqual([{ id: 't1', category: 'private_expense' }]);
    expect(w.txs[0]?.match_state).toBe('no_document_needed');
  });
  it('upload answer changes nothing and gets no new question', async () => {
    const { w, run } = setup([tx()]);
    await run();
    answer(w, 'upload');
    await run();
    expect(w.applied).toEqual([]);
    expect(w.questions).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('extracts a plain address from a From header', () => {
    expect(senderAddress('Alza <a@b.cz>')).toBe('a@b.cz');
    expect(senderAddress('a@b.cz')).toBe('a@b.cz');
    expect(senderAddress('nonsense')).toBe('');
    expect(senderAddress(null)).toBe('');
  });
  it('nightly enqueues one refresh per org', async () => {
    const seen: string[] = [];
    await createBankRadarNightlyHandler({
      listActiveOrgIds: async () => ['a', 'b'],
      enqueue: async (id) => {
        seen.push(id);
      },
    })({}, { jobId: 'j', attempt: 1, signal: new AbortController().signal });
    expect(seen).toEqual(['a', 'b']);
  });
});
