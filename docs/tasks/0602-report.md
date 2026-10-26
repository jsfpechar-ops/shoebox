# 0602 report: offer the matching total after a fix

Status: review

## Files changed
- apps/web/src/documents/recalc.ts (new): recalcSuggestion, Money-based, no floats
- apps/web/test/recalc.test.ts (new): 10 cases
- apps/web/src/documents/correction-store.ts: ok result now carries `fields` (approved by orchestrator, option 1)
- apps/web/src/documents/correction-actions.ts: FixState gets `suggestion`; idle and error states get null; saved state fills it from the planned fields
- apps/web/src/documents/fix-field.tsx: after "Saved", a secondary button "Set {field} to {amount}?" submits the same fixFieldAction for the suggested key and value
- packages/i18n/messages/en.json: doc.fix.suggest, doc.fix.suggest_help
- docs/tasks/0602-smart-recalc.md: header Status set to review
- docs/tasks/0602-report.md (this file)

## Commands
- `pnpm --filter @shoebox/web test -- recalc correction 2>&1 | tail -30`: pass, 350/350 (the filter does not narrow the run; vitest ran the whole web suite)
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30`: clean, 0 errors

## Steps
1. recalc.ts + tests: done
2. Wired into the action, idle state suggestion: null: done
3. Button in fix-field.tsx, en.json keys: done
4. Commands 6: done, both pass

## Deviations
- Amount format: the brief asks for "the same formatter the page already uses for money". The only exported money formatter (formatCzkWhole) has no cents, so it would show 121.12 as 121 Kč. The button uses a local cs-CZ currency formatter with 2 decimals, copied from the unexported one in vat/preview-view.tsx. No new dependency.
- Credit notes: a negative suggestion is allowed only when the document's gross (in the fields after the save) is negative.

## Questions
None open.

## Owner steps left
None. Branch task/0602 is not pushed.
