# 0506: Turn the grouping into documents (plan and database writes)

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0501, 0504 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

After the grouping (0504) decides "these pages are one document", the sorting job must write that down: reuse the upload's document rows where it can, create new ones for extra invoices found inside one file, remove the rows whose pages all went elsewhere (or that were blank), store each document's pages in `document_pages`, and store a `same_invoice` question when unsure. This brief adds a pure planner (tested) and the database functions. The job itself is 0507.

## 2. Context

- `@shoebox/extraction` exports (0504) `SortResult { groups: SortPiece[][]; skipped; questions: [number, number][] }`, `SortPiece { fileIndex; filePage; region; item: PageItem }`, `supplierKeyOf(item)`, and (0503) `PageItem { where; kind; supplierName; supplierIco; docNumber; labelN; labelOf; hasTotals; startsDocument }`.
- Tables: `documents` (`uploadBatchId`, `sourceFileId`, `status`, `receivedDate`, `deletedAt`, `createdAt`), `documentPages` (0501), `reviewQuestions` (`orgId, documentId, kind, payload`), `extractionRuns` (`orgId, documentId, stage, method, model, promptVersion, attempt, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, latencyMs, ok`), all exported from `@shoebox/db` schema files. `packages/db/src/document-reading.ts` shows the style (`tx.update(documents).set({...}).where(eq(...))`, `TenantTx` from `./tenant`).
- `packages/db/src/index.ts` has the line `export * from './document-pages';` (0505).
- Review question kind `same_invoice` (owner decision 2026-10-26): payload `{ other_document_id }`, asked on the later document of the pair. Default when unanswered: keep separate.
- The worker's role `app_worker` may insert, update and delete tenant rows of its org (0003).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/doc-split.ts` | new | load batch, set status, apply plan |
| `packages/db/src/index.ts` | edit | export it |
| `apps/worker/src/doc-split/plan.ts` | new | `planSort` |
| `apps/worker/test/doc-split-plan.test.ts` | new | given below |

No other file may change.

## 4. Steps

1. New `packages/db/src/doc-split.ts` with exactly these exports and the behavior in the doc comments:

```ts
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { extractionRuns, reviewQuestions } from './schema/document-details';
import { documentPages } from './schema/document-pages';
import { documents, sourceFiles } from './schema/documents';
import type { TenantTx } from './tenant';

/** One uploaded file of a drop, with the document row the upload made for it. */
export interface SplitBatchFile {
  readonly documentId: string;
  readonly sourceFileId: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly receivedDate: string | null;
  readonly status: string;
}

/**
 * The drop's documents that are still waiting to be sorted (status 'received' or 'splitting',
 * not deleted), with their files, in upload order (documents.created_at, then id).
 */
export async function loadSplitBatch(tx: TenantTx, batchId: string): Promise<SplitBatchFile[]>;

/** Sets the status of these documents (no-op for an empty list). */
export async function setDocumentsStatus(
  tx: TenantTx,
  documentIds: readonly string[],
  status: 'splitting' | 'received',
): Promise<void>;

export interface PageRowInput {
  readonly sourceFileId: string;
  readonly filePage: number;
  readonly region: string;
  readonly supplierKey: string;
  readonly docNumber: string;
  readonly labelN: number | null;
  readonly labelOf: number | null;
  readonly hasTotals: boolean;
  readonly startsDocument: boolean;
}

export interface SortPlanDocument {
  /** The upload's row to reuse, or null to insert a new document. */
  readonly documentId: string | null;
  readonly sourceFileId: string; // the file of the first page
  readonly receivedDate: string | null;
  readonly pages: readonly PageRowInput[];
}

export interface SplitRun {
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly latencyMs: number;
}

export interface SortPlan {
  readonly orgId: string;
  readonly batchId: string;
  readonly documents: readonly SortPlanDocument[];
  readonly deleteDocumentIds: readonly string[];
  /** Indexes into `documents`: [earlier, later]. */
  readonly questions: readonly (readonly [number, number])[];
  readonly runs: readonly SplitRun[];
}

/**
 * Writes the plan in the caller's transaction and returns the document ids in plan order.
 * - A reused document: status 'received', source_file_id = the plan's; its old document_pages rows are deleted.
 * - A new document: inserted with org_id, source_file_id, upload_batch_id = batchId, status 'received', received_date.
 * - Every document gets document_pages rows, positions 1..n in page order.
 * - deleteDocumentIds: deleted_at = now() (soft delete; the files stay).
 * - Each question: a review_questions row (kind 'same_invoice') on the later document, payload { other_document_id: the earlier one }.
 * - Each run: an extraction_runs row (stage 'split', method 'llm', ok true, attempt 1) on the first document of the plan.
 */
export async function applySortPlan(tx: TenantTx, plan: SortPlan): Promise<string[]>;
```

Use `.returning({ id: documents.id })` for the insert. Date column `receivedDate` is a string. `now()` via `sql\`now()\`` from drizzle-orm or `new Date()`, whichever the `deletedAt` column type takes.

2. `packages/db/src/index.ts`: add `export * from './doc-split';` before `export * from './document-pages';`. Run `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30` (expect no errors).

3. New `apps/worker/src/doc-split/plan.ts`; implement until step 4 passes:

```ts
import type { SortPlan, SplitBatchFile, SplitRun } from '@shoebox/db';
import { type SortResult, supplierKeyOf } from '@shoebox/extraction';

/**
 * The plan for one drop. `files[i]` is fileIndex i of the grouping.
 * - Group by group, in order: reuse the document of the first piece's file if that document is not
 *   used yet; otherwise a new document (documentId null) on that file, with that file's receivedDate.
 * - Pages: one row per piece, in order: sourceFileId of its file, filePage, region, supplierKey =
 *   supplierKeyOf(item), docNumber, labelN, labelOf, hasTotals, startsDocument from the item.
 * - deleteDocumentIds: the files' documents not reused, in file order.
 * - questions: result.questions as they are; runs: as given.
 */
export function planSort(
  orgId: string,
  batchId: string,
  files: readonly SplitBatchFile[],
  result: SortResult,
  runs: readonly SplitRun[],
): SortPlan;
```

4. New `apps/worker/test/doc-split-plan.test.ts` (do not edit it; `biome format --write` is allowed):

```ts
import type { SplitBatchFile } from '@shoebox/db';
import type { PageItem, SortPiece, SortResult } from '@shoebox/extraction';
import { describe, expect, it } from 'vitest';
import { planSort } from '../src/doc-split/plan';

const ORG = '11111111-1111-4111-8111-111111111111';
const BATCH = '44444444-4444-4444-8444-444444444444';

function file(n: number): SplitBatchFile {
  return {
    documentId: `doc-${n}`,
    sourceFileId: `sf-${n}`,
    storagePath: `p/${n}`,
    mimeType: 'application/pdf',
    receivedDate: '2026-10-26',
    status: 'received',
  };
}

const item = (over: Partial<PageItem> = {}): PageItem => ({
  where: '',
  kind: 'invoice',
  supplierName: 'Supplier X',
  supplierIco: '11111111',
  docNumber: 'N1',
  labelN: null,
  labelOf: null,
  hasTotals: true,
  startsDocument: true,
  ...over,
});

const piece = (fileIndex: number, filePage: number, over: Partial<PageItem> = {}): SortPiece => ({
  fileIndex,
  filePage,
  region: over.where ?? '',
  item: item(over),
});

describe('planSort', () => {
  it('joins two files into the first file’s document and removes the second row', () => {
    const result: SortResult = {
      groups: [[piece(0, 1, { hasTotals: false }), piece(1, 1, { supplierIco: '', docNumber: '' })]],
      skipped: [],
      questions: [],
    };
    const plan = planSort(ORG, BATCH, [file(0), file(1)], result, []);
    expect(plan.documents).toEqual([
      {
        documentId: 'doc-0',
        sourceFileId: 'sf-0',
        receivedDate: '2026-10-26',
        pages: [
          {
            sourceFileId: 'sf-0',
            filePage: 1,
            region: '',
            supplierKey: '11111111',
            docNumber: 'N1',
            labelN: null,
            labelOf: null,
            hasTotals: false,
            startsDocument: true,
          },
          {
            sourceFileId: 'sf-1',
            filePage: 1,
            region: '',
            supplierKey: 'supplierx',
            docNumber: '',
            labelN: null,
            labelOf: null,
            hasTotals: true,
            startsDocument: true,
          },
        ],
      },
    ]);
    expect(plan.deleteDocumentIds).toEqual(['doc-1']);
    expect(plan).toMatchObject({ orgId: ORG, batchId: BATCH, questions: [], runs: [] });
  });

  it('splits one file into new documents after the first', () => {
    const result: SortResult = {
      groups: [[piece(0, 1), piece(0, 2)], [piece(0, 3, { docNumber: 'N2' })], [piece(0, 4, { where: 'top' })]],
      skipped: [],
      questions: [[1, 2]],
    };
    const plan = planSort(ORG, BATCH, [file(0)], result, []);
    expect(plan.documents.map((d) => [d.documentId, d.sourceFileId, d.pages.length])).toEqual([
      ['doc-0', 'sf-0', 2],
      [null, 'sf-0', 1],
      [null, 'sf-0', 1],
    ]);
    expect(plan.documents[2]?.pages[0]?.region).toBe('top');
    expect(plan.deleteDocumentIds).toEqual([]);
    expect(plan.questions).toEqual([[1, 2]]);
  });

  it('removes the row of a file that had only blank pages and keeps runs', () => {
    const run = {
      model: 'claude-haiku-5-5',
      promptVersion: 'm01-sort-v1',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 300,
    };
    const result: SortResult = {
      groups: [[piece(1, 1)]],
      skipped: [{ fileIndex: 0, filePage: 1 }],
      questions: [],
    };
    const plan = planSort(ORG, BATCH, [file(0), file(1)], result, [run]);
    expect(plan.documents.map((d) => d.documentId)).toEqual(['doc-1']);
    expect(plan.deleteDocumentIds).toEqual(['doc-0']);
    expect(plan.runs).toEqual([run]);
  });
});
```

Run `pnpm --filter @shoebox/worker test -- doc-split-plan 2>&1 | tail -30` and `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30`.

## 5. Do not touch

`handler.ts`, migrations, other packages. Rule 3 (every query org-scoped: the tenant transaction already is; never use the service role here).

## 6. Commands

- `pnpm --filter @shoebox/worker test -- doc-split-plan 2>&1 | tail -30`
- `pnpm --filter @shoebox/db --filter @shoebox/worker typecheck 2>&1 | tail -30`
- `pnpm exec biome check packages/db apps/worker 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0506-report.md` (600 tokens at most) and set `Status: review`.
