# 0111 report

Status: review
Done: steps 1 to 5. Not pushed, no PR (owner said do not push).

## 1. Files changed (`git diff --stat 035aafc~1 HEAD`)

8 files, +441 -1: `packages/pipeline/src/jobs.ts`, `packages/pipeline/test/jobs.test.ts`, `packages/bank/src/dedupe.ts` (new), `packages/bank/test/dedupe.test.ts` (new), `packages/bank/src/index.ts`, `packages/db/src/statement-import.ts` (new), `packages/db/src/index.ts`, `packages/db/test/statement-import.db.test.ts` (new).

Commits: `0111 step 1` (035aafc), `0111 step 2` (a5bd874), `0111 step 3` (9e0d007), `0111 step 4` (5b32fde), `0111 step 5` (da3cd68).

## 2. Commands (last lines of output)

- `pnpm --filter @shoebox/pipeline test -- jobs`: `Test Files 2 passed (2)`, `Tests 16 passed (16)`.
- `pnpm --filter @shoebox/bank test`: `Test Files 8 passed (8)`, `Tests 84 passed (84)`.
- `pnpm --filter @shoebox/bank typecheck`, `@shoebox/pipeline typecheck`, `@shoebox/db typecheck`: tsc header only, exit 0 (db failed once, see Deviations 1; fixed).
- `pnpm --filter @shoebox/db exec vitest run test/statement-import.db.test.ts`: `Test Files 1 skipped (1)`, `Tests 1 skipped (1)`. No DATABASE_URL locally; left to CI.
- `pnpm biome check packages/db packages/bank packages/pipeline`: `Checked 80 files`, `No fixes applied`, `Found 2 infos`. No errors. The 2 infos are in `packages/bank/src/parsers/camt053.ts`, which this brief does not touch.

## 3. Brief checklist

- [x] Test files match §4 except biome formatting. bank and pipeline tests pass. db test skipped locally, left to CI.
- [x] Typecheck and biome clean (0 errors).

## 4. Deviations

1. `AccountIdentity.iban` is typed `string | undefined` (was `string`). Reason: the verbatim db test passes `iban: undefined`, which fails `tsc` under `exactOptionalPropertyTypes`. No runtime change. Done in step 5.
2. Biome `--write` formatted the new files, including the verbatim `dedupe.test.ts` and db test. Only whitespace and line breaks changed.
3. §4 gave only the signatures of the store functions. I wrote the bodies from the "Rules" text.
4. `loadStatementSource` has no `orgId` parameter, so its query filters by `id` only and relies on the tenant transaction (RLS). The other queries name `org_id`.
5. `findOrCreateMoneyAccount` orders by `money_accounts.created_at`. I did not check that column against 05 (not in the file list). The CI db test will show it.
6. New account name: `<account>/<bankCode>` when an account is given, else the IBAN, else `'bank'`. The brief's wording allowed this reading.
7. Orphan reversals are only counted in `orphanReversals`. No `bank.reversal_orphan` warning is emitted here. The return type has no place for it, so brief 0112 must handle it.

## 5. Questions

- Is an `id`-only lookup in `loadStatementSource` acceptable, or should it take `orgId`? The signature in the brief is fixed.
- Confirm `money_accounts.created_at` exists (Deviation 5).

## 6. Owner steps left

- Push the branch and open the PR, or hand that to the orchestrator.
- CI runs `statement-import.db.test.ts`.
