import type { SortPlan, SplitBatchFile, TenantTx } from '@shoebox/db';
import type { LlmClient, LlmRequest } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { createDocSplitHandler, type DocSplitStore } from '../src/doc-split/handler';

const ORG = '11111111-1111-4111-8111-111111111111';
const BATCH = '44444444-4444-4444-8444-444444444444';
const tx = {} as TenantTx;
const ctx = { tx, attempt: 1, jobId: 'job-1', signal: new AbortController().signal };

function file(n: number, mimeType = 'image/jpeg'): SplitBatchFile {
  return {
    documentId: `doc-${n}`,
    sourceFileId: `sf-${n}`,
    storagePath: `p/${n}`,
    mimeType,
    receivedDate: '2026-10-26',
    status: 'received',
  };
}

function fakeStore(files: SplitBatchFile[]) {
  const statuses: string[] = [];
  const plans: SortPlan[] = [];
  const store: DocSplitStore = {
    loadBatch: async () => files,
    setStatus: async (_tx, ids, status) => {
      statuses.push(`${status}:${ids.join(',')}`);
    },
    apply: async (_tx, plan) => {
      plans.push(plan);
      return plan.documents.map((d, i) => d.documentId ?? `new-${i}`);
    },
  };
  return { store, statuses, plans };
}

function llmReturning(json: unknown | Error): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      if (json instanceof Error) throw json;
      return {
        model: 'claude-haiku-5-5',
        stopReason: 'end_turn',
        text: '',
        json,
        latencyMs: 400,
        usage: { inputTokens: 900, outputTokens: 80, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      };
    },
  };
}

const blobs = { get: async () => new Uint8Array([1, 2, 3]) };

function setup(files: SplitBatchFile[], json: unknown | Error, pages = 1) {
  const { store, statuses, plans } = fakeStore(files);
  const llm = llmReturning(json);
  const reads: string[] = [];
  const handler = createDocSplitHandler({
    llm,
    blobs,
    model: 'claude-haiku-5-5',
    store,
    enqueueRead: async (_org, id) => {
      reads.push(id);
    },
    countPages: async () => pages,
    pick: async (_bytes, list) => new Uint8Array(list),
  });
  return { handler, llm, reads, statuses, plans };
}

const item = (over: Record<string, unknown> = {}) => ({
  where: '',
  kind: 'invoice',
  supplier_name: 'Supplier X s.r.o.',
  supplier_ico: '11111111',
  doc_number: 'N1',
  page_label: '',
  has_totals: false,
  starts_document: true,
  ...over,
});

describe('doc.split handler', () => {
  it('reads a single one-page file straight away, without a look-over', async () => {
    const { handler, llm, reads } = setup([file(0)], {});
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(llm.requests).toHaveLength(0);
    expect(reads).toEqual(['doc-0']);
  });

  it('joins two photos of one invoice and reads it once', async () => {
    const { handler, llm, reads, statuses, plans } = setup([file(0), file(1)], {
      pages: [
        { page: 1, blank: false, items: [item()] },
        { page: 2, blank: false, items: [item({ supplier_ico: '', doc_number: '', has_totals: true })] },
      ],
    });
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(llm.requests).toHaveLength(1);
    const content = llm.requests[0]?.messages[0]?.content ?? [];
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text', 'image', 'text']);
    expect(statuses).toEqual(['splitting:doc-0,doc-1']);
    expect(plans[0]?.documents).toHaveLength(1);
    expect(plans[0]?.deleteDocumentIds).toEqual(['doc-1']);
    expect(plans[0]?.runs[0]).toMatchObject({ inputTokens: 900, outputTokens: 80, latencyMs: 400 });
    expect(reads).toEqual(['doc-0']);
  });

  it('looks over a 25-page scan in two calls of at most 20 pages', async () => {
    const { handler, llm, plans } = setup([file(0, 'application/pdf')], { pages: [] }, 25);
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0]?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'Strany 1–20:' });
    expect(llm.requests[1]?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'Strany 21–25:' });
    expect(plans[0]?.documents).toHaveLength(25);
  });

  it('falls back to reading every file on its own when the look-over fails', async () => {
    const { handler, reads, statuses, plans } = setup([file(0), file(1)], new Error('down'));
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(plans).toHaveLength(0);
    expect(statuses).toEqual(['splitting:doc-0,doc-1', 'received:doc-0,doc-1']);
    expect(reads).toEqual(['doc-0', 'doc-1']);
  });

  it('reads ISDOC files directly and does not sort them', async () => {
    const { handler, llm, reads } = setup([file(0, 'application/xml'), file(1)], {});
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(llm.requests).toHaveLength(0);
    expect(reads).toEqual(['doc-0', 'doc-1']);
  });
});
