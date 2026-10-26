# 0332 report: `classifyPeriod` not_ready checks

Status: review

## Files changed (`git diff --stat HEAD~1`)

- `packages/domain/src/vat/checks-ready.ts` (new): `READY_CHECKS`, the 11 not_ready checks.
- `packages/domain/src/vat/classify-period.ts`: `khDocumentLimitCzk` added to `SimpleCheckContext` (from `rules.at(period.start).get('vat.kh_document_limit')`); the `TODO(0332)` placeholder removed; registry now built from `ACCOUNTANT_CHECKS` + `READY_CHECKS`, and throws at load if a code in the order list has no check.
- `packages/domain/test/classify-period-ready.test.ts` (new): the brief's test, with `!` replaced by a `must()` guard.

## Checks

- `pnpm --filter @shoebox/domain exec vitest run classify-period`: 2 files, 39 tests, passed.
- `pnpm --filter @shoebox/domain test -- classify-period`: 608 tests in 30 files, passed.
- `pnpm --filter @shoebox/domain typecheck`: passed.
- `pnpm exec biome check --write <3 files>`: no fixes left, no warnings.
- `grep -n 'TODO(0332)' packages/domain/src/vat/*.ts`: empty.

§7 acceptance ticked.

## Deviations

1. Step 1 said to typecheck before step 2 creates `checks-ready.ts`. I created both before the first typecheck, since the import would not resolve otherwise.
2. The brief's test had a type error: the `dom` helper annotated `partner` as `typeof CZ` (`dic: string`), but the test passes `NO_DIC` (`dic: null`). Fixed with an inline type that allows `dic: string | null`. No assertion changed.
3. Biome's optional-chain warning in `checks-ready.ts` was fixed by using `e.khDocumentTotalCzk?.toDecimal()`. Same logic.
4. Choices the brief left open: a `shvCode` entry whose document is missing from `docsById` counts as invalid VAT ID (fails closed). `S_KH_DIC_MISSING` checks are per document, not per entry, and skip documents with no partner record.

## Questions

None.

## Owner steps left

None.
