# 0410 report

Status: review

## Files changed
- apps/web/package.json, pnpm-lock.yaml: pdfjs-dist 6.4.299 (approved, decisions.md 2026-10-26)
- apps/web/src/documents/pick.ts (new), apps/web/test/pick.test.ts (new)
- apps/web/src/documents/pdf-viewer.tsx (new)
- apps/web/src/documents/fix-field.tsx
- apps/web/app/(app)/inbox/[id]/page.tsx
- apps/web/app/globals.css
- packages/i18n/messages/en.json

## Commands (last lines)
- `pnpm --filter @shoebox/web test -- pick`: 31 files, 203 passed. The `-- pick` filter does not narrow vitest here, so the whole web unit suite ran.
- `pnpm --filter @shoebox/web typecheck`: clean.
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 passed.
- `pnpm exec biome check apps/web packages/i18n`: 0 errors. 1 warning, pre-existing (`<img>` in page.tsx).
- `pnpm --filter @shoebox/web build`: succeeded.

## Section 7
- [x] pick tests pass; typecheck 0; biome clean (0 errors); web build succeeds.

## Deviations
- Step 4: removed `isEvalSupported: false` from `getDocument`. The option is not in pdfjs-dist 6.4.299 types (type error). The CSP has no `unsafe-eval`, so runtime behaviour is unchanged.
- Step 7: the file block is wrapped in `lg:sticky` even when there is no file (empty div, per brief). The grid uses auto-placement, so the checks card can sit beside the fields card rather than beside the file. Not checked visually.
- Biome `--write` reformatted pdf-viewer.tsx and globals.css (commit 0410 step 8).
- A stalled shell command (my own stray `cat` waiting on stdin) was stopped before it changed anything.
- Tool calls exceeded the 30-call cap, because of that stall and the check reruns.

## Questions
- None.

## Owner steps left
- No screenshots taken (UI brief, no browser run). Check the document page with a PDF at 375 px and 1440 px.
- No e2e or real PDF click-to-fill test was run.
- Review the branch and merge into phase/0 (no push done).
