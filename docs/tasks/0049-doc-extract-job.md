# 0049: The worker reads each upload with Haiku 5.5 and checks it

Status: review
Ticket: P1-EXT-06/07 (trimmed, Phase 1 core loop) | Depends on: 0045, 0046, 0048 (all merged into phase/0) | Base commit: phase/0 after those merges | Branch: task/0049-doc-extract-job | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Register the `doc.extract` job in the worker: load the uploaded file, read it with Haiku 5.5 (the prototype prompt and schema that scored best), run the deterministic checks, and save the result, so the document moves from "Zpracovává se" to "Hotovo" or "Ke kontrole" on its own. This closes the upload → read → check loop.

## 2. Context

- Hard rule 2: the model's output is a suggestion; the status comes from `statusAfterRead` (ready only without a blocking check).
- Hard rule 4: no document content in logs. Log only ids and error codes.
- Pieces that already exist (import, do not change):
  - `@shoebox/extraction`: `buildProtoRequest({ model, file: { bytes, mediaType } })`, `parseProtoExtraction(json)` (throws `ProtoParseError`), `isProtoMediaType(mime)`, `PROTO_PROMPT_VERSION`, `createAnthropicClient({ apiKey })`, `AnthropicHttpError` (has `status: number`), types `LlmClient`, `LlmResponse` (`{ model, json, usage: { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }, latencyMs }`).
  - `@shoebox/validation`: `runProtoChecks(input, { today, org? })`, `org` is `{ ico, dic }`; pass `undefined` when both are null.
  - `@shoebox/domain`: `createCzRules().at(date).get('vat.rates')` (throws for a date outside the rule tables: then use today), `pragueToday(clock)`, `Clock` (`{ now(): number }`).
  - `apps/worker/src/doc-extract/rows.ts` (0045): `documentPatchOf`, `vatSummaryOf`, `fieldsOf`, `validationRowsOf`, `statusAfterRead`.
  - `@shoebox/db` (0048): `loadDocumentForRead`, `setDocumentStatus`, `saveDocumentReading`, `recordFailedRead`, types `TenantTx`, `ReadingWrite`.
  - `@shoebox/pipeline` (0046): `docExtractJob`, `DEFAULT_RETRY` (`retryLimit` = number of retries).
  - `apps/worker/src/registry.ts`: `TenantHandler<P> = (payload, ctx: { tx, attempt, jobId, signal }) => Promise<void>`; `JobRegistry.registerTenant(def, handler)`. The handler runs inside `withTenant`: if it throws, the transaction rolls back and pg-boss retries.
  - `apps/worker/src/worker.ts`: `startWorker(config, { logger, register?: (registry) => void })`. `apps/worker/src/main.ts` today:

```ts
const worker = await startWorker(loadWorkerConfig(process.env), { logger });
```

  - `@shoebox/platform`: `createSupabaseBlobStore({ url, apiKey })` (service role key: server side only, after our own org check), `BlobStore.get(path)`.
- Model: `SHOEBOX_LLM_MODEL`, default `claude-haiku-5-5` (owner decision 2026-10-25: Haiku 5.5 only). Regular API calls for now; the Batch API comes later.
- Failure rule: an error on a non-final attempt is re-thrown (pg-boss retries). On the final attempt (`ctx.attempt >= DEFAULT_RETRY.retryLimit + 1`) record it with `recordFailedRead(..., final: true)` and return without throwing, so the document shows "Nepodařilo se přečíst". Error codes: `http_<status>` for `AnthropicHttpError`, `parse` for `ProtoParseError`, `unsupported_type`, `storage`, else `error`. An unsupported media type is final at once.
- Idempotency: when the loaded document's status is not `received` or `extracting`, do nothing (it was already read).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/src/doc-extract/handler.ts` | create | `createDocExtractHandler` |
| `apps/worker/test/doc-extract-handler.test.ts` | create | the test file below, verbatim |
| `apps/worker/src/doc-extract/register.ts` | create | `registerDocExtract(registry, env, logger)` |
| `apps/worker/src/main.ts` | edit | pass `register` |
| `apps/worker/src/doc-extract/rows.ts` | edit | keep the message key in `params` |
| `apps/worker/test/doc-extract-rows.test.ts` | edit | the one expectation below |

No other file may change.

## 4. Steps

0. The review screen must show each check's message, so the i18n key has to be stored. In `apps/worker/src/doc-extract/rows.ts`, `validationRowsOf` sets `params: { ...r.params, messageKey: r.key }`. In `apps/worker/test/doc-extract-rows.test.ts` change the expected rows in 'drops passes and maps severities' to `params: { a: 1, messageKey: 'proto.check.x' }` (both rows). This is the only allowed edit of that test. Run `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-rows.test.ts 2>&1 | tail -30`. Expected: pass. Commit `0049 step 0`.
1. Create the test file below verbatim, then `apps/worker/src/doc-extract/handler.ts` with:

```ts
import { loadDocumentForRead, recordFailedRead, saveDocumentReading, setDocumentStatus } from '@shoebox/db';
import type { Clock } from '@shoebox/domain';
import type { LlmClient } from '@shoebox/extraction';
import type { DocumentStagePayload } from '@shoebox/pipeline';
import type { TenantHandler } from '../registry';

export interface ReadingStore {
  readonly load: typeof loadDocumentForRead;
  readonly setStatus: typeof setDocumentStatus;
  readonly save: typeof saveDocumentReading;
  readonly fail: typeof recordFailedRead;
}
export const dbReadingStore: ReadingStore;
export interface DocExtractDeps {
  readonly llm: LlmClient;
  readonly blobs: { get(path: string): Promise<Uint8Array> };
  readonly model: string;
  readonly clock: Clock;
  readonly store?: ReadingStore; // default dbReadingStore
}
export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<DocumentStagePayload>;
```

   Order inside the handler: load → status gate → `setStatus('extracting')` → media type → `blobs.get` → `llm.complete(buildProtoRequest(...))` → `parseProtoExtraction(response.json)` → rates (date = duzp, else issue date, else today) → `runProtoChecks` → rows → `save` with `run.model = response.model`, `promptVersion = PROTO_PROMPT_VERSION`, `attempt = ctx.attempt`, tokens from `usage` (`cacheReadTokens` = `cacheReadInputTokens`, `cacheWriteTokens` = `cacheCreationInputTokens`), `latencyMs`. If the currency in the reading is not a valid ISO code, `vatSummaryOf`/`Money` may throw: treat any throw after parsing as `parse`. Run `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts 2>&1 | tail -30`. Expected: pass. Commit `0049 step 1`.
2. Create `apps/worker/src/doc-extract/register.ts`:

```ts
export function registerDocExtract(
  registry: Pick<JobRegistry, 'registerTenant'>,
  env: Readonly<Record<string, string | undefined>>,
  logger: Pick<Logger, 'info' | 'warn'>,
): boolean;
```

   It needs `ANTHROPIC_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. When one is missing: `logger.warn({ missing: [names] }, 'doc.extract not registered')` and return false (the worker still runs). Else register `docExtractJob` with `createDocExtractHandler({ llm: createAnthropicClient({ apiKey }), blobs: createSupabaseBlobStore({ url, apiKey: serviceKey }), model: env.SHOEBOX_LLM_MODEL || 'claude-haiku-5-5', clock: { now: () => Date.now() } })`, log `info({ model }, 'doc.extract registered')`, return true. Never log key values. Commit `0049 step 2`.
3. Edit `apps/worker/src/main.ts`: replace the quoted line with

```ts
const worker = await startWorker(loadWorkerConfig(process.env), {
  logger,
  register: (registry) => {
    registerDocExtract(registry, process.env, logger);
  },
});
```

   and import `registerDocExtract` from `./doc-extract/register`. Run `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`, `pnpm exec biome ci apps/worker 2>&1 | tail -30`, `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/doc-extract-rows.test.ts test/registry.test.ts 2>&1 | tail -30`. Expected: clean, all pass. Commit `0049 step 3`.

Test file `apps/worker/test/doc-extract-handler.test.ts`:

```ts
import type { DocumentForRead, ReadingWrite, TenantTx } from '@shoebox/db';
import { fixedClock } from '@shoebox/domain';
import { AnthropicHttpError, type LlmClient, type LlmRequest } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { createDocExtractHandler, type ReadingStore } from '../src/doc-extract/handler';

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind_hint: 'tax_invoice',
    supplier: { name: 'Synthetic s.r.o.', ico: '27082440', dic: 'CZ27082440', vat_id: '', country: 'CZ' },
    buyer: { name: '', ico: '', dic: '' },
    document: { number: 'SYN-1', variable_symbol: '1' },
    dates: { issue_date: '2026-09-12', duzp: '2026-09-12', due_date: '2026-09-26' },
    currency: 'CZK',
    vat_recap: [{ rate_pct: '21', base: '100.00', vat: '21.00' }],
    totals: { net: '100.00', vat: '21.00', gross: '121.00' },
    payment: { account_number: '123', bank_code: '0100', iban: '', method: 'bank_transfer' },
    flags: { not_tax_document_text: false, non_vat_payer_text: false, reverse_charge_text: false, paid_text: false },
    ...overrides,
  };
}

function fakeStore(doc: Partial<DocumentForRead> | null = {}) {
  const calls: string[] = [];
  const saved: ReadingWrite[] = [];
  const failures: Array<{ error: string; final: boolean }> = [];
  const store: ReadingStore = {
    load: async () =>
      doc === null
        ? null
        : { id: DOC, orgId: ORG, status: 'received', storagePath: `org/${ORG}/files/x`, mimeType: 'application/pdf', orgIco: null, orgDic: null, ...doc },
    setStatus: async (_tx, _id, status) => { calls.push(`status:${status}`); },
    save: async (_tx, write) => { saved.push(write); return 'run-1'; },
    fail: async (_tx, f) => { failures.push({ error: f.error, final: f.final }); },
  };
  return { store, calls, saved, failures };
}

function llmReturning(json: unknown | Error): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      if (json instanceof Error) throw json;
      return {
        model: 'claude-haiku-5-5', stopReason: 'end_turn', text: JSON.stringify(json), json, latencyMs: 900,
        usage: { inputTokens: 1500, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      };
    },
  };
}

const blobs = { get: async () => new Uint8Array([37, 80, 68, 70]) };
const clock = fixedClock('2026-10-25T10:00:00Z');
const tx = {} as TenantTx;
const ctx = (attempt = 1) => ({ tx, attempt, jobId: 'job-1', signal: new AbortController().signal });

describe('doc.extract handler', () => {
  it('reads, checks and saves a clean invoice as ready', async () => {
    const { store, calls, saved } = fakeStore();
    const llm = llmReturning(wire());
    await createDocExtractHandler({ llm, blobs, model: 'claude-haiku-5-5', clock, store })({ orgId: ORG, documentId: DOC }, ctx());
    expect(calls).toEqual(['status:extracting']);
    expect(llm.requests[0]?.model).toBe('claude-haiku-5-5');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      orgId: ORG, documentId: DOC, status: 'ready',
      patch: { class: 'received_invoice', totalGross: '121.00', partnerSnapshot: { ico: '27082440' } },
      vatSummary: [{ vatRateType: 'standard', vatRatePct: '21', base: '100', vat: '21' }],
      run: { model: 'claude-haiku-5-5', promptVersion: 'm02-proto-v3', attempt: 1, inputTokens: 1500, outputTokens: 300, latencyMs: 900 },
    });
  });

  it('sends a document with wrong VAT math to review', async () => {
    const { store, saved } = fakeStore();
    const llm = llmReturning(wire({ vat_recap: [{ rate_pct: '21', base: '100.00', vat: '30.00' }], totals: { net: '100.00', vat: '30.00', gross: '130.00' } }));
    await createDocExtractHandler({ llm, blobs, model: 'm', clock, store })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved[0]?.status).toBe('needs_review');
    expect(saved[0]?.validations.some((v) => v.severity === 'blocking')).toBe(true);
  });

  it('skips a document that was already read', async () => {
    const { store, calls, saved } = fakeStore({ status: 'ready' });
    const llm = llmReturning(wire());
    await createDocExtractHandler({ llm, blobs, model: 'm', clock, store })({ orgId: ORG, documentId: DOC }, ctx());
    expect(calls).toEqual([]);
    expect(saved).toEqual([]);
    expect(llm.requests).toEqual([]);
  });

  it('does nothing for a missing document', async () => {
    const { store, saved } = fakeStore(null);
    await createDocExtractHandler({ llm: llmReturning(wire()), blobs, model: 'm', clock, store })({ orgId: ORG, documentId: DOC }, ctx());
    expect(saved).toEqual([]);
  });

  it('re-throws a model error before the last attempt, records it on the last', async () => {
    const error = new AnthropicHttpError(529, '');
    const first = fakeStore();
    await expect(
      createDocExtractHandler({ llm: llmReturning(error), blobs, model: 'm', clock, store: first.store })({ orgId: ORG, documentId: DOC }, ctx(1)),
    ).rejects.toBe(error);
    expect(first.failures).toEqual([]);
    const last = fakeStore();
    await createDocExtractHandler({ llm: llmReturning(error), blobs, model: 'm', clock, store: last.store })({ orgId: ORG, documentId: DOC }, ctx(99));
    expect(last.failures).toEqual([{ error: 'http_529', final: true }]);
  });

  it('fails an unsupported file type at once', async () => {
    const { store, failures } = fakeStore({ mimeType: 'text/plain' });
    const llm = llmReturning(wire());
    await createDocExtractHandler({ llm, blobs, model: 'm', clock, store })({ orgId: ORG, documentId: DOC }, ctx());
    expect(failures).toEqual([{ error: 'unsupported_type', final: true }]);
    expect(llm.requests).toEqual([]);
  });
});
```

## 5. Do not touch

`apps/worker/src/registry.ts`, `apps/worker/src/worker.ts`, `packages/**`, `apps/web/**`. Hard rules 2 and 4.

## 6. Commands

The commands of steps 1 and 3, each ending `2>&1 | tail -30`.

## 7. Acceptance

- [ ] The test file is unchanged and passes; rows and registry tests still pass.
- [ ] `grep -n 'logger\.' apps/worker/src/doc-extract/*.ts` shows only ids, model names, error codes or names of missing variables.
- [ ] Typecheck and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0049-report.md` (600 tokens at most) and set `Status: review`. The report has the files changed, each command with the last 5 lines of output, §7 ticked, deviations, questions, owner steps left.

## Risk list (for the reviewer)

`apps/worker/src/doc-extract/handler.ts` (status gate, failure path), `register.ts` (secrets never logged).

## Owner steps

When the worker is deployed: set `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` on the worker service (never in the repo or the chat).
