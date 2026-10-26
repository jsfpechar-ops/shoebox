# 0119: Payment card on the document page (confirm or reject a found payment)

Status: open
Ticket: P2-BANK-06 (UI half, M07 US9) | Depends on: 0118 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

On a document's page (`/inbox/[id]`), show whether the invoice is paid and, when the matcher found a likely payment it was not sure enough to link by itself, ask one plain question with two buttons: "Yes, that's it" / "No". M07 US9: "I confirm or reject a suggested pairing with one tap". No new screen.

## 2. Context

- `match_suggestions` and `payment_links` are **select-only for users** (RLS, 05 §10.2), so the web server action only queues a job; the worker (service role, tenant tx) writes. Columns: see `packages/db/migrations/0020_money.sql` lines 100-129 (`match_suggestions.state` in open/accepted/rejected/superseded, `decided_by`, `decided_at`; `payment_links.created_by` 'system'|'user', `confirmed_by`, `confirmed_at`, `match_method` enum has `'manual'`).
- Worker matcher: `apps/worker/src/bank-match/handler.ts`. `runMatch` step 6 (around line 410) recomputes `paid_at` for linked documents from `loadDocumentLinks` + `computePaidAt`. Step 5 sets the transaction `match_state`.
- Store functions: `packages/db/src/match-store.ts` (`insertPaymentLinks`, `setTransactionMatch`, `loadDocumentLinks`, `loadDocumentPaidView`, `setDocumentPaidAt`). Jobs: `packages/pipeline/src/jobs.ts` (`bankMatchTransactionsJob` at line 254 is the pattern). Worker registration: `apps/worker/src/bank-match/register.ts`.
- Web patterns to copy: `apps/web/src/documents/duplicate.ts` (store over the Supabase client, org-scoped), `duplicate-actions.ts` (server action with `requireActiveRole(['owner','member'])` and `useActionState` state), `duplicate-notice.tsx` (client card), `enqueue.ts` (`enqueueEmailReceived` shape). Page: `apps/web/app/(app)/inbox/[id]/page.tsx` (the card goes in the non-processing, non-failed branch, as the first child after the opening `<>`).
- Learning (aliases) on confirm is M07 §5 line 342: leave `TODO(M07-learning)`; do not implement.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/src/match-store.ts` | edit | `loadSuggestionForDecision`, `decideSuggestion` (state + decided_by/at), `refreshTransactionMatchState` |
| `packages/db/src/index.ts` | edit | export them (if the file re-exports match-store by name) |
| `packages/pipeline/src/jobs.ts` | edit | `bankMatchDecideJob` name `bank.match.decide`, payload `{ orgId, suggestionId: uuid, decision: 'accept'\|'reject', userId: uuid }`, singleton key on suggestionId |
| `packages/pipeline/test/jobs.test.ts` | edit | only if a count/list assertion requires it |
| `apps/worker/src/bank-match/handler.ts` | edit | export a `refreshPaidAt(deps, tx, orgId, documentIds)` extracted from step 6 (runMatch calls it; behaviour unchanged) and `createBankMatchDecideHandler(deps)` |
| `apps/worker/src/bank-match/register.ts` | edit | register the decide job |
| `apps/worker/test/bank-match-decide.test.ts` | new | fake-store tests (§4 step 3) |
| `apps/web/src/documents/payment.ts` | new | `PaymentStore` + `supabasePaymentStore(supabase, orgId)` + pure `paymentView(...)` |
| `apps/web/src/documents/payment-actions.ts` | new | `decidePaymentAction` |
| `apps/web/src/documents/payment-card.tsx` | new | client card |
| `apps/web/src/documents/enqueue.ts` | edit | `enqueueMatchDecision` |
| `apps/web/app/(app)/inbox/[id]/page.tsx` | edit | load view, render card |
| `apps/web/test/payment.test.ts` | new | `paymentView` tests |
| `packages/i18n/messages/en.json` | edit | keys in §4 step 4 (English only; `cs.json` untouched) |

No other file may change. No migration, no new dependency.

## 4. Steps

1. **DB.** `loadSuggestionForDecision(tx, orgId, id)` returns `{ id, transaction_id, kind, document_ids: string[], amounts: string[], state, score }` or null (org-scoped). `decideSuggestion(tx, orgId, id, state: 'accepted'|'rejected', userId)` sets state, `decided_by`, `decided_at = now()` only `where state = 'open'`, returns true when a row changed. `refreshTransactionMatchState(tx, orgId, transactionId)` sets `match_state` to `'matched'` when the sum of the transaction's `payment_links.amount_account_currency` ≥ `abs(amount)`, `'partial'` when > 0, else leaves it; `matched_at` as `setTransactionMatch` does. Use `sql.param([...])` for arrays (see existing code). Commit `0119 step 1`.

2. **Job + worker.** Add the job. Decide handler: load the suggestion; return if missing or not `open`, or kind not `document`/`multi_document` (transfer/category accept: `TODO(M07-transfer-accept)`, still mark the state). **reject** → `decideSuggestion(..., 'rejected')` (the matcher already never re-suggests a rejected pair). **accept** → `decideSuggestion(..., 'accepted')`; if it changed, insert one `payment_links` row per document id with the suggestion's amount for it (`amount` and `amount_account_currency` both = that amount; the matcher writes same-currency suggestions only, otherwise `TODO(M07-fx)`), `link_type 'payment'`, `match_method 'manual'`, `confidence` = score, `created_by 'user'`, `confirmed_by` = userId, `confirmed_at now()` (extend `PaymentLinkInsert`/`insertPaymentLinks` with optional `createdBy`/`confirmedBy`, defaults unchanged); then `refreshTransactionMatchState`, then `refreshPaidAt` for those documents; then `syncOpenSuggestions(tx, orgId, transactionId, [])` is NOT called (other open suggestions for the same transaction stay; `TODO(M07-supersede-on-accept)`). Commit `0119 step 2`.

3. **Worker tests** (`bank-match-decide.test.ts`, fake store like `bank-match.test.ts`): reject marks rejected and writes no link; accept writes one manual user link per document with the right amounts, refreshes the transaction state and sets `paid_at` when fully paid; a second accept of the same suggestion (state no longer open) writes nothing; a missing suggestion is a no-op. Run `pnpm --filter @shoebox/worker exec vitest run test/bank-match-decide.test.ts test/bank-match.test.ts 2>&1 | tail -30` → pass. Commit `0119 step 3`.

4. **Web.** `PaymentStore`: `openSuggestions(documentId)` (match_suggestions where `document_ids` contains the id, state open, kind document/multi_document, order by score desc, limit 3) and `transactions(ids)` (`id, booked_on, amount, currency, counterparty_name`), and `paidAt(documentId)` from documents. `paymentView({ paidAt, suggestions, transactions, documentId })` → `{ paidAt: string | null, found: { suggestionId, bookedOn, amount, currency, counterparty: string | null }[] }`, where `amount` is the suggestion's amount for this document (index of documentId in `document_ids`), as a string. Never throw: on a store error the page shows no card. `decidePaymentAction(prev, form)`: role owner/member, fields `id` (suggestion), `document`, `decision` ∈ accept/reject; enqueue; `revalidatePath('/inbox/' + document)`; state `{ error: MessageKey | null; done: boolean }`. Card: title `doc.payment.title`; when `paidAt`: `doc.payment.paid` with `<LegalDateText>`; else for each found row `doc.payment.found` (amount with `<MoneyText>`, date, counterparty or `doc.payment.unknown_counterparty`) and two buttons (`doc.payment.yes` primary, `doc.payment.no` secondary; buttons only when the user can act); after a decision show `doc.payment.saved` and render `<AutoRefresh active />`. Nothing found and not paid: no card at all (fewest things on screen). Keys:
   - `"doc.payment.title": "Payment"`
   - `"doc.payment.paid": "Paid on {date}."` (if the key format does not allow a component, render the date next to a key without the placeholder: `"doc.payment.paid": "Paid on"`)
   - `"doc.payment.found": "We found a payment that looks like this invoice. Is it the one?"`
   - `"doc.payment.unknown_counterparty": "Unknown sender"`
   - `"doc.payment.yes": "Yes, that's it"`, `"doc.payment.no": "No"`
   - `"doc.payment.saved": "Thanks, we're updating the invoice."`
   - `"doc.payment.error": "We couldn't save that. Try again."`
   Tests in `apps/web/test/payment.test.ts` for `paymentView` (paid; one suggestion; multi-document picks the right amount; empty). Commit `0119 step 4`.

## 5. Do not touch

Migrations, `cs.json`, other screens, the matcher scoring. Hard rules: org-scoped queries; money as strings/`Money`, never float; design tokens only; English copy in `en.json`.

## 6. Commands

- Worker tests above; `pnpm --filter @shoebox/web exec vitest run test/payment.test.ts 2>&1 | tail -30`; `pnpm --filter @shoebox/pipeline exec vitest run test/jobs.test.ts 2>&1 | tail -30`.
- Typecheck `@shoebox/db`, `@shoebox/pipeline`, `@shoebox/worker`, `@shoebox/web`; `pnpm --filter @shoebox/i18n test 2>&1 | tail -30`.
- `pnpm biome check <changed paths> 2>&1 | tail -5` → 0 errors (no `!` non-null assertions).

## 7. Acceptance

- [ ] All commands above pass. - [ ] No card when nothing is found and the invoice is unpaid. - [ ] The server action only enqueues.

## 8. Stop and ask

Stop and write the report if a file outside §3 needs a change, a test fails twice, or you reach 25 tool calls / 50k tokens.

## 9. Report

`docs/tasks/0119-report.md` (600 tokens at most), `Status: review`: files changed, each command with its last 5 lines, deviations.
