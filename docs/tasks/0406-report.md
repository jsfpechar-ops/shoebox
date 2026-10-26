# 0406 report

Status: blocked

## Files changed

- `packages/i18n/messages/en.json`: 27 `manual.*` keys added after `trash.error.save` (commit `0406 step 1`).

## Commands

- Step 1 check: `python3 -c "import json; json.load(...)"` parsed OK (402 keys).
- Steps 2 to 7: not run.

## Done and left

Done: steps 1 (partly, see Deviations). Left: steps 2 to 7.

## Deviations

- Step 1: `manual.substitute.note` already exists in `en.json` (line 109, with near-identical text). The brief's duplicate key was not added. The existing key is used instead.
- Step 2 STOP: the brief's stop condition applies. `normalizeInput('date', '9. 9. 2026')` does not return `2026-09-09`. `normalizeInput` (in `apps/web/src/documents/correction.ts`) accepts only ISO `YYYY-MM-DD` via `isLegalDate` and returns `{ ok: false, error: 'doc.fix.error.date' }` for `9. 9. 2026`. The test in brief §4 step 2 (`base.date = '9. 9. 2026'`, expecting `date: '2026-09-09'`) therefore cannot pass as written. The test was not changed.

## Questions

- Should the parser accept Czech `D. M. YYYY` dates by converting them to ISO before `normalizeInput('date', …)`, or should the test base use `2026-09-09`? The brief forbids editing the test, so the owner or orchestrator must decide.

## Owner steps left

None. No push, no merge, no PR.
