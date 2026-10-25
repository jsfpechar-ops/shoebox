# 0029b report

Status: review

Steps 1-3 were done in an earlier session (9bf3d4c, 673f0e1, d13081e; typecheck clean). Step 4 is commit 33f99ae.

## 1. Files changed (`git diff --stat origin/phase/0`, packages and docs)

- docs/v3/05-data-model.md (+2)
- packages/db/migrations/0005_documents_core.sql (+190)
- packages/db/migrations/meta/_journal.json (+7)
- packages/db/src/index.ts (+1)
- packages/db/src/schema/documents.ts (+330)
- packages/db/src/schema/index.ts (+1)
- packages/db/test/migrations/documents-core.db.test.ts (+261)
- packages/testkit/src/factories/documents.ts (+95)
- packages/testkit/src/factories/index.ts (+13, -2)
- docs/tasks/0029a-report.md (+47)

## 2. Commands (last lines)

- `DATABASE_URL=... pnpm --filter @shoebox/db test`: `Test Files 10 passed (10)`, `Tests 86 passed (86)`.
- `pnpm exec biome ci packages/db`: `Checked 25 files`, no fixes applied, no errors.
- `pnpm --filter @shoebox/db typecheck`: tsc clean, no output.
- `pnpm check:tenant-sql`: `87 files, no Drizzle call on a tenant table outside withTenant()`.
- `python3 scripts/pii_guard.py --all packages/db/test/migrations/documents-core.db.test.ts`: `pii_guard: OK`.
- `local-pg.sh start` and `stop`: started, then `stopped`.

## 3. Section 7 acceptance

- [x] `documents-core.db.test.ts` passes and the db suite is 86 passed.
- [x] `grep -c "pgTable("` gives 6; `grep -c "numeric("` gives 11; float grep gives 0.
- [x] typecheck clean; biome clean; `check:tenant-sql` exit 0.
- [ ] The `psql ... like 'dddddddd-%'` count of 0 after the run was not run (no psql call made in this session).

## 4. Deviations and [verify] findings

- None in step 4. The test file was written verbatim from the brief.

## 5. Questions

- None.

## 6. Owner steps left

1. Review the PR of `task/0029-db-documents-core` (0029a plus 0029b). Do not merge it yet.
2. Merge that PR into `phase/0` after review.
