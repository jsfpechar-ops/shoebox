# 0408 report: ZIP for the accountant

Status: review

## Files changed (`git diff --stat c32d882^..HEAD`)

- `apps/web/app/(app)/ucetni/page.tsx`: edit, period select plus Download ZIP form (GET to `/api/export`)
- `apps/web/app/api/export/route.ts`: new, GET route (auth, period, size guard 413, originals, register xlsx, ZIP)
- `apps/web/src/documents/export-data.ts`: new, `loadExportDocs`
- `apps/web/src/documents/export-period.ts`: new, pure period and entry-name helpers
- `apps/web/test/export-period.test.ts`: new, test from the brief
- `packages/i18n/messages/en.json`: 7 `export.*` keys

## Commands (last lines)

- `pnpm --filter @shoebox/web test -- export-period` : `Test Files 29 passed (29)`, `Tests 196 passed (196)`
- `pnpm --filter @shoebox/web typecheck` : exit 0, no errors
- `pnpm --filter @shoebox/i18n test` : `Tests 24 passed (24)`
- `pnpm exec biome check apps/web packages/i18n` : clean, 1 warning in `apps/web/app/(app)/inbox/[id]/page.tsx` (pre-existing, not touched)

## Acceptance (§7)

- [x] export-period tests pass; typecheck 0; biome clean.

## Deviations

- Test filter ran all 29 web test files (the `-- export-period` filter did not narrow). All pass.
- `REGISTER_COLUMNS` in `register-data.ts` is not exported and that file is off-limits, so the column list is repeated in `export-data.ts`, plus the `source_files` join.
- Biome `noControlCharactersInRegex` rejected the control-char regex; the name sanitizer checks char codes instead (same behavior).
- Failed originals are skipped and counted in response header `X-Export-Skipped` (no names or content logged).
- Route and page not exercised against a live Supabase; only typecheck, lint and unit tests were run.
- No PR opened and nothing pushed (orchestrator said do not push).

## Questions

- None.

## Owner steps left

- Review and merge branch `claude/project-thread-yn56ih` into `phase/0` when ready.
