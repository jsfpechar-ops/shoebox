# 0513: The same-invoice question in the review deck format

Status: review
Ticket: Page sorting (owner 2026-10-26) | Depends on: 0511 | Base commit: see branch | Branch: claude/project-thread-z0dj04 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 20 tool calls, 40k tokens

## 1. Objective

The review deck (`/inbox/review`, lane D brief 0407) shows every open `review_questions` row whose payload is `{ question: <i18n key>, params?, options: [{ value, label: <i18n key> }] (1–4), suggested?: <value> }` and stores `answer = { value }`; the asking lane reacts. Make the `same_invoice` question follow that shape and give the deck one function to call when it is answered.

## 2. Context

- `packages/db/src/doc-split.ts` `applySortPlan` inserts the question with `payload: { other_document_id: earlierId },` (line ~165); its doc comment (line ~103) says `payload { other_document_id: the earlier one }`.
- `packages/db/migrations/0061_document_page_actions.sql` (not merged yet, edit in place) line ~81: `set answer = '{"same": true}'::jsonb, answered_by = auth.uid(), answered_at = now()`.
- `apps/web/src/documents/pages-actions.ts` `answerSameInvoiceAction`: the "no" path sets `answer: { same: false },`; the "yes" path calls `rpc('join_documents', { p_document_id: other, p_other_id: id })`, then `readAgain(auth.orgId, data as string[])`, `revalidatePath('/inbox')`, `redirect(...)`.
- en.json has `doc.pages.same_yes`, `doc.pages.same_no` (0511) and a question key starting `"doc.pages.same_question"` (grep it; if the key has another name, use that name).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/doc-split.ts` | edit | payload shape |
| `packages/db/migrations/0061_document_page_actions.sql` | edit | answer shape |
| `apps/web/src/documents/pages-actions.ts` | edit | answer shape + `reactToSameInvoice` |

No other file may change.

## 4. Steps

1. `doc-split.ts`: replace the payload with

```ts
      payload: {
        question: 'doc.pages.same_question',
        options: [
          { value: 'yes', label: 'doc.pages.same_yes' },
          { value: 'no', label: 'doc.pages.same_no' },
        ],
        suggested: 'no',
        other_document_id: earlierId,
      },
```

   and in the doc comment write `payload { question, options yes/no, suggested 'no', other_document_id: the earlier one } (review deck shape, 0407)`.
2. `0061…sql`: `'{"same": true}'` → `'{"value": "yes"}'`.
3. `pages-actions.ts`: `answer: { same: false }` → `answer: { value: 'no' }`. Append:

```ts

/**
 * Called by the review deck after it stored the answer of a `same_invoice` question:
 * "yes" joins this document after the one before it and reads it again; "no" needs nothing.
 */
export async function reactToSameInvoice(orgId: string, questionId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: q, error } = await supabase
    .from('review_questions')
    .select('document_id, payload, answer')
    .eq('id', questionId)
    .eq('org_id', orgId)
    .eq('kind', 'same_invoice')
    .maybeSingle();
  if (error || !q) return;
  const answer = q.answer as { value?: unknown } | null;
  const other = (q.payload as { other_document_id?: unknown } | null)?.other_document_id;
  if (answer?.value !== 'yes' || typeof other !== 'string' || typeof q.document_id !== 'string') return;
  const { data, error: joinError } = await supabase.rpc('join_documents', {
    p_document_id: other,
    p_other_id: q.document_id,
  });
  if (joinError || !Array.isArray(data)) return;
  await readAgain(orgId, data as string[]);
  revalidatePath('/inbox');
}
```

## 5. Do not touch

Everything outside §3.

## 6. Commands

- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`
- `pnpm --filter @shoebox/web test 2>&1 | tail -30`
- `pnpm exec biome check packages/db/src apps/web/src/documents 2>&1 | tail -30`

## 7. Acceptance

- [ ] The commands in §6 pass. `git diff --stat` lists only the §3 files.

## 8. Stop and ask

As in the [template](TEMPLATE.md).

## 9. Report

Write `docs/tasks/0513-report.md` (300 tokens at most) and set `Status: review`.
