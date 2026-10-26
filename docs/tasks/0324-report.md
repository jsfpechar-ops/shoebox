# 0324 report

Status: done

## Files changed
- `packages/db/src/ledger-rebuild.ts` (new): loadLedgerInputs, replaceLedgerEntries, readLedgerEntries, listDocumentsForRebuild, plus the exported row types.
- `packages/db/src/index.ts`: one export line (`./ledger-rebuild`).
- `packages/db/test/ledger-rebuild.db.test.ts` (new): brief test, two fixture edits (see Deviations).

## Commands (last lines)
- `pnpm --filter @shoebox/db test -- ledger-rebuild`: 160 passed, 3 failed. All 3 are in `test/rls/storage.db.test.ts` (known local shim). The filter did not restrict the run; the 4 ledger-rebuild tests pass.
- `pnpm exec vitest run test/ledger-rebuild.db.test.ts`: 4 passed.
- `pnpm --filter @shoebox/db typecheck`: clean, 0 errors.
- `pnpm exec biome check` on the 3 files: clean after `--write`.

## Section 7
- [x] Test passes against a database; typecheck clean.
- [x] `replaceLedgerEntries` takes the advisory lock as its first statement.

## Deviations
- Fixture: the `taxpayer_profiles` insert needed `tax_regime = 'danova_evidence'` and `address = '{}'::jsonb` (both not-null). Added to that one line.
- `index.ts`: biome sorted the export after `./inbound-email`. Kept biome's order so CI lint passes.
- Biome `--write` reformatted the new module and test file (formatting only).
- `build_version` is read back from the stage_version JSON number and converted with `String()`.

## Questions
None.

## Owner steps left
None.
