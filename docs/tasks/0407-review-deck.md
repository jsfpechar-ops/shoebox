# 0407: Review questions, one at a time

Status: todo
Ticket: lane D, M11 §5.7 | Depends on: 0401, 0404 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

`/inbox/review` shows what needs the user as a deck of cards, one at a time: first open questions (`review_questions`, answered with one tap on a chip), then documents that still need a look (open blocking checks, with "Open document"). Keys 1–4 answer, S skips, O opens, Esc leaves. The "To review" tab links to it.

## 2. Context

- `review_questions` (0006): `id, org_id, document_id, kind text, payload jsonb, answer jsonb, answered_by, answered_at, created_at`. Other lanes create questions. Payload contract (this brief defines it, other lanes follow it): `{ "question": "<i18n key>", "params"?: {…}, "options": [{ "value": "<string>", "label": "<i18n key>" }, …up to 4], "suggested"?: "<value>" }`. Rows with a payload of another shape are skipped (never crash).
- Answer effect owned here only for `kind = 'business_or_personal'` with values `business` | `personal` | `mixed`: also set `documents.business_flag` to the value. Other kinds: store the answer only; the lane that asked reacts to it.
- Audit: `rpc('audit_document', { p_document, p_action: 'answer_question', p_diff: { kind, answer } })` when `document_id` is set.
- Validation results: `validation_results (document_id, rule_id, severity, state, params)`, open = `state = 'open'`, blocking = `severity = 'blocking'`. The document card shows only the count, not the rule texts.
- Inbox rows: `loadInbox` in `apps/web/src/documents/inbox-data.ts` (`InboxRow` has `id, status, title, total, issueDate`).
- WCAG 2.1.4: single-key shortcuts only while the card has focus; buttons are real `<button>`s with visible labels; `aria-live="polite"` for "Question 1 of 3".

## 3. Files

| Path | Action |
|---|---|
| `apps/web/src/documents/review-deck.ts` | new (pure) |
| `apps/web/test/review-deck.test.ts` | new (below) |
| `apps/web/src/documents/review-data.ts` | new (loader) |
| `apps/web/src/documents/review-actions.ts` | new (`'use server'`) |
| `apps/web/src/documents/review-card.tsx` | new (`'use client'`, keys) |
| `apps/web/app/(app)/inbox/review/page.tsx` | new |
| `apps/web/app/(app)/inbox/page.tsx` | edit: one link |
| `packages/i18n/messages/en.json` | edit: keys |

## 4. Steps

1. `en.json` keys (after the `manual.*` block):
   ```
     "review.cta": "Go through them one by one",
     "review.title": "Review",
     "review.progress": "{n} of {total}",
     "review.exit": "Finish",
     "review.skip": "Skip",
     "review.open": "Open document",
     "review.suggested": "Suggested: {label}",
     "review.doc_card": "This document needs a look",
     "review.keys": "Keys: 1–4 answer · S skip · O open · Esc finish",
     "review.done.title": "All done. Nothing is waiting for you.",
     "review.done.back": "Back to Inbox",
     "review.error": "That did not save. Please try again.",
     "question.business_or_personal": "Is this for your business or private?",
     "question.option.business": "Business",
     "question.option.personal": "Private",
     "question.option.mixed": "Partly business",
   ```
2. New `apps/web/src/documents/review-deck.ts`:
   ```ts
   import type { MessageKey } from '@shoebox/i18n';
   export interface QuestionPayload { readonly question: MessageKey; readonly params: Record<string, string | number>; readonly options: readonly { value: string; label: MessageKey }[]; readonly suggested: string | null }
   export type ReviewCard =
     | { readonly type: 'question'; readonly id: string; readonly documentId: string | null; readonly kind: string; readonly payload: QuestionPayload; readonly createdAt: string }
     | { readonly type: 'document'; readonly documentId: string; readonly blocking: number; readonly createdAt: string };
   /** null unless the payload has a string question, 1–4 options of {value, label} strings, optional params object and suggested string that is one of the values. */
   export function parseQuestionPayload(raw: unknown): QuestionPayload | null;
   /** Questions first (oldest first, those of one document together in order of their first question), then documents with blocking checks (most blocking first, then oldest). A document that has an open question gets no document card. */
   export function buildDeck(questions: readonly Extract<ReviewCard, { type: 'question' }>[], documents: readonly Extract<ReviewCard, { type: 'document' }>[]): ReviewCard[];
   /** The card to show for `?skip=` (a count of skipped cards): deck[skip] or null when past the end. */
   export function cardAt(deck: readonly ReviewCard[], skip: number): ReviewCard | null;
   /** The key pressed → the action: '1'..'4' → {answer: index}, 's'/'S' → skip, 'o'/'O' → open, 'Escape' → exit, else null. */
   export function keyAction(key: string): { answer: number } | 'skip' | 'open' | 'exit' | null;
   ```
   Test `apps/web/test/review-deck.test.ts` (do not edit):
   ```ts
   import { describe, expect, it } from 'vitest';
   import { buildDeck, cardAt, keyAction, parseQuestionPayload } from '../src/documents/review-deck';

   const payload = {
     question: 'question.business_or_personal',
     options: [
       { value: 'business', label: 'question.option.business' },
       { value: 'personal', label: 'question.option.personal' },
     ],
     suggested: 'personal',
   };
   const q = (id: string, documentId: string | null, createdAt: string) => ({
     type: 'question' as const,
     id,
     documentId,
     kind: 'business_or_personal',
     payload: parseQuestionPayload(payload) ?? (() => { throw new Error('payload'); })(),
     createdAt,
   });
   const d = (documentId: string, blocking: number, createdAt: string) => ({ type: 'document' as const, documentId, blocking, createdAt });

   describe('parseQuestionPayload', () => {
     it('accepts the contract and fills defaults', () => {
       expect(parseQuestionPayload(payload)).toEqual({ ...payload, params: {} });
       expect(parseQuestionPayload({ ...payload, suggested: undefined })?.suggested).toBeNull();
     });
     it('rejects other shapes', () => {
       expect(parseQuestionPayload(null)).toBeNull();
       expect(parseQuestionPayload({ ...payload, options: [] })).toBeNull();
       expect(parseQuestionPayload({ ...payload, options: Array(5).fill(payload.options[0]) })).toBeNull();
       expect(parseQuestionPayload({ ...payload, suggested: 'other' })).toBeNull();
       expect(parseQuestionPayload({ ...payload, question: 3 })).toBeNull();
     });
   });

   describe('buildDeck', () => {
     it('questions first, grouped by document, then documents by blocking count', () => {
       const deck = buildDeck(
         [q('q1', 'A', '2026-10-01T00:00:00Z'), q('q2', 'B', '2026-10-02T00:00:00Z'), q('q3', 'A', '2026-10-03T00:00:00Z')],
         [d('C', 1, '2026-09-01T00:00:00Z'), d('A', 2, '2026-09-01T00:00:00Z'), d('E', 3, '2026-09-05T00:00:00Z')],
       );
       expect(deck.map((c) => (c.type === 'question' ? c.id : c.documentId))).toEqual(['q1', 'q3', 'q2', 'E', 'C']);
     });
     it('cardAt walks past skipped cards', () => {
       const deck = buildDeck([], [d('C', 1, '2026-09-01T00:00:00Z')]);
       expect(cardAt(deck, 0)?.type).toBe('document');
       expect(cardAt(deck, 1)).toBeNull();
       expect(cardAt(deck, -1)?.type).toBe('document');
     });
   });

   describe('keyAction', () => {
     it('maps the shortcuts', () => {
       expect(keyAction('2')).toEqual({ answer: 1 });
       expect(keyAction('S')).toBe('skip');
       expect(keyAction('o')).toBe('open');
       expect(keyAction('Escape')).toBe('exit');
       expect(keyAction('5')).toBeNull();
     });
   });
   ```
   (`cardAt` treats a negative skip as 0.)
3. New `review-data.ts`: `export async function loadDeck(supabase, orgId): Promise<ReviewCard[]>`: unanswered questions (`review_questions` `.eq('org_id', orgId).is('answered_at', null).order('created_at').limit(200)`, payload through `parseQuestionPayload`, skip nulls); open blocking checks (`validation_results` select `document_id` `.eq('org_id', orgId).eq('state', 'open').eq('severity', 'blocking').limit(1000)`, count per document) joined to live `needs_review` documents (`documents` select `id, created_at` `.eq('org_id', orgId).eq('status', 'needs_review').is('deleted_at', null)`); `buildDeck`. Errors → `[]`. Also `export async function loadCardDocument(supabase, orgId, id)` returning `{ title, total, issueDate } | null` (same mapping as `inboxRowOf`; you may call `inboxRowOf` on a row selected with the inbox columns).
4. New `review-actions.ts`: `export async function answerQuestionAction(form: FormData): Promise<void>`: owner/member; `id`, `value` from form; load the question (org-scoped, unanswered) and parse its payload; `value` must be one of its options; update `answer: { value }, answered_by: auth.userId, answered_at: now` (`.eq('id', id).eq('org_id', orgId).is('answered_at', null)`); if kind is `business_or_personal` and the document is set, update `documents.business_flag`; audit when document is set; `revalidatePath('/inbox')`; `redirect('/inbox/review')`. On any error `redirect('/inbox/review?error=1')`.
5. New `review-card.tsx` (`'use client'`): props `{ card: ReviewCard; doc: { title: string | null; total: { value: string; currency: string } | null; issueDate: LegalDate | null } | null; position: number; total: number; skip: number }`. Renders a `<section tabIndex={0} aria-labelledby=…>` that focuses itself on mount and handles `onKeyDown` with `keyAction` (answers submit the matching option's form via `requestSubmit`; skip → `router.push('/inbox/review?skip=' + (skip + 1))`; open → `router.push('/inbox/' + documentId)`; exit → `router.push('/inbox')`). Content: `<p aria-live="polite">` `review.progress`; doc line (title or `inbox.row.unknown_supplier`, `MoneyText`, `LegalDateText`); for a question: `<h2>` `t(payload.question, payload.params)`, one `<form action={answerQuestionAction}>` per option (hidden `id`, `value`) with a `Button` labelled `[n] ` + `t(option.label)` (the suggested one uses the primary variant, others secondary), and `review.suggested` text when set; for a document card: `<h2>` `review.doc_card` and a `Link` `review.open`. Footer: `Button` skip, `Link` open (when a document), `Link` exit (`review.exit`), and `<p className="text-body">` `review.keys`.
6. New `apps/web/app/(app)/inbox/review/page.tsx`: `searchParams` `skip` (int ≥ 0), `error`; `requireActiveRole(['owner','member'])` (else `redirect('/inbox')`); `deck = await loadDeck`; `card = cardAt(deck, skip)`; no card → `<h1>` `review.done.title` + `Link` `review.done.back`; else load the card's document and render `<h1 className="sr-only">` `review.title` + `<ReviewCard … position={skip + 1} total={deck.length} />`; `error` → `<p role="alert">` `review.error`.
7. Inbox `page.tsx`: in the "To review" tab, when the filtered list is non-empty, add above it `<Link href="/inbox/review" className="text-body underline">{t('review.cta')}</Link>`.
8. `pnpm --filter @shoebox/web test -- review-deck 2>&1 | tail -20`, `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`, `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`, `pnpm exec biome check apps/web packages/i18n 2>&1 | tail -15` (fix your files with `--write`).

## 5. Do not touch

Migrations, other lanes' files (`packages/validation`, `packages/pipeline`). Hard rules 2, 3, 6.

## 6. Commands

As in step 8.

## 7. Acceptance

- [ ] review-deck tests pass; typecheck 0; biome clean.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0407-report.md`, 150 tokens at most. Set `Status: review`.
