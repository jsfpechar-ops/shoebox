# 0614 report

Status: review

Changed: worker `rows.ts` (paid per document for card, cash, COD, received_receipt, paid_text; paid_at stays null); web `work.ts` (bills only from 14 days ago, `olderCount`, skips per-document and card/cash/cod), `overview-screen.tsx` (no Mark as paid button, one older-bills line linking to /inbox), `register-data.ts` and `register-table.tsx` (Paid / Not paid yet / Unknown), `en.json` (new keys `overview.bills.older`, `register.paid.unknown`; `register.paid.no` now "Not paid yet"). Tests added or updated in worker and web.

Commands: worker doc-extract tests 204 passed; web overview+register tests 381 passed; worker and web typecheck clean; biome clean.

Deviations: `mark-paid-button.tsx`, `mark-paid-action.ts` and key `overview.bills.mark_paid` left in place, now unused. "Simplified tax document" mapped to `received_receipt` only (no separate class in the enum). Register "Unknown" = unpaid with due date before today; no due date shows "Not paid yet". Old test expectations ("Not paid", bills shape) updated.

Questions: none. Owner steps: none.

## 1. Objective

None

## 2. Context

-

## 3. Files

As named in §2 and §4.

## 4. Steps

As in §1 and §3.

## 5. Do not touch

None

## 6. Commands

None

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no float on money, copy only in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

None
