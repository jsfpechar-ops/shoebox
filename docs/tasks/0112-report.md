# 0112 report

Status: blocked (stopped at step 3, a brief-written test assertion looks wrong)

## Files changed
- Committed: `apps/worker/package.json` (+1 line, `@shoebox/bank`), `pnpm-lock.yaml`, `apps/worker/src/bank-import/handler.ts` (new).
- Not committed: `apps/worker/test/bank-import.test.ts` (new, verbatim from brief §4 step 3, extracted by script).
- Not started: step 4 (`register.ts`, `main.ts`).

## Commands
- Step 1 `pnpm install 2>&1 | tail -5`: "Already up to date", "Done in 9.6s". Commit `0112 step 1`.
- Step 2: handler written, commit `0112 step 2`. No separate run (tests are step 3).
- Step 3 `pnpm exec vitest run test/bank-import.test.ts --reporter=verbose 2>&1 | grep ... | tail -30`:
  `Tests 1 failed | 4 passed (5)`. Passing: MT940 import, missing/already-imported file, PDF and CSV, too-large file.
  The brief's wrapper command `pnpm --filter @shoebox/worker test -- bank-import` ran the whole worker suite (15 files, 79 passed, 7 skipped, 1 failed) and did not filter.

## Failing assertion (not edited)
`test/bank-import.test.ts` line 122, test "asks for the account when the file names none":
`expect(f.imports[0]).toMatchObject({ format: 'mt940', state: 'needs_account', moneyAccountId: null })`.
Actual: `format: 'csv_generic'`, `state: 'needs_mapping'`.
Why: the input has no `:25:` line. `packages/bank/src/detect.ts` lines 61-63 detect MT940 only when `:20:`, `:25:` and `:61:` are all present, so the file is never detected as MT940. The handler records what detection returns. The brief's expectation cannot hold with the current detector.
Options for the owner: (a) expect `csv_generic` / `needs_mapping` for this input, (b) add a `:25:` line with no account, which then yields `needs_account`, or (c) change the detector (a `packages/bank` change, outside this brief).

## Deviations
None. Stopped as the brief's §8 says.

## Questions
Which option above should the brief use? Then the executor can finish step 3 (commit `0112 step 3`) and step 4.

## Owner steps left
None yet.
