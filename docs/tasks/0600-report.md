# 0600 report
Status: review

Files: work.ts (+ zod row parser, WORK_SELECT), overview-work.test.ts, load.ts, view.ts, overview-screen.tsx, mark-paid-action.ts, mark-paid-button.tsx, format.ts (formatMoneyText), en.json.
Commands: web test -- overview: 349 passed. web typecheck: 0 errors. i18n test: 24 passed. pnpm lint: ok.

Deviations:
- `audit_document` rejects action 'mark_paid' (allowed: edit_field, trash, restore, create_manual, answer_question). Used 'edit_field' with diff {field: paid_at, old: null, new: today}; no migration made.
- format.ts got `formatMoneyText` (non-CZK/decimal-string formatting); work.ts holds the row parser since rows.ts was not listed.
- Links `/inbox?tab=review` and `paid=unpaid` filter are not verified to exist in the inbox.
- Screenshots not taken.
