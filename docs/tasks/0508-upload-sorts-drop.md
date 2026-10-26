# 0508: Upload sends each drop to the sorting job

Status: review
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0507 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

All files of one upload share a batch id, and the upload queues one `doc.split` job for the drop instead of one read per file. The sorting job (0507) then joins, splits and queues the reads. A single one-page file costs nothing extra: the job reads it straight away.

## 2. Context

- `@shoebox/pipeline` exports `docSplitJob` (0507): name `'doc.split'`, payload `{ orgId, batchId }`, entityId batchId. `documents.upload_batch_id` exists (0060).
- `apps/web/src/documents/enqueue.ts` has `boss()` and `enqueueDocExtract(orgId, documentId, retry?)`, which builds `const payload = docExtractJob.payload.parse(...)`, `jobKey`, `jobIdFromKey`, then `(await boss()).send(name, payload, { id, singletonKey })`. Its import line is `import { docExtractJob, jobIdFromKey, jobKey } from '@shoebox/pipeline';`.
- `apps/web/src/documents/upload.ts` excerpts (find verbatim):

```ts
  insertDocument(row: {
    orgId: string;
    sourceFileId: string;
    receivedDate: string;
  }): Promise<string>;
  enqueueRead(orgId: string, documentId: string): Promise<void>;
```

```ts
    const documentId = await deps.insertDocument({
      orgId: ctx.orgId,
      sourceFileId: source.id,
      receivedDate: deps.today(),
    });
    try {
      await deps.enqueueRead(ctx.orgId, documentId);
    } catch {
      // The queue is down: the document stays `received` and is still accepted.
    }
    items.push({ fileName: file.name, status: 'accepted', documentId });
  }
  return items;
}
```

  and `const items: UploadItem[] = [];` at the start of `uploadDocuments`.
- `apps/web/src/documents/supabase-deps.ts` inserts documents with `source_file_id: row.sourceFileId,` and has `    enqueueRead: enqueueDocExtract,`; its imports include `import { enqueueDocExtract } from './enqueue';`.
- `apps/web/test/upload.test.ts` `fakeDeps`: `async insertDocument(row) {` (keeps `docs.set(row.sourceFileId, id)`) and

```ts
    async enqueueRead(_org, documentId) {
      if (options.failEnqueue) throw new Error('down');
      enqueued.push(documentId);
    },
```

  and `return { deps, puts, sources, enqueued };`.
- Lane A's e-mail intake will call the same job; do not change the upload route's request or response shape.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/enqueue.ts` | edit | `enqueueDocSplit` |
| `apps/web/src/documents/upload.ts` | edit | batch id, one sort job |
| `apps/web/src/documents/supabase-deps.ts` | edit | wire it |
| `apps/web/test/upload.test.ts` | edit | fakes + one test |

No other file may change.

## 4. Steps

1. `enqueue.ts`: import `docSplitJob` too (keep the import sorted) and append:

```ts

/** Queues `doc.split` for one upload drop (page sorting); it queues the reads itself. */
export async function enqueueDocSplit(orgId: string, batchId: string): Promise<void> {
  const payload = docSplitJob.payload.parse({ orgId, batchId });
  const key = jobKey(docSplitJob, payload);
  await (await boss()).send(docSplitJob.name, payload, {
    id: jobIdFromKey(key),
    singletonKey: key,
  });
}
```

2. `upload.ts`: in `UploadDeps`, add `    uploadBatchId: string;` to the `insertDocument` row type, and replace the `enqueueRead` line with:

```ts
  /** Queues the sorting job for the drop (doc.split). */
  enqueueSort(orgId: string, batchId: string): Promise<void>;
  newBatchId(): string;
```

   In `uploadDocuments`: after `const items: UploadItem[] = [];` add `  const batchId = deps.newBatchId();\n  let queued = 0;`. In the insert, add `uploadBatchId: batchId,`. Replace the `try { await deps.enqueueRead ... } catch { ... }` block with `    queued += 1;`. Before `return items;` add:

```ts
  if (queued > 0) {
    try {
      await deps.enqueueSort(ctx.orgId, batchId);
    } catch {
      // The queue is down: the documents stay `received` and are still accepted.
    }
  }
```

3. `supabase-deps.ts`: insert `upload_batch_id: row.uploadBatchId,` after `source_file_id: row.sourceFileId,`; replace `    enqueueRead: enqueueDocExtract,` with `    enqueueSort: enqueueDocSplit,\n    newBatchId: () => crypto.randomUUID(),`; import `enqueueDocSplit` instead of `enqueueDocExtract` (check with grep that nothing else in the file uses `enqueueDocExtract`).

4. `upload.test.ts`: in `fakeDeps` add `let batches = 0;` and `const inserted: { sourceFileId: string; uploadBatchId: string }[] = [];` next to `enqueued`, push `{ sourceFileId: row.sourceFileId, uploadBatchId: row.uploadBatchId }` in `insertDocument`, replace the `enqueueRead` method with

```ts
    async enqueueSort(_org, batchId) {
      if (options.failEnqueue) throw new Error('down');
      enqueued.push(batchId);
    },
    newBatchId: () => `batch-${++batches}`,
```

   and return `{ deps, puts, sources, enqueued, inserted }`. Then append inside `describe('uploadDocuments', ...)`:

```ts

  it('puts the files of one upload in one batch and queues one sorting job', async () => {
    const { deps, enqueued, inserted } = fakeDeps();
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a'), pdf('b')]);
    expect(enqueued).toHaveLength(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.uploadBatchId).toBe(enqueued[0]);
    expect(inserted[1]?.uploadBatchId).toBe(enqueued[0]);
  });

  it('queues nothing when every file was a duplicate', async () => {
    const { deps, enqueued } = fakeDeps();
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(enqueued).toHaveLength(1);
  });
```

   Run `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30` and `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`.

## 5. Do not touch

`apps/web/app/api/documents/route.ts` (shape stays), the worker. Rule 8.

## 6. Commands

- `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/documents apps/web/test 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0508-report.md` (600 tokens at most) and set `Status: review`.
