# 0325 report: ledger rebuild jobs

Status: blocked
Done: steps 1 to 4. Left: lint fix in the brief test file (see Questions).

## Files changed
- apps/worker/src/ledger/build.ts (new)
- apps/worker/src/ledger/handler.ts (new)
- apps/worker/src/ledger/register.ts (new)
- apps/worker/src/main.ts (import + registerLedgerJobs call)
- apps/worker/test/ledger-rebuild.test.ts (new; biome formatting only)

## Commands
- `pnpm --filter @shoebox/worker typecheck`: clean (after steps 1, 2, 3, 4).
- `pnpm --filter @shoebox/worker test -- ledger-rebuild`: pnpm ignored the filter and ran all worker files, 92 passed, 7 skipped. Direct `npx vitest run test/ledger-rebuild.test.ts` in apps/worker: 8 of 8 passed.
- `pnpm --filter @shoebox/worker test -- registry`: all passed (same pnpm filter behaviour).
- `pnpm --filter @shoebox/pipeline test -- jobs`: see the result line in the final reply.
- `biome check` on apps/worker/src/ledger and main.ts: clean.
- `biome check` on the test file: FAILS, lint/style/noNonNullAssertion at apps/worker/test/ledger-rebuild.test.ts:233 (`docs[DOC]!` and `.lines[0]!`). Not a formatting issue, so not fixed.
- No DB tests were run.

## Deviations
- Step 3: worker.ts not touched. Its register callback already receives db.
- main.ts has no registerDocCategorize line, so registerLedgerJobs is added after registerTrashPurge.
- `vatRatePct` uses unary `+` (a rate, not money) because the brief bans `Number(`.
- pct and fx_rate strings are padded with `fixed()` instead of rounded, because the worker has no decimal.js dependency. Amounts use Money `toDecimal().toFixed(2)`.
- profileAt follows the brief literally: latest validFrom <= date, validTo ignored.
- `ledger.verify` has no path to replace; verified by the test.

## Questions
- Test line 233 has non-null assertions that biome forbids. Options: owner or orchestrator fixes the brief test, or allows the rule for this file. The brief said to stop and report, so I did not edit the test beyond formatting.

## Owner steps left
None.
