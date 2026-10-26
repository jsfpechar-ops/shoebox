# 0113: Bank statements dropped into the normal upload

Status: todo
Ticket: P2-BANK-04 (upload half) | Depends on: 0111 | Base commit: see branch | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A user drops a bank statement (GPC/ABO, CAMT.053 XML or MT940) into the same upload box as invoices, and the app recognises it and imports the payments instead of treating it as an invoice. No new button or screen: fewest buttons for a layman.

## 2. Context

M11: "No new top-level screen without an ADR"; Phase 2 adds bank content to existing screens. Backlog P2-BANK-04: "uploads recognised as statements go to bank import".

`@shoebox/bank` exports `detectStatementFormat(bytes, filename?)` → `{ format, ... }`; it throws `StatementTooLargeError` above 10 MB. Formats with a parser: `'gpc' | 'camt053' | 'mt940'`. `@shoebox/pipeline` exports `bankImportStatementJob` (payload `{ orgId, sourceFileId }`), `jobKey`, `jobIdFromKey`.

`apps/web/src/documents/upload.ts` excerpts (anchors):
```ts
  'application/x-isdocx', // .isdocx (a ZIP holding the ISDOC)
];
```
```ts
  if (ext === 'isdocx') return 'application/x-isdocx';
  return type;
```
```ts
  /** Queues the sorting job for the drop (doc.split). */
  enqueueSort(orgId: string, batchId: string): Promise<void>;
```
```ts
  | {
      readonly fileName: string;
      readonly status: 'rejected';
      readonly reason: 'type' | 'size' | 'empty';
    };
```
```ts
    if (!source.created) {
      const existing = await deps.findDocumentBySource(source.id);
```
`apps/web/src/documents/enqueue.ts` has `enqueueEmailReceived` built as:
```ts
export async function enqueueEmailReceived(orgId: string, inboundEmailId: string): Promise<void> {
  const payload = emailReceivedJob.payload.parse({ orgId, inboundEmailId });
  const key = jobKey(emailReceivedJob, payload);
  await (await boss()).send(emailReceivedJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}
```
`apps/web/src/documents/supabase-deps.ts`: `supabaseUploadDeps(supabase)` returns the `UploadDeps` object; it imports `enqueueDocSplit` from `./enqueue`.

`apps/web/src/documents/upload-dropzone.tsx`:
```ts
type UploadAnswer = { items?: { status: 'accepted' | 'duplicate' | 'rejected' }[] };

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.isdoc,.isdocx,.xml';
```
```ts
        { n: count('duplicate'), key: 'inbox.upload.duplicate' as const },
```
`packages/i18n/messages/en.json` line: `  "inbox.upload.duplicate": "{n, plural, one {# file is already here} other {# files are already here}}.",` and `inbox.upload.hint` / `inbox.upload.rejected` (texts in §4). English copy only; `cs.json` stays untouched.

`apps/web/test/upload.test.ts` has `fakeDeps()` building a `UploadDeps` object whose last members are `enqueueSort`, `newBatchId`, `today`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/package.json` | edit | add `"@shoebox/bank": "workspace:*",` as the first dependency |
| `pnpm-lock.yaml` | edit | by `pnpm install` only |
| `apps/web/src/documents/upload.ts` | edit | statement routing |
| `apps/web/src/documents/enqueue.ts` | edit | `enqueueBankImport` |
| `apps/web/src/documents/supabase-deps.ts` | edit | wire `enqueueStatement` |
| `apps/web/src/documents/upload-dropzone.tsx` | edit | accept + message |
| `packages/i18n/messages/en.json` | edit | one new key, two texts |
| `apps/web/test/upload.test.ts` | edit | fake + new tests |

No other file may change.

## 4. Steps

1. Add the dependency, `pnpm install 2>&1 | tail -5`. Commit `0113 step 1`.

2. `upload.ts`:
   - add `'text/plain', // .gpc, .abo, .sta, .mt940 bank statements` after the `application/x-isdocx` entry of `UPLOAD_MEDIA_TYPES`;
   - in `uploadMediaTypeOf`, before `return type;` add `if (ext === 'gpc' || ext === 'abo' || ext === 'sta' || ext === 'mt940') return 'text/plain';`;
   - in `UploadDeps`, after `enqueueSort`, add
```ts
  /** Queues bank.import.statement for a stored statement file. */
  enqueueStatement(orgId: string, sourceFileId: string): Promise<void>;
```
   - add to `UploadItem` the member `| { readonly fileName: string; readonly status: 'statement' }`;
   - add an exported helper
```ts
/** True when the file is a bank statement we can import (GPC/ABO, CAMT.053, MT940). */
export function isBankStatement(name: string, mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType !== 'text/plain' && mimeType !== 'application/xml') return false;
  try {
    const { format } = detectStatementFormat(bytes, name);
    return format === 'gpc' || format === 'camt053' || format === 'mt940';
  } catch {
    return false;
  }
}
```
   (`import { detectStatementFormat } from '@shoebox/bank';`);
   - in `uploadDocuments`, right after the `insertSourceFile` call (before `if (!source.created) {`) add
```ts
    if (isBankStatement(file.name, mimeType, file.bytes)) {
      await deps.enqueueStatement(ctx.orgId, source.id);
      items.push({ fileName: file.name, status: 'statement' });
      continue;
    }
    if (mimeType === 'text/plain') {
      items.push({ fileName: file.name, status: 'rejected', reason: 'type' });
      continue;
    }
```
   (A re-upload of the same statement enqueues again; the worker skips a file already imported.) Commit `0113 step 2`.

3. `enqueue.ts`: add `bankImportStatementJob` to the `@shoebox/pipeline` import and, below `enqueueEmailReceived`, `export async function enqueueBankImport(orgId: string, sourceFileId: string): Promise<void>` built exactly like `enqueueEmailReceived` with `bankImportStatementJob` and `{ orgId, sourceFileId }`. `supabase-deps.ts`: import `enqueueBankImport` next to `enqueueDocSplit` and add to the returned object `enqueueStatement: (orgId, sourceFileId) => enqueueBankImport(orgId, sourceFileId),`. Commit `0113 step 3`.

4. `upload-dropzone.tsx`: `UploadAnswer` status union gains `'statement'`; `ACCEPT` gains `,.gpc,.abo,.sta,.mt940` at the end of the string; after the `duplicate` line add `        { n: count('statement'), key: 'inbox.upload.statement' as const },`. `en.json`: after the `inbox.upload.duplicate` line add
```json
  "inbox.upload.statement": "{n, plural, one {# bank statement found, importing the payments} other {# bank statements found, importing the payments}}.",
```
and change `inbox.upload.hint` to `"A PDF, a photo of a receipt, an ISDOC file or a bank statement. We read it and check it for you."` and the second sentence of `inbox.upload.rejected` to `Send a PDF, a photo, an ISDOC file or a bank statement (GPC, ABO, CAMT.053 XML, MT940) up to 20 MB.` Commit `0113 step 4`.

5. `upload.test.ts`: in `fakeDeps`, add `const statements: string[] = [];`, the member `async enqueueStatement(_org, sourceFileId) { statements.push(sourceFileId); },` before `newBatchId`, and return `statements` too. Append this block at the end of the file, verbatim:
```ts
describe('bank statements in the upload', () => {
  const gpc = `074${'0'.repeat(6)}2400123455${'SYSEL TEST'.padEnd(20)}${'0'.repeat(89)}`;
  const file = (name: string, text: string, type = '') => ({ name, type, bytes: new TextEncoder().encode(text) });

  it('sends a GPC or MT940 file to bank import instead of making a document', async () => {
    const f = fakeDeps();
    const sta = ':20:S\n:25:2400123455/2010\n:61:260915C5,00NTRF//R1\n';
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [
      file('vypis.gpc', gpc),
      file('vypis.sta', sta, 'application/octet-stream'),
    ]);
    expect(items).toEqual([
      { fileName: 'vypis.gpc', status: 'statement' },
      { fileName: 'vypis.sta', status: 'statement' },
    ]);
    expect(f.statements).toEqual(['sf-1', 'sf-2']);
    expect(f.inserted).toEqual([]);
    expect(f.enqueued).toEqual([]);
  });

  it('sends a CAMT.053 XML to bank import but keeps ISDOC XML a document', async () => {
    const f = fakeDeps();
    const camt =
      '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>';
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [
      file('vypis.xml', camt, 'text/xml'),
      file('faktura.isdoc', '<Invoice xmlns="http://isdoc.cz/namespace/2013"/>'),
    ]);
    expect(items.map((i) => i.status)).toEqual(['statement', 'accepted']);
    expect(f.statements).toHaveLength(1);
    expect(f.inserted).toHaveLength(1);
  });

  it('rejects a text file that is not a statement', async () => {
    const f = fakeDeps();
    const items = await uploadDocuments(f.deps, { orgId: ORG, userId: USER }, [file('notes.gpc', 'hello')]);
    expect(items).toEqual([{ fileName: 'notes.gpc', status: 'rejected', reason: 'type' }]);
  });
});
```
Run `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30` → all pass (old and new). Commit `0113 step 5`.

## 5. Do not touch

`packages/` except `en.json`; `cs.json`; the worker; other web files. Hard rules: every string through `packages/i18n` (English in `en.json`); no new screen; no new external dependency.

## 6. Commands

- `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors.
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → pass.
- `pnpm biome check apps/web/src/documents apps/web/test/upload.test.ts packages/i18n 2>&1 | tail -30` → clean (`--write` once for formatting only).

## 7. Acceptance

- [ ] The appended test block matches §4 (formatting aside); all upload tests pass.
- [ ] Typecheck, i18n test and biome clean.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong (say which assertion and why);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a file outside §3 needs a change;
- a step is unclear.

## 9. Report

Write `docs/tasks/0113-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. Anything you could not do, and why.
