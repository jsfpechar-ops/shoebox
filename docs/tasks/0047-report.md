# 0047 report: Inbox drop zone and document list

Status: review

## Files changed (`git diff --stat 6b5a98e HEAD`)
8 files, +306 / -3: `apps/web/app/(app)/inbox/page.tsx`, `apps/web/src/documents/{inbox-data.ts,upload-dropzone.tsx,auto-refresh.tsx}`, `apps/web/test/inbox-data.test.ts`, `packages/i18n/messages/{cs,en}.json`, `docs/tasks/0047-inbox-dropzone.md` (status only).

## Commands (last lines)
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm --filter @shoebox/web exec vitest run test/inbox-data.test.ts`: 4 tests passed.
- `pnpm --filter @shoebox/web typecheck`: clean.
- `pnpm exec biome ci apps/web packages/i18n`: 1 error left, formatting in `apps/web/test/inbox-data.test.ts` (verbatim test file, not changed).
- shell.spec, Chromium projects: 23 passed. Axe passed on desktop and mobile Chromium. One failure, `Inter is self-hosted`, on both Chromium projects: `expect(fontFiles.length).toBeGreaterThan(0)` got 0. Not in the new files; probably environmental. Not verified against base.
- WebKit specs also ran (filter ignored) and failed: `browserType.launch` for webkit, not installed.

## §7 checklist
- [x] Test file unchanged and passes; i18n test passes.
- [x] No literal text in .tsx (i18n test / `check:i18n` passes).
- [x] No raw color, `text-sm`/`text-xs`, or `text-muted-foreground` in new files.
- [x] shell.spec on Chromium with axe passes (except the font-file check above).

## Deviations
- `StatusBadge` `processingSince`: the brief's JSX `processingSince={row.processing ? row.createdAt : undefined}` fails under `exactOptionalPropertyTypes`. Changed to a conditional spread.
- Step 1 was already committed (92da0f6) before this run; not redone.

## Questions
- Biome flags the verbatim test file's formatting. Format it, or exempt test files? Not changed here.
- The Inter font check: is it expected to fail in this container?

## Owner steps left
- Merge the PR when opened (not opened here, per instruction).
