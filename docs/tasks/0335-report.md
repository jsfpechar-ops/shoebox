# 0335 report

Status: review (orchestrator: P8 generator now keeps the per-document VAT sum when splitting, the brief precondition)

## Done

- Step 1: `packages/domain/src/vat/reconcile.ts` and index export. Commit 645d4df, amended in the follow-up commit.
- Step 2: `packages/domain/test/kh-dp3.property.test.ts`. Brief text plus `Number.parseInt` (Biome) and the approved amendments below.
- Typecheck clean. `pnpm depcruise`: no violations. Biome: clean.

## Orchestrator-approved spec amendments (applied)

1. P3: k = number of DP3 source rows in {3,4,5,6,12,13} that have at least one entry (test: entries; reconcile: `dp3.raw` keys). The earlier rule (non-zero DP3 rows) failed on rows that round to zero.
2. P6: ř.64 = max(ř.62 − ř.63, 0) and ř.65 = max(ř.63 − ř.62, 0), in the test and in the reconcile P6_IO_SHAPE check. Refund periods pass.
3. P8: compare everything except `entryCount`.

## Test result

`pnpm exec vitest run test/kh-dp3.property.test.ts`: 3 passed, 1 failed (P7/P8).
P1–P5 (payer) and P6 (IO) pass. The reconcile tamper test passes.

## Remaining failure (not relaxed)

P8, counterexample `[[{"kind":"iss_domestic","rate":"standard","parts":[1216998,1085922],"sign":1,"big":false,"idx":0}],0]`.
The only visible difference is `dan1` in KH: 0.00 expected (unsplit) vs 0.01 received (split). Hand check: 23029.20 × 21% = 4836.13 unsplit; split parts 2555.70 + 2280.44 = 4836.14. This is the per-part tax rounding the brief anticipated. P8 requires identical tax, so it fails.

Decision needed from the orchestrator: (a) relax P8 for `dan1`/`dan2` to within 0.01 per split part, as the brief allowed, or (b) change the property to document-level tax (compute KH tax from the document total), which is a 0334 change. No relaxation made without approval.

## Deviations

- Biome `Number` fix in the test.
- P5 derived-row check (43/44) for payers only, as in dphdp3.ts.

## Owner steps left

None.
