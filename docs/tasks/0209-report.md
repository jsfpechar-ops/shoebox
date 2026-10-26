# 0209 report: registry warnings

Status: review

## Files changed

- `apps/worker/src/doc-extract/registry-checks.ts` (new): `RegistryDeps`, `defaultRegistryDeps`, `registryRows`.
- `apps/worker/test/registry-checks.test.ts` (new): 8 tests, synthetic values, fakes only.
- `apps/worker/src/doc-extract/handler.ts`: `registries?` dep; `registryRows` runs before `store.save` and appends warning rows.
- `apps/worker/test/doc-extract-handler.test.ts`: `offline` registry fakes passed to all 12 handler calls, so no test hits the network.
- `apps/worker/package.json`, `pnpm-lock.yaml`: `@shoebox/registries` workspace dependency.
- `packages/i18n/messages/en.json`: four `proto.check.reg_*.warn` keys.

## Commands

- `pnpm exec biome check --write apps/worker packages/i18n`: fixed formatting in 4 files; re-check clean.
- `pnpm --filter @shoebox/worker test`: 7 files passed, 2 skipped (DB suites), 56 tests passed, 7 skipped.
- `pnpm --filter @shoebox/worker typecheck`: clean.
- `pnpm --filter @shoebox/i18n test`: 3 files, 24 tests passed.

## Acceptance

- [x] §6 passes.

## Deviations

- Account check compares the paid IBAN only against accounts with no end date (`datumZverejneniUkonceni` null). Brief said "none equals", read as "no active account equals". An ended account therefore still raises the warning.
- VAT-amount test uses a regex (`/[1-9]/`) on the decimal string instead of a float comparison.
- The 2 skipped worker test files need a database and were not run.

## Questions

- None.

## Owner steps left

- None for this ticket.
