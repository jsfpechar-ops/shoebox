# 0349 report

Status: blocked
Reason: brief step 3 conflicts with the i18n key test. The brief's keys `vat.kh.section.A2`, `A4`, `A5`, `B2`, `B3` contain uppercase segments. `packages/i18n/test/catalog.test.ts` (line 29) requires every key segment to match `[a-z0-9_]+`, so `pnpm --filter @shoebox/i18n test` fails with exactly those 5 keys. Changing the test is forbidden; renaming the keys is a deviation from the brief. Owner or orchestrator must choose: (a) lowercase the section segment (e.g. `vat.kh.section.a2`) and the brief is updated to match, or (b) relax the test regex.

## Done

- Step 1 (`38f8f8e`, formatting `1f7389e`): `packages/domain/src/vat/preview.ts` created with the exported types and `buildPeriodPreview`, as the brief specifies.
- Step 2 (`8a9ddd5`): `packages/domain/test/vat-preview.test.ts` written from the brief text (biome reformatted it in `1f7389e`).
- Step 3: `packages/i18n/messages/en.json` has the 20 `vat.row.*` labels, 5 `vat.kh.section.*` and 2 `vat.shv.code.*` keys. UNCOMMITTED in the worktree, because the i18n test fails on the 5 uppercase keys.
- Step 4: NOT done. `packages/domain/src/index.ts` export not added; commit message from the brief not used.

## Checks

- `pnpm --filter @shoebox/domain exec vitest run test/vat-preview.test.ts`: 2 passed.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm exec biome check --write` on the 2 domain files: fixed formatting only.
- `pnpm depcruise`: no dependency violations.
- `pnpm --filter @shoebox/i18n test`: 1 failed (`catalog.test.ts`, key format), 23 passed.

## Deviations

- Done: steps 1 to 2 committed; step 3 edited, not committed. Left: resolve the key naming, commit step 3, then step 4 (index export and commit).
- `result` is always populated from `dp3` (the brief did not say when it is null).
- KH `counterparty` for A2 is `kStat + vatidDod`, for A4 `dicOdb`, for B2 `dicDod`; A5/B3 are null.
- Brief's `vat.row.*` label keys for rows 1 to 65 all present; `TODO(i18n-cs)` not written (JSON has no comments); cs.json untouched.

## Owner steps left

1. Decide the preview-PDF renderer (`TODO(decision-pdf)`).
