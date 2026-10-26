# 0108 report

Status: blocked (stopped at step 3, brief §8: a brief-written test seems wrong)

## Done

- Step 1: `packages/bank/test/normalize.test.ts` lines 21–22 now hold ` ` and ` ` escapes. No change to `normalize.ts` was needed. Committed `0108 step 1`.
- Step 2: `packages/bank/src/detect.ts` created with the exact exports from the brief. Committed `0108 step 2`.
- Step 3: `packages/bank/test/detect.test.ts` copied verbatim from the brief (extracted with a script). Committed as `0108 step 3`, but 2 of its 60 tests fail (see below).
- Steps 4 to 6 (`gpc.ts`, `gpc.test.ts`, index re-export) not done.

## Files changed

- `packages/bank/test/normalize.test.ts` (edit, 2 lines)
- `packages/bank/src/detect.ts` (new)
- `packages/bank/test/detect.test.ts` (new, verbatim from brief)

## Commands

`pnpm --filter @shoebox/bank test -- normalize 2>&1 | tail -5` (step 1): pass.
```
 Test Files  2 passed (2)
      Tests  50 passed (50)
   Start at  01:54:38
   Duration  1.08s
```

`pnpm --filter @shoebox/bank test -- detect 2>&1 | tail -30` (step 3): FAIL, 2 failed, 58 passed.
```
 FAIL  test/detect.test.ts > detectEncoding / decodeText > falls back to windows-1250 and decodes it
AssertionError: expected 'ŽLUťOUČKÝ' to be 'ŽLUŤOUČKÝ' // Object.is equality
 FAIL  test/detect.test.ts > detectStatementFormat > finds GPC by its 128-char 074 header
AssertionError: expected '0740000002400123455SYSEL TEST        …' to have a length of 128 but got 118
```

Typecheck and biome were not run (steps 4 to 6 not reached).

## Deviations

- Step 3 test failures are a bug in the brief's test fixtures, not in `detect.ts`. Per the rules I did not edit the test.
  1. `windows-1250` byte `0x9D` is lowercase `ť`; uppercase `Ť` is `0x8D`. The expected string `'ŽLUŤOUČKÝ'` cannot come from those bytes. Fix: change `0x9d` to `0x8d` in the cp1250 array, or change the expected string to `'ŽLUťOUČKÝ'`.
  2. `GPC_074` is 118 chars: `'0'.repeat(79)` should be `'0'.repeat(89)` so the header is 128 chars (3 + 16 account + 20 name + 89 filler).
- Done: steps 1 to 3. Left: steps 4 to 6.

## Questions

- Owner or orchestrator: confirm the two fixes above, then a fresh executor can run steps 4 to 6 (the `gpc.ts` parser and `gpc.test.ts`).

## Owner steps left

None.
