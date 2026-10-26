# 0603: Show on the PDF where a value came from

Status: review
Ticket: GAP-04 (owner go 2026-10-26 23:02) | Depends on: none | Base commit: 886fc60 | Branch: claude/project-thread-7b9jcx | PR base: phase/0
Executor: Sonnet 5.5 (reason: visual judgement) | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

When the user opens "Fix" on a value (or hovers/focuses a value), the PDF on the same page scrolls to and highlights the text that matches it, so they can compare without searching. Works for PDFs with a text layer; scans without text simply show no highlight.

## 2. Context

- `apps/web/src/documents/pdf-viewer.tsx` renders the PDF with `pdfjs-dist` (already a dependency) and supports click-to-fill (`apps/web/src/documents/pick.ts`, `PICK_EVENT`, `setPickTarget`).
- `fix-field.tsx` opens the input and calls `setPickTarget(id)`.
- Matching: normalise both sides (strip spaces, NBSP, thousands separators; `,` ↔ `.` for money; dates `2026-10-01` ↔ `1. 10. 2026` ↔ `01.10.2026`). Match on whole text items or a run of adjacent items on one line. First match wins.
- Design tokens only (a translucent focus/highlight token from `packages/ui`; if none fits, use the existing yellow focus token at low opacity via a CSS variable, no raw colours). Respect `prefers-reduced-motion` for the scroll.
- No document text may be logged (hard rule 4).

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/web/src/documents/locate.ts` | new | pure `normaliseForMatch(kind, s)` and `findMatch(items: {str; page; x; y; w; h}[], kind, value) → {page; rect} \| null` |
| `apps/web/test/locate.test.ts` | new | tests |
| `apps/web/src/documents/pick.ts` | edit | add `LOCATE_EVENT` and `requestLocate(kind, value)` |
| `apps/web/src/documents/pdf-viewer.tsx` | edit | collect text items with positions per rendered page, listen for `LOCATE_EVENT`, draw one highlight box, scroll it into view |
| `apps/web/src/documents/fix-field.tsx` | edit | call `requestLocate(kind, current)` when the input opens. Keep this edit minimal (one effect line) because 0602 also edits this file |

No other file may change.

## 4. Steps

1. `locate.ts` + tests: money "1 210,00" vs value "1210.00"; IČO with spaces; date three formats; value split over two adjacent items; no match → null.
2. Viewer wiring; check in the browser at 375 px and 1440 px with `testdata/golden-v1/` PDF (if the dev server needs secrets, test the pure part and describe the manual check in the report instead).
3. Run §6.

## 5. Do not touch

`correction.ts`, `correction-actions.ts`, `detail-data.ts`. Hard rules 4, 6, 7.

## 6. Commands

- `pnpm --filter @shoebox/web test -- locate 2>&1 | tail -30` → pass.
- `pnpm --filter @shoebox/web typecheck 2>&1 | tail -30` → 0 errors.

## 7. Acceptance

- [ ] Tests pass, typecheck clean, no logging of text, tokens only.

## 8. Stop and ask

As in TEMPLATE.md §8.

## 9. Report

Write `docs/tasks/0603-report.md` (600 tokens at most), set `Status: review`, commit with message `0603: highlight on the PDF where a value came from`. Do not push.
