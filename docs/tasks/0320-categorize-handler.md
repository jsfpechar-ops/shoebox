# 0320: P1-CAT-04d the `doc.categorize` worker job (handler, registration, event, ledger enqueue)

Status: todo
Ticket: P1-CAT-04 | Depends on: 0319 (merged) | Base commit: lane branch head | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 25 tool calls, 55k tokens

## 1. Objective

Register `doc.categorize` in the worker: load (0317) → plan (0319) → call Haiku 5.5 through `runCategorize` (0315) only when the plan asks → plan again → save → enqueue `ledger.rebuild_document`. Cost of every LLM attempt is recorded in `extraction_runs` (AC-3). From this brief on, a document that leaves lane B's read stage can be categorized.

## 2. Context

- Pattern to copy exactly: `apps/worker/src/doc-extract/handler.ts` (`ReadingStore` injection, `DEFAULT_RETRY` final-attempt logic, `errorCode`) and `apps/worker/src/doc-extract/register.ts` (env check, `createAnthropicClient`, `SHOEBOX_LLM_MODEL || 'claude-haiku-5-5'`). Registry API (`apps/worker/src/registry.ts`): `registerTenant(def, handler)`, `enqueue(def, payload)`, handler signature `(payload, ctx: {tx, attempt, jobId, signal})`.
- Who enqueues `doc.categorize`: lane B's read stage when it sets `needs_review`/`ready` after validation (TODO(P1-VAL-08): until then, the web route of 0321 and the owner's manual re-run); this brief does not edit `doc-extract`.
- Guards: skip when the document is null, `deletedAt` set, or `status ∈ {received, splitting, classifying, extracting, failed, duplicate, supporting, finalized}` (finalized documents are immutable, M04 §4.14; a revision flow comes with LEDG-03 edit-impact later). Skip when `payload.revision !== doc.revision` (stale job).
- Idempotency of the LLM call: the LLM is called at most once per job run (two attempts inside `runCategorize`). When `runCategorize` returns `ok:false`, the plan is saved **without** LLM output (fallback lines stay unresolved → `which_category` questions, `needs_review`), and the two failed attempts are recorded; the job succeeds (no retry: a model that answers garbage twice will not improve on a retry).
- Logging (hard rule 4): only ids, counts, status, model, token counts. Never a description, subject or payload.
- Event `document.categorized {documentId, lowConfidenceLines, questions}` (M04 §6.5): log it at info level as `event: 'document.categorized'` (there is no event bus yet; TODO(03 §3.1 events)).
- After save: `enqueue(ledgerRebuildDocumentJob, {orgId, documentId, reason: 'categorized', nonce: Date.now()})` wrapped in try/catch → a failed enqueue is logged (`warn`) and does not fail the job (the nightly `ledger.verify` catches gaps).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/categorize/handler.ts` | create | `createDocCategorizeHandler`, `CategorizeStore` |
| `apps/worker/src/categorize/register.ts` | create | `registerDocCategorize` |
| `apps/worker/src/main.ts` | edit | one import, one call |
| `apps/worker/test/categorize-job.test.ts` | create | the test below, verbatim |

## 4. Steps

1. Create `apps/worker/src/categorize/handler.ts` exporting exactly:
```ts
import { type CategorizationWrite, type DocumentForCategorize, loadDocumentForCategorize, saveCategorization } from '@shoebox/db';
import type { Clock, LegalDate, RULE_SCHEMAS, RuleResolver } from '@shoebox/domain';
import type { LlmClient } from '@shoebox/extraction';
import { type DocCategorizePayload, docCategorizeJob, ledgerRebuildDocumentJob, type LedgerRebuildDocumentPayload, type TenantJobDefinition } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { TenantHandler } from '../registry';
export interface CategorizeStore { readonly load: typeof loadDocumentForCategorize; readonly save: typeof saveCategorization; }
export const dbCategorizeStore: CategorizeStore;
export interface Enqueue { <P extends { orgId: string }>(def: TenantJobDefinition<P>, payload: P): Promise<string | null>; }
export interface DocCategorizeDeps {
  readonly llm: LlmClient;
  readonly model: string;
  readonly clock: Clock;
  readonly rules?: RuleResolver<typeof RULE_SCHEMAS>;   // default createCzRules()
  readonly enqueue: Enqueue;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly store?: CategorizeStore;                      // default dbCategorizeStore
}
export const SKIPPED_STATUSES: readonly string[] = ['received', 'splitting', 'classifying', 'extracting', 'failed', 'duplicate', 'supporting', 'finalized'];
export function createDocCategorizeHandler(deps: DocCategorizeDeps): TenantHandler<DocCategorizePayload>;
```
   Flow: `doc = load` → guards → `first = planCategorization({doc, llm: null, rules, today: pragueToday(clock), model, categorizeVersion: docCategorizeJob.version})` → if `first.needsLlm && first.llmRequest`: `built = buildCategorizeRequest(first.llmRequest)`; `result = await runCategorize(deps.llm, built)` (a thrown provider error propagates: pg-boss retries); `runs = result.attempts.map(a => ({model: a.model, promptVersion: a.promptVersion, attempt: a.attempt, inputTokens: a.usage.inputTokens, outputTokens: a.usage.outputTokens, cacheReadTokens: a.usage.cacheReadInputTokens, cacheWriteTokens: a.usage.cacheCreationInputTokens, latencyMs: a.latencyMs, ok: a.ok, error: a.error}))`; `final = result.ok ? planCategorization({...same, llm: result.output}) : first` → else `final = first, runs = []` → `save(tx, {...final.write, runs})` → log event → enqueue ledger rebuild.
   Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

2. Create `apps/worker/src/categorize/register.ts` exporting `registerDocCategorize(registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>, env, logger): boolean` — same shape as `registerDocExtract`, requiring only `ANTHROPIC_API_KEY`; `enqueue: (def, payload) => registry.enqueue(def, payload)`. Logs `'doc.categorize registered'` / `'doc.categorize not registered'`.

3. Edit `apps/worker/src/main.ts`. Anchor: `import { registerDocExtract } from './doc-extract/register';` → add below `import { registerDocCategorize } from './categorize/register';`. Anchor: `    registerDocExtract(registry, process.env, logger);` → add below `    registerDocCategorize(registry, process.env, logger);`. Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → 0 errors.

4. Create `apps/worker/test/categorize-job.test.ts` verbatim; implement until it passes, do not edit it:
```ts
import type { CategorizationWrite, DocumentForCategorize, TenantTx } from '@shoebox/db';
import { fixedClock } from '@shoebox/domain';
import type { LlmClient, LlmRequest } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { type CategorizeStore, createDocCategorizeHandler, SKIPPED_STATUSES } from '../src/categorize/handler';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333331';

function document(over: Partial<DocumentForCategorize> = {}): DocumentForCategorize {
  return {
    id: DOC, orgId: ORG, status: 'validating', revision: 1, class: 'received_receipt', direction: 'in', taxDocStatus: 'simplified_tax_document',
    issueDate: '2026-09-12', duzp: '2026-09-12', receivedDate: null, servicePeriodFrom: null, servicePeriodTo: null, paidAt: '2026-09-12', vatPointDate: null,
    currency: 'CZK', fxRate: null, fxRateDate: null, totalGross: '249.00', paymentMethod: 'card', isPaidPerDocument: true,
    businessFlag: 'business', summaryCs: null, partnerId: 'p1', partnerSnapshot: null, buyerSnapshot: null, stageVersion: {},
    orgIco: '12345678', orgDic: 'CZ12345678', orgSettings: {},
    lines: [{ id: L1, position: 1, lineType: 'item', description: 'Quechua backpack', quantity: '1', net: '205.79', vat: '43.21', gross: '249.00', vatRateType: 'standard', vatRatePct: '21', vatTreatment: null, categoryCode: null, businessSharePct: '100', deductibility: null, coveredByDocumentId: null, rcCommodityCode: null, classificationSource: null, classificationConfidence: null }],
    fields: [], questions: [],
    partner: { id: 'p1', name: 'Decathlon', ico: '26151006', dic: 'CZ26151006', vatId: null, country: 'CZ', isVatPayer: true },
    vendor: null,
    profiles: [{ validFrom: '2026-01-01', validTo: null, vatStatus: 'identifikovana_osoba', vatPeriod: 'monthly', foreignServiceDppdPolicy: 'issue_date', mainActivityNace: '55.20' }],
    fxRates: [], ...over,
  };
}
const wireLine = { position: 1, category_code: 'exp_other_deductible', alternative_category_code: 'private_expense', confidence: 0.55, supply_kind: 'goods', asset_candidate: false, mixed_use_item: false, place_of_supply_abroad: false, reason_cs: 'sports gear' };
const wire = { document: { subject_cs: 'Backpack', dominant_category_code: 'exp_other_deductible', business_likelihood: 'personal', personal_reason_cs: 'sports gear' }, lines: [wireLine] };

function fakeStore(doc: DocumentForCategorize | null) {
  const saved: CategorizationWrite[] = [];
  const store: CategorizeStore = { load: async () => doc, save: async (_tx, w) => { saved.push(w); return w.fields.length; } };
  return { store, saved };
}
function fakeLlm(answers: unknown[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return { requests, async complete(request) { requests.push(request); const json = answers[requests.length - 1]; if (json instanceof Error) throw json; return { model: request.model, stopReason: 'end_turn', text: JSON.stringify(json), json, usage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, latencyMs: 7 }; } };
}
function harness(doc: DocumentForCategorize | null, answers: unknown[]) {
  const { store, saved } = fakeStore(doc);
  const llm = fakeLlm(answers);
  const enqueued: Array<{ name: string; payload: unknown }> = [];
  const logs: Array<{ level: string; msg: string; obj: unknown }> = [];
  const handler = createDocCategorizeHandler({ llm, model: 'claude-haiku-5-5', clock: fixedClock('2026-10-26T10:00:00Z'), store, enqueue: async (def, payload) => { enqueued.push({ name: def.name, payload }); return 'j1'; }, logger: { info: (obj: unknown, msg?: string) => { logs.push({ level: 'info', msg: msg ?? '', obj }); }, warn: (obj: unknown, msg?: string) => { logs.push({ level: 'warn', msg: msg ?? '', obj }); } } as never });
  const ctx = { tx: {} as TenantTx, attempt: 1, jobId: 'job-1', signal: new AbortController().signal };
  return { run: (revision = 1) => handler({ orgId: ORG, documentId: DOC, revision, trigger: 'pipeline' }, ctx), saved, llm, enqueued, logs };
}

describe('doc.categorize handler', () => {
  it('calls the LLM once, saves with the run recorded, logs the event and enqueues the ledger rebuild (Decathlon)', async () => {
    const h = harness(document(), [wire]);
    await h.run();
    expect(h.llm.requests).toHaveLength(1);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ orgId: ORG, documentId: DOC, status: 'needs_review', document: { businessFlag: 'unknown' } });
    expect(h.saved[0]?.runs).toEqual([expect.objectContaining({ model: 'claude-haiku-5-5', promptVersion: 'm04-categorize-v1', attempt: 1, inputTokens: 120, ok: true, error: null })]);
    expect(h.saved[0]?.questions.map((q) => q.kind)).toEqual(['business_or_personal', 'which_category']);
    expect(h.enqueued).toEqual([{ name: 'ledger.rebuild_document', payload: expect.objectContaining({ orgId: ORG, documentId: DOC, reason: 'categorized' }) }]);
    const event = h.logs.find((l) => (l.obj as { event?: string }).event === 'document.categorized');
    expect(event?.obj).toMatchObject({ documentId: DOC, questions: ['business_or_personal', 'which_category'] });
    expect(JSON.stringify(h.logs)).not.toContain('backpack');
  });

  it('two invalid answers: saves the fallback plan with both attempts recorded, job succeeds', async () => {
    const h = harness(document(), [{ nope: 1 }, { nope: 2 }]);
    await h.run();
    expect(h.llm.requests).toHaveLength(2);
    expect(h.saved[0]?.runs.map((r) => [r.attempt, r.ok, r.error])).toEqual([[1, false, 'parse'], [2, false, 'parse']]);
    expect(h.saved[0]?.status).toBe('needs_review');
    expect(h.saved[0]?.lines[0]?.categoryCode).toBeNull();
    expect(h.saved[0]?.fields.some((f) => f.source === 'llm')).toBe(false);
  });

  it('a provider error propagates (pg-boss retries) and nothing is saved', async () => {
    const boom = Object.assign(new Error('503'), { name: 'AnthropicHttpError' });
    const h = harness(document(), [boom]);
    await expect(h.run()).rejects.toBe(boom);
    expect(h.saved).toEqual([]);
    expect(h.enqueued).toEqual([]);
  });

  it('vendor memory resolves without the LLM (AC-6) and still enqueues the rebuild', async () => {
    const h = harness(document({ class: 'received_invoice', taxDocStatus: 'not_tax_document', lines: [{ ...document().lines[0]!, description: 'Úklid apartmánu září', net: '11600.00', vat: null, gross: '11600.00', vatRateType: 'none', vatRatePct: null }], partner: { id: 'p3', name: 'Čistá s.r.o.', ico: '11223344', dic: null, vatId: null, country: 'CZ', isVatPayer: false }, vendor: { id: 'v1', partnerId: 'p3', defaultCategoryCode: 'exp_cleaning', defaultVatTreatment: 'rcv_domestic_no_vat', defaultBusinessFlag: 'business', confirmations: 2, pinned: false, multiCategory: false, extractionHints: { subject_cs: 'Apartment cleaning' } } }), []);
    await h.run();
    expect(h.llm.requests).toHaveLength(0);
    expect(h.saved[0]).toMatchObject({ status: 'ready', runs: [] });
    expect(h.enqueued).toHaveLength(1);
  });

  it('skips missing, finalized and stale-revision documents without touching the LLM or the store', async () => {
    for (const doc of [null, document({ status: 'finalized' }), document({ status: 'duplicate' })]) {
      const h = harness(doc, [wire]);
      await h.run();
      expect(h.llm.requests).toHaveLength(0);
      expect(h.saved).toEqual([]);
    }
    const stale = harness(document({ revision: 2 }), [wire]);
    await stale.run(1);
    expect(stale.saved).toEqual([]);
    expect(SKIPPED_STATUSES).toContain('finalized');
  });

  it('a failed ledger enqueue is a warning, not a job failure', async () => {
    const { store } = fakeStore(document());
    const handler = createDocCategorizeHandler({ llm: fakeLlm([wire]), model: 'claude-haiku-5-5', clock: fixedClock('2026-10-26T10:00:00Z'), store, enqueue: async () => { throw new Error('queue down'); }, logger: { info: () => undefined, warn: () => undefined } as never });
    await expect(handler({ orgId: ORG, documentId: DOC, revision: 1, trigger: 'pipeline' }, { tx: {} as TenantTx, attempt: 1, jobId: 'j', signal: new AbortController().signal })).resolves.toBeUndefined();
  });
});
```
   Command: `pnpm --filter @shoebox/worker test -- categorize-job 2>&1 | tail -30` → all pass; `pnpm --filter @shoebox/worker test -- registry 2>&1 | tail -30` → unchanged.

## 5. Do not touch

`doc-extract/*`, `registry.ts`, `worker.ts`, `packages/*`. Hard rules 2, 4 (the `not.toContain('backpack')` assertion is the log check), 8.

## 6. Commands

`pnpm --filter @shoebox/worker test -- categorize-job 2>&1 | tail -30`; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

## 7. Acceptance

- [ ] Tests pass; typecheck clean. - [ ] `main.ts` registers the job after `doc.extract`. - [ ] No log line carries a description, subject or payload.

## 8. Stop and ask

Per TEMPLATE §8.

## 9. Report

`docs/tasks/0320-report.md`. Owner steps to list: none new (uses `ANTHROPIC_API_KEY` already set for `doc.extract`).

## Risk list

`handler.ts` (guards, run recording, no content in logs).

## Owner steps

None.
