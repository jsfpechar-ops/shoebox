# 0621: Start categorization after every read, and never let it override an open blocking check

Status: todo
Ticket: P1-M04 trigger | Depends on: 0620 | Base commit: 6e7c134 | Branch: claude/project-thread-vvw1j4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Nothing enqueues `doc.categorize` after the worker reads a document, so no uploaded document is categorized and none reaches the ledgers (`doc.categorize` is the only job that enqueues `ledger.rebuild_document`). After this brief the read handler enqueues `doc.categorize` (trigger `pipeline`) for every saved reading that is not `supporting`, a document added by hand does the same, and the categorize plan keeps `needs_review` while the document has an open blocking check (hard rule 2: AI output reaches `ready` only after the deterministic checks).

## 2. Context

- M04 §4.6 step 9: categorize enqueues `ledger.rebuild_document` (already built). M04 inputs: documents in `needs_review | ready` (the handler already skips `received, splitting, classifying, extracting, failed, duplicate, supporting, finalized`).
- Hard rule 2 and M03: a document with an open `blocking` row in `validation_results` must stay `needs_review`. Today `planCategorization` computes `status` from questions and `postChecks` only (`postChecks` defaults to `[]`), so once categorize runs after a read it would flip such a document to `ready`. This brief closes that hole.
- `docCategorizeJob` payload (packages/pipeline/src/jobs.ts): `{ orgId, documentId, revision, trigger, nonce? }`; job id = `${documentId}-${revision}-${trigger}[-${nonce}]`, so a re-read of the same revision needs a `nonce` (use `Date.now()`, like the ledger jobs do).
- Excerpt, apps/worker/src/doc-extract/handler.ts (deps):

```ts
  readonly enqueueMatch?: (orgId: string, documentId: string, trigger: string) => Promise<unknown>; // bank.match.document on ready (M07 §4.6.1)
```

- Excerpt, same file (after the save):

```ts
      const runId = await store.save(ctx.tx, write);
      if (write.status === 'ready') await deps.enqueueMatch?.(write.orgId, write.documentId, runId);
```

- Excerpt, apps/worker/src/doc-extract/register.ts:

```ts
import { bankMatchDocumentJob, docExtractJob } from '@shoebox/pipeline';
```

and

```ts
      enqueueMatch: (orgId, documentId, trigger) =>
        registry.enqueue(bankMatchDocumentJob, { orgId, documentId, trigger }),
```

- Excerpt, packages/db/src/document-reading.ts (`DocumentForRead` and `loadDocumentForRead`):

```ts
export interface DocumentForRead {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
```

```ts
    .select({
      id: documents.id,
      orgId: documents.orgId,
      status: documents.status,
      storagePath: sourceFiles.storagePath,
```

- Excerpt, packages/db/src/document-categorize.ts, imports:

```ts
import { llmCostUsd } from '@shoebox/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  documentFields,
  documentLines,
  extractionRuns,
  reviewQuestions,
} from './schema/document-details';
```

its interface end:

```ts
  /** fx_rates rows of the document's currency within 120 days before issue_date (empty for CZK). */
  readonly fxRates: readonly CategorizeFxRow[];
}
```

and the return of `loadDocumentForCategorize`:

```ts
  return {
    ...doc,
    lines,
    fields,
    questions,
    partner: partner ?? null,
    vendor: vendor ?? null,
    profiles,
    fxRates: fxRows,
  };
```

- `validationResults` (same schema file as `documentLines`) has columns `orgId`, `documentId`, `severity` (`'blocking' | 'warning'`), `state` (`'open'` when unresolved).
- Excerpt, apps/worker/src/categorize/plan.ts:

```ts
  const needsReview =
    planned.asked.length > 0 ||
    planned.deferred.length > 0 ||
    openKinds(doc.questions).size > 0 ||
    lineWrites.some((w) => w.categoryCode === null) ||
    postChecks.some((c) => c.severity === 'blocking');
```

- Excerpt, apps/web/src/documents/manual-entry-actions.ts (end of the action):

```ts
    savedId = id;
  } catch {
    return { errors: { form: 'manual.error.save' } };
  }
  revalidatePath('/inbox');
  redirect(`/inbox/${savedId}`);
```

- `apps/web/src/documents/enqueue.ts` exports `enqueueDocCategorize(orgId, documentId, revision, trigger, nonce?)`. A new document has `revision = 1`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/document-reading.ts` | edit | `revision` on `DocumentForRead` |
| `packages/db/test/document-reading.db.test.ts` | edit | expected row gets `revision: 1` |
| `apps/worker/src/doc-extract/handler.ts` | edit | `enqueueCategorize` dep, called after the save |
| `apps/worker/src/doc-extract/register.ts` | edit | wire it to `docCategorizeJob` |
| `apps/worker/test/doc-extract-handler.test.ts` | edit | fixture `revision`, one new test |
| `apps/worker/test/doc-extract-isdoc.test.ts`, `apps/worker/test/import-run.test.ts` | edit only if typecheck asks | add `revision: 1` to a `DocumentForRead` fixture |
| `packages/db/src/document-categorize.ts` | edit | `openBlocking` count on `DocumentForCategorize` |
| `apps/worker/src/categorize/plan.ts` | edit | `needsReview` includes `openBlocking` |
| `apps/worker/test/categorize-plan.test.ts`, `apps/worker/test/categorize-job.test.ts` | edit | fixtures get `openBlocking: 0`; one new plan test |
| `apps/web/src/documents/manual-entry-actions.ts` | edit | enqueue categorize after a manual document |

No other file may change.

## 4. Steps

### Step 1: `packages/db/src/document-reading.ts`

1a. In `DocumentForRead`, after `readonly status: string;` add `readonly revision: number;`.
1b. In `loadDocumentForRead`'s select, after `status: documents.status,` add `revision: documents.revision,`.

Then in `packages/db/test/document-reading.db.test.ts`, test `'loads the document with its file and the org identity'`, after `status: 'received',` add `revision: 1,`.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

### Step 2: `apps/worker/src/doc-extract/handler.ts`

2a. After the `enqueueMatch` dep line add:

```ts
  readonly enqueueCategorize?: (orgId: string, documentId: string, revision: number) => Promise<unknown>; // doc.categorize after every saved reading (M04 §4.6)
```

2b. Replace

```ts
      const runId = await store.save(ctx.tx, write);
      if (write.status === 'ready') await deps.enqueueMatch?.(write.orgId, write.documentId, runId);
```

with

```ts
      const runId = await store.save(ctx.tx, write);
      if (write.status === 'ready') await deps.enqueueMatch?.(write.orgId, write.documentId, runId);
      if (write.status !== 'supporting') {
        await deps.enqueueCategorize?.(write.orgId, write.documentId, doc.revision);
      }
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → errors only in test fixtures missing `revision` (fixed in step 4), or none.

### Step 3: `apps/worker/src/doc-extract/register.ts`

3a. Replace `import { bankMatchDocumentJob, docExtractJob } from '@shoebox/pipeline';` with `import { bankMatchDocumentJob, docCategorizeJob, docExtractJob } from '@shoebox/pipeline';`.

3b. After the `enqueueMatch: ...` two lines add:

```ts
      enqueueCategorize: (orgId, documentId, revision) =>
        registry.enqueue(docCategorizeJob, {
          orgId,
          documentId,
          revision,
          trigger: 'pipeline',
          nonce: Date.now(),
        }),
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

### Step 4: worker tests for the read handler

4a. `apps/worker/test/doc-extract-handler.test.ts`, in `fakeStore`, after `status: 'received',` add `revision: 1,`.

4b. Directly after the test `'reads, checks and saves a clean invoice as ready'` (after its closing `});`) add:

```ts
  it('enqueues categorization after a saved reading, with the document revision', async () => {
    const { store } = fakeStore({ revision: 3 });
    const categorized: Array<[string, string, number]> = [];
    await createDocExtractHandler({
      registries: offline,
      llm: llmReturning(wire()),
      blobs,
      model: 'claude-haiku-5-5',
      clock,
      store,
      enqueueCategorize: async (orgId, documentId, revision) => {
        categorized.push([orgId, documentId, revision]);
      },
    })({ orgId: ORG, documentId: DOC }, ctx());
    expect(categorized).toEqual([[ORG, DOC, 3]]);
  });
```

4c. If `pnpm --filter @shoebox/worker typecheck` reports a `DocumentForRead` fixture without `revision` in `doc-extract-isdoc.test.ts` or `import-run.test.ts`, add `revision: 1,` after its `status:` line. Change nothing else there.

Command: `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts 2>&1 | tail -30` → all passed; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors.

### Step 5: `packages/db/src/document-categorize.ts`

5a. In the schema import add `validationResults` (alphabetical, after `reviewQuestions`):

```ts
import {
  documentFields,
  documentLines,
  extractionRuns,
  reviewQuestions,
  validationResults,
} from './schema/document-details';
```

5b. In `DocumentForCategorize`, after the `fxRates` line add:

```ts
  /** Open `blocking` rows in validation_results: while > 0 the document stays needs_review (hard rule 2). */
  readonly openBlocking: number;
```

5c. In `loadDocumentForCategorize`, directly before `  return {\n    ...doc,` add:

```ts
  const [blocking] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(validationResults)
    .where(
      and(
        eq(validationResults.orgId, doc.orgId),
        eq(validationResults.documentId, documentId),
        eq(validationResults.severity, 'blocking'),
        eq(validationResults.state, 'open'),
      ),
    );
```

and in the returned object, after `fxRates: fxRows,` add `openBlocking: blocking?.n ?? 0,`.

Command: `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` → no errors.

### Step 6: `apps/worker/src/categorize/plan.ts`

Replace

```ts
    lineWrites.some((w) => w.categoryCode === null) ||
    postChecks.some((c) => c.severity === 'blocking');
```

with

```ts
    lineWrites.some((w) => w.categoryCode === null) ||
    postChecks.some((c) => c.severity === 'blocking') ||
    doc.openBlocking > 0;
```

### Step 7: categorize tests

7a. In `apps/worker/test/categorize-plan.test.ts` function `doc()` and in `apps/worker/test/categorize-job.test.ts` function `document()`: after the `orgSettings:` line add `openBlocking: 0,`.

7b. In `apps/worker/test/categorize-plan.test.ts`, inside the test `'a blocking post-check or an open question keeps needs_review; a null direction throws'`, directly before `expect(() => plan({ doc: doc({ direction: null }) })).toThrow('CategorizeInputError');` add:

```ts
    expect(
      plan({
        doc: doc({ ...base, openBlocking: 1 }),
        llm: llm({ businessLikelihood: 'business' }, { confidence: 0.9 }),
      }).write.status,
    ).toBe('needs_review');
```

Command: `pnpm --filter @shoebox/worker exec vitest run test/categorize-plan.test.ts test/categorize-job.test.ts 2>&1 | tail -30` → all passed; `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no errors.

### Step 8: `apps/web/src/documents/manual-entry-actions.ts`

8a. Add to the imports (after the last existing `import` line): `import { enqueueDocCategorize } from './enqueue';`

8b. Replace

```ts
  revalidatePath('/inbox');
  redirect(`/inbox/${savedId}`);
```

with

```ts
  try {
    await enqueueDocCategorize(auth.orgId, savedId, 1, 'pipeline');
  } catch {
    // The document is saved; the 15-minute catch-up job (0622) categorizes it.
  }
  revalidatePath('/inbox');
  redirect(`/inbox/${savedId}`);
```

If `savedId` is typed `string | null` there, use `if (savedId !== null)` around the `await`. If `auth` is not in scope at that point, STOP and report.

Command: `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → no errors; `pnpm exec biome ci apps/web/src/documents/manual-entry-actions.ts apps/worker packages/db 2>&1 | tail -30` → no errors.

## 5. Do not touch

`packages/db/migrations/`, `packages/db/src/schema/`, `packages/pipeline/`, `apps/worker/src/categorize/handler.ts`, `apps/worker/src/doc-extract/rows.ts`, `docs/v3/`. Hard rules 2, 3 (every new query carries `orgId`), 8.

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-handler.test.ts test/categorize-plan.test.ts test/categorize-job.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome ci apps/worker packages/db apps/web/src/documents/manual-entry-actions.ts 2>&1 | tail -30`

## 7. Acceptance

- [ ] A saved reading with status `ready` or `needs_review` enqueues `doc.categorize` with the document's revision, trigger `pipeline` and a nonce; `supporting` does not.
- [ ] `planCategorization` returns `needs_review` whenever `doc.openBlocking > 0`.
- [ ] A document added by hand enqueues `doc.categorize`.
- [ ] All commands in §6 pass.

## 8. Stop and ask

Stop, and write the report, if: an excerpt is not found; a test fails twice, or a test the brief wrote seems wrong; you reach 25 tool calls or about 50k tokens (report as `blocked`); a new dependency seems needed; a file outside §3 needs a change; §5 would be touched; a step is unclear.

## 9. Report

Write `docs/tasks/0621-report.md` (600 tokens at most) and set `Status: review`: files changed (`git diff --stat`), each command with its last 5 lines, §7 ticked, Deviations, Questions. Commit after every step as `0621 step k`. Do not open a PR.
