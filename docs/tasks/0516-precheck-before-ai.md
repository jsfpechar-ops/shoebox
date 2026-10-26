# 0516: Run the free pre-check before any model call

Status: todo
Ticket: owner request 2026-10-26 | Depends on: 0514, 0515 | Base commit: branch head after 0515 | Branch: claude/project-thread-jrsxk4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`doc.split` and `doc.extract` call `precheckDocument` (0515) before the model. A bank statement, a tax or office report, a newsletter, a too-long or too-large file is saved as a skipped reading with a friendly message and costs zero tokens; everything else is read as before.

## 2. Context

- `@shoebox/extraction` exports `precheckDocument`, `PrecheckVerdict`, `PRECHECK_VERSION`, `SPLIT_MAX_PAGES`, `pdfPageCount`, `scanDocument`, `DocumentScan` (0515).
- `packages/db/src/document-reading.ts`: `ReadingPatch.classSource: 'llm'` and `ReadingWrite.run.method?: 'llm' | 'isdoc'`. The db enum `field_source` already has `'rule'`.
- `apps/worker/src/doc-extract/handler.ts`, after the scan block: `const isdoc = parts === null && (...) ? isdocOf(bytes) : null;` then `if (isdoc !== null) {...} else if (modelType === null) {...} else { // Step 2: no ISDOC, so the model reads the page.`. Earlier: `const pages = store.loadPages ? await store.loadPages(ctx.tx, doc.id) : [];` (one row per chosen page) inside a try.
- `apps/worker/src/doc-split/handler.ts` loop: `let pageCount = 1; if (mime === 'application/pdf') { try { pageCount = await countPages(bytes); } catch { direct.add(file.documentId); continue; } } sortable.push(...)`. Direct files skip the sort call and are read on their own.
- `apps/web/src/documents/detail-data.ts` shows an open validation row's `params.messageKey` when it is a key of `packages/i18n/messages/en.json`; the other params are its ICU arguments.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-reading.ts` | edit | `classSource: 'llm' \| 'rule'`; `method?: 'llm' \| 'isdoc' \| 'rule'` (doc comment: `'rule' = skipped by the free pre-check, no model call`) |
| `apps/worker/src/doc-extract/rows.ts` | edit | `precheckWriteOf` (step 2) |
| `apps/worker/src/doc-extract/handler.ts` | edit | pre-check before the model (step 3) |
| `apps/worker/src/doc-split/handler.ts` | edit | pre-checked files skip the sort (step 4) |
| `packages/i18n/messages/en.json` | edit | five keys (step 5) |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | tests (step 6) |
| `apps/worker/test/doc-split-handler.test.ts` | edit | tests (step 6) |

No other file may change.

## 4. Steps

1. `document-reading.ts`: widen the two types as in §3. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.
2. `rows.ts`: add
   ```ts
   /** The reading saved for a document the free pre-check skipped (0516): no values, one message, no model call. */
   export function precheckWriteOf(
     ids: { readonly orgId: string; readonly documentId: string },
     verdict: Extract<PrecheckVerdict, { kind: 'skip' }>,
     attempt: number,
   ): ReadingWrite
   ```
   returning `status: verdict.status`; `patch` with `class: verdict.documentClass`, `classSource: 'rule'`, `direction: 'in'`, `taxDocStatus: verdict.status === 'supporting' ? 'not_tax_document' : 'unknown'`, `currency: 'CZK'`, every other `ReadingPatch` field `null`; `vatSummary: []`; `fields: []`; `validations: [{ ruleId: 'PRECHECK_SKIPPED', ruleVersion: 1, severity: 'warning', params: { reason: verdict.reason, messageKey: \`precheck.${verdict.reason}\` } }]`; `run: { method: 'rule', model: null, promptVersion: PRECHECK_VERSION, attempt, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 0 }`. Import `ReadingWrite` from `@shoebox/db` and `PrecheckVerdict`, `PRECHECK_VERSION` from `@shoebox/extraction` (merge into existing import lines).
3. `handler.ts`:
   - Add `readonly countPages?: (bytes: Uint8Array) => Promise<number>; // default pdfPageCount` to `DocExtractDeps`.
   - Hoist `let pageRows = 0;` before the loadPages try and set `pageRows = pages.length;` inside it.
   - Replace the `} else {` that opens "Step 2" with:
     ```ts
     } else {
       // Step 2: free pre-check (0516). A clear non-invoice, or a file too long or large, costs no tokens.
       let pageCount: number | null = parts === null ? null : pageRows;
       if (parts === null && mediaType === 'application/pdf') {
         try {
           pageCount = await (deps.countPages ?? pdfPageCount)(bytes);
         } catch {
           pageCount = null;
         }
       }
       const byteLength = parts === null ? bytes.length : parts.reduce((n, p) => n + p.bytes.length, 0);
       const verdict = precheckDocument({ byteLength, pageCount, scan });
       if (verdict.kind === 'skip') {
         try {
           await store.save(ctx.tx, precheckWriteOf({ orgId: doc.orgId, documentId: doc.id }, verdict, ctx.attempt));
         } catch (error) {
           return onError(error, errorCode(error, 'error'), true);
         }
         return;
       }
       // Step 3: no ISDOC and not skipped, so the model reads the page.
     ```
     and keep the existing body of that branch after it. (`onError` takes three arguments since 0514; if it takes two, STOP.)
4. `doc-split/handler.ts`:
   - Add `readonly scan?: (bytes: Uint8Array, mediaType: string) => Promise<DocumentScan>; // default scanDocument` to `DocSplitDeps`.
   - In the loop, right after the PDF `pageCount` try/catch, add:
     ```ts
     // 0516: a long PDF, or one the free pre-check skips, is never sent to the sort call.
     if (mime === 'application/pdf' && (pageCount > SPLIT_MAX_PAGES || (await skippedByPrecheck(bytes, mime)))) {
       direct.add(file.documentId);
       continue;
     }
     ```
     with a helper inside `createDocSplitHandler`:
     ```ts
     const skippedByPrecheck = async (bytes: Uint8Array, mime: string): Promise<boolean> => {
       try {
         const scan = await (deps.scan ?? scanDocument)(bytes, mime);
         return precheckDocument({ byteLength: bytes.length, pageCount: null, scan }).kind === 'skip';
       } catch {
         return false;
       }
     };
     ```
5. `en.json`: add after the last `proto.check.` key, keeping the file's style:
   - `"precheck.bank_statement": "This looks like a bank statement, not an invoice, so we didn't read it. To bring in your payments, download the statement from your internet banking as GPC (ABO), CAMT.053 XML or MT940 and drop that file here."`
   - `"precheck.government_filing": "This looks like a tax return or a report for an office, not an invoice, so we didn't read it. We kept it as a supporting document."`
   - `"precheck.not_invoice": "This looks like a newsletter or an advert, not an invoice, so we didn't read it. We kept it as a supporting document."`
   - `"precheck.too_many_pages": "This file has more pages than one invoice usually has, so we didn't read it. Upload only the invoice pages, or split the file into smaller ones."`
   - `"precheck.too_large": "This file is too large to read. Upload a smaller copy, or only the invoice pages."`
   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`. If a test demands the keys in another file (e.g. `cs.json`), STOP (§8): rule 6 says write no new Czech.
6. Tests (synthetic text only):
   - `doc-extract-handler.test.ts`: (a) "skips a bank statement without a model call": `scan: async () => ({ text: 'VÝPIS Z ÚČTU 1. 9. 2026 - 30. 9. 2026 12345678901', textGood: true, qrTexts: [] })`, `countPages: async () => 2` → `llm.requests` empty, `saved[0]` matches `{ status: 'supporting', patch: { class: 'bank_statement', classSource: 'rule' }, run: { method: 'rule', inputTokens: 0 }, validations: [{ ruleId: 'PRECHECK_SKIPPED', params: { messageKey: 'precheck.bank_statement' } }] }`. (b) "skips a 21-page PDF": `countPages: async () => 21`, no scan text → `status: 'needs_review'`, messageKey `precheck.too_many_pages`, no request. (c) "still reads an invoice": scan text `'FAKTURA - DAŇOVÝ DOKLAD 2026001 12345678901'`, `countPages: async () => 1` → one request.
   - `doc-split-handler.test.ts`: copy an existing two-page case; add `scan` returning the bank statement text → the LLM is not called and the document is passed to `enqueueRead`. And one with `countPages: async () => 41` (no scan text) → the LLM is not called. Then run the whole file once: existing cases may need `scan: async () => ({ text: null, textGood: false, qrTexts: [] })` in their deps; adding that to existing deps is allowed, changing their expectations is not.

## 5. Do not touch

`packages/extraction/**` (0515 owns it), `packages/pipeline/**`, `apps/web/**`, `packages/i18n/messages/cs.json`, `packages/i18n/later/**`. No migration (no schema change: `'rule'` is already in the enum). Rule 4: no document content in logs.

## 6. Commands

```
pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/doc-extract-rows.test.ts test/doc-extract-parts.test.ts test/doc-extract-isdoc.test.ts test/doc-split-handler.test.ts 2>&1 | tail -30
pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30
pnpm --filter @shoebox/db typecheck 2>&1 | tail -30
pnpm --filter @shoebox/i18n test 2>&1 | tail -30
```

## 7. Acceptance

- [ ] All four commands pass.

## 8. Stop and ask

As TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0516-report.md` (600 tokens at most), set `Status: review`, commit on the current branch with message `0516: free pre-check before any model call`. Do not push.
