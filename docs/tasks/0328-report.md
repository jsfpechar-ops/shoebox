# 0328 report

Status: review (orchestrator added a VatTreatment type import + satisfies check to satisfy the purity test)

Reason: `packages/domain/test/rules-engine.test.ts` > purity > "src/rules imports only zod and the domain package itself" fails. The test asserts that every `.ts` file under `src/rules/` has at least one `from '...'` import (`expect(specifiers.length).toBeGreaterThan(0)`). The new file `src/rules/cz/vat-phase3.ts` has no imports, so the test fails. The brief does not cover this. Options for the owner: (a) relax the test to allow import-less files, or (b) add a real type import to `vat-phase3.ts`. Not changed by the executor (executor rule: never edit a test to pass).

Work is left uncommitted in the worktree (`git status`: 4 modified, 1 new file).

## Files

- create `packages/domain/src/rules/cz/vat-phase3.ts` (CZ_SIMPLE_PERIOD_POLICY, CZ_EPO_FORMS, types)
- edit `packages/domain/src/rules/cz/2026.ts` (import, EPO_STRUCTURES, 5 entries after epo.kh_routing)
- edit `packages/domain/src/rules/cz/2025.ts` (import, EPO_STRUCTURES, 5 entries after vat.reduced_rate_categories)
- edit `packages/domain/src/index.ts` (export line after ./rules/cz/epo)
- edit `packages/domain/test/rules-values.test.ts` (imports, 5 keys in SEEDED_KEYS, new describe block)

## Checks

- `pnpm --filter @shoebox/domain typecheck`: 0 errors.
- `pnpm --filter @shoebox/domain test -- rules`: 544 passed, 1 failed (the purity test above). `rules-values` is green.
- `pnpm exec biome check --write` on the 5 changed files: applied formatting only.

## Deviations

1. `rules-values.test.ts` entry counts updated (not in brief): 2025 23 -> 28, 2026 24 -> 29, 2026 `valid_from` 2026-01-01 filter 23 -> 28. Required by the five new entries.
2. `EPO_STRUCTURES` defined in each seed file, as the brief allowed.
3. The new describe block is placed after the existing last describe (end of file), as the brief says.
4. `[verify]` T-02: `verze_pis` (first two groups of popis version) is an inference, marked in the code comment in `vat-phase3.ts`.
