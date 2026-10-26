# 0120: Missing-documents radar (payments without an invoice)

Status: todo
Ticket: P2-RADAR-01 | Depends on: 0118, 0119 | Branch: claude/project-thread-236iho | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

A business payment that left the account more than 7 days ago with no invoice matched becomes a plain question in the Inbox review queue: "You paid {amount} to {counterparty} on {date}. We don't have the invoice." with up to four one-tap answers. When the invoice arrives and gets matched, the question disappears by itself. This is what makes the books complete for a layman.

## 2. Context (read only these ranges)

- Spec: `docs/v3/modules/M07-bank-and-payments.md` §4.8 (lines 416-432) and the `bank.radar.refresh` payload at line 556. Phase 2 scope here: **`missing_document` only**. `missing_credit_note`, `unexplained_income`, `expected_invoice`, `substitute_unpaid` and "pick from documents" stay `TODO(M07-radar-<kind>)`.
- `review_questions` table: `packages/db/migrations/0006_documents_detail.sql` lines 101-125 (`transaction_id` set, `document_id` null, `kind = 'missing_document'`, `payload` jsonb, `answer` jsonb, `answered_at`). Users answer through `apps/web/src/documents/review-actions.ts` (`answerQuestionAction` stores the answer; "the asking lane reacts").
- Deck payload contract: `parseQuestionPayload` in `apps/web/src/documents/review-deck.ts` (question key, params string|number, 1-4 options `{ value, label }`, optional `suggested`). Card UI: `apps/web/src/documents/review-card.tsx`.
- Transactions columns: `packages/db/migrations/0020_money.sql` (`amount` signed, `match_state`, `category_code`, `is_pending`, `money_account_id` → `money_accounts.is_business`, `counterparty_name`, `variable_symbol`, `booked_on`). Remainder: `abs(amount)` minus the sum of the transaction's `payment_links.amount_account_currency`.
- Grace days: `MATCHER_CONFIG.radarGraceDays` in `packages/bank/src/matcher/config.ts` (7).
- Jobs: `packages/pipeline/src/jobs.ts` (`bankMatchDecideJob` is the newest pattern); worker registration `apps/worker/src/bank-match/register.ts`; for a daily run find how an existing nightly job is scheduled (`grep -rn "schedule" apps/worker/src packages/pipeline/src | head`) and copy that mechanism.
- Org details for the supplier request: the taxpayer profile / organizations columns (name, IČO, DIČ, address); `grep -n` in `packages/db/migrations` for the table that holds them. Most recent sender: `inbound_emails.from_address` of an e-mail that delivered a document of the same supplier (match on supplier IČO or name); leave the recipient empty when unknown (never guess `info@`).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/bank/src/radar.ts` | new | pure `radarCandidates(txs, today, graceDays)` and `supplierRequestText(input)` (subject + body, English, plain text) |
| `packages/bank/src/index.ts` | edit | export them |
| `packages/bank/test/radar.test.ts` | new | pure tests |
| `packages/db/src/radar-store.ts` | new | org-scoped SQL: load radar transactions, load open/answered radar questions, insert question, resolve (set `answer = {"resolved":"auto"}`, `answered_at = now()`), apply answer to the transaction, last supplier sender |
| `packages/db/src/index.ts` | edit | export |
| `packages/pipeline/src/jobs.ts` | edit | `bankRadarRefreshJob` (`bank.radar.refresh`, payload `{ orgId }`, singleton per org) |
| `apps/worker/src/bank-radar/handler.ts`, `register.ts` | new | the job; daily schedule per org + run after each `bank.match.*` and `bank.match.decide` run (enqueue at the end of those handlers only if they expose an enqueue dep already; otherwise rely on the daily run + the web trigger below) |
| `apps/worker/src/main.ts` | edit | register |
| `apps/worker/test/bank-radar.test.ts` | new | fake-store tests |
| `apps/web/src/documents/review-actions.ts` | edit | after saving an answer to a `missing_document` question, enqueue `bank.radar.refresh` for the org |
| `apps/web/src/documents/enqueue.ts` | edit | `enqueueRadarRefresh(orgId)` |
| `apps/web/src/documents/review-card.tsx` | edit | for kind `missing_document` with a `mailto` param, show an "Ask the supplier" `mailto:` link and a "Copy text" button (clipboard) under the options |
| `packages/i18n/messages/en.json` | edit | keys §4 step 4 |

No migration. No other file unless a test proves it necessary (then say so in the report).

## 4. Steps

1. **Pure** (`radar.ts`): a candidate is a transaction with `amount < 0`, `match_state` in `unmatched|partial`, business account, `category_code` null, not pending, `booked_on <= today - graceDays`, remainder > 0. `supplierRequestText({ orgName, ico, dic, address, bookedOn, amount, currency, variableSymbol, counterparty })` → `{ subject, body }`: subject `Invoice for payment of {amount} {currency} on {date}`; body asks for a tax document for that payment and lists the org's invoicing details (lines omitted when a value is null). Amounts as strings formatted with 2 decimals; no floats. Tests: boundary day (exactly grace days old is in; one day less is out), partial remainder, incoming excluded, pending excluded, categorised excluded, text omits null lines. Commit `0120 step 1`.

2. **Store + job.** Handler per org: (a) apply answered, not yet applied radar questions (mark applied in `answer.applied = true`): `private` → `match_state = 'no_document_needed'` and category `private` when that code exists in `categories` (else null, `TODO(P0-DB-11)`); `no_document` → `match_state = 'no_document_needed'`; `upload` and `request` → nothing (the question stays answered; the transaction stays a candidate but gets no new question while an answered one exists). (b) load candidates; (c) insert a question for each candidate with no radar question yet (open or answered); payload: `question: 'review.missing_document.question'`, params `{ amount, currency, date, counterparty, mailto }` (`mailto` = full `mailto:` URL, recipient possibly empty, subject/body URL-encoded), options in this order: `upload` (`review.missing_document.upload`), `no_document` (`review.missing_document.no_document`), `private` (`review.missing_document.private`), no `suggested`; (d) auto-resolve open radar questions whose transaction is no longer a candidate. Idempotent: running twice inserts nothing new. Tests with a fake store: appears after grace, not before; second run no duplicate; matched transaction → open question auto-resolved; `no_document` answer → transaction updated once, no new question; `private` answer → state + category. Commit `0120 step 2`.

3. **Web.** Enqueue after a `missing_document` answer; review card link + copy button (client component already? keep the existing pattern; `navigator.clipboard.writeText`, show `review.missing_document.copied` for 2 s). Nothing is ever sent by the app. Commit `0120 step 3`.

4. **Copy** (`en.json`, English only, `cs.json` untouched):
   - `"review.missing_document.question": "You paid {amount} {currency} to {counterparty} on {date}, but we don't have the invoice."`
   - `"review.missing_document.upload": "I'll upload it"`
   - `"review.missing_document.no_document": "There's no invoice for this"`
   - `"review.missing_document.private": "It was a private payment"`
   - `"review.missing_document.ask_supplier": "Ask the supplier for it"`
   - `"review.missing_document.copy": "Copy the request text"`, `"review.missing_document.copied": "Copied"`
   - `"review.missing_document.unknown_counterparty": "an unknown recipient"`: when the counterparty is unknown the worker stores `counterparty: ''` and the card substitutes this text before formatting the question.
   Commit `0120 step 4`.

## 5. Do not touch

Matcher scoring, migrations, `cs.json`, other screens. Hard rules: org-scoped queries, money never float, design tokens only, English copy in `en.json`, no e-mail sent by the app.

## 6. Commands

- `pnpm --filter @shoebox/bank exec vitest run test/radar.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/worker exec vitest run test/bank-radar.test.ts 2>&1 | tail -30`
- `pnpm --filter @shoebox/web exec vitest run 2>&1 | tail -15` (review-deck/review-card tests still pass)
- Typecheck bank, db, pipeline, worker, web; `pnpm --filter @shoebox/i18n test 2>&1 | tail -5`; `pnpm --filter @shoebox/pipeline exec vitest run test/jobs.test.ts 2>&1 | tail -5`
- `pnpm biome check <changed paths> 2>&1 | tail -5` → 0 errors (no `!`).
- `pnpm --filter @shoebox/web build 2>&1 | tail -5` → succeeds.

## 7. Acceptance

- [ ] All commands pass. - [ ] Running the job twice is a no-op. - [ ] The app sends nothing; `mailto:` only.

## 8. Stop and ask

Stop and write the report if a migration seems necessary, a test fails twice, or you reach 25 tool calls / 50k tokens.

## 9. Report

`docs/tasks/0120-report.md` (600 tokens at most), `Status: review`: files changed, commands with last 5 lines, deviations.
