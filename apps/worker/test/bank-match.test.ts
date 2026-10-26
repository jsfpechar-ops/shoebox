import { authorityRulesOf } from '@shoebox/bank';
import type {
  MatchDocRow,
  MatchTxRow,
  PaymentLinkInsert,
  SuggestionInsert,
  TenantTx,
} from '@shoebox/db';
import { CZK, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import {
  type BankMatchDeps,
  createBankMatchDocumentHandler,
  createBankMatchTransactionsHandler,
  runMatch,
} from '../src/bank-match/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000118';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
const rules = authorityRulesOf({
  fu: {
    bank_code: '0710',
    prefix_map: { '705': 'tax_vat_payment' },
    vat_refund_category: 'income_vat_refund',
  },
  name_hints: { OSSZ: 'ins_social_own' },
});
const clock = { now: () => Date.parse('2026-03-20T10:00:00Z') };

function txRow(over: Partial<MatchTxRow> & { id: string }): MatchTxRow {
  return {
    money_account_id: 'acc',
    booked_on: '2026-03-10',
    amount: '-1210.00',
    currency: 'CZK',
    amount_original: null,
    currency_original: null,
    counterparty_name: null,
    counterparty_account: null,
    counterparty_bank_code: null,
    counterparty_iban: null,
    variable_symbol: null,
    message: null,
    card_merchant: null,
    match_state: 'unmatched',
    linked_account_amount: '0',
    ...over,
  };
}
function docRow(over: Partial<MatchDocRow> & { id: string }): MatchDocRow {
  return {
    class: 'received_invoice',
    status: 'ready',
    direction: 'in',
    currency: 'CZK',
    amount_due: '1210.00',
    open_amount: '1210.00',
    document_number: null,
    variable_symbol: null,
    issue_date: '2026-03-01',
    due_date: '2026-03-15',
    service_period_to: null,
    payment_method: null,
    partner_id: 'p1',
    partner_name: 'Alfa Servis s.r.o.',
    pay_to_account: null,
    partner_accounts: ['2400123455/2010'],
    created_at: '2026-03-01T10:00:00Z',
    ...over,
  };
}
type State = {
  matchState: string;
  categoryCode?: string | null;
  pairedTransactionId?: string | null;
};
interface World {
  readonly txs: MatchTxRow[];
  readonly docs: MatchDocRow[];
  readonly links: PaymentLinkInsert[];
  readonly suggestions: Map<string, SuggestionInsert[]>;
  readonly states: Map<string, State>;
  readonly paidAt: Map<string, string | null>;
  readonly changed: string[];
}
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}
const DONE = new Set(['matched', 'no_document_needed', 'ignored']);
const sumLinks = (
  w: World,
  pick: (l: PaymentLinkInsert) => boolean,
  field: 'amount' | 'amountAccountCurrency',
) =>
  Money.sum(
    w.links.filter(pick).map((l) => Money.parse(l[field], CZK)),
    CZK,
  );

function world(txs: MatchTxRow[], docs: MatchDocRow[]): { w: World; deps: BankMatchDeps } {
  const w: World = {
    txs,
    docs,
    links: [],
    suggestions: new Map(),
    states: new Map(),
    paidAt: new Map(),
    changed: [],
  };
  let n = 0;
  const deps: BankMatchDeps = {
    rules,
    clock,
    onPaidAtChanged: async (_org, id) => {
      w.changed.push(id);
    },
    store: {
      loadTransactions: async (_tx, _org, scope) =>
        w.txs
          .filter((t) => !('ids' in scope) || scope.ids.includes(t.id))
          .filter((t) => !DONE.has(w.states.get(t.id)?.matchState ?? t.match_state))
          .map((t) => ({
            ...t,
            linked_account_amount: sumLinks(
              w,
              (l) => l.transactionId === t.id,
              'amountAccountCurrency',
            ).toFixed2(),
          })),
      loadDocuments: async (_tx, _org, scope) =>
        w.docs
          .filter((d) => !('ids' in scope) || scope.ids.includes(d.id))
          .map((d) => ({
            ...d,
            open_amount: Money.parse(d.amount_due, CZK)
              .subtract(sumLinks(w, (l) => l.documentId === d.id, 'amount'))
              .toFixed2(),
          }))
          .filter((d) => Money.parse(d.open_amount, CZK).isPositive()),
      loadContext: async () => ({
        aliases: [],
        known_accounts: [{ value: '2400123455/2010', partner_id: 'p1' }],
        rejected: [],
        partners_with_vs_history: [],
      }),
      loadOwnAccounts: async () => [
        {
          id: 'acc',
          type: 'bank',
          account_number: '2400123455',
          bank_code: '2010',
          iban: null,
          is_business: true,
        },
        {
          id: 'acc2',
          type: 'bank',
          account_number: '1003-1234567899',
          bank_code: '0800',
          iban: null,
          is_business: true,
        },
      ],
      insertLinks: async (_tx, _org, rows) =>
        rows.map((r) => {
          w.links.push(r);
          return `l${++n}`;
        }),
      syncSuggestions: async (_tx, _org, txId, rows) => {
        w.suggestions.set(txId, [...rows]);
        return { inserted: rows.length, superseded: 0 };
      },
      setTransaction: async (_tx, _org, txId, patch) => {
        w.states.set(txId, patch);
      },
      loadDocumentLinks: async (_tx, _org, docId) =>
        w.links
          .filter((l) => l.documentId === docId)
          .map((l, i) => ({
            link_type: l.linkType,
            amount: l.amount,
            booked_on: must(w.txs.find((t) => t.id === l.transactionId)).booked_on,
            created_at: `2026-03-20T10:00:${String(i).padStart(2, '0')}Z`,
          })),
      loadDocumentPaidView: async (_tx, _org, docId) => {
        const d = w.docs.find((x) => x.id === docId);
        return d
          ? {
              amount_due: d.amount_due,
              currency: d.currency,
              issue_date: d.issue_date,
              is_paid_per_document: null,
              paid_at: w.paidAt.get(docId) ?? null,
            }
          : null;
      },
      setPaidAt: async (_tx, _org, docId, paidAt) => {
        if ((w.paidAt.get(docId) ?? null) === paidAt) return false;
        w.paidAt.set(docId, paidAt);
        return true;
      },
    },
  };
  return { w, deps };
}
const run = (deps: BankMatchDeps, ids: string[]) =>
  runMatch(deps, ctx.tx, ORG, { transactionIds: ids });

describe('bank.match: single document', () => {
  it('VS + amount → link, matched, paid_at', async () => {
    const { w, deps } = world(
      [txRow({ id: 't1', variable_symbol: '2026001' })],
      [docRow({ id: 'd1', variable_symbol: '2026001', document_number: 'FV2026001' })],
    );
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({
      transactions: 1,
      links: 1,
      suggestions: 0,
      categorized: 0,
      paidAtChanged: ['d1'],
    });
    expect(w.links[0]).toEqual({
      transactionId: 't1',
      documentId: 'd1',
      linkType: 'payment',
      amount: '1210.00',
      amountAccountCurrency: '1210.00',
      matchMethod: 'vs_amount',
      confidence: '0.996',
      matcherVersion: 1,
    });
    expect(w.states.get('t1')).toEqual({ matchState: 'matched' });
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
    expect(w.changed).toEqual(['d1']);
    expect(w.suggestions.get('t1')).toEqual([]);
    const again = await run(deps, ['t1']);
    expect(again).toMatchObject({ transactions: 0, links: 0, suggestions: 0, paidAtChanged: [] });
    expect(w.links).toHaveLength(1);
  });
  it('partial payment with VS → partial state, paid_at stays null', async () => {
    const { w, deps } = world(
      [txRow({ id: 't1', amount: '-600.00', variable_symbol: '2026001' })],
      [docRow({ id: 'd1', variable_symbol: '2026001' })],
    );
    await run(deps, ['t1']);
    expect(w.links[0]).toMatchObject({ amount: '600.00', matchMethod: 'vs_only' });
    expect(w.states.get('t1')).toEqual({ matchState: 'matched' });
    expect(w.paidAt.has('d1')).toBe(false);
  });
  it('two documents of the same amount → two suggestions, no link', async () => {
    const { w, deps } = world([txRow({ id: 't1' })], [docRow({ id: 'd1' }), docRow({ id: 'd2' })]);
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 0, suggestions: 2 });
    expect(w.links).toEqual([]);
    expect(w.suggestions.get('t1')?.map((s) => [s.kind, s.documentIds[0], s.score])).toEqual([
      ['document', 'd1', '0.622'],
      ['document', 'd2', '0.622'],
    ]);
    expect(w.states.has('t1')).toBe(false);
  });
  it('document scope re-scores the lookback window', async () => {
    const { w, deps } = world(
      [txRow({ id: 't1', variable_symbol: '2026001' })],
      [docRow({ id: 'd1', variable_symbol: '2026001' })],
    );
    await createBankMatchDocumentHandler(deps)(
      { orgId: ORG, documentId: 'd1', trigger: 'run-1' },
      ctx,
    );
    expect(w.links).toHaveLength(1);
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
  });
  it('transactions handler accepts an import id', async () => {
    const { w, deps } = world(
      [txRow({ id: 't1', variable_symbol: '2026001' })],
      [docRow({ id: 'd1', variable_symbol: '2026001' })],
    );
    await createBankMatchTransactionsHandler(deps)(
      { orgId: ORG, statementImportId: 'eeeeeeee-0000-4000-8000-00000000e118' },
      ctx,
    );
    expect(w.links).toHaveLength(1);
  });
});

describe('bank.match: rules first', () => {
  it('bank fee needs no document', async () => {
    const { w, deps } = world(
      [txRow({ id: 't1', amount: '-59.00', message: 'Poplatek za vedení účtu' })],
      [docRow({ id: 'd1' })],
    );
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 0, suggestions: 0, categorized: 1 });
    expect(w.states.get('t1')).toEqual({
      matchState: 'no_document_needed',
      categoryCode: 'exp_bank_fees',
    });
    expect(w.suggestions.has('t1')).toBe(false);
  });
  it('FÚ prefix 705 is automatic, OSSZ by name is a suggestion that keeps document matching', async () => {
    const { w, deps } = world(
      [
        txRow({
          id: 'vat',
          amount: '-4200.00',
          counterparty_account: '705-1234567890',
          counterparty_bank_code: '0710',
        }),
        txRow({ id: 'soc', amount: '-5005.00', counterparty_name: 'OSSZ Praha 3' }),
      ],
      [docRow({ id: 'd1', amount_due: '5005.00', open_amount: '5005.00' })],
    );
    const r = await run(deps, ['vat', 'soc']);
    expect(r).toMatchObject({ categorized: 1 });
    expect(w.states.get('vat')).toEqual({
      matchState: 'no_document_needed',
      categoryCode: 'tax_vat_payment',
    });
    const soc = w.suggestions.get('soc') ?? [];
    expect(soc.map((s) => s.kind)).toEqual(['category', 'document']);
    expect(soc[0]).toMatchObject({ categoryCode: 'ins_social_own', score: '0.600' });
    expect(soc[1]).toMatchObject({ documentIds: ['d1'], score: '0.818' });
  });
  it('own transfer pairs both sides', async () => {
    const { w, deps } = world(
      [
        txRow({
          id: 't1',
          amount: '-5000.00',
          counterparty_account: '1003-1234567899',
          counterparty_bank_code: '0800',
        }),
        txRow({
          id: 't2',
          money_account_id: 'acc2',
          amount: '5000.00',
          booked_on: '2026-03-11',
          counterparty_account: '2400123455',
          counterparty_bank_code: '2010',
        }),
      ],
      [],
    );
    const r = await run(deps, ['t1', 't2']);
    expect(r).toMatchObject({ categorized: 2, links: 0 });
    expect(w.states.get('t1')).toEqual({
      matchState: 'no_document_needed',
      categoryCode: 'transfer_own_accounts',
      pairedTransactionId: 't2',
    });
    expect(w.states.get('t2')).toEqual({
      matchState: 'no_document_needed',
      categoryCode: 'transfer_own_accounts',
      pairedTransactionId: 't1',
    });
  });
  it('own transfer without its counterpart is a suggestion', async () => {
    const { w, deps } = world(
      [
        txRow({
          id: 't1',
          amount: '-5000.00',
          counterparty_account: '1003-1234567899',
          counterparty_bank_code: '0800',
        }),
      ],
      [],
    );
    await run(deps, ['t1']);
    expect(w.states.has('t1')).toBe(false);
    expect(w.suggestions.get('t1')).toEqual([
      expect.objectContaining({ kind: 'category', categoryCode: 'transfer_own_accounts' }),
    ]);
  });
});

describe('bank.match: multi-document', () => {
  const docs = () => [
    docRow({ id: 'd1', document_number: 'FV1' }),
    docRow({
      id: 'd2',
      document_number: 'FV2',
      amount_due: '500.00',
      open_amount: '500.00',
      due_date: '2026-03-19',
    }),
  ];
  const t = (message: string | null) =>
    txRow({
      id: 't1',
      amount: '-1710.00',
      counterparty_account: '2400123455',
      counterparty_bank_code: '2010',
      message,
    });
  it('known partner, unique subset, no document numbers → suggestion capped at 0.89', async () => {
    const { w, deps } = world([t(null)], docs());
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 0, suggestions: 1 });
    expect(w.suggestions.get('t1')).toEqual([
      expect.objectContaining({
        kind: 'multi_document',
        documentIds: ['d1', 'd2'],
        amounts: ['1210.00', '500.00'],
        score: '0.890',
      }),
    ]);
  });
  it('every document number in the message → two links, matched, both paid', async () => {
    const { w, deps } = world([t('Uhrada FV1 FV2')], docs());
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 2, suggestions: 0, paidAtChanged: ['d1', 'd2'] });
    expect(w.links.map((l) => [l.documentId, l.amount, l.confidence])).toEqual([
      ['d1', '1210.00', '0.998'],
      ['d2', '500.00', '0.998'],
    ]);
    expect(w.states.get('t1')).toEqual({ matchState: 'matched' });
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
    expect(w.paidAt.get('d2')).toBe('2026-03-10');
  });
});
