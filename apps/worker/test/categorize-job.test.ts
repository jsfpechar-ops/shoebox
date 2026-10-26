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
