# 0407 report

Status: review

## Files changed (this brief)

- `packages/i18n/messages/en.json` (+15 keys)
- `apps/web/src/documents/review-deck.ts` (new)
- `apps/web/test/review-deck.test.ts` (new, from brief; format-only change by biome)
- `apps/web/src/documents/review-data.ts` (new)
- `apps/web/src/documents/review-actions.ts` (new)
- `apps/web/src/documents/review-card.tsx` (new)
- `apps/web/app/(app)/inbox/review/page.tsx` (new)
- `apps/web/app/(app)/inbox/page.tsx` (one link added above the To review list)

## Commands (last lines)

- `pnpm --filter @shoebox/web test -- review-deck`: 191 passed (191), 28 files. The filter did not limit the run; all web tests ran and passed.
- `pnpm --filter @shoebox/web typecheck`: no errors.
- `pnpm --filter @shoebox/i18n test`: 24 passed (24).
- `pnpm exec biome check apps/web packages/i18n`: 0 errors. 1 warning, pre-existing in `apps/web/app/(app)/inbox/[id]/page.tsx` (noImgElement), not touched.

## Acceptance (§7)

- [x] review-deck tests pass; typecheck 0; biome clean (apart from the pre-existing warning above).

## Deviations

- `review.progress` already existed in en.json ("Question {n} of {total}"). Not duplicated; the existing value is kept, which matches the aria note ("Question 1 of 3").
- `answerQuestionAction` was committed inside the commit labelled `0407 step 3` (no separate step 4 commit).
- Biome `--write` reformatted `review-deck.test.ts` (formatting only) and `inbox/page.tsx` (my added block).
- `section` keeps `tabIndex={0}` as the brief requires; biome's `noNoninteractiveTabindex` is suppressed on that line with a reason.
- Focus is set on mount; the page passes `key` per card so each card mounts fresh.
- No PR opened and nothing pushed, per the orchestrator instruction.

## Questions

None.

## Owner steps left

None for this brief.
