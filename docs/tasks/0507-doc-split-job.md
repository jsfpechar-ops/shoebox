# 0507: The sorting job `doc.split`

Status: review
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0502, 0503, 0504, 0505, 0506 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

One job per upload drop sorts its pages into documents: it counts the pages, has Haiku look them over (in calls of at most 20 pages), groups them, writes the plan and then queues one read per document. A drop of a single one-page file skips the look-over (no extra cost). ISDOC files are read directly. If the look-over fails, every file is read on its own, exactly as before, so nothing gets stuck.

## 2. Context

- The job name must be in 03 §3.1 `JOB_NAMES` (`packages/pipeline/src/jobs.ts`); `'doc.split'` is there and this job replaces M01 §4.7 (decision 2026-10-26). `packages/pipeline/src/jobs.ts` has `tenantPayload(shape)` and ends with:

```ts
/** M02: read one document (Haiku 5.5), then run the checks. Enqueued by the upload API. */
export const docExtractJob = defineTenantJob({
  name: 'doc.extract',
  payload: documentStagePayload,
  version: 1,
  entityId: (payload) => payload.documentId,
});
```

- Race: the sort job's writes commit only after its handler returns, so the reads it queues must start a few seconds later. `apps/worker/src/registry.ts` excerpts (find verbatim):

```ts
  enqueue<P extends { orgId: string }>(
    def: TenantJobDefinition<P>,
    payload: P,
  ): Promise<string | null>;
  enqueue<P extends object>(def: SystemJobDefinition<P>, payload: P): Promise<string | null>;
```

```ts
    async enqueue(def: AnyDefinition, payload: object): Promise<string | null> {
      const data = def.payload.parse(payload);
      await ensureQueue(def);
      if (def.scope === 'tenant') {
        const key = jobKey(def, data as { orgId: string });
        return boss.send(def.name, data, { id: jobIdFromKey(key), singletonKey: key });
      }
```

  `apps/worker/test/registry.test.ts` checks the exact `send` arguments without options: keep them unchanged when no option is given.
- `apps/worker/src/main.ts` excerpt: `    registerDocExtract(registry, process.env, logger);` and `import { registerDocExtract } from './doc-extract/register';`. Follow `apps/worker/src/doc-extract/register.ts` for the env checks (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, model `env.SHOEBOX_LLM_MODEL || 'claude-haiku-5-5'`, `createAnthropicClient({ apiKey })`, `createSupabaseBlobStore({ url, apiKey: serviceKey })`).
- Available: `@shoebox/db` `loadSplitBatch`, `setDocumentsStatus`, `applySortPlan`, `SplitBatchFile`, `SplitRun` (0506); `@shoebox/extraction` `buildSortRequest`, `parsePageMap`, `SORT_MAX_PAGES_PER_CALL` (20), `SORT_PROMPT_VERSION`, `groupPages`, `SortPage`, `pdfPageCount`, `pdfPickPages`, `isProtoMediaType`, `readIsdoc`, `LlmClient`; worker `planSort` (0506), `TenantHandler` from `../registry`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/pipeline/src/jobs.ts` | edit | `docSplitJob` |
| `apps/worker/src/registry.ts` | edit | optional `startAfterSeconds` |
| `apps/worker/test/registry.test.ts` | edit | one test |
| `apps/worker/src/doc-split/handler.ts` | new | the job |
| `apps/worker/test/doc-split-handler.test.ts` | new | given below |
| `apps/worker/src/doc-split/register.ts` | new | registration |
| `apps/worker/src/main.ts` | edit | register it |

No other file may change.

## 4. Steps

1. `jobs.ts`: append

```ts

/** M01 page sorting (replaces §4.7): sort the pages of one upload drop into documents, then queue their reads. */
export const docSplitJob = defineTenantJob({
  name: 'doc.split',
  payload: tenantPayload({ batchId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.batchId,
});
export type DocSplitPayload = z.infer<typeof docSplitJob.payload>;
```

(If `z.infer` on `docSplitJob.payload` does not type-check, write `{ orgId: string; batchId: string }`.) Run `pnpm --filter @shoebox/pipeline typecheck 2>&1 | tail -30`.

2. `registry.ts`: add a third optional parameter `options?: { readonly startAfterSeconds?: number }` to both `enqueue` overloads and to the implementation. In the tenant branch send `{ id: jobIdFromKey(key), singletonKey: key }` when `options?.startAfterSeconds` is undefined, else the same object plus `startAfter: options.startAfterSeconds`. System jobs ignore it.

3. `registry.test.ts`: after the test `'sends a tenant job with the key-derived id and the key as singletonKey'` add

```ts

  it('can delay a tenant job', async () => {
    const { registry, sent } = fakes();
    const key = `${ORG}:doc.split:${DOC}:1`;
    await registry.enqueue(split, { orgId: ORG, documentId: DOC }, { startAfterSeconds: 5 });
    expect(sent[0]).toEqual([
      'doc.split',
      { orgId: ORG, documentId: DOC },
      { id: jobIdFromKey(key), singletonKey: key, startAfter: 5 },
    ]);
  });
```

Run `pnpm --filter @shoebox/worker test -- registry 2>&1 | tail -30`.

4. New `apps/worker/src/doc-split/handler.ts` with these exports; implement the steps in the doc comment until step 5 passes:

```ts
import { applySortPlan, loadSplitBatch, setDocumentsStatus } from '@shoebox/db';
import type { LlmClient } from '@shoebox/extraction';
import type { DocSplitPayload } from '@shoebox/pipeline';
import type { TenantHandler } from '../registry';

export interface DocSplitStore {
  readonly loadBatch: typeof loadSplitBatch;
  readonly setStatus: typeof setDocumentsStatus;
  readonly apply: typeof applySortPlan;
}

export const dbDocSplitStore: DocSplitStore = {
  loadBatch: loadSplitBatch,
  setStatus: setDocumentsStatus,
  apply: applySortPlan,
};

export interface DocSplitDeps {
  readonly llm: LlmClient;
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly model: string;
  /** Queues doc.extract for one document, a few seconds later (the sort's writes commit first). */
  readonly enqueueRead: (orgId: string, documentId: string) => Promise<unknown>;
  readonly store?: DocSplitStore; // default dbDocSplitStore
  readonly countPages?: (bytes: Uint8Array) => Promise<number>; // default pdfPageCount
  readonly pick?: (bytes: Uint8Array, pages: readonly number[]) => Promise<Uint8Array>; // default pdfPickPages
}

/**
 * 1. files = loadBatch(tx, batchId); none → return.
 * 2. Fetch every file's bytes once. A file is "direct" (read on its own, not sorted) when its type is
 *    not a model type (isProtoMediaType false), or it is a PDF with ISDOC data (readIsdoc returns
 *    non-null; a throw counts as no ISDOC), or countPages throws. Otherwise it is "sortable" with pageCount = countPages(bytes) for a
 *    PDF and 1 for an image.
 * 3. If the sortable files hold 1 page or fewer in all → enqueueRead every file's document, in file
 *    order; no model call; return.
 * 4. setStatus(tx, sortable document ids, 'splitting').
 * 5. Number the sortable pages 1..N in file order. Cut them into chunks of at most
 *    SORT_MAX_PAGES_PER_CALL consecutive pages: a file fits whole into the current chunk, else the chunk
 *    closes; a file bigger than the limit is split into page ranges with pick(bytes, [pages]). Each
 *    chunk is one buildSortRequest call; its parts carry firstPage (global) and pageCount.
 * 6. For each chunk: llm.complete → parsePageMap(response.json, the chunk's global page numbers).
 *    Collect a SplitRun per call from response.model, SORT_PROMPT_VERSION, response.usage
 *    (inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens) and latencyMs.
 * 7. Any error in 5–6 → fallback: setStatus(sortable ids, 'received'), enqueueRead every file's
 *    document in file order, return (the job succeeds).
 * 8. SortPage per global page: fileIndex = the sortable file's index (0-based among sortable files),
 *    filePage, blank and items from the page map. groupPages → planSort(orgId, batchId,
 *    sortableFiles, result, runs) → ids = apply(tx, plan).
 * 9. enqueueRead each id, then each direct file's document.
 */
export function createDocSplitHandler(deps: DocSplitDeps): TenantHandler<DocSplitPayload>;
```

5. New `apps/worker/test/doc-split-handler.test.ts` (do not edit it; `biome format --write` allowed):

```ts
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
```

Run `pnpm --filter @shoebox/worker test -- doc-split-handler 2>&1 | tail -30` (expect 5 passed).

6. New `apps/worker/src/doc-split/register.ts`: `registerDocSplit(registry: Pick<JobRegistry, 'registerTenant' | 'enqueue'>, env, logger): boolean`, a copy of `registerDocExtract`'s shape that registers `docSplitJob` with `createDocSplitHandler({ llm, blobs, model, enqueueRead: (orgId, documentId) => registry.enqueue(docExtractJob, { orgId, documentId }, { startAfterSeconds: 5 }) })` and logs `'doc.split registered'` / `'doc.split not registered'`.

7. `main.ts`: import `registerDocSplit` from `./doc-split/register` and call `registerDocSplit(registry, process.env, logger);` after the `registerDocExtract` line. Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

## 5. Do not touch

`doc-extract/*`, `apps/web`, the upload flow (0508 switches it). Rule 4: nothing from a document in logs or errors.

## 6. Commands

- `pnpm --filter @shoebox/worker test -- doc-split registry 2>&1 | tail -30`
- `pnpm --filter @shoebox/pipeline test 2>&1 | tail -30`
- `pnpm --filter @shoebox/pipeline --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/pipeline apps/worker 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0507-report.md` (600 tokens at most) and set `Status: review`.
