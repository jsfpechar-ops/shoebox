# 0347 report

Status: review

## Files changed
- packages/domain/src/vat/amend.ts (new): types, snapshotOfDphdp3/Kh/Shv, diffFilings, isEmptyDiff, chooseAmendmentKind
- packages/domain/test/amendments.test.ts (new, verbatim from brief)
- packages/domain/src/index.ts (export line added, sorted before vat/classify-period)

## Checks
- `vitest run test/amendments.test.ts`: 6 passed. Last line: `Tests  6 passed (6)`
- `pnpm --filter @shoebox/domain typecheck`: clean (no errors)
- `biome check`: `Checked 3 files in 1151ms. No fixes applied.`
- `pnpm depcruise`: `no dependency violations found (583 modules, 1623 dependencies cruised)`

## Deviations and defaults (all marked TODO(TA-10) in code)
- SHV before deadline: radne due = original deadline. SHV after deadline: nasledne due uses the KH window (5 working days). Rules have no SHV window; this is a default. [verify] not checked against a primary source.
- ř.66 sign: formula from the brief, not verified against the EPO instructions. No web check was made. row66 is omitted when next is null.
- KH keys: brief spelled only A2 and A5/B3. A4 and B2 use `A4:<dicOdb>:<c_evid_dd>:<dppd>` and `B2:<dicDod>:<c_evid_dd>:<dppd>`. Veta C is not in the snapshot.
- shv.changed also lists keys added or removed on either side (only bucket the spec gives).
- Snapshot builders throw on a duplicate key (not specified in brief). Silent overwrite would lose tax data.

## Questions
- Duplicate KH key (same vatid, evidence number and dppd) or SHV key: should it sum, or stay an error as now?

## Owner steps left
None.
