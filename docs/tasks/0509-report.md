# 0509 report: a page uploaded days later

Status: review

## Files changed (git diff --stat)

- packages/db/src/doc-split.ts (edit: lateQuestions, sameInvoicePayload, findOpenPageDocuments)
- apps/worker/src/doc-split/late.ts (new: matchLatePages)
- apps/worker/src/doc-split/plan.ts (edit: late argument, lateQuestions)
- apps/worker/src/doc-split/handler.ts (edit: findOpen store method, now dep, no fast path when open documents exist)
- apps/worker/test/doc-split-late.test.ts (new, 4 tests)
- apps/worker/test/doc-split-handler.test.ts (edit: fake store, 1 test)
- docs/tasks/0509-late-pages.md (Status line only)

## Commands

- `pnpm --filter @shoebox/worker test` : pass. Last lines: `Test Files 10 passed | 2 skipped (12)`, `Tests 63 passed | 7 skipped (70)`.
- `pnpm --filter @shoebox/worker typecheck` : pass (no errors).
- `pnpm --filter @shoebox/db typecheck` : pass (no errors).
- `pnpm exec biome check packages/db/src apps/worker` : pass after `biome check --write` on the 6 changed files (formatting only).

## Brief 7 acceptance

- [x] Commands in 6 pass.
- [x] Only the 3 section-3 file groups changed (no migration, no index.ts change).

## Deviations

- doc-split.ts: added `desc` to the drizzle import (needed for `orderBy(desc(createdAt))`; the brief listed only gte, ne).
- sameInvoicePayload is a new function placed after the SortPlan interface; the existing question loop uses it.
- The skipped tests (7 in worker, 2 files) were not checked against the base commit.

## Questions

- Are the 7 skipped worker tests expected (likely DB-backed integration tests)?

## Owner steps left

- None. Commit is local on claude/project-thread-z0dj04; not pushed.
