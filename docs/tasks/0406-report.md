# 0406 report

Status: review

## Files changed

- `packages/i18n/messages/en.json`: `manual.*` keys (step 1; `manual.substitute.note` reused).
- `apps/web/src/documents/manual-entry.ts` (new, pure parser and row builders).
- `apps/web/test/manual-entry.test.ts` (new, from the brief, ISO date).
- `apps/web/src/documents/manual-entry-actions.ts` (new, `'use server'`).
- `apps/web/src/documents/manual-entry-form.tsx` (new, `'use client'`).
- `apps/web/app/(app)/inbox/new/page.tsx` (new).
- `apps/web/app/(app)/inbox/page.tsx`: one `Link` after `UploadDropzone`.

Commits: `0406 step 1` to `0406 step 7`. Not pushed, no branch, no PR.

## Commands

- `pnpm --filter @shoebox/web test -- manual-entry`: 27 files, 186 tests passed. The filter did not limit the run; the whole web suite ran.
- `pnpm --filter @shoebox/web typecheck`: clean (no output).
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm exec biome check apps/web packages/i18n`: one error left, `apps/web/app/(app)/inbox/[id]/page.tsx:135` `noImgElement`. Not in this brief and not touched.

## Checklist (§7)

- [x] manual-entry tests pass; typecheck 0; biome clean for the files of this brief.

## Deviations

- Step 1: `manual.substitute.note` already existed; the duplicate was not added.
- Step 3: `redirect()` runs after the `try` block (success path sets the id), so no error helper was added.
- Step 7: `biome check --write` reformatted my new files, including the test file (formatting only, no assertion changed).
- The vitest name filter did not narrow the run (see Commands).

## Questions

None.

## Owner steps left

None for this brief. Open the PR from `claude/project-thread-yn56ih` into `phase/0` when ready.
