# 0509: A page uploaded days later

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0507, 0513 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A user uploads an invoice without its last page, and uploads that page the next day. The sorting job sees that the new page continues an invoice that is still missing its totals (uploaded in the last 7 days) and asks "Is this part of the same invoice?" (the `same_invoice` question, default No). It never joins on its own across uploads.

## 2. Context

- `packages/db/src/doc-split.ts`: imports `import { and, asc, eq, inArray, isNull } from 'drizzle-orm';`, tables `documents`, `documentPages` (columns `documentId, position, supplierKey, docNumber, hasTotals`), `documents` has `id, status, deletedAt, createdAt, uploadBatchId`. `SortPlan` ends with:

```ts
  /** Indexes into `documents`: [earlier, later]. */
  readonly questions: readonly (readonly [number, number])[];
  readonly runs: readonly SplitRun[];
}
```

  `applySortPlan` has a loop `for (const [earlier, later] of plan.questions) {` that inserts a `review_questions` row with `kind: 'same_invoice'` and a `payload: { question: 'doc.pages.same_question', options: [...], suggested: 'no', other_document_id: earlierId }`.
- `apps/worker/src/doc-split/plan.ts`: `planSort(orgId, batchId, files, result, runs)` loops `for (const group of result.groups)` and pushes one `planDocuments` entry per group with a first piece (`if (!first) continue;`); it returns `{ orgId, batchId, documents: planDocuments, deleteDocumentIds, questions: ..., runs }`.
- `apps/worker/src/doc-split/handler.ts`: `DocSplitStore { loadBatch, setStatus, apply }`, `dbDocSplitStore`, `DocSplitDeps`. The fast path is:

```ts
    const totalPages = sortable.reduce((sum, s) => sum + s.pageCount, 0);
    if (totalPages <= 1) {
      await readAll(payload.orgId, files);
      return;
    }
```

  and the plan is made by `plan = planSort(payload.orgId, payload.batchId, sortableFiles, groupPages(pages), runs);`.
- `@shoebox/extraction` exports `supplierKeyOf(item)`, types `SortResult` (`groups: readonly (readonly SortPiece[])[]`), `SortPiece` (`item: PageItem`), `PageItem` (`supplierName, supplierIco, docNumber, hasTotals, startsDocument, ...`).
- Worker tests: `apps/worker/test/doc-split-handler.test.ts` (`fakeStore(files)` builds `store: DocSplitStore = { loadBatch, setStatus, apply }`; `setup(files, json, pages)`; `item(over)` with snake_case wire fields; `file(n)`), `apps/worker/test/doc-split-plan.test.ts`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/doc-split.ts` | edit | `findOpenPageDocuments`, `lateQuestions` |
| `apps/worker/src/doc-split/late.ts` | new | `matchLatePages` |
| `apps/worker/src/doc-split/plan.ts` | edit | `late` argument |
| `apps/worker/src/doc-split/handler.ts` | edit | load open documents, no fast path when there are some |
| `apps/worker/test/doc-split-late.test.ts` | new | 4 tests |
| `apps/worker/test/doc-split-handler.test.ts` | edit | fake store + 1 test |
| `apps/worker/test/doc-split-plan.test.ts` | edit | pass `[]` if needed for types only |

No other file may change. `packages/db/src/index.ts` already re-exports `./doc-split` (check with grep; if not, stop and ask).

## 4. Steps

1. `doc-split.ts`: add `gte`, `ne` (and `or` if you need it) to the drizzle import. Add to `SortPlan`, after `questions`:

```ts
  /** A document of this plan (index) that may continue an open document of an earlier upload. */
  readonly lateQuestions?: readonly { readonly document: number; readonly otherDocumentId: string }[];
```

   Move the payload into `function sameInvoicePayload(otherDocumentId: string)` returning the same object, use it in the existing loop, and after that loop add:

```ts
  for (const late of plan.lateQuestions ?? []) {
    const laterId = ids[late.document];
    if (!laterId) throw new Error('applySortPlan: late question index out of range');
    await tx.insert(reviewQuestions).values({
      orgId: plan.orgId,
      documentId: laterId,
      kind: 'same_invoice',
      payload: sameInvoicePayload(late.otherDocumentId),
    });
  }
```

   Then add (and update the doc comment of `applySortPlan` with one line about late questions):

```ts
export interface OpenPageDocument {
  readonly documentId: string;
  readonly supplierKey: string; // first non-empty supplier_key of its pages, else ''
  readonly docNumber: string; // first non-empty doc_number of its pages, else ''
}

/**
 * Documents of the org that may still miss a page: created at or after `since`, not deleted, not
 * finalized, not from `batchId`, with document_pages rows and none with has_totals. Newest first,
 * at most 20.
 */
export async function findOpenPageDocuments(
  tx: TenantTx,
  since: Date,
  batchId: string,
): Promise<OpenPageDocument[]>;
```

   Implementation: one select of `{ documentId, position, supplierKey, docNumber, hasTotals, createdAt: documents.createdAt, uploadBatchId: documents.uploadBatchId }` from `documentPages` inner join `documents` on `documentPages.documentId = documents.id`, where `isNull(documents.deletedAt)`, `ne(documents.status, 'finalized')`, `gte(documents.createdAt, since)`, ordered by `documents.createdAt` desc then `documentPages.position` asc, `.limit(400)`. In JS: group rows by documentId in order of first appearance, skip a document whose `uploadBatchId === batchId` or any row has `hasTotals`, take the first non-empty `supplierKey` / `docNumber`, return the first 20.

2. New `apps/worker/src/doc-split/late.ts`:

```ts
import type { OpenPageDocument } from '@shoebox/db';
import { type SortResult, supplierKeyOf } from '@shoebox/extraction';

const numberKey = (n: string): string => n.toUpperCase().replace(/\s+/g, '');

/**
 * Groups of a new drop that may continue an open document of an earlier upload (0509): the
 * group's first piece does not start a document, and the open document does not differ from it
 * (both supplier keys set and different = differs; both numbers set and different = differs).
 * Among the open documents that do not differ, prefer one with the same number or the same
 * supplier key; otherwise the first (newest). One open document is used for one group at most.
 * Returns [{ group, otherDocumentId }] in group order.
 */
export function matchLatePages(
  result: SortResult,
  open: readonly OpenPageDocument[],
): { readonly group: number; readonly otherDocumentId: string }[];
```

   Write the body as the comment says.

3. `plan.ts`: add a sixth parameter `late: readonly { readonly group: number; readonly otherDocumentId: string }[] = []`. Track the plan document index of each group (`const docIndexOfGroup: number[] = []`, set it to `planDocuments.length` before each push, by the group's index in `result.groups`; use `for (const [g, group] of result.groups.entries())`). Return also `lateQuestions: late.flatMap((l) => { const document = docIndexOfGroup[l.group]; return document === undefined ? [] : [{ document, otherDocumentId: l.otherDocumentId }]; })`. Update the doc comment with one line.

4. `handler.ts`:
   - `DocSplitStore` gets `readonly findOpen: typeof findOpenPageDocuments;` and `dbDocSplitStore` gets `findOpen: findOpenPageDocuments,` (import it from `@shoebox/db`).
   - `DocSplitDeps` gets `readonly now?: () => Date; // default () => new Date()`.
   - Add `const LATE_PAGE_DAYS = 7;` at module level with a one-line comment.
   - Replace the fast path with:

```ts
    const totalPages = sortable.reduce((sum, s) => sum + s.pageCount, 0);
    const since = new Date((deps.now ?? (() => new Date()))().getTime() - LATE_PAGE_DAYS * 86_400_000);
    const open = totalPages >= 1 ? await store.findOpen(ctx.tx, since, payload.batchId) : [];
    if (totalPages <= 1 && open.length === 0) {
      await readAll(payload.orgId, files);
      return;
    }
```

   - Replace the plan line with `const result = groupPages(pages);` and `plan = planSort(payload.orgId, payload.batchId, sortableFiles, result, runs, matchLatePages(result, open));` (import `matchLatePages` from `./late`).
   - Update the handler doc comment: drops of one page skip the look-over only when no open document of an earlier upload could miss a page.

5. `doc-split-handler.test.ts`: `fakeStore(files, open: OpenPageDocument[] = [])` adds `findOpen: async () => open` to the store (import the type from `@shoebox/db`). `setup` gets a fourth parameter `open: OpenPageDocument[] = []` passed to `fakeStore`. Append inside the describe:

```ts

  it('asks whether a page uploaded days later belongs to an open invoice', async () => {
    const { handler, llm, plans, reads } = setup(
      [file(0)],
      {
        pages: [
          { page: 1, blank: false, items: [item({ doc_number: '', has_totals: true, starts_document: false })] },
        ],
      },
      1,
      [{ documentId: 'old-1', supplierKey: '11111111', docNumber: 'N1' }],
    );
    await handler({ orgId: ORG, batchId: BATCH }, ctx);
    expect(llm.requests).toHaveLength(1);
    expect(plans[0]?.lateQuestions).toEqual([{ document: 0, otherDocumentId: 'old-1' }]);
    expect(reads).toEqual(['doc-0']);
  });
```

6. New `doc-split-late.test.ts`, with a helper `piece(over: Partial<PageItem>): SortPiece` (fileIndex 0, filePage 1, region '', item with kind 'invoice', where '', supplierName '', supplierIco '', docNumber '', labelN null, labelOf null, hasTotals false, startsDocument true, then `...over`). Tests:
   - a continuation page with the same IČO is matched to the open document;
   - a page that starts a document is not matched;
   - a different IČO or a different number is not matched;
   - with two open documents, the one with the same number wins over the newer one without.

   Run `pnpm --filter @shoebox/worker test 2>&1 | tail -30`.

## 5. Do not touch

Everything outside §3. No migration (columns exist since 0060).

## 6. Commands

- `pnpm --filter @shoebox/worker test 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/db/src apps/worker 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0509-report.md` (600 tokens at most) and set `Status: review`.
