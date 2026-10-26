# 0511 report

Status: blocked

## Files changed (vs ff50ff4)

- `apps/web/src/documents/pages-data.ts` (new): loadPagesView
- `apps/web/test/pages-data.test.ts` (new, brief test; biome formatting only)
- `apps/web/src/documents/pages-actions.ts` (new): separatePagesAction, answerSameInvoiceAction
- `apps/web/src/documents/pages-card.tsx` (new): PagesCard
- `apps/web/app/(app)/inbox/[id]/page.tsx`: 2 imports, pagesView load, PagesCard render (11 lines added; moveToTrashAction import kept)
- `packages/i18n/messages/en.json`: 7 keys added

## Commands

- `pnpm --filter @shoebox/web test -- pages-data`: pass. Vitest ran the whole web package (28 files, 189 tests) because of the filter argument; `pnpm --filter @shoebox/web exec vitest run pages-data` ran only pages-data: 3 of 3 pass.
- `pnpm --filter @shoebox/web typecheck`: pass (after the deviation below).
- `pnpm --filter @shoebox/i18n test`: pass, 24 of 24.
- `pnpm exec biome check apps/web/src/documents apps/web/app apps/web/test`: FAIL. One error: `lint/suspicious/noThenProperty` at `apps/web/test/pages-data.test.ts:14` (`chain.then = ...` in the brief's fake Supabase). The one warning (`<img>` in page.tsx) is pre-existing, not from this change.

## Section 7 acceptance

- [x] Tests and typecheck in §6 pass. `git diff --stat` lists only §3 files.
- [ ] biome check on apps/web/test fails (see above), so §6 does not fully pass.

## Deviations

- step 1: `pagesResult.data as PageRow[]` did not typecheck (the client infers `source_files` as an array). Changed to `as unknown as PageRow[]`. Runtime unchanged.
- Formatting: biome rewrote `pages-actions.ts` (the `.update({...})` object is split over lines) and the test file. No logic changed.
- No push, no PR (executor cannot push; owner or orchestrator opens it).
- Done: steps 1 to 6 (committed, one commit per step, plus "0511 step 2 format").

## Questions

1. The brief's test fake assigns `chain.then`, which biome flags. The test file must not change under the executor rules. Options: (a) add `// biome-ignore lint/suspicious/noThenProperty: thenable test double` above line 14 of the test, (b) rewrite the fake without `then`, or (c) accept the lint failure. Owner or orchestrator decides.

## Owner steps left

- Decide question 1, then the executor (or owner) reruns biome check on apps/web/test.
- Open the PR from `claude/project-thread-z0dj04` to `phase/0` after the lint is resolved.
