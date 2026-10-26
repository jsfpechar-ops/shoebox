# 0405 report: Trash and restore

Status: review

## Files changed (`git diff --stat` for steps 1 to 7)

7 files, 237 insertions, 2 deletions: `packages/i18n/messages/en.json`, `apps/web/src/documents/trash.ts` (new), `apps/web/src/documents/trash-data.ts` (new), `apps/web/src/documents/trash-actions.ts` (new), `apps/web/test/trash.test.ts` (new), `apps/web/app/(app)/inbox/page.tsx`, `apps/web/app/(app)/inbox/[id]/page.tsx`.

## Commands (last lines)

- `pnpm --filter @shoebox/web test -- trash`: "Tests 180 passed (180)", "Test Files 26 passed (26)".
- `pnpm --filter @shoebox/web typecheck`: exit 0, no errors.
- `pnpm --filter @shoebox/i18n test`: "Tests 24 passed (24)".
- `pnpm exec biome check apps/web packages/i18n`: 0 errors, 1 warning (`noImgElement` in `inbox/[id]/page.tsx`, pre-existing `<img>`).

## Acceptance (§7)

- [x] trash tests pass; typecheck 0; biome clean (no errors).

## Deviations

- Step 7: biome flagged `apps/web/test/trash.test.ts` for formatting only; ran `biome check --write` on that file. No test logic changed.
- Step 1: the brief's key block ends each line with a comma; the last key also needed one to keep `en.json` valid (done).
- Not pushed, no PR opened (brief said one PR; the executor instructions were no push, no branch).

## Questions

None.

## Owner steps left

None.
