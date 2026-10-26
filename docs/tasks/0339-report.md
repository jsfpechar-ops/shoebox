# 0339 report: serializeKh and serializeShv with golden XML and P9

Status: review
Code commit: 4e8acee (branch wt-0339, not pushed)

## Files changed
- packages/tax-xml/package.json (fast-check 4.10.2 devDependency), pnpm-lock.yaml (+3)
- packages/tax-xml/src/kh.ts, src/shv.ts (new); src/index.ts (exports serializeKh, serializeShv and their option types)
- packages/tax-xml/test/kh-shv.test.ts (brief test), test/kh-shv-guards.test.ts (new, see Deviations)
- testdata/golden-v1/expected/vat/dphkh1-payer-2026-09.xml, dphshv-payer-2026-09.xml (new)

## Checks
- `vitest run test/kh-shv.test.ts`: 4 passed (goldens byte-match, both validate with xmllint; P9 200 runs green).
- `vitest run test/kh-shv-guards.test.ts`: 2 passed.
- Whole tax-xml package: 23 passed.
- `typecheck`: clean. `biome check` on changed paths: clean.
- Coverage (src/**): kh.ts 100% lines, shv.ts 100% lines. Package total 85.03% lines, just above the 85% gate; the gap is validate.ts (55.8%) and xml.ts (87%), not the new files.

## Deviations
1. `pnpm install --offline` failed (fast-check metadata not in offline cache). Used `pnpm install --prefer-offline`, which resolved from the store. No new package: fast-check is already in packages/domain.
2. Brief test file, minimal fixes to pass typecheck and Biome: `discoveredOn` passed as a spread (exactOptionalPropertyTypes, TS2379); `Number(pct)` changed to `Number.parseInt(pct, 10)`; P9 `it` given a 60000 ms timeout (200 xmllint runs take about 7 s, over the 5 s default).
3. Added test/kh-shv-guards.test.ts (form-mismatch throws, empty SHV), not in brief §3, to cover the new src files.
4. kh.ts exports `vetaPOf` (VetaP shared with shv.ts); index.ts does not re-export it.
5. Evidence numbers and VAT ids are written raw (no trim), so whitespace-only values are not dropped.

## [verify] items
- Vet C decimals (`26529.00`): written with dec2Attr; the golden validates against the vendored XSD 03.01.15. Primary source not checked.
- `c_radku` width and `por_c_stran`: validated only against the vendored XSD, which accepted the goldens and 200 random periods. Primary source not checked.

## Questions
None.

## Owner steps left
1. Decisions line: "2026-10-26 fast-check added to @shoebox/tax-xml devDependencies (already in the workspace; no new package)".
2. Push wt-0339 and open the PR against phase/0 when ready.
