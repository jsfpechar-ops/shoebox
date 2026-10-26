# 0602 report: offer the matching total after a fix

Status: blocked (stopped after step 1, at step 2)

## Files changed
- apps/web/src/documents/recalc.ts (new): recalcSuggestion, Money-based, no floats
- apps/web/test/recalc.test.ts (new): 10 cases from step 1
- docs/tasks/0602-smart-recalc.md: Status todo -> blocked
- docs/tasks/0602-report.md (new)

## Commands
- `pnpm --filter @shoebox/web test -- recalc` : pass (350 of 350; the filter did not narrow the run, vitest ran the whole web suite, all green)
- `pnpm --filter @shoebox/web typecheck` : clean, 0 errors

## Step status
- Step 1 (recalc.ts + tests): done, committed as "0602 step 1".
- Step 2 (wire into action): NOT done, see Questions.
- Step 3 (button in fix-field.tsx, en.json keys): NOT done, depends on step 2.

## Questions (blocking step 2)
The brief says FixState.suggestion is "filled from the planned fields after a successful save". The planned fields are built inside applyCorrection (apps/web/src/documents/correction-store.ts, `plan.fields`), but its CorrectionResult is only `{ ok: true; status }`. correction-store.ts is not in the brief's file table, and fixFieldAction has no access to the fields otherwise. Options for the owner:
1. Allow a small edit to correction-store.ts: add `fields` to the ok result (one line in the type, one in the return). Simplest.
2. Keep that file closed and have correction-actions.ts re-read document_fields after the save (extra query, more code).

Also to confirm: the brief's "Set total" suggestion should not be offered when the saved status is not needs_review (step 2 reads it from the planned fields only).

## Owner steps left
None until the question above is answered. Then the executor can finish steps 2 to 4 and the report.
