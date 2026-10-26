# 0318 report

Status: review
Ticket: P1-CAT-04 | Branch: wt-0318

## Files changed

- `apps/worker/src/categorize/answers.ts` (new): `parseQuestionPayload`, `applyAnswers`, `openKinds`
- `apps/worker/src/categorize/questions.ts` (new): `QUESTION_PRIORITY`, `buildQuestions`
- `packages/i18n/messages/en.json`: 27 `categorize.*` keys appended
- `apps/worker/test/categorize-questions.test.ts` (new): brief test, biome formatting only

## Commands

- `pnpm --filter @shoebox/worker exec vitest run test/categorize-questions.test.ts`: 9 passed, 0 failed
- `pnpm --filter @shoebox/worker test -- categorize-questions`: ran the whole worker suite (the filter did not narrow it): 84 passed, 7 skipped, 0 failed
- `pnpm --filter @shoebox/worker typecheck`: 0 errors
- `pnpm --filter @shoebox/i18n test`: 24 passed
- `pnpm exec biome check` on the new files: clean after `--write`

## Checklist (§7)

- [x] Tests pass; typecheck clean; i18n test passes with the new keys
- [x] No Czech string added

## Deviations

- `questions.ts` also imports the value `parseQuestionPayload` from `./answers` (the brief gave only the type import). Needed to read `params.line_ids` of answered rows.
- Biome `--write` reformatted the three source files and the test file (formatting only, allowed by the brief).
- `which_category` options are the union of the top categories of all lines in the group, deduplicated, capped at 3.
- `applyAnswers`: kinds other than `business_or_personal` with no `params.line_ids` are ignored (the brief did not say).
- The `pnpm --filter @shoebox/worker test -- categorize-questions` filter does not narrow the run (the whole suite ran); the single-file run was added.

## Questions

None.

## Owner steps left

None.
