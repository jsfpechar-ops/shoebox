# 0335 report

Status: blocked

## Done

- Step 1: `packages/domain/src/vat/reconcile.ts` created, `export * from './vat/reconcile';` appended to `packages/domain/src/index.ts`. Commit 645d4df.
- Step 2: `packages/domain/test/kh-dp3.property.test.ts` created verbatim, except `Number(row)` changed to `Number.parseInt(row, 10)` (Biome). Commit 3d5aa61, red.
- Biome `--write` applied (formatting only). Typecheck clean. `pnpm depcruise`: no violations.
- Steps 1 to 3 done. Acceptance (§7) not met: 3 of 4 properties fail.

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- kh-dp3`: Tests 3 failed, 1 passed (the tamper test passes). Ran the whole domain suite because the `--` filter is not honored; only this file was run afterwards.
- `pnpm exec vitest run test/kh-dp3.property.test.ts`: `Tests 3 failed | 1 passed (4)`.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm depcruise`: no dependency violations found (583 modules).

## Counterexamples (fast-check, verbatim)

1. P1–P5, payer. `[[{"kind":"eu_service","rate":"standard","parts":[1],"sign":1,"big":false,"idx":0}]]`. Issue: `P3_A2_SUM`. Cause: DP3 row 5 base rounds 0.01 CZK to 0, so k (non-zero DP3 rows) = 0 and the tolerance is 0.00, while the A2 sum is 0.01. The brief's k definition is wrong for rows that round to zero. Suggested fix (owner or orchestrator decision): count source rows with at least one entry (keys in `dp3.raw` within {3,4,5,6,12,13}), not non-zero DP3 rows. A later run (`iss_domestic` + `eu_goods`, 0.01 CZK parts) was not analysed. P2 to P5 for payers are not verified past P3, since fast-check stops at the first counterexample.
2. P6, IO. Shrunk input: one `eu_service` standard entry, base -2.36 CZK. Diagnostic: row62 -1.00, row63 0.00, row64 0.00, row65 1.00. Cause: a net-negative (refund) period puts the amount in ř.65, so "ř.64 = ř.62" fails. `reconcileKhDp3` P6 check flags it too (`P6_IO_SHAPE`, "row64 0.00 vs row62 -1.00"). Suggested: P6 expects ř.64 = max(ř.62 − ř.63, 0) and ř.65 accordingly, or the generator is limited to positive net periods.
3. P7/P8. `[[{"kind":"iss_domestic","rate":"standard","parts":[1,1],"sign":1,"big":false,"idx":0}],0]`. P7 passed. P8 differs only in `entryCount` (1 vs 2) in both `dp3` and `kh`, which is the input count, not a tax figure. Suggested: exclude `entryCount` from the P8 comparison. This is outside the brief's allowed relaxation (dan/tax haléře only).

## Deviations

- Biome fix in the test (`Number` to `Number.parseInt`), formatting applied to both new files.
- P5 derived-row check (43/44) applied to payers only; IO has no deduction rows by design (`dphdp3.ts` derives them only for `platce`).
- P1 mirrors checked exactly for all five Věta C values, as the brief's P1 text says.

## Questions

- Decide the three test-spec fixes above (P3 k definition, P6 ř.64/65 expectation, P8 `entryCount`). No test or source file was edited to make them pass.
- Commit 3d5aa61 is red on purpose. Do not merge the branch until the brief is amended.

## Owner steps left

None.
