# 0331 report: classifyPeriod core

Status: review

## Files changed

- `packages/domain/src/vat/classify-period.ts` (new): types, strict policy schema, registry `SIMPLE_CHECKS` (24 codes, order per M05 §4.3), `classifyPeriod`.
- `packages/domain/src/vat/checks-accountant.ts` (new): `ACCOUNTANT_CHECKS` (S_ENTRY_BEFORE_STATUS plus the 12 needs_accountant checks), `RETURN_ROWS_3_13`, `uniqueSorted`.
- `packages/domain/test/classify-period.test.ts` (new): brief test, `!` replaced by a `must()` guard.
- `packages/domain/src/index.ts` (edit): one export line.

## Commands

- `pnpm --filter @shoebox/domain exec vitest run classify-period 2>&1 | tail -30`: `Test Files 1 passed (1)`, `Tests 15 passed (15)`.
- `pnpm --filter @shoebox/domain typecheck 2>&1 | tail -30`: `tsc -p tsconfig.json`, exit 0, no errors.
- `pnpm exec biome check --write <4 changed files> 2>&1 | tail -30`: `Checked 4 files`, one optional-chain warning fixed by hand, then clean.

## Acceptance (§7)

- [x] Test green: 24 codes present, verdict precedence covered, each accountant code has pass and fail cases.
- [x] `S_IO_NEGATIVE_TAX` carries `TODO(decision-TA-11)`.

## Deviations

1. `CzRules` is not imported from `../vat/period`, because 0330 is not in this tree. It is `ReturnType<typeof createCzRules>`, the same pattern as `overview/deadlines.ts`.
2. The parsed policy type is `ParsedSimplePeriodPolicy`, not `SimplePeriodPolicy`. The name `SimplePeriodPolicy` is already exported by 0328 (`rules/cz/vat-phase3.ts`), and a second export would clash in `index.ts`.
3. `S_ENTRY_BEFORE_STATUS` is a not_ready check in the table, but the brief's test needs it implemented here. It lives in `checks-accountant.ts`, so 13 checks are implemented and 11 are `PENDING` placeholders for 0332.
4. `RETURN_ROWS_3_13` and `uniqueSorted` are defined in `checks-accountant.ts` and re-exported from `classify-period.ts`. This avoids a runtime import cycle.
5. Test file: each `!` is a `must()` guard (executor rule). Test assertions are unchanged.

## Questions

- The policy flags `allow_partial_business_share_on_deduction` and `allow_prior_period_credit_notes` are parsed but not read. The brief's table has no gate for them. Both are `false` in 2026.1, so behavior is unchanged today. Confirm whether the checks should honour them.
- For `neplatce`, `S_TREATMENT_NOT_ALLOWED` passes. `S_PROFILE_UNSUPPORTED` decides that case.
- `S_MAX_DOCS` returns `documentIds: []`, because the brief names no documents for it.

## Owner steps left

None.
