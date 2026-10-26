# 0353 report

Status: review

- K-C01: `basisOf` in `ledgers/tax.ts` now net alone for a deducting payer; `LEDGER_ALGO_VERSION` 1 -> 2. Consumer: `apps/worker/src/ledger/handler.ts` (input hash and stale check); no test asserted the literal.
- Numbers changed by K-C01: only AC-9i payer, 23242.63 -> 22305.79 and 18594.10 -> 17844.63 (net x 0.8). No other test changed; vat-ledger untouched.
- New: `income-tax/totals.ts`, `test/annual-totals.test.ts` (200 property runs), export in `index.ts`.
- Checks: domain suite 638 passed; worker 153 passed, 7 skipped (pre-existing); typecheck, biome, depcruise clean.
- Deviations: test file `seq += 1` inside a template broke biome `noAssignInExpressions`; replaced with a `nextSeq()` helper. known-issues K-C01 row NOT touched (brief §5: orchestrator removes it).
- Questions: none. Owner step: accountant sentence on K-C01 rule (brief Owner steps).
