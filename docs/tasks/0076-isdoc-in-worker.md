# 0076: The worker reads ISDOC first and skips the AI call

Status: done
Ticket: P1-EXT-06/07 (trimmed core loop) + M01 formats | Depends on: 0075 | Base commit: 1e90c0d (phase/0) | Branch: claude/project-thread-3666oz | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Before calling Haiku, `doc.extract` now looks for ISDOC data (embedded in the PDF, or an uploaded `.isdoc`, `.isdocx` or `.xml`). When it finds it, the values are saved with source `isdoc`, the same checks run, and no model call is made; otherwise Haiku reads the file as today. Uploads accept `.isdoc`, `.isdocx` and `.xml`.

## 2. Context

- M02 §4.1: "Skip the LLM iff … the source is (a) ISDOC …". Hard rule 2 still holds: the status comes from `statusAfterRead` after the checks (`runProtoChecks`), never from the reader.
- No migration: `field_source` already has `'isdoc'` (0001); `extraction_runs.method` is a `field_source` and `model` is nullable (0006).
- An ISDOC reading writes a run with `method: 'isdoc'`, `model: null`, `prompt_version: 'isdoc-6-v1'` and zero tokens; its `document_fields` rows have `source: 'isdoc'`.
- A PDF with a broken ISDOC falls back to Haiku. An `.isdoc`/`.xml`/`.isdocx` without readable ISDOC fails at once with error `isdoc_unreadable` (a model cannot read XML).
- Stored media types: `.isdoc`/`.xml` → `application/xml`, `.isdocx` → `application/x-isdocx` (browsers send `""` or a generic type for these). A plain `.zip` stays rejected.
- Hard rule 4: no document content in logs (the handler logs nothing new).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-reading.ts` | edit | `ReadingWrite`: field source `'llm'` or `'isdoc'`, optional `run.method`, `run.model` nullable |
| `apps/worker/src/doc-extract/rows.ts` | edit | `fieldsOf(x, source = 'llm')` |
| `apps/worker/src/doc-extract/handler.ts` | edit | ISDOC first, then the model |
| `apps/worker/test/doc-extract-isdoc.test.ts` | create | 5 tests |
| `apps/web/src/documents/upload.ts` | edit | accept and type ISDOC files (`uploadMediaTypeOf`) |
| `apps/web/src/documents/upload-dropzone.tsx` | edit | `accept` adds `.isdoc,.isdocx,.xml` |
| `apps/web/test/upload.test.ts` | edit | 2 tests added |

No other file may change. The whole change is the patch in §4; the orchestrator wrote it and checked that it applies to `phase/0` and passes §6.

## 4. Steps

1. Set `Status: in-progress` in this file. Apply the patch at the end of this section straight from this file (do not retype it):

```bash
awk '/^```diff$/{f=1;next} /^```$/{if(f)exit} f' docs/tasks/0076-isdoc-in-worker.md | git apply --whitespace=nowarn 2>&1 | tail -30
git status --short 2>&1 | tail -30
```

Expected: no output from `git apply`; `git status` lists exactly the §3 files and this brief. If `git apply` fails: STOP (§8), do not hand-edit.

2. Run the §6 commands in order; the expected results are given there. Commit `0076 step 2` (the patch plus this file).
3. Write the report (§9), set `Status: review`, commit `0076 report`. Do not push; the orchestrator pushes and opens the PR.

```diff
diff --git a/apps/web/src/documents/upload-dropzone.tsx b/apps/web/src/documents/upload-dropzone.tsx
index 17b6ed5..75a50c0 100644
--- a/apps/web/src/documents/upload-dropzone.tsx
+++ b/apps/web/src/documents/upload-dropzone.tsx
@@ -6,7 +6,7 @@ import { type ChangeEvent, type DragEvent, useState } from 'react';
 
 type UploadAnswer = { items?: { status: 'accepted' | 'duplicate' | 'rejected' }[] };
 
-const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
+const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.isdoc,.isdocx,.xml';
 
 /** One drop zone: drag files in or tap to pick them. Sends all files at once to POST /api/documents. */
 export function UploadDropzone() {
diff --git a/apps/web/src/documents/upload.ts b/apps/web/src/documents/upload.ts
index 43837b1..585acff 100644
--- a/apps/web/src/documents/upload.ts
+++ b/apps/web/src/documents/upload.ts
@@ -6,7 +6,20 @@ export const UPLOAD_MEDIA_TYPES: readonly string[] = [
   'image/jpeg',
   'image/png',
   'image/webp',
+  'application/xml', // .isdoc and .xml: the worker reads ISDOC data without AI
+  'application/x-isdocx', // .isdocx (a ZIP holding the ISDOC)
 ];
+
+/**
+ * The media type we store. Browsers send "" or a generic type for ISDOC files, so the extension
+ * decides for .isdoc, .isdocx and .xml; every other file keeps the type the browser sent.
+ */
+export function uploadMediaTypeOf(name: string, type: string): string {
+  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
+  if (ext === 'isdoc' || ext === 'xml') return 'application/xml';
+  if (ext === 'isdocx') return 'application/x-isdocx';
+  return type;
+}
 export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
 export const UPLOAD_MAX_FILES = 50;
 
@@ -67,7 +80,8 @@ export async function uploadDocuments(
       items.push({ fileName: file.name, status: 'rejected', reason: 'empty' });
       continue;
     }
-    if (!UPLOAD_MEDIA_TYPES.includes(file.type)) {
+    const mimeType = uploadMediaTypeOf(file.name, file.type);
+    if (!UPLOAD_MEDIA_TYPES.includes(mimeType)) {
       items.push({ fileName: file.name, status: 'rejected', reason: 'type' });
       continue;
     }
@@ -77,12 +91,12 @@ export async function uploadDocuments(
     }
     const sha256 = sha256Hex(file.bytes);
     const storagePath = filePath(ctx.orgId, sha256);
-    await deps.putFile(storagePath, file.bytes, file.type);
+    await deps.putFile(storagePath, file.bytes, mimeType);
     const source = await deps.insertSourceFile({
       orgId: ctx.orgId,
       sha256,
       storagePath,
-      mimeType: file.type,
+      mimeType,
       byteSize: file.bytes.byteLength,
       originalFilename: file.name,
       filenameNfc: file.name.normalize('NFC'),
diff --git a/apps/web/test/upload.test.ts b/apps/web/test/upload.test.ts
index a0ffedb..e91350d 100644
--- a/apps/web/test/upload.test.ts
+++ b/apps/web/test/upload.test.ts
@@ -5,6 +5,7 @@ import {
   UPLOAD_MAX_BYTES,
   type UploadDeps,
   uploadDocuments,
+  uploadMediaTypeOf,
 } from '../src/documents/upload';
 
 const ORG = '11111111-1111-4111-8111-111111111111';
@@ -109,6 +110,28 @@ describe('uploadDocuments', () => {
     expect(puts).toEqual([]);
   });
 
+  it('accepts ISDOC files whatever type the browser sends, and stores the type by extension', async () => {
+    const { deps, sources } = fakeDeps();
+    const bytes = (text: string) => new TextEncoder().encode(text);
+    const items = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [
+      { name: 'faktura.isdoc', type: '', bytes: bytes('<Invoice/>') },
+      { name: 'faktura.ISDOCX', type: 'application/octet-stream', bytes: bytes('PK') },
+      { name: 'data.xml', type: 'text/xml', bytes: bytes('<x/>') },
+      { name: 'archive.zip', type: 'application/zip', bytes: bytes('PK2') },
+    ]);
+    expect(items.map((i) => i.status)).toEqual(['accepted', 'accepted', 'accepted', 'rejected']);
+    expect([...sources.values()].map((s) => s.row.mimeType)).toEqual([
+      'application/xml',
+      'application/x-isdocx',
+      'application/xml',
+    ]);
+  });
+
+  it('keeps the type the browser sent for other files', () => {
+    expect(uploadMediaTypeOf('a.pdf', 'application/pdf')).toBe('application/pdf');
+    expect(uploadMediaTypeOf('noext', 'image/png')).toBe('image/png');
+  });
+
   it('keeps the document when the queue is down', async () => {
     const { deps } = fakeDeps({ failEnqueue: true });
     const [item] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('b')]);
diff --git a/apps/worker/src/doc-extract/handler.ts b/apps/worker/src/doc-extract/handler.ts
index f0e2ce2..9b747ec 100644
--- a/apps/worker/src/doc-extract/handler.ts
+++ b/apps/worker/src/doc-extract/handler.ts
@@ -9,12 +9,16 @@ import { type Clock, createCzRules, parseLegalDate, pragueToday } from '@shoebox
 import {
   AnthropicHttpError,
   buildProtoRequest,
+  ISDOC_READER_VERSION,
+  type IsdocReading,
   isProtoMediaType,
   type LlmClient,
   type LlmResponse,
   PROTO_PROMPT_VERSION,
+  type ProtoExtraction,
   ProtoParseError,
   parseProtoExtraction,
+  readIsdoc,
 } from '@shoebox/extraction';
 import { DEFAULT_RETRY, type DocumentStagePayload } from '@shoebox/pipeline';
 import { runProtoChecks } from '@shoebox/validation';
@@ -57,6 +61,18 @@ function errorCode(error: unknown, fallback: 'error' | 'storage'): string {
   return fallback;
 }
 
+/** Media types stored for .isdoc/.xml and .isdocx uploads: only their ISDOC data can be read. */
+const ISDOC_ONLY_TYPES: readonly string[] = ['application/xml', 'application/x-isdocx'];
+
+/** ISDOC data of the file, or null (none, or unreadable: the caller then uses the model). */
+function isdocOf(bytes: Uint8Array): IsdocReading | null {
+  try {
+    return readIsdoc(bytes);
+  } catch {
+    return null;
+  }
+}
+
 /** VAT rates in force at the document's date; falls back to today when the date is outside the rule tables. */
 function ratesFor(date: string | null, clock: Clock): VatRates {
   try {
@@ -101,7 +117,9 @@ export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<Doc
     await store.setStatus(ctx.tx, doc.id, 'extracting');
 
     const mediaType = doc.mimeType;
-    if (!isProtoMediaType(mediaType)) {
+    const isdocOnly = ISDOC_ONLY_TYPES.includes(mediaType);
+    const modelType = isProtoMediaType(mediaType) ? mediaType : null;
+    if (modelType === null && !isdocOnly) {
       await store.fail(ctx.tx, { ...run, error: 'unsupported_type', final: true });
       return;
     }
@@ -113,18 +131,11 @@ export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<Doc
       return onError(error, errorCode(error, 'storage'));
     }
 
-    let response: LlmResponse;
-    try {
-      response = await deps.llm.complete(
-        buildProtoRequest({ model: deps.model, file: { bytes, mediaType } }),
-      );
-    } catch (error) {
-      return onError(error, errorCode(error, 'error'));
-    }
-
-    let write: ReadingWrite;
-    try {
-      const extraction = parseProtoExtraction(response.json);
+    const toWrite = (
+      extraction: ProtoExtraction,
+      source: 'llm' | 'isdoc',
+      runRow: ReadingWrite['run'],
+    ): ReadingWrite => {
       const rates = ratesFor(
         extraction.dates.duzp ?? extraction.dates.issue_date ?? null,
         deps.clock,
@@ -136,15 +147,53 @@ export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<Doc
           : { ico: doc.orgIco, dic: doc.orgDic };
       const checks = runProtoChecks(extraction, org === undefined ? { today } : { today, org });
       const rows = validationRowsOf(checks);
-      write = {
+      return {
         orgId: doc.orgId,
         documentId: doc.id,
         status: statusAfterRead(extraction, rows),
         patch: documentPatchOf(extraction),
         vatSummary: vatSummaryOf(extraction, rates),
-        fields: fieldsOf(extraction),
+        fields: fieldsOf(extraction, source),
         validations: rows,
-        run: {
+        run: runRow,
+      };
+    };
+
+    let write: ReadingWrite;
+    // Step 1: exact data first. An ISDOC (plain, .isdocx or embedded in the PDF) is read without AI.
+    const isdoc = mediaType === 'application/pdf' || isdocOnly ? isdocOf(bytes) : null;
+    if (isdoc !== null) {
+      try {
+        write = toWrite(isdoc.extraction, 'isdoc', {
+          method: 'isdoc',
+          model: null,
+          promptVersion: ISDOC_READER_VERSION,
+          attempt: ctx.attempt,
+          inputTokens: 0,
+          outputTokens: 0,
+          cacheReadTokens: 0,
+          cacheWriteTokens: 0,
+          latencyMs: 0,
+        });
+      } catch (error) {
+        return onError(error, 'parse');
+      }
+    } else if (modelType === null) {
+      // An XML or .isdocx without readable ISDOC data: nothing a model could read either.
+      await store.fail(ctx.tx, { ...run, error: 'isdoc_unreadable', final: true });
+      return;
+    } else {
+      // Step 2: no ISDOC, so the model reads the page.
+      let response: LlmResponse;
+      try {
+        response = await deps.llm.complete(
+          buildProtoRequest({ model: deps.model, file: { bytes, mediaType: modelType } }),
+        );
+      } catch (error) {
+        return onError(error, errorCode(error, 'error'));
+      }
+      try {
+        write = toWrite(parseProtoExtraction(response.json), 'llm', {
           model: response.model,
           promptVersion: PROTO_PROMPT_VERSION,
           attempt: ctx.attempt,
@@ -153,11 +202,11 @@ export function createDocExtractHandler(deps: DocExtractDeps): TenantHandler<Doc
           cacheReadTokens: response.usage.cacheReadInputTokens,
           cacheWriteTokens: response.usage.cacheCreationInputTokens,
           latencyMs: response.latencyMs,
-        },
-      };
-    } catch (error) {
-      // Any throw after parsing (e.g. an invalid currency code) counts as a parse failure.
-      return onError(error, 'parse');
+        });
+      } catch (error) {
+        // Any throw after parsing (e.g. an invalid currency code) counts as a parse failure.
+        return onError(error, 'parse');
+      }
     }
 
     try {
diff --git a/apps/worker/src/doc-extract/rows.ts b/apps/worker/src/doc-extract/rows.ts
index a2e5184..1339786 100644
--- a/apps/worker/src/doc-extract/rows.ts
+++ b/apps/worker/src/doc-extract/rows.ts
@@ -62,7 +62,7 @@ export interface VatSummaryRow {
 export interface FieldRow {
   readonly fieldKey: string;
   readonly valueText: string;
-  readonly source: 'llm';
+  readonly source: 'llm' | 'isdoc';
 }
 
 export type StatusAfterRead = 'ready' | 'needs_review' | 'supporting';
@@ -175,7 +175,7 @@ export function vatSummaryOf(x: ProtoExtraction, rates: VatRates): VatSummaryRow
   }));
 }
 
-export function fieldsOf(x: ProtoExtraction): FieldRow[] {
+export function fieldsOf(x: ProtoExtraction, source: FieldRow['source'] = 'llm'): FieldRow[] {
   const pairs: Array<[string, string | null]> = [
     ['supplier.name', x.supplier.name],
     ['supplier.ico', x.supplier.ico],
@@ -211,7 +211,7 @@ export function fieldsOf(x: ProtoExtraction): FieldRow[] {
   const rows: FieldRow[] = [];
   for (const [fieldKey, value] of pairs) {
     if (value !== null) {
-      rows.push({ fieldKey, valueText: value, source: 'llm' });
+      rows.push({ fieldKey, valueText: value, source });
     }
   }
   return rows;
diff --git a/apps/worker/test/doc-extract-isdoc.test.ts b/apps/worker/test/doc-extract-isdoc.test.ts
new file mode 100644
index 0000000..3ae94ec
--- /dev/null
+++ b/apps/worker/test/doc-extract-isdoc.test.ts
@@ -0,0 +1,162 @@
+import type { DocumentForRead, ReadingWrite, TenantTx } from '@shoebox/db';
+import { fixedClock } from '@shoebox/domain';
+import type { LlmClient, LlmRequest } from '@shoebox/extraction';
+import { describe, expect, it } from 'vitest';
+import { createDocExtractHandler, type ReadingStore } from '../src/doc-extract/handler';
+
+// Synthetic data only: IČO 12345679 is a made-up number with a valid check digit.
+const ORG = '11111111-1111-4111-8111-111111111111';
+const DOC = '22222222-2222-4222-8222-222222222222';
+
+const ISDOC = `<?xml version="1.0" encoding="UTF-8"?>
+<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
+  <DocumentType>1</DocumentType>
+  <ID>FV-2026-0042</ID>
+  <IssueDate>2026-09-12</IssueDate>
+  <TaxPointDate>2026-09-12</TaxPointDate>
+  <VATApplicable>true</VATApplicable>
+  <LocalCurrencyCode>CZK</LocalCurrencyCode>
+  <AccountingSupplierParty><Party>
+    <PartyIdentification><ID>12345679</ID></PartyIdentification>
+    <PartyName><Name>Example Supplier s.r.o.</Name></PartyName>
+    <PostalAddress><Country><IdentificationCode>CZ</IdentificationCode></Country></PostalAddress>
+    <PartyTaxScheme><CompanyID>CZ12345679</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>
+  </Party></AccountingSupplierParty>
+  <TaxTotal>
+    <TaxSubTotal><TaxableAmount>100.00</TaxableAmount><TaxAmount>21.00</TaxAmount><TaxCategory><Percent>21</Percent></TaxCategory></TaxSubTotal>
+    <TaxAmount>21.00</TaxAmount>
+  </TaxTotal>
+  <LegalMonetaryTotal><TaxExclusiveAmount>100.00</TaxExclusiveAmount><TaxInclusiveAmount>121.00</TaxInclusiveAmount><PayableAmount>121.00</PayableAmount></LegalMonetaryTotal>
+  <PaymentMeans><Payment><PaymentMeansCode>42</PaymentMeansCode>
+    <Details><PaymentDueDate>2026-09-26</PaymentDueDate><ID>123</ID><BankCode>0100</BankCode><VariableSymbol>20260042</VariableSymbol></Details>
+  </Payment></PaymentMeans>
+</Invoice>`;
+
+const enc = (s: string) => new TextEncoder().encode(s);
+
+/** A tiny PDF whose only stream is an uncompressed embedded ISDOC (or a page content stream). */
+function pdfWith(embedded: string | null): Uint8Array {
+  const body = embedded ?? 'BT (Faktura) Tj ET';
+  const type = embedded === null ? '' : '/Type /EmbeddedFile ';
+  return enc(
+    `%PDF-1.7\n5 0 obj\n<< ${type}/Length ${enc(body).length} >>\nstream\n${body}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
+  );
+}
+
+function fakeStore(doc: Partial<DocumentForRead>) {
+  const saved: ReadingWrite[] = [];
+  const failures: Array<{ error: string; final: boolean }> = [];
+  const store: ReadingStore = {
+    load: async () => ({
+      id: DOC,
+      orgId: ORG,
+      status: 'received',
+      storagePath: `org/${ORG}/files/x`,
+      mimeType: 'application/pdf',
+      orgIco: null,
+      orgDic: null,
+      ...doc,
+    }),
+    setStatus: async () => {},
+    save: async (_tx, write) => {
+      saved.push(write);
+      return 'run-1';
+    },
+    fail: async (_tx, f) => {
+      failures.push({ error: f.error, final: f.final });
+    },
+  };
+  return { store, saved, failures };
+}
+
+/** A model that must not be called for ISDOC files; when it is, it answers with an empty object. */
+function spyLlm(): LlmClient & { requests: LlmRequest[] } {
+  const requests: LlmRequest[] = [];
+  return {
+    requests,
+    async complete(request) {
+      requests.push(request);
+      return {
+        model: 'claude-haiku-5-5',
+        stopReason: 'end_turn',
+        text: '{}',
+        json: {},
+        latencyMs: 1,
+        usage: {
+          inputTokens: 1,
+          outputTokens: 1,
+          cacheReadInputTokens: 0,
+          cacheCreationInputTokens: 0,
+        },
+      };
+    },
+  };
+}
+
+const clock = fixedClock('2026-10-25T10:00:00Z');
+const ctx = {
+  tx: {} as TenantTx,
+  attempt: 1,
+  jobId: 'job-1',
+  signal: new AbortController().signal,
+};
+
+async function run(mimeType: string, bytes: Uint8Array) {
+  const { store, saved, failures } = fakeStore({ mimeType });
+  const llm = spyLlm();
+  await createDocExtractHandler({
+    llm,
+    blobs: { get: async () => bytes },
+    model: 'm',
+    clock,
+    store,
+  })({ orgId: ORG, documentId: DOC }, ctx);
+  return { saved, failures, llm };
+}
+
+describe('doc.extract with ISDOC data', () => {
+  it('reads a PDF with an embedded ISDOC exactly, without calling the model', async () => {
+    const { saved, llm } = await run('application/pdf', pdfWith(ISDOC));
+    expect(llm.requests).toEqual([]);
+    expect(saved).toHaveLength(1);
+    expect(saved[0]).toMatchObject({
+      status: 'ready',
+      patch: { class: 'received_invoice', documentNumber: 'FV-2026-0042', totalGross: '121.00' },
+      run: {
+        method: 'isdoc',
+        model: null,
+        promptVersion: 'isdoc-6-v1',
+        inputTokens: 0,
+        outputTokens: 0,
+      },
+    });
+    expect(saved[0]?.fields.length).toBeGreaterThan(0);
+    expect(saved[0]?.fields.every((f) => f.source === 'isdoc')).toBe(true);
+  });
+
+  it('reads a plain .isdoc upload (stored as application/xml) without the model', async () => {
+    const { saved, llm } = await run('application/xml', enc(ISDOC));
+    expect(llm.requests).toEqual([]);
+    expect(saved[0]?.run.method).toBe('isdoc');
+  });
+
+  it('still asks the model for a PDF without ISDOC', async () => {
+    const { llm } = await run('application/pdf', pdfWith(null));
+    expect(llm.requests).toHaveLength(1);
+  });
+
+  it('fails an XML file without readable ISDOC at once, without the model', async () => {
+    const { saved, failures, llm } = await run(
+      'application/xml',
+      enc('<Invoice xmlns="urn:other"/>'),
+    );
+    expect(llm.requests).toEqual([]);
+    expect(saved).toEqual([]);
+    expect(failures).toEqual([{ error: 'isdoc_unreadable', final: true }]);
+  });
+
+  it('falls back to the model when a PDF carries a broken ISDOC', async () => {
+    const { llm } = await run('application/pdf', pdfWith(ISDOC.replace('</Invoice>', '')));
+    expect(llm.requests).toHaveLength(1);
+  });
+});
diff --git a/packages/db/src/document-reading.ts b/packages/db/src/document-reading.ts
index b0fc1c8..dcfc2ee 100644
--- a/packages/db/src/document-reading.ts
+++ b/packages/db/src/document-reading.ts
@@ -51,7 +51,7 @@ export interface ReadingWrite {
     base: string;
     vat: string;
   }[];
-  readonly fields: readonly { fieldKey: string; valueText: string; source: 'llm' }[];
+  readonly fields: readonly { fieldKey: string; valueText: string; source: 'llm' | 'isdoc' }[];
   readonly validations: readonly {
     ruleId: string;
     ruleVersion: number;
@@ -59,7 +59,9 @@ export interface ReadingWrite {
     params: Record<string, unknown>;
   }[];
   readonly run: {
-    readonly model: string;
+    /** How the values were read; default 'llm'. 'isdoc' = from the file's ISDOC data, no model call. */
+    readonly method?: 'llm' | 'isdoc';
+    readonly model: string | null;
     readonly promptVersion: string;
     readonly attempt: number;
     readonly inputTokens: number;
@@ -112,7 +114,7 @@ export async function saveDocumentReading(tx: TenantTx, write: ReadingWrite): Pr
       orgId,
       documentId,
       stage: 'extract',
-      method: 'llm',
+      method: run.method ?? 'llm',
       ok: true,
       model: run.model,
       promptVersion: run.promptVersion,
```

## 5. Do not touch

`packages/db/migrations/**`, `packages/extraction/**`, `packages/validation/**`, the existing worker test files. Hard rules 2 (status only after checks), 3 (org-scoped writes), 4 (no content in logs).

## 6. Commands

- `pnpm --filter @shoebox/worker test -- test/doc-extract-isdoc.test.ts test/doc-extract-handler.test.ts test/doc-extract-rows.test.ts 2>&1 | tail -30` → all pass
- `pnpm --filter @shoebox/web test -- test/upload.test.ts 2>&1 | tail -30` → `Tests  7 passed (7)`
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`, then the same for `@shoebox/db` and `@shoebox/web` → no errors
- `pnpm exec biome check apps/worker apps/web/src/documents apps/web/test/upload.test.ts packages/db/src 2>&1 | tail -30` → no errors

## 7. Acceptance

- [ ] `git diff --stat HEAD~2` lists only the §3 files plus this brief and the report.
- [ ] The §6 commands pass; the existing handler and rows tests are unchanged and green.
- [ ] `grep -c "method: run.method ?? 'llm'" packages/db/src/document-reading.ts` → `1`.

## 8. Stop and ask

Stop and write the report if: `git apply` fails; a test fails twice; a file outside §3 changes; a new dependency seems needed; you reach 25 tool calls or about 50k tokens.

## 9. Report

Write `docs/tasks/0076-report.md` (600 tokens at most): files changed (`git diff --stat HEAD~2`), each command with the last 5 lines of its output, deviations (none expected).
