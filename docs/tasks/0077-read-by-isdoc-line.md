# 0077: The document page says when the values came from ISDOC

Status: done
Ticket: M11 source legend `isdoc` (trimmed to one line) | Depends on: 0051 (merged, goes first); reads `extraction_runs.method` | Base commit: 1e90c0d (phase/0) | Branch: claude/project-thread-3666oz | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On the document page, under "What we read", show one quiet line when the values came from the invoice's ISDOC data, so the user knows no AI guessed them. The upload hint and the rejection message name ISDOC files as accepted.

## 2. Context

- M11 source legend: `isdoc` = read from the invoice's machine data (ISDOC). Design principle (owner 2026-10-25): plain words, the official term in brackets.
- Hard rule 6: English copy in `packages/i18n/messages/en.json` only; no new Czech. Tokens only: `text-meta text-muted-foreground` (both already used in the app).
- `extraction_runs` is select-only for users under RLS (0006), so the page can read the latest run's `method`. An error on that query never hides the document (the line is a hint).
- Copy (this brief owns it):
  - `doc.detail.read_by_isdoc`: "Read exactly from the invoice's built-in data (ISDOC). No AI was used."
  - `inbox.upload.hint`: "A PDF, a photo of a receipt or an ISDOC file. We read it and check it for you."
  - `inbox.upload.rejected`: "… Send a PDF, a photo or an ISDOC file up to 20 MB."

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/detail-data.ts` | edit | `readBy` from the latest successful extract run |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | the line under "What we read" |
| `apps/web/test/detail-data.test.ts` | edit | 1 test added |
| `packages/i18n/messages/en.json` | edit | 1 key added, 2 strings changed |

No other file may change. The whole change is the patch in §4; the orchestrator wrote it and checked that it applies to `phase/0` and passes §6.

## 4. Steps

1. Set `Status: in-progress` in this file. Apply the patch at the end of this section straight from this file (do not retype it):

```bash
awk '/^```diff$/{f=1;next} /^```$/{if(f)exit} f' docs/tasks/0077-read-by-isdoc-line.md | git apply --whitespace=nowarn 2>&1 | tail -30
git status --short 2>&1 | tail -30
```

Expected: no output from `git apply`; `git status` lists exactly the §3 files and this brief. If `git apply` fails: STOP (§8), do not hand-edit.

2. Run the §6 commands in order; the expected results are given there. Commit `0077 step 2` (the patch plus this file).
3. Write the report (§9), set `Status: review`, commit `0077 report`. Do not push; the orchestrator pushes and opens the PR.

```diff
diff --git a/apps/web/app/(app)/inbox/[id]/page.tsx b/apps/web/app/(app)/inbox/[id]/page.tsx
index 9f69bba..ffee88c 100644
--- a/apps/web/app/(app)/inbox/[id]/page.tsx
+++ b/apps/web/app/(app)/inbox/[id]/page.tsx
@@ -60,6 +60,9 @@ export default async function DocumentPage({ params }: { params: Promise<{ id: s
         <>
           <Card className="flex flex-col gap-4 p-6">
             <h2 className="text-card-title">{t('doc.detail.read_title')}</h2>
+            {detail.readBy === 'isdoc' ? (
+              <p className="text-meta text-muted-foreground">{t('doc.detail.read_by_isdoc')}</p>
+            ) : null}
             <dl className="flex flex-col gap-3">
               {detail.fields.map((field) => {
                 const editKey = canFix ? editKeyOf(field.label) : null;
diff --git a/apps/web/src/documents/detail-data.ts b/apps/web/src/documents/detail-data.ts
index fb04a6e..7ae8a15 100644
--- a/apps/web/src/documents/detail-data.ts
+++ b/apps/web/src/documents/detail-data.ts
@@ -23,6 +23,8 @@ export interface DocumentDetail {
   readonly fields: readonly DetailField[];
   readonly vatLines: readonly { rate: string; base: string; vat: string }[];
   readonly checks: readonly DetailCheck[]; // blocking first, then warning
+  /** How the values were read: 'isdoc' = exactly from the file's ISDOC data, no AI. */
+  readonly readBy: 'isdoc' | 'model' | null;
   readonly file: {
     readonly path: string;
     readonly mimeType: string;
@@ -53,8 +55,13 @@ function isKey(key: string): key is MessageKey {
   return Object.hasOwn(catalogs.en, key);
 }
 
-/** Builds the page model from the three raw rows. Pure; null when the document row is malformed. */
-export function detailOf(doc: unknown, vat: unknown, checks: unknown): DocumentDetail | null {
+/** Builds the page model from the raw rows. Pure; null when the document row is malformed. */
+export function detailOf(
+  doc: unknown,
+  vat: unknown,
+  checks: unknown,
+  runs: unknown = [],
+): DocumentDetail | null {
   if (!isRow(doc)) return null;
   const id = text(doc.id);
   const status = text(doc.status);
@@ -131,6 +138,10 @@ export function detailOf(doc: unknown, vat: unknown, checks: unknown): DocumentD
       }
     : null;
 
+  const lastRun = Array.isArray(runs) ? runs.find(isRow) : undefined;
+  const method = lastRun ? text(lastRun.method) : null;
+  const readBy = method === null ? null : method === 'isdoc' ? 'isdoc' : 'model';
+
   return {
     id,
     status: status as DocumentStatus,
@@ -141,6 +152,7 @@ export function detailOf(doc: unknown, vat: unknown, checks: unknown): DocumentD
     fields,
     vatLines,
     checks: detailChecks,
+    readBy,
     file,
   };
 }
@@ -152,7 +164,7 @@ export async function loadDocumentDetail(
   id: string,
 ): Promise<DocumentDetail | null> {
   try {
-    const [docResult, vatResult, checkResult] = await Promise.all([
+    const [docResult, vatResult, checkResult, runResult] = await Promise.all([
       supabase
         .from('documents')
         .select(DOCUMENT_COLUMNS)
@@ -170,9 +182,19 @@ export async function loadDocumentDetail(
         .select('rule_id, severity, params')
         .eq('document_id', id)
         .eq('state', 'open'),
+      supabase
+        .from('extraction_runs')
+        .select('method')
+        .eq('document_id', id)
+        .eq('stage', 'extract')
+        .eq('ok', true)
+        .order('created_at', { ascending: false })
+        .limit(1),
     ]);
     if (docResult.error || vatResult.error || checkResult.error) return null;
-    return detailOf(docResult.data, vatResult.data, checkResult.data);
+    // The read method is a hint only: an error there never hides the document.
+    const runs = runResult.error ? [] : runResult.data;
+    return detailOf(docResult.data, vatResult.data, checkResult.data, runs);
   } catch {
     return null;
   }
diff --git a/apps/web/test/detail-data.test.ts b/apps/web/test/detail-data.test.ts
index 7a30ea9..3e909de 100644
--- a/apps/web/test/detail-data.test.ts
+++ b/apps/web/test/detail-data.test.ts
@@ -94,6 +94,12 @@ describe('detailOf', () => {
     expect(detail?.checks[1]?.params.field).toBe('Due date');
   });
 
+  it('says when the values came from ISDOC data, from the latest run', () => {
+    expect(detailOf(doc, [], [], [{ method: 'isdoc' }])?.readBy).toBe('isdoc');
+    expect(detailOf(doc, [], [], [{ method: 'llm' }])?.readBy).toBe('model');
+    expect(detailOf(doc, [], [])?.readBy).toBeNull();
+  });
+
   it('returns null for a malformed document', () => {
     expect(detailOf(null, [], [])).toBeNull();
     expect(detailOf({ id: 3 }, [], [])).toBeNull();
diff --git a/packages/i18n/messages/en.json b/packages/i18n/messages/en.json
index 265ba4c..ea91c02 100644
--- a/packages/i18n/messages/en.json
+++ b/packages/i18n/messages/en.json
@@ -21,11 +21,11 @@
   "inbox.tabs.trash": "Trash",
   "inbox.upload.cta": "Upload documents",
   "inbox.upload.drop": "Drop files here",
-  "inbox.upload.hint": "A PDF or a photo of a receipt. We read it and check it for you.",
+  "inbox.upload.hint": "A PDF, a photo of a receipt or an ISDOC file. We read it and check it for you.",
   "inbox.upload.busy": "Uploading…",
   "inbox.upload.accepted": "{n, plural, one {# document uploaded, reading it} other {# documents uploaded, reading them}}.",
   "inbox.upload.duplicate": "{n, plural, one {# file is already here} other {# files are already here}}.",
-  "inbox.upload.rejected": "{n, plural, one {# file cannot be read} other {# files cannot be read}}. Send a PDF or a photo up to 20 MB.",
+  "inbox.upload.rejected": "{n, plural, one {# file cannot be read} other {# files cannot be read}}. Send a PDF, a photo or an ISDOC file up to 20 MB.",
   "inbox.upload.error": "The upload failed. Please try again.",
   "inbox.list.label": "Documents",
   "inbox.row.unknown_supplier": "Supplier not read yet",
@@ -34,6 +34,7 @@
   "inbox.address.label": "E-mail for documents",
   "doc.detail.back": "Back to Inbox",
   "doc.detail.read_title": "What we read",
+  "doc.detail.read_by_isdoc": "Read exactly from the invoice's built-in data (ISDOC). No AI was used.",
   "doc.detail.attention_title": "Needs your attention",
   "doc.detail.all_good": "Everything checks out. There is nothing for you to do.",
   "doc.detail.open_file": "Open the document",
```

## 5. Do not touch

`packages/i18n/messages/cs.json`, `packages/i18n/later/**`, `packages/ui/**`. Hard rule 6.

## 6. Commands

- `pnpm --filter @shoebox/web test -- test/detail-data.test.ts 2>&1 | tail -30` → `Tests  4 passed (4)`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → all pass
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors
- `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -30` → no errors (one existing `noImgElement` warning is not yours)

## 7. Acceptance

- [ ] `git diff --stat HEAD~2` lists only the §3 files plus this brief and the report.
- [ ] The §6 commands pass.
- [ ] No screenshot: one text line inside an existing card, no layout change.

## 8. Stop and ask

Stop and write the report if: `git apply` fails; a test fails twice; a file outside §3 changes; a new dependency seems needed; you reach 25 tool calls or about 50k tokens.

## 9. Report

Write `docs/tasks/0077-report.md` (600 tokens at most): files changed (`git diff --stat HEAD~2`), each command with the last 5 lines of its output, deviations (none expected).
