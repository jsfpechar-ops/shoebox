# 0602: After a fix, offer the matching total in one tap

Status: review
Ticket: GAP-03 (owner go 2026-10-26 23:02) | Depends on: none | Base commit: 886fc60 | Branch: claude/project-thread-7b9jcx | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When the user fixes the base (net), VAT or total (gross) and the three no longer add up, the app offers the missing one ("Set total to 1 210,00 Kč?") as one button. The app never changes a second value on its own; the user taps (hard rule 2).

## 2. Context

- `apps/web/src/documents/correction.ts`: `planCorrection({ fields, documentClass, editKey, value, org, today })` returns `{ fields, rows, status }`. Field keys `totals.net`, `totals.vat`, `totals.gross`; values are decimal strings.
- Money is `Money` from `@shoebox/domain` (ADR-007), never a float. Use its add/subtract and equality; read its exports before writing code.
- `apps/web/src/documents/correction-actions.ts` `fixFieldAction` returns `FixState { error; saved }`; `apps/web/src/documents/fix-field.tsx` shows "Saved" after a save.
- Rule: user edited `totals.net` or `totals.vat` → suggest `totals.gross = net + vat`. User edited `totals.gross` → suggest `totals.net = gross − vat`. Only when the two other values exist, are valid decimals, and `net + vat ≠ gross`. Never suggest a negative value unless the document already has a negative gross (credit note).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/recalc.ts` | new | `recalcSuggestion(fields: Readonly<Record<string,string>>, editKey: string): { editKey: 'totals.net' \| 'totals.gross'; value: string } \| null` |
| `apps/web/test/recalc.test.ts` | new | tests |
| `apps/web/src/documents/correction-actions.ts` | edit | `FixState` gets `suggestion: { editKey; value } \| null`, filled from the planned fields after a successful save |
| `apps/web/src/documents/fix-field.tsx` | edit | after "Saved", if a suggestion exists show "Set {field} to {amount}?" as a button that submits the same `fixFieldAction` form for the suggested key and value |
| `packages/i18n/messages/en.json` | edit | `doc.fix.suggest` ("Set {field} to {amount}?"), `doc.fix.suggest_help` |
| `apps/web/test/correction.test.ts` | edit only if `FixState` change breaks it |

No other file may change.

## 4. Steps

1. `recalc.ts` + tests: net edited (gross suggested); vat edited; gross edited (net suggested); already consistent → null; missing value → null; invalid decimal → null; 2-decimal precision kept ("100.10" + "21.02" = "121.12"); credit note negatives.
2. Wire into the action (idle state gets `suggestion: null`).
3. Button in `fix-field.tsx`: format the amount with the same formatter the page already uses for money; button label is the full sentence.
4. Run §6.

## 5. Do not touch

`packages/validation`, `planCorrection` logic, `trust.ts`, the page file. Hard rules 1, 2, 6.

## 6. Commands

- `pnpm --filter @shoebox/web test -- recalc correction 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no float on money, copy only in `en.json`.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0602-report.md` (600 tokens at most), set `Status: review`, commit with message `0602: offer the matching total after a fix`. Do not push.
