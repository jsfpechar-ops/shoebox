import {
  type AuthorityRules,
  assign,
  chooseSubset,
  classifyByRules,
  computePaidAt,
  type DocView,
  dateFactor,
  findOwnTransferPair,
  findSubsetSum,
  generateCandidates,
  isEligible,
  type LinkView,
  MATCHER_CONFIG,
  type MatchContext,
  messageHasDocKey,
  multiDocumentScore,
  type OwnAccount,
  scoreBatch,
  toHalere,
  type TxView,
  windowKindOf,
} from '@shoebox/bank';
import type {
  insertPaymentLinks,
  loadDocumentLinks,
  loadDocumentPaidView,
  loadMatchContextRows,
  loadOpenDocuments,
  loadOwnAccounts,
  loadTransactionsForMatch,
  MatchDocRow,
  MatchTxRow,
  PaymentLinkInsert,
  setDocumentPaidAt,
  setTransactionMatch,
  SuggestionInsert,
  syncOpenSuggestions,
  TenantTx,
} from '@shoebox/db';
import {
  type Clock,
  type DocumentClass,
  type DocumentStatus,
  type LegalDate,
  type LinkType,
  Money,
  parseLegalDate,
  pragueToday,
} from '@shoebox/domain';
import type { TenantHandler } from '../registry';

export interface BankMatchStore {
  readonly loadTransactions: typeof loadTransactionsForMatch;
  readonly loadDocuments: typeof loadOpenDocuments;
  readonly loadContext: typeof loadMatchContextRows;
  readonly loadOwnAccounts: typeof loadOwnAccounts;
  readonly insertLinks: typeof insertPaymentLinks;
  readonly syncSuggestions: typeof syncOpenSuggestions;
  readonly setTransaction: typeof setTransactionMatch;
  readonly loadDocumentLinks: typeof loadDocumentLinks;
  readonly loadDocumentPaidView: typeof loadDocumentPaidView;
  readonly setPaidAt: typeof setDocumentPaidAt;
}
export interface BankMatchDeps {
  readonly store: BankMatchStore;
  readonly rules: AuthorityRules;
  readonly clock: Clock;
  /** TODO(M07 §4.7.8): read fx_rates. Default: unknown rate (null). */
  readonly fxRate?: MatchContext['fxRate'];
  /** TODO(M07 §6.4): document.paid_at_changed event + ledger rebuild hang here. */
  readonly onPaidAtChanged?: (
    orgId: string,
    documentId: string,
    paidAt: string | null,
  ) => Promise<unknown>;
}
export type MatchScope =
  | { transactionIds: readonly string[] }
  | { statementImportId: string }
  | { documentId: string };
export interface MatchRunResult {
  readonly transactions: number;
  readonly links: number;
  readonly suggestions: number;
  readonly categorized: number;
  readonly paidAtChanged: readonly string[];
}

export function toTxView(row: MatchTxRow): TxView {
  const amount = Money.parse(row.amount, row.currency);
  const remaining = amount.abs().subtract(Money.parse(row.linked_account_amount, row.currency));
  return {
    id: row.id,
    moneyAccountId: row.money_account_id,
    bookedOn: parseLegalDate(row.booked_on),
    amount,
    currency: row.currency,
    ...(row.amount_original !== null && row.currency_original !== null
      ? { amountOriginal: Money.parse(row.amount_original, row.currency_original) }
      : {}),
    remaining,
    ...(row.counterparty_name !== null ? { counterpartyName: row.counterparty_name } : {}),
    ...(row.counterparty_account !== null ? { counterpartyAccount: row.counterparty_account } : {}),
    ...(row.counterparty_bank_code !== null
      ? { counterpartyBankCode: row.counterparty_bank_code }
      : {}),
    ...(row.counterparty_iban !== null ? { counterpartyIban: row.counterparty_iban } : {}),
    ...(row.variable_symbol !== null ? { vs: row.variable_symbol } : {}),
    ...(row.message !== null ? { message: row.message } : {}),
    ...(row.card_merchant !== null ? { cardMerchant: row.card_merchant } : {}),
  };
}

function accountsFromPayTo(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const v = value as { account?: unknown; bank_code?: unknown; iban?: unknown };
  const out: string[] = [];
  if (typeof v.account === 'string' && typeof v.bank_code === 'string') {
    out.push(`${v.account}/${v.bank_code}`);
  }
  if (typeof v.iban === 'string' && v.iban !== '') out.push(v.iban.toUpperCase());
  return out;
}

export function toDocView(row: MatchDocRow): DocView {
  return {
    id: row.id,
    cls: row.class as DocumentClass,
    status: row.status as DocumentStatus,
    direction: row.direction,
    currency: row.currency,
    amountDue: Money.parse(row.amount_due, row.currency),
    openAmount: Money.parse(row.open_amount, row.currency),
    ...(row.document_number !== null ? { documentNumber: row.document_number } : {}),
    ...(row.variable_symbol !== null ? { variableSymbol: row.variable_symbol } : {}),
    ...(row.issue_date !== null ? { issueDate: parseLegalDate(row.issue_date) } : {}),
    ...(row.due_date !== null ? { dueDate: parseLegalDate(row.due_date) } : {}),
    ...(row.service_period_to !== null
      ? { servicePeriodTo: parseLegalDate(row.service_period_to) }
      : {}),
    ...(row.payment_method !== null ? { paymentMethod: row.payment_method } : {}),
    ...(row.partner_id !== null ? { partnerId: row.partner_id } : {}),
    ...(row.partner_name !== null ? { partnerName: row.partner_name } : {}),
    partnerAccounts: [...row.partner_accounts, ...accountsFromPayTo(row.pay_to_account)],
    createdAt: row.created_at,
  };
}

const sumMoney = (items: readonly Money[], currency: string): Money =>
  items.reduce((acc, m) => acc.add(m), Money.zero(currency));

export async function runMatch(
  deps: BankMatchDeps,
  tx: TenantTx,
  orgId: string,
  scope: MatchScope,
): Promise<MatchRunResult> {
  const cfg = MATCHER_CONFIG;
  const store = deps.store;
  const today = pragueToday(deps.clock);
  const documentScope = 'documentId' in scope;

  // 1. Load.
  let txRows: MatchTxRow[];
  let docRows: MatchDocRow[];
  if ('documentId' in scope) {
    txRows = await store.loadTransactions(tx, orgId, {
      lookbackDays: cfg.sweepLookbackDays,
      today,
    });
    docRows = await store.loadDocuments(tx, orgId, { ids: [scope.documentId] });
  } else {
    txRows = await store.loadTransactions(
      tx,
      orgId,
      'transactionIds' in scope
        ? { ids: scope.transactionIds }
        : { statementImportId: scope.statementImportId },
    );
    docRows = await store.loadDocuments(tx, orgId, { all: true });
  }
  const contextRows = await store.loadContext(tx, orgId);
  const ownRows = documentScope ? [] : await store.loadOwnAccounts(tx, orgId);
  const ctx: MatchContext = {
    aliases: contextRows.aliases.map((a) => ({
      kind: a.kind as 'account' | 'merchant' | 'name',
      value: a.value_normalized,
      partnerId: a.partner_id,
      confirmations: a.confirmations,
    })),
    rejected: new Set(contextRows.rejected.map((r) => `${r.transaction_id}:${r.document_id}`)),
    knownAccounts: contextRows.known_accounts.map((k) => ({
      value: k.value,
      partnerId: k.partner_id,
    })),
    partnersWithVsHistory: new Set(contextRows.partners_with_vs_history),
    fxRate: deps.fxRate ?? (() => null),
  };
  const txs = txRows.map(toTxView).filter((t) => t.remaining?.isPositive() === true);
  const docs = docRows.map(toDocView);
  const pending = new Map<string, SuggestionInsert[]>();
  for (const t of txs) pending.set(t.id, []);
  const handled = new Set<string>();
  const auto = new Set<string>();
  let categorized = 0;

  const categorySuggestion = (
    t: TxView,
    categoryCode: string,
    reason: string,
  ): SuggestionInsert => ({
    transactionId: t.id,
    kind: 'category',
    documentIds: [],
    amounts: [],
    pairedTransactionId: null,
    categoryCode,
    score: '0.600',
    features: [{ code: 'rule', reason }],
    matcherVersion: cfg.version,
  });

  // 2. Rules (TODO(M07 §4.7.3) refunds, TODO(M07 §4.7.7) platform payouts and offsets,
  // TODO(M07 §4.7.9) card/cash evidence, TODO(M07 §4.7.8) fx_rates, TODO(M07 §4.7.4) government_filing link,
  // TODO(M07 §4.7.10) overpayment review question, TODO(M07 §6.4) events, TODO(M07 §6.3) nightly sweep).
  if (!documentScope) {
    const own: OwnAccount[] = ownRows.map((o) => ({
      id: o.id,
      ...(o.account_number !== null ? { account: o.account_number } : {}),
      ...(o.bank_code !== null ? { bankCode: o.bank_code } : {}),
      ...(o.iban !== null ? { iban: o.iban } : {}),
    }));
    for (const t of txs) {
      if (handled.has(t.id)) continue;
      const o = classifyByRules(t, deps.rules, own);
      if (o === null) continue;
      if (o.reason === 'own_transfer') {
        const pair =
          o.pairedAccountId === undefined
            ? null
            : findOwnTransferPair(
                t,
                o.pairedAccountId,
                txs.filter((c) => !handled.has(c.id)),
              );
        if (pair !== null) {
          await store.setTransaction(tx, orgId, t.id, {
            matchState: 'no_document_needed',
            categoryCode: 'transfer_own_accounts',
            pairedTransactionId: pair.id,
          });
          await store.setTransaction(tx, orgId, pair.id, {
            matchState: 'no_document_needed',
            categoryCode: 'transfer_own_accounts',
            pairedTransactionId: t.id,
          });
          for (const id of [t.id, pair.id]) {
            handled.add(id);
            auto.add(id);
          }
          categorized += 2;
        } else {
          pending.get(t.id)?.push(categorySuggestion(t, o.categoryCode, o.reason));
          handled.add(t.id);
        }
        continue;
      }
      if (o.mode === 'auto') {
        await store.setTransaction(tx, orgId, t.id, {
          matchState: 'no_document_needed',
          categoryCode: o.categoryCode,
        });
        handled.add(t.id);
        auto.add(t.id);
        categorized++;
      } else {
        pending.get(t.id)?.push(categorySuggestion(t, o.categoryCode, o.reason));
      }
    }
  }

  // 3. Single document.
  const linked = new Map<string, Money[]>();
  const linkedDocs: string[] = [];
  let linkCount = 0;
  const noteLink = (transactionId: string, documentId: string, amountAccount: Money): void => {
    linked.set(transactionId, [...(linked.get(transactionId) ?? []), amountAccount]);
    if (!linkedDocs.includes(documentId)) linkedDocs.push(documentId);
    linkCount++;
  };
  const open = txs.filter((t) => !handled.has(t.id));
  const cands = open.flatMap((t) => generateCandidates(t, docs, ctx, cfg));
  const scores = scoreBatch(cands, ctx, cfg);
  const { links, suggestions } = assign(scores, cfg, ctx.rejected);
  const inserts: PaymentLinkInsert[] = links.map((l) => ({
    transactionId: l.transactionId,
    documentId: l.documentId,
    linkType: 'payment',
    amount: l.amountDoc.toFixed2(),
    amountAccountCurrency: l.amountAccount.toFixed2(),
    matchMethod: l.matchMethod,
    confidence: l.confidence.toFixed(3),
    matcherVersion: cfg.version,
  }));
  if (inserts.length > 0) await store.insertLinks(tx, orgId, inserts);
  for (const l of links) noteLink(l.transactionId, l.documentId, l.amountAccount);
  for (const s of suggestions) {
    pending.get(s.transactionId)?.push({
      transactionId: s.transactionId,
      kind: 'document',
      documentIds: s.documentIds,
      amounts: s.amounts.map((m) => m.toFixed2()),
      pairedTransactionId: null,
      categoryCode: null,
      score: s.score.toFixed(3),
      features: s.features,
      matcherVersion: cfg.version,
    });
  }

  // 4. Multi-document subset sum (TODO(M07 §4.7.2) rounding residual: links carry the exact open amounts).
  for (const t of open) {
    if (linked.has(t.id)) continue;
    const txAccount =
      t.counterpartyAccount && t.counterpartyBankCode
        ? `${t.counterpartyAccount}/${t.counterpartyBankCode}`
        : undefined;
    const txIban = t.counterpartyIban?.toUpperCase();
    const keys = [txAccount, txIban].filter((v): v is string => v !== undefined);
    const partnerId =
      ctx.knownAccounts.find((k) => keys.includes(k.value))?.partnerId ??
      ctx.aliases.find((a) => a.kind === 'account' && keys.includes(a.value))?.partnerId;
    if (partnerId === undefined) continue;
    const items = docs
      .filter(
        (d) =>
          d.partnerId === partnerId && isEligible(t, d) && d.currency === t.currency,
      )
      .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
      .slice(0, cfg.subsetSum.maxDocs);
    const subsets = findSubsetSum(
      toHalere(t.remaining ?? t.amount.abs()),
      items.map((d) => ({ id: d.id, halere: toHalere(d.openAmount) })),
      toHalere(Money.parse(cfg.roundingToleranceCzk, t.currency)),
      cfg.subsetSum.maxSubsetSize,
    ).filter((s) => s.length >= 2);
    const dueById: Record<string, LegalDate | undefined> = {};
    for (const d of items) dueById[d.id] = d.dueDate;
    const chosen = chooseSubset(subsets, dueById);
    if (chosen === null) continue;
    const chosenDocs = chosen.ids
      .map((id) => items.find((d) => d.id === id))
      .filter((d): d is DocView => d !== undefined);
    const meanDateFactor =
      chosenDocs.reduce((s, d) => s + dateFactor(windowKindOf(t, d), t.bookedOn, d, cfg).f, 0) /
      chosenDocs.length;
    const messageHasAll = chosenDocs.every((d) => messageHasDocKey(t.message, d));
    const score = multiDocumentScore(
      { account: true, alias: false, nameSim: 0, meanDateFactor, unique: chosen.unique, messageHasAll },
      cfg,
    );
    if (score >= cfg.autoThreshold) {
      const rows: PaymentLinkInsert[] = chosenDocs.map((d) => ({
        transactionId: t.id,
        documentId: d.id,
        linkType: 'payment',
        amount: d.openAmount.toFixed2(),
        amountAccountCurrency: d.openAmount.toFixed2(),
        matchMethod: 'amount_date_counterparty',
        confidence: score.toFixed(3),
        matcherVersion: cfg.version,
      }));
      await store.insertLinks(tx, orgId, rows);
      for (const d of chosenDocs) noteLink(t.id, d.id, d.openAmount);
    } else if (score >= cfg.suggestThreshold) {
      pending.get(t.id)?.push({
        transactionId: t.id,
        kind: 'multi_document',
        documentIds: chosenDocs.map((d) => d.id),
        amounts: chosenDocs.map((d) => d.openAmount.toFixed2()),
        pairedTransactionId: null,
        categoryCode: null,
        score: score.toFixed(3),
        features: [{ code: 'multi_document', unique: chosen.unique }],
        matcherVersion: cfg.version,
      });
    }
  }

  // 5. States and suggestions.
  for (const t of txs) {
    const amounts = linked.get(t.id);
    if (amounts !== undefined) {
      const after = (t.remaining ?? t.amount.abs()).subtract(sumMoney(amounts, t.currency));
      await store.setTransaction(tx, orgId, t.id, {
        matchState: after.isPositive() ? 'partial' : 'matched',
      });
    }
  }
  let suggestionCount = 0;
  for (const t of txs) {
    if (auto.has(t.id)) continue;
    const rows = pending.get(t.id) ?? [];
    await store.syncSuggestions(tx, orgId, t.id, rows);
    suggestionCount += rows.length;
  }

  // 6. paid_at.
  const paidAtChanged: string[] = [];
  for (const id of linkedDocs) {
    const view = await store.loadDocumentPaidView(tx, orgId, id);
    if (view === null) continue;
    const rows = await store.loadDocumentLinks(tx, orgId, id);
    const linkViews: LinkView[] = rows.map((r) => ({
      linkType: r.link_type as LinkType,
      amount: Money.parse(r.amount, view.currency),
      bookedOn: parseLegalDate(r.booked_on),
      createdAt: r.created_at,
    }));
    const paidAt = computePaidAt(
      {
        amountDue: Money.parse(view.amount_due ?? '0', view.currency),
        currency: view.currency,
        ...(view.issue_date !== null ? { issueDate: parseLegalDate(view.issue_date) } : {}),
        ...(view.is_paid_per_document !== null
          ? { isPaidPerDocument: view.is_paid_per_document }
          : {}),
      },
      linkViews,
      cfg,
    );
    const changed = await store.setPaidAt(tx, orgId, id, paidAt);
    if (changed) {
      paidAtChanged.push(id);
      await deps.onPaidAtChanged?.(orgId, id, paidAt);
    }
  }

  // 7.
  return {
    transactions: txs.length,
    links: linkCount,
    suggestions: suggestionCount,
    categorized,
    paidAtChanged,
  };
}

export function createBankMatchTransactionsHandler(
  deps: BankMatchDeps,
): TenantHandler<{ orgId: string; transactionIds?: string[]; statementImportId?: string }> {
  return async (payload, ctx) => {
    if (payload.statementImportId === undefined && payload.transactionIds === undefined) return;
    await runMatch(
      deps,
      ctx.tx,
      payload.orgId,
      payload.statementImportId !== undefined
        ? { statementImportId: payload.statementImportId }
        : { transactionIds: payload.transactionIds ?? [] },
    );
  };
}

export function createBankMatchDocumentHandler(
  deps: BankMatchDeps,
): TenantHandler<{ orgId: string; documentId: string; trigger: string }> {
  return async (payload, ctx) => {
    await runMatch(deps, ctx.tx, payload.orgId, { documentId: payload.documentId });
  };
}
