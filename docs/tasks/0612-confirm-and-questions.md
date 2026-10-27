# 0612: One "Looks right, confirm" button; each issue is a question

Status: review
Ticket: REAL-DATA (owner test 2026-10-27, Josef) | Depends on: none | Base commit: d5c65a1 | Branch: claude/project-thread-w656wo | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Owner, on a document marked "To review": "where do I review, how?". A layman must see one obvious action. The document page shows, when the document is `needs_review`:

- A card at the top of the right column titled "Is this right?" listing each open blocking issue as a plain question with one-tap answers.
- Below it one primary button "Looks right, confirm". It dismisses every open blocking issue of this document (state `dismissed`, `dismiss_reason = 'user_confirmed'`, `resolved_by`, `resolved_at`), sets status `ready`, writes `audit_document`, and returns to the Inbox's next document to review (or the Inbox).

Questions (keys in en.json):
- `buyer.other_firm`: "This invoice is addressed to IČO {id}. Is it for your business?" → [Yes, it's mine] dismisses that issue; [No, not mine] moves the document to trash (existing trash action).
- `buyer.supplier_is_me`: "Your business is the supplier here. Is this an invoice you issued?" → [Yes] dismisses; [No] opens Fix on supplier IČO.
- `ico_checksum` (or the actual id): "We could not verify supplier IČO {ico}. Is it printed like this?" → [Yes, it's right] dismisses; [Fix it] focuses the IČO Fix field.
- Any other blocking issue: its existing message as the text, answers [It's fine] dismisses, [Fix it] focuses the first field key (if any).

Warnings stay as small notes; they never need an answer. When nothing open is blocking after an answer, status becomes `ready` (same rule as `correction.ts`).

## 2. Context

- Page: `apps/web/app/(app)/inbox/[id]/page.tsx`; data `apps/web/src/documents/detail-data.ts`; fixes `correction-actions.ts`, `fix-field.tsx`; trash `trash-actions.ts`; audit in other actions (copy the pattern); review deck `review-actions.ts` / `review-card.tsx` for the one-tap button look.
- `validation_results`: `state` open/resolved/dismissed, `dismiss_reason`, `resolved_by`, `resolved_at`. Every query is org-scoped (hard rule 3). Check that every place deciding status or listing blockers (`review-data.ts`, `duplicate.ts`, `correction.ts`, `inbox-data.ts`) only counts `state = 'open'`; fix the ones that do not.
- A re-read or a user fix re-runs checks: a dismissed rule must stay dismissed when the same rule and same params come back (keep `state` on upsert if params are unchanged). Find the upsert in `packages/db/src/document-reading.ts` / correction store.
- Design system tokens only; primary button = the existing `Button` default variant. Fewest buttons.

## 3. Files

New `apps/web/src/documents/confirm-actions.ts` (`confirmDocumentAction`, `answerIssueAction`), `apps/web/src/documents/issue-questions.ts` (pure: issue row → question + answers; unit tested), `apps/web/src/documents/issues-card.tsx`; edits to the page, detail-data, the queries above, en.json; tests in `apps/web/test`.

## 4. Do not touch

Check logic in `packages/validation`, the worker. Hard rules 2, 3, 6.

## 5. Commands

`pnpm --filter @shoebox/web test -- issue-questions confirm correction detail 2>&1 | tail -30`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, db test/typecheck if touched.

## 6. Report

`docs/tasks/0612-report.md` (600 tokens max), `Status: review`, commit `0612: one confirm button and one-tap questions on the review page`. Do not push.
