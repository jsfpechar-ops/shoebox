# 0404 report

Status: review

## Files changed
- packages/i18n/messages/en.json (keys)
- apps/web/src/documents/inbox-tabs.ts (new)
- apps/web/test/inbox-tabs.test.ts (new)
- apps/web/src/documents/register-table.tsx (new)
- apps/web/app/(app)/inbox/page.tsx (edit)
- apps/web/app/api/register/route.ts (new)

## Commands (last lines)
- i18n test: 3 files, 24 tests passed
- web test -- inbox-tabs: 25 files, 176 tests passed (vitest ignores the filter; all pass)
- web typecheck: clean
- biome check apps/web: no errors; 1 pre-existing warning (img in doc detail page, not touched)
- web build: succeeded

## Acceptance (§7)
- [x] inbox-tabs tests pass; typecheck 0; biome clean (no new issues)

## Deviations
- Test file apps/web/test/inbox-tabs.test.ts was reformatted by biome --write (line wrapping only, assertions unchanged).
- route.ts passes `new Uint8Array(bytes)` to Response to satisfy TS typing (createXlsx returns Uint8Array<ArrayBufferLike>).
- The trash tab (until 0405) renders the "To review" branch; no trash nav link added.
- No screenshots taken (not run in a browser).

## Questions
- None.

## Owner steps left
- None for this brief. Merge via phase/0 as usual.
