# 0118: Worker jobs `bank.match.transactions` and `bank.match.document`

Status: todo
Ticket: P2-MATCH-04 | Depends on: 0112, 0116, 0117 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Sonnet 5.5 (reason: money matching; wires four existing files) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

After every statement import, and whenever a document becomes `ready`, the worker runs the matcher: it categorises transactions that need no document, links bank payments to documents, stores suggestions for the user, and sets `documents.paid_at`. The user sees paid documents without touching anything; everything the matcher decides is explainable and re-runnable (I4).

## 2. Context

M07 §4.6.1 pass order (reversals are handled on import, 0111): own transfers (§4.7.6) → rule categorisation (§4.7.4–§4.7.5) → single-document matching (0115 candidates/score, 0116 assign) → multi-document subset sum (§4.7.2) → `paid_at` (§4.7.10). Triggers: `bank.match.transactions` after every import; `bank.match.document` when a document becomes `ready` (re-scores the unmatched transactions of the last `sweepLookbackDays`). Idempotency key per ADR-003 is the registry's `{org}:{job}:{entityId}:{version}`.

Skipped here, each left as a `TODO(M07 §x)` comment in the handler: §4.7.3 refunds, §4.7.7 platform payouts and offsets, §4.7.9 card/cash evidence, FX rates from `fx_rates` (the `fxRate` dependency defaults to "unknown", so foreign-currency documents match only on `amount_original`), the `government_filing` link for tax payments, the review question `overpayment`, events (`bank.link_created`, `document.paid_at_changed`, `bank.authority_payment_recognised`) and the ledger rebuild on `paid_at` change (`onPaidAtChanged` hook is provided, nothing is wired to it yet), the nightly sweep, alias learning on user confirmation (0119/P2-MATCH-05).

From `@shoebox/bank` (0115, 0116): `MATCHER_CONFIG`, types `TxView`, `DocView`, `MatchContext`, `AliasView`, `Candidate`, `CandidateScore`, `AuthorityRules`, `OwnAccount`, `LinkView`; functions `generateCandidates`, `scoreBatch`, `assign`, `isEligible`, `dateFactor`, `windowKindOf`, `messageHasDocKey`, `toHalere`, `findSubsetSum`, `chooseSubset`, `multiDocumentScore`, `computePaidAt`, `classifyByRules`, `findOwnTransferPair`, `authorityRulesOf`.
From `@shoebox/db` (0117): `loadTransactionsForMatch`, `loadOpenDocuments`, `loadMatchContextRows`, `loadOwnAccounts`, `insertPaymentLinks`, `syncOpenSuggestions`, `setTransactionMatch`, `loadDocumentLinks`, `loadDocumentPaidView`, `setDocumentPaidAt` and their row types `MatchTxRow`, `MatchDocRow`, `PaymentLinkInsert`, `SuggestionInsert`, `TenantTx`.
From `@shoebox/domain`: `Money`, `parseLegalDate`, `pragueToday(clock)`, `createCzRules()`, types `Clock`, `DocumentClass`, `DocumentStatus`, `LinkType`.

`packages/pipeline/src/jobs.ts` excerpts (job names of the `bank.*` family need no `JOB_NAMES` entry: `isJobName` accepts them, so `jobs.test.ts` stays untouched):
```ts
export const bankImportStatementJob = defineTenantJob({
  name: 'bank.import.statement',
  payload: tenantPayload({ sourceFileId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.sourceFileId,
});
```
`createHash` is already imported there; `tenantPayload(shape)` returns `z.strictObject({ orgId: z.uuid(), ...shape })`.

`apps/worker/src/registry.ts`: `TenantHandler<P> = (payload: P, ctx: TenantJobContext) => Promise<void>`, `ctx.tx: TenantTx`; `JobRegistry.enqueue(def, payload, options?)`; `registerTenant(def, handler)`. Test context: `const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };`.

`apps/worker/src/doc-extract/handler.ts` excerpts:
```ts
  readonly store?: ReadingStore; // default dbReadingStore
```
```ts
      await store.save(ctx.tx, write);
```
(`store.save` returns the extraction run id, a uuid; `write.status` is `'ready' | 'needs_review' | 'supporting'`; `write.orgId`, `write.documentId`.)
`apps/worker/src/doc-extract/register.ts` excerpts: `  registry: Pick<JobRegistry, 'registerTenant'>,` and `      clock: { now: () => Date.now() },`.
`apps/worker/src/main.ts` excerpts: `import { registerDocSplit } from './doc-split/register';` and `    registerDocSplit(registry, process.env, logger);`.
`apps/worker/src/bank-import/handler.ts` (0112) exports `BankImportDeps` (`blobs`, `store`) and `createBankImportHandler(deps)`; its flow ends with the awaited `insertTransactions(...)` call that returns `{ inserted, duplicates, orphanReversals }`. `apps/worker/src/bank-import/register.ts` has `registry: Pick<JobRegistry, 'registerTenant'>,` and the `createBankImportHandler({ ... })` call. If `apps/worker/src/bank-import/` does not exist, 0112 has not landed: STOP (§8).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | two job definitions |
| `apps/worker/src/bank-match/handler.ts` | new | `runMatch` and the two handlers |
| `apps/worker/src/bank-match/register.ts` | new | registration |
| `apps/worker/src/main.ts` | edit | import + call |
| `apps/worker/src/bank-import/handler.ts` | edit | `enqueueMatch` after an import |
| `apps/worker/src/bank-import/register.ts` | edit | wire `enqueueMatch` |
| `apps/worker/src/doc-extract/handler.ts` | edit | `enqueueMatch` when a document becomes `ready` |
| `apps/worker/src/doc-extract/register.ts` | edit | wire `enqueueMatch` |
| `apps/worker/test/bank-match.test.ts` | new | verbatim below |

No other file may change. (0112 also names `packages/pipeline/src/jobs.ts`, `apps/worker/src/main.ts` and the two `bank-import` files: 0112 goes first.)

## 4. Steps

1. In `packages/pipeline/src/jobs.ts`, directly below the `bankImportStatementJob` definition (after its `});`), add:
```ts
/** M07 §6.2: match the transactions of one import (or an explicit batch). Enqueued after bank.import.statement. */
export const bankMatchTransactionsJob = defineTenantJob({
  name: 'bank.match.transactions',
  payload: tenantPayload({
    transactionIds: z.array(z.uuid()).min(1).max(5000).optional(),
    statementImportId: z.uuid().optional(),
  }).refine((p) => p.transactionIds !== undefined || p.statementImportId !== undefined, {
    message: 'transactionIds or statementImportId is required',
  }),
  version: 1,
  entityId: (p) =>
    p.statementImportId ??
    createHash('sha256').update([...(p.transactionIds ?? [])].sort().join(',')).digest('hex').slice(0, 32),
});

/** M07 §6.2: re-score the unmatched transactions of the lookback window for one document that became ready. `trigger` = the extraction run id. */
export const bankMatchDocumentJob = defineTenantJob({
  name: 'bank.match.document',
  payload: tenantPayload({ documentId: z.uuid(), trigger: z.string().min(1).max(64) }),
  version: 1,
  entityId: (p) => `${p.documentId}:${p.trigger}`,
});
```
Run `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -10` and `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -10`. Commit `0118 step 1`.

2. New `apps/worker/src/bank-match/handler.ts` with exactly these exports:
```ts
import type { AuthorityRules, DocView, MatchContext, TxView } from '@shoebox/bank';
import type { Clock } from '@shoebox/domain';
import type {
  insertPaymentLinks, loadDocumentLinks, loadDocumentPaidView, loadMatchContextRows, loadOpenDocuments, loadOwnAccounts,
  loadTransactionsForMatch, MatchDocRow, MatchTxRow, setDocumentPaidAt, setTransactionMatch, syncOpenSuggestions, TenantTx,
} from '@shoebox/db';
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
  readonly onPaidAtChanged?: (orgId: string, documentId: string, paidAt: string | null) => Promise<unknown>;
}
export type MatchScope = { transactionIds: readonly string[] } | { statementImportId: string } | { documentId: string };
export interface MatchRunResult {
  readonly transactions: number; readonly links: number; readonly suggestions: number; readonly categorized: number;
  readonly paidAtChanged: readonly string[];
}
export function toTxView(row: MatchTxRow): TxView;
export function toDocView(row: MatchDocRow): DocView;
export async function runMatch(deps: BankMatchDeps, tx: TenantTx, orgId: string, scope: MatchScope): Promise<MatchRunResult>;
export function createBankMatchTransactionsHandler(deps: BankMatchDeps): TenantHandler<{ orgId: string; transactionIds?: string[]; statementImportId?: string }>;
export function createBankMatchDocumentHandler(deps: BankMatchDeps): TenantHandler<{ orgId: string; documentId: string; trigger: string }>;
```
`toTxView`: `amount = Money.parse(row.amount, row.currency)`; `amountOriginal` when both columns set; `remaining = amount.abs().subtract(Money.parse(row.linked_account_amount, row.currency))`; nulls → `undefined`; `bookedOn = parseLegalDate(row.booked_on)`. `toDocView`: `cls = row.class as DocumentClass`, `status as DocumentStatus`, `amountDue`/`openAmount` parsed with `row.currency`, dates parsed when not null, `partnerAccounts = [...row.partner_accounts, ...fromPayTo]` where `fromPayTo` reads `pay_to_account` as `{ account?, bank_code?, iban? }` and yields `\`${account}/${bank_code}\`` when both and the upper-cased `iban` when set.
`runMatch`, `cfg = MATCHER_CONFIG`, `today = pragueToday(deps.clock)`:
1. Load: `documentId` scope → `loadTransactions(tx, orgId, { lookbackDays: cfg.sweepLookbackDays, today })` and `loadDocuments(tx, orgId, { ids: [documentId] })`; otherwise `loadTransactions` with `{ ids }` or `{ statementImportId }` and `loadDocuments({ all: true })`. `loadContext`; `loadOwnAccounts` (not in the `documentId` scope). Build `ctx: MatchContext` (`aliases` from `kind/value_normalized/partner_id/confirmations`, `rejected` as `` `${transaction_id}:${document_id}` ``, `knownAccounts` from `known_accounts`, `partnersWithVsHistory`, `fxRate = deps.fxRate ?? (() => null)`). `txs = rows.map(toTxView)` (keep only `remaining` positive), `docs = rows.map(toDocView)`. `pending = new Map<string, SuggestionInsert[]>()` with an empty array for every tx; `handled = new Set<string>()`.
2. Rules (skipped in the `documentId` scope), per tx in order: `o = classifyByRules(t, deps.rules, own)` where `own` maps `OwnAccountRow` to `{ id, account: account_number ?? undefined, bankCode: bank_code ?? undefined, iban: iban ?? undefined }`. `o === null` → next. `reason === 'own_transfer'`: `pair = findOwnTransferPair(t, o.pairedAccountId, txs)`; found → `setTransaction` both (`no_document_needed`, `categoryCode: 'transfer_own_accounts'`, `pairedTransactionId` crosswise), both handled, `categorized += 2`; not found → push a suggestion `{ kind: 'category', documentIds: [], amounts: [], pairedTransactionId: null, categoryCode: o.categoryCode, score: '0.600', features: [{ code: 'rule', reason: o.reason }], matcherVersion: cfg.version }` and mark handled. `mode === 'auto'` → `setTransaction(t.id, { matchState: 'no_document_needed', categoryCode: o.categoryCode })`, handled, `categorized++`. `mode === 'suggest'` → push the same suggestion shape (not handled: document matching continues).
3. Single document: `cands = txs.filter(not handled).flatMap(t => generateCandidates(t, docs, ctx, cfg))`; `scores = scoreBatch(cands, ctx, cfg)`; `{ links, suggestions } = assign(scores, cfg, ctx.rejected)`. Insert links (`amount: amountDoc.toFixed2()`, `amountAccountCurrency: amountAccount.toFixed2()`, `matchMethod`, `confidence: confidence.toFixed(3)`, `matcherVersion: cfg.version`, `linkType: 'payment'`); push each suggestion to `pending` (`documentIds`, `amounts` as `toFixed2()`, `score.toFixed(3)`, `features`).
4. Multi-document, per tx not handled and without a link from step 3: resolve `partnerId` from `ctx.knownAccounts` or an `account` alias matching `txAccount`/`txIban` (as in candidates (d)); none → next. `items` = docs with that `partnerId`, `isEligible(t, d)`, `d.currency === t.currency`, sorted by `dueDate` asc (undefined last), first `cfg.subsetSum.maxDocs`; `subsets = findSubsetSum(toHalere(t.remaining ?? t.amount.abs()), items.map(d => ({ id: d.id, halere: toHalere(d.openAmount) })), toHalere(Money.parse(cfg.roundingToleranceCzk, t.currency)), cfg.subsetSum.maxSubsetSize).filter(s => s.length >= 2)`; `chosen = chooseSubset(subsets, dueById)`; null → next. `meanDateFactor` = mean of `dateFactor(windowKindOf(t, d), t.bookedOn, d, cfg).f` over the chosen docs; `messageHasAll` = every chosen doc has `messageHasDocKey(t.message, d)`; `score = multiDocumentScore({ account: true, alias: false, nameSim: 0, meanDateFactor, unique: chosen.unique, messageHasAll }, cfg)`. `score ≥ cfg.autoThreshold` → one link per chosen doc (`amountDoc = amountAccount = d.openAmount`, `matchMethod 'amount_date_counterparty'`, `confidence score`); `score ≥ cfg.suggestThreshold` → suggestion `kind 'multi_document'` with the chosen ids and open amounts. (The rounding residual of §4.7.2 step 4 is a `TODO`: links carry the exact open amounts.)
5. States: for each tx with new links, `after = remaining − Σ amountAccount`; `setTransaction(t.id, { matchState: after.isPositive() ? 'partial' : 'matched' })`. For every tx that did not get `setTransaction(..., 'no_document_needed')` in step 2 (keep an `auto` set there): `syncSuggestions(tx, orgId, t.id, pending.get(t.id))` (an empty list supersedes stale open ones; identical rows stay, I4). Count `suggestions` as the total number of pending rows synced.
6. `paid_at` for each document that got a link: `view = loadDocumentPaidView`; `links = loadDocumentLinks` mapped to `LinkView` (`amount` parsed with `view.currency`, `bookedOn` parsed, `linkType as LinkType`); `paidAt = computePaidAt({ amountDue: Money.parse(view.amount_due ?? '0', view.currency), currency: view.currency, issueDate: parsed or undefined, isPaidPerDocument: view.is_paid_per_document ?? undefined }, links, cfg)`; `changed = setPaidAt(...)`; when changed, collect the id and `await deps.onPaidAtChanged?.(orgId, id, paidAt)`.
7. Return `{ transactions: txs.length, links, suggestions, categorized, paidAtChanged }`.
Handlers: transactions → `runMatch(deps, ctx.tx, orgId, statementImportId ? { statementImportId } : { transactionIds: transactionIds ?? [] })` (return at once when both are missing); document → `runMatch(deps, ctx.tx, orgId, { documentId })`.
Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -10`. Commit `0118 step 2`.

3. New `apps/worker/test/bank-match.test.ts`, verbatim:
```ts
import { authorityRulesOf } from '@shoebox/bank';
import type { MatchDocRow, MatchTxRow, PaymentLinkInsert, SuggestionInsert, TenantTx } from '@shoebox/db';
import { CZK, Money } from '@shoebox/domain';
import { describe, expect, it } from 'vitest';
import { type BankMatchDeps, createBankMatchDocumentHandler, createBankMatchTransactionsHandler, runMatch } from '../src/bank-match/handler';

const ORG = 'eeeeeeee-0000-4000-8000-000000000118';
const ctx = { tx: {} as TenantTx, jobId: 'j', attempt: 1, signal: new AbortController().signal };
const rules = authorityRulesOf({
  fu: { bank_code: '0710', prefix_map: { '705': 'tax_vat_payment' }, vat_refund_category: 'income_vat_refund' },
  name_hints: { OSSZ: 'ins_social_own' },
});
const clock = { now: () => Date.parse('2026-03-20T10:00:00Z') };

function txRow(over: Partial<MatchTxRow> & { id: string }): MatchTxRow {
  return {
    money_account_id: 'acc', booked_on: '2026-03-10', amount: '-1210.00', currency: 'CZK', amount_original: null, currency_original: null,
    counterparty_name: null, counterparty_account: null, counterparty_bank_code: null, counterparty_iban: null, variable_symbol: null,
    message: null, card_merchant: null, match_state: 'unmatched', linked_account_amount: '0', ...over,
  };
}
function docRow(over: Partial<MatchDocRow> & { id: string }): MatchDocRow {
  return {
    class: 'received_invoice', status: 'ready', direction: 'in', currency: 'CZK', amount_due: '1210.00', open_amount: '1210.00',
    document_number: null, variable_symbol: null, issue_date: '2026-03-01', due_date: '2026-03-15', service_period_to: null,
    payment_method: null, partner_id: 'p1', partner_name: 'Alfa Servis s.r.o.', pay_to_account: null,
    partner_accounts: ['2400123455/2010'], created_at: '2026-03-01T10:00:00Z', ...over,
  };
}
type State = { matchState: string; categoryCode?: string | null; pairedTransactionId?: string | null };
interface World {
  readonly txs: MatchTxRow[]; readonly docs: MatchDocRow[]; readonly links: PaymentLinkInsert[];
  readonly suggestions: Map<string, SuggestionInsert[]>; readonly states: Map<string, State>; readonly paidAt: Map<string, string | null>;
  readonly changed: string[];
}
const DONE = new Set(['matched', 'no_document_needed', 'ignored']);
const sumLinks = (w: World, pick: (l: PaymentLinkInsert) => boolean, field: 'amount' | 'amountAccountCurrency') =>
  Money.sum(w.links.filter(pick).map((l) => Money.parse(l[field], CZK)), CZK);

function world(txs: MatchTxRow[], docs: MatchDocRow[]): { w: World; deps: BankMatchDeps } {
  const w: World = { txs, docs, links: [], suggestions: new Map(), states: new Map(), paidAt: new Map(), changed: [] };
  let n = 0;
  const deps: BankMatchDeps = {
    rules, clock,
    onPaidAtChanged: async (_org, id) => { w.changed.push(id); },
    store: {
      loadTransactions: async (_tx, _org, scope) =>
        w.txs
          .filter((t) => !('ids' in scope) || scope.ids.includes(t.id))
          .filter((t) => !DONE.has(w.states.get(t.id)?.matchState ?? t.match_state))
          .map((t) => ({ ...t, linked_account_amount: sumLinks(w, (l) => l.transactionId === t.id, 'amountAccountCurrency').toFixed2() })),
      loadDocuments: async (_tx, _org, scope) =>
        w.docs
          .filter((d) => !('ids' in scope) || scope.ids.includes(d.id))
          .map((d) => ({ ...d, open_amount: Money.parse(d.amount_due, CZK).subtract(sumLinks(w, (l) => l.documentId === d.id, 'amount')).toFixed2() }))
          .filter((d) => Money.parse(d.open_amount, CZK).isPositive()),
      loadContext: async () => ({ aliases: [], known_accounts: [{ value: '2400123455/2010', partner_id: 'p1' }], rejected: [], partners_with_vs_history: [] }),
      loadOwnAccounts: async () => [
        { id: 'acc', type: 'bank', account_number: '2400123455', bank_code: '2010', iban: null, is_business: true },
        { id: 'acc2', type: 'bank', account_number: '1003-1234567899', bank_code: '0800', iban: null, is_business: true },
      ],
      insertLinks: async (_tx, _org, rows) => rows.map((r) => { w.links.push(r); return `l${++n}`; }),
      syncSuggestions: async (_tx, _org, txId, rows) => { w.suggestions.set(txId, [...rows]); return { inserted: rows.length, superseded: 0 }; },
      setTransaction: async (_tx, _org, txId, patch) => { w.states.set(txId, patch); },
      loadDocumentLinks: async (_tx, _org, docId) =>
        w.links.filter((l) => l.documentId === docId).map((l, i) => ({
          link_type: l.linkType, amount: l.amount, booked_on: w.txs.find((t) => t.id === l.transactionId)!.booked_on, created_at: `2026-03-20T10:00:${String(i).padStart(2, '0')}Z`,
        })),
      loadDocumentPaidView: async (_tx, _org, docId) => {
        const d = w.docs.find((x) => x.id === docId);
        return d ? { amount_due: d.amount_due, currency: d.currency, issue_date: d.issue_date, is_paid_per_document: null, paid_at: w.paidAt.get(docId) ?? null } : null;
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
const run = (deps: BankMatchDeps, ids: string[]) => runMatch(deps, ctx.tx, ORG, { transactionIds: ids });

describe('bank.match: single document', () => {
  it('VS + amount → link, matched, paid_at', async () => {
    const { w, deps } = world([txRow({ id: 't1', variable_symbol: '2026001' })], [docRow({ id: 'd1', variable_symbol: '2026001', document_number: 'FV2026001' })]);
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ transactions: 1, links: 1, suggestions: 0, categorized: 0, paidAtChanged: ['d1'] });
    expect(w.links[0]).toEqual({ transactionId: 't1', documentId: 'd1', linkType: 'payment', amount: '1210.00', amountAccountCurrency: '1210.00', matchMethod: 'vs_amount', confidence: '0.989', matcherVersion: 1 });
    expect(w.states.get('t1')).toEqual({ matchState: 'matched' });
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
    expect(w.changed).toEqual(['d1']);
    expect(w.suggestions.get('t1')).toEqual([]);
    const again = await run(deps, ['t1']);
    expect(again).toMatchObject({ transactions: 0, links: 0, suggestions: 0, paidAtChanged: [] });
    expect(w.links).toHaveLength(1);
  });
  it('partial payment with VS → partial state, paid_at stays null', async () => {
    const { w, deps } = world([txRow({ id: 't1', amount: '-600.00', variable_symbol: '2026001' })], [docRow({ id: 'd1', variable_symbol: '2026001' })]);
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
    expect(w.suggestions.get('t1')?.map((s) => [s.kind, s.documentIds[0], s.score])).toEqual([['document', 'd1', '0.622'], ['document', 'd2', '0.622']]);
    expect(w.states.has('t1')).toBe(false);
  });
  it('document scope re-scores the lookback window', async () => {
    const { w, deps } = world([txRow({ id: 't1', variable_symbol: '2026001' })], [docRow({ id: 'd1', variable_symbol: '2026001' })]);
    await createBankMatchDocumentHandler(deps)({ orgId: ORG, documentId: 'd1', trigger: 'run-1' }, ctx);
    expect(w.links).toHaveLength(1);
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
  });
  it('transactions handler accepts an import id', async () => {
    const { w, deps } = world([txRow({ id: 't1', variable_symbol: '2026001' })], [docRow({ id: 'd1', variable_symbol: '2026001' })]);
    await createBankMatchTransactionsHandler(deps)({ orgId: ORG, statementImportId: 'eeeeeeee-0000-4000-8000-00000000e118' }, ctx);
    expect(w.links).toHaveLength(1);
  });
});

describe('bank.match: rules first', () => {
  it('bank fee needs no document', async () => {
    const { w, deps } = world([txRow({ id: 't1', amount: '-59.00', message: 'Poplatek za vedení účtu' })], [docRow({ id: 'd1' })]);
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 0, suggestions: 0, categorized: 1 });
    expect(w.states.get('t1')).toEqual({ matchState: 'no_document_needed', categoryCode: 'exp_bank_fees' });
    expect(w.suggestions.has('t1')).toBe(false);
  });
  it('FÚ prefix 705 is automatic, OSSZ by name is a suggestion that keeps document matching', async () => {
    const { w, deps } = world(
      [
        txRow({ id: 'vat', amount: '-4200.00', counterparty_account: '705-1234567890', counterparty_bank_code: '0710' }),
        txRow({ id: 'soc', amount: '-5005.00', counterparty_name: 'OSSZ Praha 3' }),
      ],
      [docRow({ id: 'd1', amount_due: '5005.00', open_amount: '5005.00' })],
    );
    const r = await run(deps, ['vat', 'soc']);
    expect(r).toMatchObject({ categorized: 1 });
    expect(w.states.get('vat')).toEqual({ matchState: 'no_document_needed', categoryCode: 'tax_vat_payment' });
    const soc = w.suggestions.get('soc') ?? [];
    expect(soc.map((s) => s.kind)).toEqual(['category', 'document']);
    expect(soc[0]).toMatchObject({ categoryCode: 'ins_social_own', score: '0.600' });
    expect(soc[1]).toMatchObject({ documentIds: ['d1'], score: '0.818' });
  });
  it('own transfer pairs both sides', async () => {
    const { w, deps } = world(
      [
        txRow({ id: 't1', amount: '-5000.00', counterparty_account: '1003-1234567899', counterparty_bank_code: '0800' }),
        txRow({ id: 't2', money_account_id: 'acc2', amount: '5000.00', booked_on: '2026-03-11', counterparty_account: '2400123455', counterparty_bank_code: '2010' }),
      ],
      [],
    );
    const r = await run(deps, ['t1', 't2']);
    expect(r).toMatchObject({ categorized: 2, links: 0 });
    expect(w.states.get('t1')).toEqual({ matchState: 'no_document_needed', categoryCode: 'transfer_own_accounts', pairedTransactionId: 't2' });
    expect(w.states.get('t2')).toEqual({ matchState: 'no_document_needed', categoryCode: 'transfer_own_accounts', pairedTransactionId: 't1' });
  });
  it('own transfer without its counterpart is a suggestion', async () => {
    const { w, deps } = world([txRow({ id: 't1', amount: '-5000.00', counterparty_account: '1003-1234567899', counterparty_bank_code: '0800' })], []);
    await run(deps, ['t1']);
    expect(w.states.has('t1')).toBe(false);
    expect(w.suggestions.get('t1')).toEqual([expect.objectContaining({ kind: 'category', categoryCode: 'transfer_own_accounts' })]);
  });
});

describe('bank.match: multi-document', () => {
  const docs = () => [
    docRow({ id: 'd1', document_number: 'FV1' }),
    docRow({ id: 'd2', document_number: 'FV2', amount_due: '500.00', open_amount: '500.00', due_date: '2026-03-19' }),
  ];
  const t = (message: string | null) =>
    txRow({ id: 't1', amount: '-1710.00', counterparty_account: '2400123455', counterparty_bank_code: '2010', message });
  it('known partner, unique subset, no document numbers → suggestion capped at 0.89', async () => {
    const { w, deps } = world([t(null)], docs());
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 0, suggestions: 1 });
    expect(w.suggestions.get('t1')).toEqual([expect.objectContaining({ kind: 'multi_document', documentIds: ['d1', 'd2'], amounts: ['1210.00', '500.00'], score: '0.890' })]);
  });
  it('every document number in the message → two links, matched, both paid', async () => {
    const { w, deps } = world([t('Uhrada FV1 FV2')], docs());
    const r = await run(deps, ['t1']);
    expect(r).toMatchObject({ links: 2, suggestions: 0, paidAtChanged: ['d1', 'd2'] });
    expect(w.links.map((l) => [l.documentId, l.amount, l.confidence])).toEqual([['d1', '1210.00', '0.998'], ['d2', '500.00', '0.998']]);
    expect(w.states.get('t1')).toEqual({ matchState: 'matched' });
    expect(w.paidAt.get('d1')).toBe('2026-03-10');
    expect(w.paidAt.get('d2')).toBe('2026-03-10');
  });
});
```
Run `pnpm --filter @shoebox/worker test -- bank-match 2>&1 | tail -30` → pass. Commit `0118 step 3`.

4. New `apps/worker/src/bank-match/register.ts`:
```ts
export function registerBankMatch(registry: Pick<JobRegistry, 'registerTenant'>, env: Readonly<Record<string, string | undefined>>, logger: Pick<Logger, 'info' | 'warn'>): boolean;
```
No env is required. `clock = { now: () => Date.now() }`; `rules = authorityRulesOf(createCzRules().at(pragueToday(clock)).get('bank.authority_accounts') as Record<string, unknown>)` (resolved once at start; a `TODO(rules per run date)` comment); `store` = the ten `@shoebox/db` functions; register both `bankMatchTransactionsJob` → `createBankMatchTransactionsHandler(deps)` and `bankMatchDocumentJob` → `createBankMatchDocumentHandler(deps)`; `logger.info({}, 'bank.match registered')`; return true. In `apps/worker/src/main.ts` add `import { registerBankMatch } from './bank-match/register';` directly below `import { registerDocSplit } from './doc-split/register';` and `    registerBankMatch(registry, process.env, logger);` directly below `    registerDocSplit(registry, process.env, logger);`. Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -10`. Commit `0118 step 4`.

5. Hook after an import. In `apps/worker/src/bank-import/handler.ts`: add to `BankImportDeps` the member `readonly enqueueMatch?: (orgId: string, statementImportId: string) => Promise<unknown>;` and, directly after the awaited `insertTransactions(...)` call (grep `insertTransactions(`), when the returned `inserted > 0`: `await deps.enqueueMatch?.(payload.orgId, <the import id variable of that file>);`. In `apps/worker/src/bank-import/register.ts`: change `registry: Pick<JobRegistry, 'registerTenant'>,` to `registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,`, import `bankMatchTransactionsJob` from `@shoebox/pipeline`, and add to the `createBankImportHandler({ ... })` argument `enqueueMatch: (orgId, statementImportId) => registry.enqueue(bankMatchTransactionsJob, { orgId, statementImportId }),`. Run `pnpm --filter @shoebox/worker test -- bank-import 2>&1 | tail -10` → still passes. Commit `0118 step 5`.

6. Hook when a document becomes ready. In `apps/worker/src/doc-extract/handler.ts`: directly below `  readonly store?: ReadingStore; // default dbReadingStore` add `  readonly enqueueMatch?: (orgId: string, documentId: string, trigger: string) => Promise<unknown>; // bank.match.document on ready (M07 §4.6.1)`; replace `      await store.save(ctx.tx, write);` with
```ts
      const runId = await store.save(ctx.tx, write);
      if (write.status === 'ready') await deps.enqueueMatch?.(write.orgId, write.documentId, runId);
```
In `apps/worker/src/doc-extract/register.ts`: change `  registry: Pick<JobRegistry, 'registerTenant'>,` to `  registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>,`, import `bankMatchDocumentJob` from `@shoebox/pipeline` (extend the existing import line), and directly below `      clock: { now: () => Date.now() },` add `      enqueueMatch: (orgId, documentId, trigger) => registry.enqueue(bankMatchDocumentJob, { orgId, documentId, trigger }),`. Run `pnpm --filter @shoebox/worker test -- doc-extract-handler 2>&1 | tail -10` → still passes, and `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -10`. Commit `0118 step 6`.

## 5. Do not touch

`packages/bank/`, `packages/db/`, `packages/domain/`, `apps/web/`, `packages/pipeline/test/`. Hard rules 1 (amounts travel as `Money` or 2-decimal strings; `confidence` and `score` are the only numbers formatted with `toFixed(3)`), 3 (every store call runs on `ctx.tx` inside `withTenant`), 4 (no document content or counterparty names in logs), 8 (nothing sends or moves money).

## 6. Commands

- `pnpm --filter @shoebox/pipeline test -- jobs 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/worker test -- bank-match 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/worker test -- bank-import 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/worker test -- doc-extract-handler 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30` → no errors.

## 7. Acceptance

- [ ] `bank-match.test.ts` passes unchanged; the second run of the first test creates nothing (I4).
- [ ] `bank-import` and `doc-extract-handler` tests still pass after the hooks.
- [ ] `grep -n "TODO(M07" apps/worker/src/bank-match/handler.ts` lists the skipped items of §2.
- [ ] `apps/worker/src/main.ts` registers `bank.match` after `doc.split`.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found (in particular if `apps/worker/src/bank-import/` is missing: 0112 first);
- a test fails twice, or a test the brief wrote seems wrong (name the value and your computation);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear.

## 9. Report

Write `docs/tasks/0118-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`handler.ts` (pass order, state after links, `paid_at`), the two hooks (`bank-import/handler.ts`, `doc-extract/handler.ts`), `jobs.ts` idempotency keys.

## Owner steps

1. After the deploy, upload one statement in the test environment and open a document the statement pays: the register's Paid column should show "Paid". Tell the orchestrator what you saw.
