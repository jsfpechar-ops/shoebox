# 0512: "Add a missing page"

Status: review
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0511 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When a page of an invoice ended up as its own document (for example uploaded a week later), the user opens the invoice, clicks **Add a missing page**, picks the other document from a short list of recent ones, and the app joins them and reads the invoice again. One small link, hidden until clicked.

## 2. Context

- `join_documents(p_document_id, p_other_id) → uuid[]` (0510): p_other's pages go after p_document's, p_other is removed.
- `apps/web/src/documents/pages-actions.ts` (0511) has `'use server'`, `field(form, name)`, `readAgain(orgId, ids)` and `answerSameInvoiceAction`, which ends:

```ts
    .eq('id', question)
    .eq('org_id', auth.orgId);
  revalidatePath(`/inbox/${id}`);
}
```

- `apps/web/src/documents/pages-data.ts` (0511) exports `loadPagesView(supabase, documentId)` and the `SupabaseLike` type alias (not exported).
- `apps/web/src/documents/pages-card.tsx` (0511) exports `PagesCard({ documentId, view, canFix })`, which returns `null` when `!showPages && view.question === null`, and renders a `<>...</>` fragment that ends:

```tsx
      ) : null}
    </>
  );
}
```

- `page.tsx` (0511) renders `<PagesCard documentId={detail.id} view={pagesView} canFix={...} />`.
- Copy in `packages/i18n/messages/en.json`; the 0511 keys end with `"doc.pages.open_other": "Open the document before it",`.
- 07 rules: no fine print; a native `<details>`/`<summary>` keeps the link hidden until needed. Labels above inputs.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/pages-data.ts` | edit | `loadJoinCandidates` |
| `apps/web/test/pages-data.test.ts` | edit | one test |
| `apps/web/src/documents/pages-actions.ts` | edit | `addPageAction` |
| `apps/web/src/documents/pages-card.tsx` | edit | the picker |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | pass candidates |
| `packages/i18n/messages/en.json` | edit | 4 keys |

No other file may change.

## 4. Steps

1. `pages-data.ts`: add

```ts
export interface JoinCandidate {
  readonly id: string;
  readonly label: string; // supplier name, else the file name, else the received date
}

/**
 * Up to 20 other documents of the org to join into this one: not deleted, not finalized, not this
 * one, newest first (documents: id, partner_snapshot, received_date, created_at,
 * source_files(original_filename)). A query error → [].
 */
export async function loadJoinCandidates(
  supabase: SupabaseLike,
  orgId: string,
  documentId: string,
): Promise<JoinCandidate[]>;
```

   Query: `.from('documents').select('id, partner_snapshot, received_date, source_files(original_filename)').eq('org_id', orgId).is('deleted_at', null).neq('status', 'finalized').neq('id', documentId).order('created_at', { ascending: false }).limit(20)`. Label: `partner_snapshot.name` if a non-empty string, else `source_files.original_filename`, else `received_date`, else `''`.

2. `pages-data.test.ts`: the fake chain must also support `neq`: change `['select', 'eq', 'is', 'order', 'limit']` to `['select', 'eq', 'neq', 'is', 'order', 'limit']`, import `loadJoinCandidates` too, and append:

```ts

describe('loadJoinCandidates', () => {
  it('labels each document by supplier, else file name, else date', async () => {
    const list = await loadJoinCandidates(
      fakeSupabase({
        documents: {
          data: [
            { id: 'd1', partner_snapshot: { name: 'Supplier X' }, received_date: '2026-10-20', source_files: null },
            { id: 'd2', partner_snapshot: null, received_date: '2026-10-21', source_files: { original_filename: 'p2.jpg' } },
            { id: 'd3', partner_snapshot: { name: '' }, received_date: '2026-10-22', source_files: null },
          ],
          error: null,
        },
      }),
      'org',
      'doc-1',
    );
    expect(list).toEqual([
      { id: 'd1', label: 'Supplier X' },
      { id: 'd2', label: 'p2.jpg' },
      { id: 'd3', label: '2026-10-22' },
    ]);
  });
});
```

   Run `pnpm --filter @shoebox/web test -- pages-data 2>&1 | tail -30`.

3. `pages-actions.ts`: append

```ts

/** "Add a missing page": the chosen document's pages go after this one's; it is read again. */
export async function addPageAction(form: FormData): Promise<void> {
  const auth = await requireActiveRole(['owner', 'member']);
  if (!auth.ok) return;
  const id = field(form, 'id');
  const other = field(form, 'other');
  if (id === '' || other === '' || id === other) return;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('join_documents', { p_document_id: id, p_other_id: other });
  if (error || !Array.isArray(data)) return;
  await readAgain(auth.orgId, data as string[]);
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
}
```

4. `pages-card.tsx`: add a prop `candidates: readonly JoinCandidate[]` (import the type from `./pages-data`, import `addPageAction`). Change the early return to `if (!showPages && view.question === null && !(canFix && candidates.length > 0)) return null;`. Before the closing `</>` add:

```tsx
      {canFix && candidates.length > 0 ? (
        <details className="text-body">
          <summary className="cursor-pointer underline">{t('doc.pages.add')}</summary>
          <form action={addPageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="id" value={documentId} />
            <label htmlFor="add-page-other" className="text-body">
              {t('doc.pages.add_label')}
            </label>
            <select
              id="add-page-other"
              name="other"
              required
              className="rounded-control border border-input bg-card p-2 text-body"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label === '' ? t('doc.pages.add_unnamed') : c.label}
                </option>
              ))}
            </select>
            <div>
              <Button type="submit" variant="secondary">
                {t('doc.pages.add_button')}
              </Button>
            </div>
          </form>
        </details>
      ) : null}
```

   If `rounded-control`, `border-input` or `bg-card` is not a class used elsewhere in `apps/web` (`grep -rn "rounded-control" apps/web/src | head -3`), use the classes of the `Input` in `apps/web/src/documents/fix-field.tsx` instead.

5. `page.tsx`: import `loadJoinCandidates` with `loadPagesView`. After the `pagesView` line add `  const candidates = detail && auth.ok ? await loadJoinCandidates(supabase, auth.orgId, detail.id) : [];` and pass `candidates={candidates}` to `<PagesCard`.

6. `en.json`: after `"doc.pages.open_other"` add:

```json
  "doc.pages.add": "Add a missing page",
  "doc.pages.add_label": "Which document holds the missing page?",
  "doc.pages.add_button": "Add it to this invoice",
  "doc.pages.add_unnamed": "Document without a name",
```

## 5. Do not touch

Everything outside §3. Rules 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/web test -- pages-data 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`
- `pnpm exec biome check apps/web/src/documents apps/web/app apps/web/test 2>&1 | tail -30`

## 7. Acceptance

- [x] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0512-report.md` (600 tokens at most) and set `Status: review`.
