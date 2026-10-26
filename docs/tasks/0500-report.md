# 0500 report: Read again

Status: review

## Files changed
- apps/web/src/documents/enqueue.ts (optional `retry` key)
- apps/web/src/documents/read-again.ts (new)
- apps/web/src/documents/read-again-actions.ts (new, server action)
- apps/web/src/documents/upload.ts (restartIfFailed dep, repeated file restarts a failed read)
- apps/web/src/documents/supabase-deps.ts (wiring)
- apps/web/test/read-again.test.ts (new, as given)
- apps/web/test/upload.test.ts (fake dep, one test)
- apps/web/app/(app)/inbox/[id]/page.tsx (failed branch with Read again button)
- packages/i18n/messages/en.json (3 keys: doc.detail.failed, doc.read_again.button)
- docs/tasks/0500-read-again.md (Status only)

## Commands
- pnpm --filter @shoebox/web test -- read-again upload: 23 files, 165 tests passed. The filter did not narrow the run; the whole web suite ran.
- pnpm --filter @shoebox/web typecheck: clean.
- pnpm --filter @shoebox/i18n test: 3 files, 24 tests passed.
- pnpm exec biome check apps/web/src/documents apps/web/test apps/web/app: one format error in read-again-actions.ts, fixed with biome format --write. Remaining: 1 warning, img in page.tsx, in existing code, not from this change.

## Checklist (§7)
- [x] Tests pass, typecheck clean, biome clean except the pre-existing img warning.
- [x] Diff touches only §3 files.
- [ ] Browser check of the failed page not run (no UI run in this session).

## Deviations
- Commits were made per step as asked. Steps 2 and 3 were committed together as "step 2" (read-again.ts and its test were written before the first commit of them).

## Questions
- None.

## Owner steps left
- Review and merge the branch into phase/0 (no push done by executor).
