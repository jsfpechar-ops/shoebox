# 0612 report

Status: review

## Files
New: `confirm-actions.ts`, `issue-questions.ts`, `issues-card.tsx`, `test/issue-questions.test.ts`.
Edited: inbox `[id]/page.tsx`, `detail-data.ts` (check id and raw field name), `fix-field.tsx` (opens on "Fix it"), `en.json` (`doc.issue.*`).

## Commands
- web tests (whole suite ran): 58 files, 387 tests passed.
- web typecheck: clean. i18n test: 24 passed. biome: clean (one existing img warning).
- `context_lint.py`: FAIL, not from this brief: `0614-paid-without-chores.md` has no Status line.

## Checks
Every blocker count (`review-data`, `duplicate`, `detail-data`) already filters `state = 'open'`; `inbox-data` reads no checks. Re-read upsert is already safe: unique (document, rule) with `onConflictDoNothing`, and `correction-store` skips settled rules. No change needed.

## Deviations
`audit_document` allows only a fixed action list, so both actions log `answer_question` with a `kind` in the diff (no migration).

## Owner steps left
None.
