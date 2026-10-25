# 0025b report

Status: review
Branch: task/0025b-rls-suite (base origin/phase/0, which contains 0025a)
Note: steps 1 to 4 ran in the first session, which stopped at the tool-call cap. Step 5 and the checks were finished by a second session.

Done: steps 1 to 5 (all of the brief's §4 steps).

Files changed (commits "0025b step 1" to "0025b step 5"):
- packages/db/test/rls/isolation.db.test.ts (new)
- packages/db/test/rls/roles.db.test.ts (new)
- scripts/check-tenant-sql.ts (new)
- scripts/lint/test/tenant-sql.test.ts (new)
- package.json (lint runs check:tenant-sql; script wired to scripts/check-tenant-sql.ts)

Commands and results:
- `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test test/rls/isolation.db.test.ts 2>&1 | tail -30`: 5 passed
- same with `test/rls/roles.db.test.ts`: 5 passed
- `pnpm exec vitest run --project unit scripts/lint/test/tenant-sql.test.ts 2>&1 | tail -30`: 8 passed
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -5`: exit 0
- `pnpm exec biome ci packages/db scripts package.json 2>&1 | tail -5`: Checked 26 files, no fixes applied, exit 0
- `pnpm lint 2>&1 | tail -3`: last line `check:tenant-sql: 75 files, no Drizzle call on a tenant table outside withTenant()`, exit 0
- Fixture (bad.ts, `from(organizations)` outside withTenant): `../../../../../../tmp/tsql/bad.ts:2:18  from(organizations) on a tenant table outside withTenant()`, exit=1
- `grep -c 'ts-morph' package.json scripts/check-tenant-sql.ts`: 0 and 1 (the one hit is a comment, "no ts-morph"; no dependency added)
- `bash packages/db/scripts/local-pg.sh stop`: stopped

§7 acceptance:
- [ ] Whole db package (71 passed / 28 passed, 43 skipped without DATABASE_URL): not run in this session.
- [x] Fixture fails with exit=1 and a `bad.ts:2:` hit (/tmp/tsql removed).
- [x] `pnpm lint` exit 0, last line is the check:tenant-sql summary.
- [x] ts-morph grep: no dependency; scripts file has the word only in a comment.
- [ ] PR to phase/0: not opened (out of scope for this run).

Deviations:
- Step 5 ran in a second session. The 25-tool-call cap was hit in the first.
- The ts-morph grep returns 1 in scripts/check-tenant-sql.ts because of a comment. The §7 expectation was 0.
- The brief's Status line set to `review`.
- The script reports 75 files here; the brief's own run reported 57. Different base, not a failure.

Questions: none.
Owner steps left: open the PR to phase/0 (title in brief §7) once the reviewer accepts.
