# 0504 report: grouping rules

Status: review

## Files changed
- `packages/extraction/src/sort/group.ts` (new): `supplierKeyOf`, `sameSupplier`, `groupPages` per brief section 2.
- `packages/extraction/test/group-pages.test.ts` (new): brief test file, formatted with biome only.
- `packages/extraction/src/index.ts`: added `export * from './sort/group';`.
- `docs/tasks/0504-group-pages.md`: status only.

## Commands
- `pnpm --filter @shoebox/extraction test -- group-pages 2>&1 | tail -30`: the filter did not restrict the run. All 9 extraction test files ran: 81 passed, 0 failed. The 17 group-pages tests are among them.
- `pnpm --filter @shoebox/extraction typecheck 2>&1 | tail -30`: passed, no errors.
- `pnpm exec biome check packages/extraction 2>&1 | tail -30`: passed, no fixes needed.

## Acceptance (section 7)
- [x] Commands in section 6 pass.
- [x] Only the section 3 files changed (plus the brief status line).

## Deviations
None.

## Questions
None.

## Owner steps left
None. Not pushed, no PR opened (per executor instructions).
