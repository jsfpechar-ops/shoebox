# 0600: Přehled shows "waiting for you", "read automatically" and "bills to pay"

Status: todo
Ticket: GAP-01 (owner go 2026-10-26 23:02) | Depends on: none | Base commit: 886fc60 | Branch: claude/project-thread-7b9jcx | PR base: phase/0
Executor: Sonnet 5.5 (reason: visual judgement) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The overview (Přehled) today shows tax deadlines, limit meters and totals only. A layman opening the app needs three more answers at the top: how many documents wait for me, how much the app read on its own, and which bills I still have to pay (with a one-tap "Mark as paid").

## 2. Context

- `apps/web/src/overview/load.ts` loads `documents` for the year with `DOCUMENTS_SELECT` (`rows.ts`) and builds the view with `buildOverviewView` (`view.ts`, pure). `overview-screen.tsx` renders cards with `card`, `text-card-title`, `HelpTip`.
- `documents` columns used here: `id`, `status` (enum `DOCUMENT_STATUS_VALUES` in `packages/domain/src/enums/index.ts`), `direction` (`'in'` = a bill we received, `'out'` = our invoice), `due_date`, `paid_at`, `total_gross::text`, `currency`, `document_number`, `partner_snapshot` (jsonb, has `name`), `deleted_at`. Money stays a decimal string (ADR-007): sum with `Money` from `@shoebox/domain`, never `Number`.
- `document_fields` has `source` (`FIELD_SOURCE_VALUES`, `'user'` means the user typed it) and `is_current`.
- Statuses: read the enum. "Waiting for you" = `needs_review` (and any other status the enum marks as needing the user, e.g. a question). "Being read" = `received`, `splitting`, `classifying`, `extracting` (and any other in-progress value). "Done" = `ready` and later states.
- Hard rules: every query `.eq('org_id', orgId)`; every string through `packages/i18n/messages/en.json` (do not add Czech); design tokens only; "?" help next to each new term (HelpTip); no fine print (body size text).
- Mark as paid writes `documents.paid_at = today` (Prague, `pragueToday`) for one document of the active org and one audit row the same way `apps/web/src/documents/correction-store.ts` §6b calls `supabase.rpc('audit_document', …)`. Copy that call shape exactly; if the rpc does not accept the payload, STOP.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/overview/work.ts` | new | pure `computeWorkSummary(rows, asOf)` and `computeBillsToPay(rows, asOf)` |
| `apps/web/test/overview-work.test.ts` | new | tests for both |
| `apps/web/src/overview/load.ts` | edit | one extra org-scoped query (id, status, direction, due_date, paid_at, total_gross::text, currency, document_number, partner_snapshot, document_fields(source,is_current)) for non-deleted docs, limit 5000; pass to view |
| `apps/web/src/overview/view.ts` | edit | add `work` and `bills` to `OverviewView` (optional input, default empty) |
| `apps/web/src/overview/overview-screen.tsx` | edit | two new cards right after the title: "Waiting for you" (with a link to `/inbox?tab=review`) and "Bills to pay" |
| `apps/web/src/overview/mark-paid-action.ts` | new | server action `markPaidAction(prev, formData)` |
| `apps/web/src/overview/mark-paid-button.tsx` | new | client form button with `useActionState`, mirrors `FixField` error handling |
| `packages/i18n/messages/en.json` | edit | `overview.work.*`, `overview.bills.*`, `overview.help.work`, `overview.help.auto_read`, `overview.help.bills` |
| `apps/web/test/overview-view.test.ts` | edit only if the new optional fields break it |

No other file may change.

## 4. Steps

1. `work.ts`:
   - `WorkSummary = { waiting: number; reading: number; done: number; autoReadPct: number | null }`. `autoReadPct` = of `done` documents, the share with no current field whose source is `'user'`, rounded down to a whole percent; `null` when `done` is 0.
   - `BillToPay = { id; partnerName: string | null; number: string | null; due: LegalDate; amount: string; currency: string; overdue: boolean; daysLeft: number }`. Only `direction === 'in'`, `paid_at === null`, `due_date !== null`, status `ready` or `needs_review`. Sort by due ascending. `BillsToPay = { items: BillToPay[] (max 5); count: number; totalCzk: string | null }` where `totalCzk` sums CZK items with `Money` (null if none).
   - Tests: empty input; a mix of statuses; auto-read with and without user fields; overdue vs not (asOf boundary: due == asOf is not overdue); sorting; max 5 with the true `count`; no float drift ("0.10" + "0.20" = "0.30").
2. `load.ts` and `view.ts`: add the query in the same try block; parse rows with zod like `rows.ts` does; a row that fails parsing is skipped.
3. Screen: "Waiting for you" card shows the big number (`text-kpi`), a line "N being read", and "Read automatically: X%" with HelpTip. Hide the auto-read line when `null`. "Bills to pay" lists up to 5 rows (supplier, number, amount with the existing money formatter in `format.ts`, due date, an "Overdue" badge using the existing warning token), each with the Mark-as-paid button, plus "and N more" linking to `/inbox?tab=all&paid=unpaid`. Empty state text: "No unpaid bills."
4. `markPaidAction`: validates the id with zod uuid, gets the org from `getOrgContext()`, updates with `.eq('id', id).eq('org_id', orgId).is('paid_at', null)`, writes the audit row, `revalidatePath('/prehled')`. Returns `{ error: MessageKey | null; done: boolean }`.
5. Run the commands of §6.

## 5. Do not touch

`packages/domain/rules`, the VAT and podklady cards, other screens. Hard rules 1, 3, 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/web test -- overview 2>&1 | tail -30` → all pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.
- `pnpm --filter @shoebox/i18n test 2>&1 | tail -30` → pass (key parity rules, if any, satisfied).
- `pnpm lint 2>&1 | tail -30` if the repo has it.

## 7. Acceptance

- [ ] New tests pass; typecheck clean.
- [ ] No `Number(`/`parseFloat` on money in the new code.
- [ ] Every query in the change has `org_id`.
- [ ] All new copy is in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0600-report.md` (600 tokens at most), set `Status: review`, commit with message `0600: overview shows waiting, read automatically and bills to pay`. Do not push.
