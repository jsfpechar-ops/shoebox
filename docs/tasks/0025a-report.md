# 0025a report: RLS suite

Status: blocked

## 1. Files changed

Steps 1-8 are committed locally on this branch (not pushed before this session):

- d30ec0f 0025a step 1
- c18fd8a 0025a step 2 (step 2 only added the rls-catalog export)
- 5be1d7a 0025a step 3
- 863afa9 0025a step 4
- c476768 0025a step 5
- 4b4292b 0025a step 6
- 76910fe 0025a step 7
- 5e79f99 0025a step 8

## 2. Commands (fresh cluster on port 54432, SHOEBOX_PGDIR=/var/lib/postgresql/shoebox-0025a)

- `DATABASE_URL=... pnpm --filter @shoebox/db test`: 6 files, 61 passed.
- `DATABASE_URL=... pnpm exec vitest run --project db`: 4 files, 33 passed.
- `pnpm --filter @shoebox/db test` without DATABASE_URL: 2 files passed, 4 skipped; 28 passed, 33 skipped.
- `pnpm --filter @shoebox/testkit test`: 6 files, 71 passed (brief said 29; the actual count is 71).
- `pnpm --filter @shoebox/db typecheck`: exit 0.
- `pnpm --filter @shoebox/testkit typecheck`: exit 0.
- `pnpm exec biome ci packages/db packages/testkit`: checked 45 files, no fixes applied.
- Note: exit codes above are those of the piped `tail`, not of the command itself. The output lines show success.

## 3. Acceptance (section 7)

- rls_probe tables count: 0.
- organizations with aaaaaaaa-/bbbbbbbb- ids: 2 (expected 0). Leftover ids:
  - aaaaaaaa-0000-4000-8000-000000000001
  - bbbbbbbb-0000-4000-8000-000000000002
- `grep -c "tenantFactories.define" packages/testkit/src/factories/index.ts`: 1.
- Not re-run in this session: `git diff --stat origin/phase/0 -- pnpm-lock.yaml`.

## 4. Deviations

- Step 2 only added the rls-catalog export.
- testkit has 71 tests, not 29.
- This finishing session was run by a separate executor. The cluster was started fresh and stopped after the run.

## 5. Open issue

The fixture cleanup did not run, or did not remove the two organizations above. Status is blocked until those rows are removed and the count is 0.
