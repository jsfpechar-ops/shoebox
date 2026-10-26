# 0321 report

Status: blocked (lint in the brief-given test file; stopped per §8)

## Files changed (git diff --stat)

5 files changed, 413 insertions(+):
- apps/web/app/api/documents/[id]/lines/[lineId]/classification/route.ts (new, PATCH)
- apps/web/app/api/review-questions/[id]/answer/route.ts (new, POST)
- apps/web/src/documents/classification.ts (new)
- apps/web/src/documents/enqueue.ts (enqueueDocCategorize added, import extended)
- apps/web/test/classification.test.ts (new, brief text; biome --write formatting only)

## Commands

- `pnpm --filter @shoebox/web test -- classification`: 243 passed, 38 files passed. The filter did not narrow the run (vitest ran all web unit files).
- `pnpm --filter @shoebox/web typecheck`: clean, 0 errors.
- `pnpm exec biome check apps/web/test/classification.test.ts apps/web/src/documents apps/web/app/api`: 3 lint errors, all in the brief-given test file:
  - test/classification.test.ts:54 lint/suspicious/noThenProperty (fake's `then` in `from()`)
  - test/classification.test.ts:64 lint/suspicious/noThenProperty (fake's `then` in `insert()`)
  - test/classification.test.ts:105 lint/correctness/noUnsafeOptionalChaining (`(update?.values as Row).answered_at`)
  Not changed: the brief says never edit a test file.

## Deviations

- Step 2 anchor `import { docExtractJob, ...` does not exist; the import block is multi-line. Added `type CategorizeTrigger` and `docCategorizeJob` into it.
- Step 1: `storeAnswer` checks the already-answered (409) and option value (400) before loading the document. Needed so the brief's test cases (no `documents` table in the fake) return 409/400. Document lookup and finalized check (409) come after.
- Step 1: exported two extra interfaces `AnswerInput` and `PatchInput` for the store inputs.
- Step 4 route path depth: 7 levels of `../` for the classification route.

## Questions

- Lint errors in the test file: the brief's test fake uses `then`, which biome flags. Owner or orchestrator to decide whether to adjust the lint config or the brief test (the fake needs the thenable).

## Owner steps left

- Decide on the 3 lint errors above, then rerun biome and the test on this branch.
- Lane D: the deck can call `POST /api/review-questions/{id}/answer`; if it writes `review_questions` directly, it must also call `enqueueDocCategorize(orgId, documentId, revision, 'question_answered')`.
