# 0323 report: vendor memory route

Status: review
Commit: 2d15bb4 (0323 step 4), branch wt-0323, not pushed.

## Files changed (git diff --stat HEAD~1)
- apps/web/src/documents/vendor-memory.ts (new): parseReprocess, resetVendorMemory, listVendorProfiles
- apps/web/app/api/vendor-profiles/route.ts (new): GET, roles owner/member/accountant/viewer
- apps/web/app/api/vendor-profiles/[id]/memory/route.ts (new): DELETE, origin check, roles owner/member, reprocess via enqueueDocCategorize(..., 'user_reprocess')
- apps/web/test/vendor-memory-route.test.ts (new): brief test, one biome-ignore added

## Checks
- `pnpm --filter @shoebox/web exec vitest run test/vendor-memory-route.test.ts`: 3 passed
- `pnpm --filter @shoebox/web typecheck`: clean
- `pnpm exec biome check --write <changed paths>`: clean

## Deviations
- The brief's test used `then:` on the fake builder, which Biome flags (noThenProperty). Added a `biome-ignore` comment on that line; the test logic is unchanged.
- The brief's `--filter ... test -- vendor-memory-route` form ran the whole web suite (39 files, 246 tests, all passed). The single-file exec was used for the check.
- The 200 cap is applied by `.limit(200)`. No count is logged for the rest, and there is no log line. TODO(cat-05-bulk) is in the code.
- The brief's stray "Command after 2 and 3" typecheck was run once after both routes and the helper were written.

## Owner steps left
None.
