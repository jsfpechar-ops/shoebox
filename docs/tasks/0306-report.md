# 0306 report

Status: review

## Files changed (`git diff --stat 31f3746..HEAD`)

- `packages/domain/src/fx.ts` (new, 66 lines): `resolveFxRate`, `convertToCzk`, types `FxRateRow`, `FxRate`, `CnbRateRule`.
- `packages/domain/src/index.ts` (+1): `export * from './fx';` after the enums export.
- `packages/domain/test/fx.test.ts` (new, brief-verbatim, then biome formatting only).

## Commands (last lines)

- `pnpm --filter @shoebox/domain test -- fx` before step 2 (expected fail): `Cannot find module '../src/fx'`; suite failed, 366 other tests passed.
- `pnpm --filter @shoebox/domain test -- fx` after step 2: `Test Files 18 passed (18)`, `Tests 374 passed (374)`. The `fx` filter ran the whole package suite.
- `pnpm --filter @shoebox/domain typecheck`: `tsc -p tsconfig.json` with no errors.
- `pnpm exec biome check packages/domain`: first run flagged formatting in `fx.test.ts`; after `--write` on that file: `Checked 50 files in 7s. No fixes applied.`

## Acceptance (§7)

- [x] Test file green. Test content unchanged except biome formatting (see Deviations).
- [x] `7` does not appear as a literal in `fx.ts`.
- [x] Commits `0306 step 1`, `0306 step 2`, `0306 step 3`; no push, no PR.

## Deviations

- Step 2: import path changed to `./dates/index` and `./money/index`, as the brief's own comment says (this file is in `src/`).
- Step 2: `resolveFxRate` has an extra `void rule;` so the `rule` parameter is not flagged as unused. The signature is exactly as given. The function does not check the rule value; the type admits only `'rate_valid_on_date_else_last_published'`.
- Step 2: added a `RangeError` guard for a non-integer or negative `maxLookbackDays` (the brief's Rules section asks for this).
- Step 3: biome flagged formatting in `fx.test.ts`; applied `biome check --write` on that file, as the executor notes allow. Test assertions unchanged.
- Verify note (brief §9): ZDPH § 4 odst. 8 is not re-checked against the primary source here. The existing `TODO(verify)` in `packages/domain/src/rules/cz/2026.ts` (line 78) still stands.

## Questions

- None blocking. `convertToCzk` does not round; callers apply `round2`, as the brief says.

## Owner steps left

- None for this ticket.
