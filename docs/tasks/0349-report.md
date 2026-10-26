# 0349 report

Status: review

## Done

- Step 1: `packages/domain/src/vat/preview.ts` with the exported types and `buildPeriodPreview` (formatting by biome, commit `38f8f8e` plus `1f7389e`).
- Step 2: `packages/domain/test/vat-preview.test.ts` as written in the brief (biome reformatted it in `1f7389e`).
- Step 3 (`4cdc467`): 20 `vat.row.*` labels, 5 `vat.kh.section.*` keys in lowercase (`a2`, `a4`, `a5`, `b2`, `b3`), 2 `vat.shv.code.*` keys in `packages/i18n/messages/en.json`. `buildPeriodPreview` builds the section key with `section.toLowerCase()`.
- Step 4 (`4190716`): `export * from './vat/preview';` appended to `packages/domain/src/index.ts`.

## Checks

- `pnpm --filter @shoebox/domain exec vitest run test/vat-preview.test.ts`: 2 passed.
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.
- `pnpm --filter @shoebox/domain typecheck`: clean.
- `pnpm exec biome check --write` on the changed files: formatting only.
- `pnpm depcruise`: no dependency violations.

## Deviations

- Section keys lowercased per coordinator instruction (brief named `vat.kh.section.A2` etc.). The i18n test is unchanged.
- KH counterparty: A2 = `kStat + vatidDod`, A4 = `dicOdb`, B2 = `dicDod`; A5/B3 null.
- `result` is always populated from `dp3`.
- No `TODO(i18n-cs)` comment (JSON has no comments); cs.json untouched.
- Commit messages: step commits use `0349 step k`; step 4 uses the brief's message.

## Owner steps left

1. Decide the preview-PDF renderer (`TODO(decision-pdf)`).
