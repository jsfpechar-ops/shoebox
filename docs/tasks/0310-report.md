# 0310 report

Status: review
Branch: wt-0310 (not pushed, no PR)

## Files changed (git diff --stat b8e4728..HEAD)

- packages/domain/src/index.ts (export `./rules/cz/epo`; biome also reordered an existing `vat/*` export pair)
- packages/domain/src/rules/cz/2025.ts (+10: import, `DPHDP3_STRUCTURE`, two entries)
- packages/domain/src/rules/cz/2026.ts (+10: same)
- packages/domain/test/rules-values.test.ts (counts 23/24/23, keys, host, new describe)

## Commands

- `pnpm --filter @shoebox/domain test -- rules-values` (after step 1, before step 2): 4 failed, expected (missing keys and counts).
- `pnpm --filter @shoebox/domain test -- rules` (after step 2): 21 files, 490 tests passed.
- `pnpm --filter @shoebox/domain typecheck`: passed, no errors.
- `pnpm exec biome check packages/domain`: 2 errors (import order in index.ts, format in test file); fixed with `biome check --write` on those two files; re-check clean ("No fixes applied").
- `pnpm --filter @shoebox/domain test -- epo-rows kh-routing`: the filter did not narrow the run; all 21 files, 490 tests passed (includes both 0309 files).

## Acceptance (brief §7)

- [x] rules-values, rules-keys, rules-law, epo-rows, kh-routing green. rules-keys unchanged at 75.
- [x] `rules.at('2026-10-26').get('epo.dphdp3_row_map')` has 19 rows; `epo.kh_routing` version 1 (asserted in the new test).
- [x] Commits `0310 step 1..4` plus this report; no push.

## Deviations

- Step 1d: the test imports from `../src/index`, not `../src/rules/index`. The new epo import line was added after it.
- Anchor: `KH_METHODOLOGY` is wrapped over two lines in 2025.ts and 2026.ts. Inserted after the wrapped constant. Same URL.
- Steps 2 and 3 were applied in one commit (`0310 step 2`, both year files). Commit labels are therefore step 1, step 2, step 3 (index export), step 4 (biome fixes).
- `[verify]` on `DPHDP3_STRUCTURE`: NOT checked. No network access in this session. Whether the page lists `VetaD`/`Veta1`..`Veta6` is unrecorded.

## Questions

None.

## Owner steps left

None.
