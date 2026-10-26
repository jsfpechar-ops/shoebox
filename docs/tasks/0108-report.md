# 0108 report

Status: review

## Done

- Step 1: `normalize.test.ts` lines 21 to 22 hold `\u00a0` and `\u202f` escapes. `normalize.ts` unchanged. Commit `0108 step 1`.
- Step 2: `packages/bank/src/detect.ts` with the brief's exports. Commit `0108 step 2`.
- Step 3: `detect.test.ts` verbatim. First run had 2 failures (brief fixtures). Coordinator-approved fix applied (`'0'.repeat(89)`, byte `0x8d`). Commits `0108 step 3`, `0108 step 3 fix`.
- Step 4: `packages/bank/src/parsers/gpc.ts` with the brief's exports. Commit `0108 step 4`.
- Step 5: `packages/bank/test/gpc.test.ts` verbatim (extracted by script). Commit `0108 step 5`.
- Step 6: `index.ts` re-exports detect and gpc. Commit `0108 step 6`.

## Files changed

- `packages/bank/test/normalize.test.ts` (2 lines)
- `packages/bank/src/detect.ts` (new)
- `packages/bank/src/parsers/gpc.ts` (new)
- `packages/bank/src/index.ts` (2 lines added)
- `packages/bank/test/detect.test.ts` (new; fixture fix applied)
- `packages/bank/test/gpc.test.ts` (new; biome reformat only)
- `docs/tasks/0108-report.md`

## Commands (brief §6)

`pnpm --filter @shoebox/bank test 2>&1 | tail -30`: pass.
```
 Test Files  4 passed (4)
      Tests  67 passed (67)
```

`pnpm --filter @shoebox/bank typecheck 2>&1 | tail -30`: clean (tsc prints no errors).

`pnpm biome check packages/bank 2>&1 | tail -30`: first run had formatting errors in the test files and one import sort error. Ran `biome format --write packages/bank` once (formatting only). Then fixed the export order in `index.ts` and one optional chain in `detect.ts`. Final check: `Checked 12 files ... No fixes applied.` (clean).

## Deviations

- `index.ts`: biome requires sorted exports, so `./detect` is placed before `./normalize`. Brief said to add it after `./normalize`.
- `detect.ts`: `camtVersion` set conditionally, since `exactOptionalPropertyTypes` rejected `undefined`. `first !== undefined && ...` became `first?.startsWith(...)`.
- `gpc.ts` (my choices where the brief is silent): a second 074 line is a `gpc.bad_line`; 078/079 lines after a skipped 075 are ignored, so a skipped row does not take their text.
- Done: steps 1 to 6. Left: none.

## Questions

None.

## Owner steps left

None. Not pushed.
