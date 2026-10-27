# 0606 report

Status: review

## Files changed
- new `apps/web/src/documents/locate.ts` (`normaliseForMatch`, `findMatch`)
- new `apps/web/test/locate.test.ts` (11 tests)
- edit `pick.ts` (`LOCATE_EVENT`, `requestLocate`)
- edit `pdf-viewer.tsx` (collects positioned text items per page, listens for `LOCATE_EVENT`, draws one highlight box, scrolls it into view; reduced motion respected)
- edit `fix-field.tsx` (one line: `requestLocate(kind, current)` when the input opens; `current` added to effect deps)

## Commands
- `pnpm --filter @shoebox/web test -- locate`: 54 files, 350 tests pass.
- `pnpm --filter @shoebox/web typecheck`: 0 errors. Biome check clean.

## Acceptance
- [x] Tests pass, typecheck clean, no text logged, tokens only (highlight uses `color-mix` of `--color-focus`).

## Deviations
- Browser check at 375/1440 px not done (no dev server with secrets). Manual check: open a document with a text PDF, press Fix on a value, the PDF scrolls to a yellow box over it. Scans show nothing.
- No CSS file edited: highlight styled inline (globals.css not in file list).
- Match is on a run of adjacent same-line items or words inside one item; first match wins.

## Owner steps left
Merge; do the manual check above.
