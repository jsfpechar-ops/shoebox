# 0334 report: computeKh and computeShv

Status: review

## Files changed

- `packages/domain/src/vat/kh.ts` (new): KH types, `vatIdParts`, `computeKh`.
- `packages/domain/src/vat/shv.ts` (new): SH types, `computeShv`.
- `packages/domain/test/kh.test.ts` (new): brief test, verbatim except `!` replaced by a `must()` guard (Biome).
- `packages/domain/src/index.ts`: two export lines added.

## Checks

- `pnpm --filter @shoebox/domain exec vitest run test/kh.test.ts`: 8 passed.
- `pnpm --filter @shoebox/domain test -- kh`: 30 files, 592 tests passed (the filter matches more than kh).
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm exec biome check` on the four changed files: clean.

## §7 Acceptance

- [x] Green; typecheck clean.

## Deviations

- Test file: `!` non-null assertions replaced with a `must()` guard (Biome rule); assertions unchanged.
- `computeKh` `entryCount` counts only in-scope entries (sections A2, A4, A5, B2, B3). Ignored entries are counted nowhere, as the brief says.
- Zero and none rate entries in A4/B2/A2 add their base to bucket 1 with zero tax (the tax is not taken from `vatCzk`). Standard entries take `vatCzk`.
- SH: negative groups use the same ceil0/round0/floor0 function, sign kept.
- Biome reformatted the new files (formatting only).

## [verify] items for the owner

- `c_radku` format: sorting by (`dppd`, `c_evid_dd`, dic/vatid) with a documentId tie-break; the format is not checked against the primary source.
- Věta C source: taken from DPHDP3 rows 1, 2, 40, 41 (base) and Σ bases of rows 3, 4, 5, 6, 12, 13. Not checked against KH sums.
- SH rounding of negative groups: sign kept, same function as positive groups. Not checked against the primary source.
- `por_c_stran = 1`: fixed value per the brief; not checked.

## Questions

None.

## Owner steps left

None.
