# 0614: Paid status without chores

Status: review
Ticket: REAL-DATA (owner test 2026-10-27, Josef) | Depends on: none | Base commit: d5c65a1 | Branch: claude/project-thread-w656wo | PR base: phase/0
Executor: Sonnet 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Owner (2026-10-27): "imagine marking 100 docs as paid, that's horrible design". The user never marks documents paid one by one. Paid comes from, in order: the document itself, the bank statement, or it stays "unknown" for the accountant, with no nagging.

1. At read time, a document paid by card, cash or cash-on-delivery, or a retail receipt (class receipt / simplified tax document; check the class enum), is paid per document: `is_paid_per_document = true` (today only `flags.paid_text` sets it, `apps/worker/src/doc-extract/rows.ts:141`). `paid_at` stays null (the issue date is the payment date; do not invent one).
2. Overview "bills to pay" (`apps/web/src/overview/`): list only unpaid bank-transfer bills due from 14 days ago onward, never older ones, and drop the per-row "Mark as paid" button. When older unpaid transfer bills exist, show one line instead: "{n} older bills have no payment found. Upload your bank statement and we match them all." linking to the Inbox upload (statements dropped there are already imported: `bank.import.statement`).
3. Register and export: the Paid column says "Paid", "Not paid yet" (due date in the future) or "Unknown" (no payment found), never asks for action. Keep `register.bulk.mark_paid` as it is (bulk is fine for those who want it).

## 2. Context

`apps/web/src/overview/rows.ts`, `overview-screen.tsx` (bills section ~line 200), `mark-paid-button.tsx`, `mark-paid-action.ts` (leave the action file; remove only its use in the bills list), `apps/web/src/documents/register-data.ts` (`paid` field), worker `rows.ts` `mapPaymentMethod`. Copy only in `en.json`.

## 3. Files

As named in §2 and §4.

## 4. Steps

As in §1 and §3.

## 5. Do not touch

Bank matcher, ledgers. Hard rules 1, 6.

## 6. Commands

`pnpm --filter @shoebox/worker test -- doc-extract 2>&1 | tail -30`, `pnpm --filter @shoebox/web test -- overview register 2>&1 | tail -30`, typecheck of worker and web.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no float on money, copy only in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

`docs/tasks/0614-report.md` (600 tokens max), `Status: review`, commit `0614: paid status without per-document chores`. Do not push.
