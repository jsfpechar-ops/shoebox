# 0081: "Read again" for a document that could not be read

Status: in-progress
Ticket: Page sorting (owner request 2026-10-26, proposal https://claude.ai/artifact/BAej5jjZ6mcbXh6EEupUPQ) | Depends on: none | Base commit: 496b1e9 | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A document stuck on "Could not read" gets a **Read again** button on its page, and uploading the same file again restarts its read instead of answering "duplicate". Today the page of a failed document also wrongly says "Everything checks out": it shows a plain "We couldn't read this document" instead.

## 2. Context

- The worker reads a document only while its status is `received` or `extracting` (`apps/worker/src/doc-extract/handler.ts`). A final failure sets `failed`.
- `enqueueDocExtract` gives each job a fixed id from `jobKey(...)`, so sending it again for the same document is a no-op. A retry needs a different key: the brief adds an optional `retry` string to it.
- `apps/web/src/documents/enqueue.ts` excerpt (find verbatim):

```ts
/** Queues `doc.extract` with the worker's idempotency key: a second call for the same document is a no-op. */
export async function enqueueDocExtract(orgId: string, documentId: string): Promise<void> {
  const payload = docExtractJob.payload.parse({ orgId, documentId });
  const key = jobKey(docExtractJob, payload);
```

- `apps/web/src/documents/upload.ts` excerpts (find verbatim):

```ts
  findDocumentBySource(sourceFileId: string): Promise<string | null>;
```

```ts
      if (existing !== null) {
        items.push({ fileName: file.name, status: 'duplicate', documentId: existing });
        continue;
      }
```

- `apps/web/src/documents/supabase-deps.ts` excerpt: `    enqueueRead: enqueueDocExtract,`
- `apps/web/test/upload.test.ts`: `fakeDeps` builds `const deps: UploadDeps = { ... }` with `async findDocumentBySource(id) {` and ends `    today: () => '2026-10-25',\n  };`. The last test is `it('keeps the document when the queue is down', ...)` and the file ends `  });\n});`.
- `apps/web/app/(app)/inbox/[id]/page.tsx` excerpt (find verbatim):

```tsx
      {processing ? (
        <>
          <p className="text-body">{t('doc.detail.reading')}</p>
          <AutoRefresh active />
        </>
      ) : (
```

- Copy is English only, in `packages/i18n/messages/en.json` (rule 6). `cs.json` is dormant: add nothing there.
- Server actions follow `apps/web/src/documents/correction-actions.ts`: `'use server'`, `requireActiveRole(['owner', 'member'])`, `createSupabaseServerClient()`, `revalidatePath`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/enqueue.ts` | edit | optional `retry` argument |
| `apps/web/src/documents/read-again.ts` | new | `restartFailedRead`, `supabaseReadAgainDeps` |
| `apps/web/test/read-again.test.ts` | new | given below |
| `apps/web/src/documents/read-again-actions.ts` | new | `readAgainAction` server action |
| `apps/web/src/documents/upload.ts` | edit | `restartIfFailed` dep, used for a repeated file |
| `apps/web/test/upload.test.ts` | edit | fake dep + one test |
| `apps/web/src/documents/supabase-deps.ts` | edit | wire `restartIfFailed` |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | failed branch with the button |
| `packages/i18n/messages/en.json` | edit | 3 keys |

No other file may change.

## 4. Steps

1. `enqueue.ts`: replace the excerpt's first three lines and the `key` line with:

```ts
/**
 * Queues `doc.extract` with the worker's idempotency key: a second call for the same document is a no-op.
 * `retry` (any unique string) makes a new job for a document whose read failed.
 */
export async function enqueueDocExtract(
  orgId: string,
  documentId: string,
  retry?: string,
): Promise<void> {
  const payload = docExtractJob.payload.parse({ orgId, documentId });
  const base = jobKey(docExtractJob, payload);
  const key = retry === undefined ? base : `${base}:retry:${retry}`;
```

The rest of the function stays. Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` (expect no errors).

2. New `apps/web/src/documents/read-again.ts` with exactly these exports, then implement until step 3's tests pass:

```ts
import type { createSupabaseServerClient } from '../supabase/server';
import { enqueueDocExtract } from './enqueue';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ReadAgainDeps {
  /** Moves the org's document from `failed` back to `received`. False when it was not `failed` (or not found). */
  markReceived(orgId: string, documentId: string): Promise<boolean>;
  enqueue(orgId: string, documentId: string, retry: string): Promise<void>;
  now(): number;
}

/**
 * Restarts the read of a document that could not be read. True when it was restarted.
 * A queue failure is swallowed: the document stays `received`, as after an upload.
 */
export async function restartFailedRead(
  deps: ReadAgainDeps,
  orgId: string,
  documentId: string,
): Promise<boolean>;

/** Supabase-backed deps (RLS applies): update documents set status='received' where id, org_id, status='failed', deleted_at is null; select id. */
export function supabaseReadAgainDeps(supabase: SupabaseServerClient): ReadAgainDeps;
```

`supabaseReadAgainDeps`: `markReceived` runs `.from('documents').update({ status: 'received' }).eq('id', documentId).eq('org_id', orgId).eq('status', 'failed').is('deleted_at', null).select('id')`, throws `new Error('documents')` on error, and returns `data.length > 0`. `enqueue` is `enqueueDocExtract`; `now` is `Date.now`.

3. New `apps/web/test/read-again.test.ts` (do not edit it):

```ts
import { describe, expect, it } from 'vitest';
import { type ReadAgainDeps, restartFailedRead } from '../src/documents/read-again';

const ORG = '11111111-1111-4111-8111-111111111111';

function fake(options: { failed?: boolean; queueDown?: boolean } = {}) {
  const queued: { id: string; retry: string }[] = [];
  const deps: ReadAgainDeps = {
    async markReceived() {
      return options.failed ?? true;
    },
    async enqueue(_org, id, retry) {
      if (options.queueDown) throw new Error('down');
      queued.push({ id, retry });
    },
    now: () => 1_761_436_800_000,
  };
  return { deps, queued };
}

describe('restartFailedRead', () => {
  it('moves a failed document back to the queue with a new job key', async () => {
    const { deps, queued } = fake();
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(true);
    expect(queued).toEqual([{ id: 'doc-1', retry: '1761436800000' }]);
  });

  it('does nothing for a document that did not fail', async () => {
    const { deps, queued } = fake({ failed: false });
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(false);
    expect(queued).toEqual([]);
  });

  it('still counts as restarted when the queue is down', async () => {
    const { deps } = fake({ queueDown: true });
    expect(await restartFailedRead(deps, ORG, 'doc-1')).toBe(true);
  });
});
```

Run `pnpm --filter @shoebox/web test -- read-again 2>&1 | tail -30` (expect 3 passed).

4. New `apps/web/src/documents/read-again-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { restartFailedRead, supabaseReadAgainDeps } from './read-again';

/** "Read again" on a document that could not be read. */
export async function readAgainAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = form.get('id');
  if (typeof id !== 'string' || id === '') return;
  await restartFailedRead(supabaseReadAgainDeps(await createSupabaseServerClient()), auth.orgId, id);
  revalidatePath(`/inbox/${id}`);
  revalidatePath('/inbox');
}
```

Run the typecheck (expect no errors).

5. `upload.ts`: after the `findDocumentBySource` line add

```ts
  /** Restarts the read when the existing document could not be read; true when it did. */
  restartIfFailed(orgId: string, documentId: string): Promise<boolean>;
```

and replace the `if (existing !== null) { ... }` block with:

```ts
      if (existing !== null) {
        const restarted = await deps.restartIfFailed(ctx.orgId, existing);
        items.push({
          fileName: file.name,
          status: restarted ? 'accepted' : 'duplicate',
          documentId: existing,
        });
        continue;
      }
```

6. `upload.test.ts`: in `fakeDeps`, change the options type to `{ failEnqueue?: boolean; failedDocs?: string[] }`, and add after the `findDocumentBySource` method:

```ts
    async restartIfFailed(_org, documentId) {
      return options.failedDocs?.includes(documentId) ?? false;
    },
```

Append a test inside the `describe('uploadDocuments', ...)` block, before its closing `});`:

```ts

  it('restarts the read when the same file comes again after it could not be read', async () => {
    const { deps } = fakeDeps({ failedDocs: ['doc-2'] });
    const [first] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    const [second] = await uploadDocuments(deps, { orgId: ORG, userId: USER }, [pdf('a')]);
    expect(first?.status).toBe('accepted');
    expect(second).toEqual({ fileName: 'Faktura ř.pdf', status: 'accepted', documentId: 'doc-2' });
  });
```

(The fake numbers source files and documents with one counter: the first file is `sf-1`, its document `doc-2`.) Run `pnpm --filter @shoebox/web test -- upload 2>&1 | tail -30` (expect all passed). If `doc-2` is not the id, STOP (§8).

7. `supabase-deps.ts`: add `import { restartFailedRead, supabaseReadAgainDeps } from './read-again';` and, before `enqueueRead: enqueueDocExtract,`:

```ts
    restartIfFailed: (orgId, documentId) =>
      restartFailedRead(supabaseReadAgainDeps(supabase), orgId, documentId),
```

Run the typecheck.

8. `page.tsx`: add imports `Button` (to the `@shoebox/ui` import, keep it sorted) and `import { readAgainAction } from '../../../../src/documents/read-again-actions';`. Replace `      ) : (` that directly follows the `processing` fragment in the excerpt with:

```tsx
      ) : detail.status === 'failed' ? (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-body">{t('doc.detail.failed')}</p>
          {auth.ok && (auth.role === 'owner' || auth.role === 'member') ? (
            <form action={readAgainAction}>
              <input type="hidden" name="id" value={detail.id} />
              <Button type="submit">{t('doc.read_again.button')}</Button>
            </form>
          ) : null}
        </Card>
      ) : (
```

9. `en.json`: after the `"doc.detail.reading"` line add:

```json
  "doc.detail.failed": "We couldn't read this document. You can try again, or upload a clearer copy.",
  "doc.read_again.button": "Read again",
```

Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` and the typecheck.

## 5. Do not touch

`apps/worker/`, `packages/pipeline/`, `packages/db/`, `cs.json`. Hard rules 4 (no document content in logs), 6 (copy only through i18n, design tokens only), 8.

## 6. Commands

- `pnpm --filter @shoebox/web test -- read-again upload 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/documents apps/web/test apps/web/app 2>&1 | tail -30`

## 7. Acceptance

- [ ] The tests in §6 pass, typecheck and biome are clean.
- [ ] `git diff --stat` lists only the §3 files.
- [ ] A failed document's page shows the new sentence and, for owner and member, a "Read again" button. It no longer says "Everything checks out".

## 8. Stop and ask

As in the [template](TEMPLATE.md): an excerpt not found, a test failing twice, 25 tool calls, a new dependency, a file outside §3.

## 9. Report

Write `docs/tasks/0081-report.md` (600 tokens at most) and set `Status: review`: files changed, each command with its last 5 lines, anything that surprised you.
