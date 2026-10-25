# 0049 report: doc.extract job

Status: review

## Files changed (`git diff --stat e492a02~1..HEAD -- apps/worker`)

- apps/worker/src/doc-extract/handler.ts (new): `createDocExtractHandler`, `dbReadingStore`, `ReadingStore`, `DocExtractDeps`
- apps/worker/src/doc-extract/register.ts (new): `registerDocExtract`
- apps/worker/src/doc-extract/rows.ts (edit): `params` keeps `messageKey`
- apps/worker/src/main.ts (edit): passes `register`
- apps/worker/test/doc-extract-handler.test.ts (new, from brief; biome reformatted whitespace only)
- apps/worker/test/doc-extract-rows.test.ts (edit: the two expected rows; biome reformatted)

## Commands (last lines)

- Step 0: `pnpm --filter @shoebox/worker exec vitest run test/doc-extract-rows.test.ts` gave `Tests 10 passed (10)`.
- Step 1: `vitest run test/doc-extract-handler.test.ts` gave `Tests 6 passed (6)` (after one fix, see Deviations).
- Step 2: `pnpm --filter @shoebox/worker typecheck` ran clean.
- Step 3: `pnpm --filter @shoebox/worker typecheck` clean; `vitest run` on handler, rows and registry tests gave `Test Files 3 passed (3)`, `Tests 27 passed (27)`.
- Step 3: `pnpm exec biome ci apps/worker` failed on formatting before the fix; after `pnpm exec biome check --write apps/worker` it reports `Checked 18 files. No fixes applied.`
- Final rerun after formatting: typecheck clean, same 27 tests pass.

## Section 7

- [x] The test file passes (6/6). Rows and registry tests still pass. Biome changed whitespace in the test file only.
- [x] `grep -n 'logger\.' apps/worker/src/doc-extract/*.ts` shows only `missing` names, `model`, and fixed messages.
- [x] Typecheck and biome clean.

## Deviations

1. Step 0 anchor: the literal `params: { ...r.params` was not in `rows.ts`. The line was `params: r.params as Record<string, unknown>,`. Replaced with `params: { ...(r.params as Record<string, unknown>), messageKey: r.key },`, the brief's intent.
2. Step 1: `createCzRules().at(date).get('vat.rates')` returns the value directly, not an entry with `.value`. The first run failed on that; the fix was to drop `.value`. Then 6/6 passed.
3. Post-parse throws (rates, checks, rows) are mapped to `parse`. Save errors map to `error`.
4. `biome check --write apps/worker` (requested by the orchestrator) reformatted the handler, register and both test files. Formatting only.

## Questions

None.

## Owner steps left

Set on the worker service, never in the repo: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Without them the worker starts and logs `doc.extract not registered`.
