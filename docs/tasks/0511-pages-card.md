# 0511: Document page: its pages, "These are separate invoices", "Is this one invoice?"

Status: todo
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0510 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A document made of several pages shows them in a small "Pages" card, with one fix link: **These are separate invoices**. When the sorting was unsure, the page asks one plain question, **"Is this part of the same invoice as the document before it?"** with Yes and No. Yes joins them; No keeps them apart. The owner wants the fewest buttons (rules 11–14 of 07): these appear only on documents that need them.

## 2. Context

- Database functions (0510, `security invoker`): `separate_document_pages(p_document_id uuid) → uuid[]` (the documents to read again; `[]` when nothing changed) and `join_documents(p_document_id uuid, p_other_id uuid) → uuid[]` (p_other's pages go after p_document's; p_other is removed). Call them with `supabase.rpc('separate_document_pages', { p_document_id })`.
- `review_questions` rows of kind `'same_invoice'` sit on the later document with `payload.other_document_id` = the earlier one; open while `answered_at` is null. Owner and member may update them (`answer`, `answered_by`, `answered_at`).
- `enqueueDocExtract(orgId, documentId, retry?)` in `apps/web/src/documents/enqueue.ts` (0500): pass `retry = String(Date.now())` so a document read before is read again.
- Server action pattern: `apps/web/src/documents/read-again-actions.ts` (`'use server'`, `requireActiveRole(['owner', 'member'])`, `createSupabaseServerClient()`, `revalidatePath`). `redirect` comes from `next/navigation`.
- UI: `@shoebox/ui` exports `Button` (variants `primary`, `secondary`, `ghost`, `link`), `Card`. Text classes: `text-card-title`, `text-body`, `text-meta text-muted-foreground`. Copy only through `t()` from `@shoebox/i18n`, keys in `packages/i18n/messages/en.json` (rule 6; `cs.json` stays dormant).
- `apps/web/app/(app)/inbox/[id]/page.tsx` excerpts (find verbatim):

```tsx
  const detail = auth.ok ? await loadDocumentDetail(supabase, auth.orgId, id) : null;
```

```tsx
      {detail.file && fileUrl ? (
```

  `canFix` is defined in that page as owner/member and status `ready` or `needs_review`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/pages-data.ts` | new | `loadPagesView` |
| `apps/web/test/pages-data.test.ts` | new | given below |
| `apps/web/src/documents/pages-actions.ts` | new | 2 server actions |
| `apps/web/src/documents/pages-card.tsx` | new | the card |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | load + render the card |
| `packages/i18n/messages/en.json` | edit | 6 keys |

No other file may change.

## 4. Steps

1. New `apps/web/src/documents/pages-data.ts`; implement until step 2 passes:

```ts
import type { createSupabaseServerClient } from '../supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface PageLine {
  readonly position: number;
  readonly fileName: string | null;
  readonly filePage: number;
  readonly region: string;
}

export interface PagesView {
  readonly pages: readonly PageLine[];
  /** An open same_invoice question on this document, or null. */
  readonly question: { readonly id: string; readonly otherDocumentId: string } | null;
}

/**
 * The document's pages (document_pages with source_files(original_filename), by position) and its
 * open same_invoice question (review_questions: document_id, kind 'same_invoice', answered_at null,
 * the oldest one; payload.other_document_id must be a string, else no question).
 * Any query error → { pages: [], question: null }.
 */
export async function loadPagesView(
  supabase: SupabaseLike,
  documentId: string,
): Promise<PagesView>;
```

2. New `apps/web/test/pages-data.test.ts` (do not edit it; `biome format --write` allowed):

```ts
import { describe, expect, it } from 'vitest';
import { loadPagesView } from '../src/documents/pages-data';

type Result = { data: unknown; error: unknown };

/** A minimal stand-in for the Supabase query builder: every chain resolves to the table's result. */
function fakeSupabase(results: Record<string, Result>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: null, error: { message: 'no table' } };
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit']) chain[name] = () => chain;
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  } as never;
}

describe('loadPagesView', () => {
  it('lists the pages in order with their file names', async () => {
    const view = await loadPagesView(
      fakeSupabase({
        document_pages: {
          data: [
            { position: 1, file_page: 1, region: '', source_files: { original_filename: 'a.jpg' } },
            { position: 2, file_page: 3, region: 'top', source_files: { original_filename: 'scan.pdf' } },
          ],
          error: null,
        },
        review_questions: { data: null, error: null },
      }),
      'doc-1',
    );
    expect(view).toEqual({
      pages: [
        { position: 1, fileName: 'a.jpg', filePage: 1, region: '' },
        { position: 2, fileName: 'scan.pdf', filePage: 3, region: 'top' },
      ],
      question: null,
    });
  });

  it('returns the open same-invoice question', async () => {
    const view = await loadPagesView(
      fakeSupabase({
        document_pages: { data: [], error: null },
        review_questions: { data: { id: 'q-1', payload: { other_document_id: 'doc-0' } }, error: null },
      }),
      'doc-1',
    );
    expect(view.question).toEqual({ id: 'q-1', otherDocumentId: 'doc-0' });
  });

  it('shows nothing when a query fails', async () => {
    const view = await loadPagesView(fakeSupabase({}), 'doc-1');
    expect(view).toEqual({ pages: [], question: null });
  });
});
```

   Use `.maybeSingle()` for the question query (with `.order('created_at', { ascending: true }).limit(1)`) and await the pages query directly. Run `pnpm --filter @shoebox/web test -- pages-data 2>&1 | tail -30`.

3. New `apps/web/src/documents/pages-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireActiveRole } from '../auth/org-context';
import { createSupabaseServerClient } from '../supabase/server';
import { enqueueDocExtract } from './enqueue';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

async function readAgain(orgId: string, ids: readonly string[]): Promise<void> {
  const retry = String(Date.now());
  for (const id of ids) {
    try {
      await enqueueDocExtract(orgId, id, retry);
    } catch {
      // The queue is down: the documents stay `received`.
    }
  }
}

/** "These are separate invoices": one document per page, each read again. */
export async function separatePagesAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  if (id === '') return;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('separate_document_pages', { p_document_id: id });
  if (error || !Array.isArray(data)) return;
  await readAgain(auth.orgId, data as string[]);
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
}

/** The answer to "Is this part of the same invoice as the document before it?". */
export async function answerSameInvoiceAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  const other = field(form, 'other');
  const question = field(form, 'question');
  if (id === '' || other === '' || question === '') return;
  const supabase = await createSupabaseServerClient();
  if (field(form, 'answer') === 'yes') {
    const { data, error } = await supabase.rpc('join_documents', {
      p_document_id: other,
      p_other_id: id,
    });
    if (error || !Array.isArray(data)) return;
    await readAgain(auth.orgId, data as string[]);
    revalidatePath('/inbox');
    redirect(`/inbox/${other}`);
  }
  await supabase
    .from('review_questions')
    .update({ answer: { same: false }, answered_by: auth.userId, answered_at: new Date().toISOString() })
    .eq('id', question)
    .eq('org_id', auth.orgId);
  revalidatePath(`/inbox/${id}`);
}
```

   Run `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`. If `auth.userId` does not exist on the auth result, STOP (§8).

4. New `apps/web/src/documents/pages-card.tsx` (a server component):

```tsx
import { t } from '@shoebox/i18n';
import { Button, Card } from '@shoebox/ui';
import Link from 'next/link';
import { answerSameInvoiceAction, separatePagesAction } from './pages-actions';
import type { PagesView } from './pages-data';

/** Pages of a sorted document and the one fix the user may need; nothing when there is nothing to show. */
export function PagesCard({
  documentId,
  view,
  canFix,
}: {
  documentId: string;
  view: PagesView;
  canFix: boolean;
}) {
  const showPages = view.pages.length > 1;
  if (!showPages && view.question === null) return null;
  return (
    <>
      {view.question !== null ? (
        <Card className="flex flex-col gap-4 p-6">
          <p className="text-body">{t('doc.pages.same_question')}</p>
          <Link href={`/inbox/${view.question.otherDocumentId}`} className="text-body underline">
            {t('doc.pages.open_other')}
          </Link>
          {canFix ? (
            <div className="flex flex-wrap gap-2">
              {(['yes', 'no'] as const).map((answer) => (
                <form key={answer} action={answerSameInvoiceAction}>
                  <input type="hidden" name="id" value={documentId} />
                  <input type="hidden" name="other" value={view.question?.otherDocumentId} />
                  <input type="hidden" name="question" value={view.question?.id} />
                  <input type="hidden" name="answer" value={answer} />
                  <Button type="submit" variant={answer === 'yes' ? 'primary' : 'secondary'}>
                    {t(answer === 'yes' ? 'doc.pages.same_yes' : 'doc.pages.same_no')}
                  </Button>
                </form>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      {showPages ? (
        <Card className="flex flex-col gap-3 p-6">
          <h2 className="text-card-title">{t('doc.pages.title', { count: view.pages.length })}</h2>
          <ol className="flex flex-col gap-1">
            {view.pages.map((page) => (
              <li key={page.position} className="text-body">
                {t('doc.pages.line', {
                  file: page.fileName ?? '',
                  page: page.filePage,
                })}
              </li>
            ))}
          </ol>
          {canFix ? (
            <form action={separatePagesAction}>
              <input type="hidden" name="id" value={documentId} />
              <Button type="submit" variant="link">
                {t('doc.pages.separate')}
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
```

5. `page.tsx`: import `loadPagesView` from `../../../../src/documents/pages-data` and `PagesCard` from `../../../../src/documents/pages-card`. After the `const detail = ...` line add `  const pagesView = detail ? await loadPagesView(supabase, detail.id) : null;`. Directly before `      {detail.file && fileUrl ? (` insert:

```tsx
      {pagesView && !processing ? (
        <PagesCard
          documentId={detail.id}
          view={pagesView}
          canFix={auth.ok && (auth.role === 'owner' || auth.role === 'member')}
        />
      ) : null}

```

6. `en.json`: after the `"doc.read_again.button"` line add:

```json
  "doc.pages.title": "{count, plural, one {# page} other {# pages}}",
  "doc.pages.line": "{file}, page {page}",
  "doc.pages.separate": "These are separate invoices",
  "doc.pages.same_question": "Is this part of the same invoice as the document before it? We kept them apart to be safe.",
  "doc.pages.same_yes": "Yes, one invoice",
  "doc.pages.same_no": "No, keep them apart",
  "doc.pages.open_other": "Open the document before it",
```

   Run `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`.

## 5. Do not touch

The rest of `page.tsx` (lane D also edits it), the worker, migrations. Rules 6, 7 (no new screen: this is a card on the existing document page).

## 6. Commands

- `pnpm --filter @shoebox/web test -- pages-data 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/documents apps/web/app apps/web/test 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0511-report.md` (600 tokens at most) and set `Status: review`.
