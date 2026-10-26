# 0110 report: money tables migration

Status: review

## 1. Files changed (`git diff --stat 6fda9f9..HEAD`)

```
packages/db/migrations/0020_money.sql        | 170 +++ (new)
packages/db/migrations/meta/_journal.json    |   7 +
packages/db/test/migrations/money.db.test.ts |  67 +++ (new)
packages/testkit/src/factories/index.ts      |  16 ++-
packages/testkit/src/factories/money.ts      | 129 +++ (new)
5 files changed, 388 insertions(+), 1 deletion(-)
```

Commits: `0110 step 1` to `0110 step 5`. Not pushed.

## 2. Commands

- `python3 -I` extraction script (steps 1 to 5): each brief block was pulled from the brief by an anchor match, asserted to occur once, and written verbatim. Journal entry `when` = 1792979548478 (largest). Journal parses, 16 entries. Last lines: `step1 ok 170 lines`, `step2 ok when= 1792979548478 entries= 16`, `step3 ok`, `step4 edited`, `step5 ok`.
- `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`: exit 0, no errors.
- `pnpm --filter @shoebox/db exec vitest run test/migrations/money.db.test.ts 2>&1 | tail -30`: `Test Files 1 skipped (1)`, `Tests 4 skipped (4)`, exit 0.
- `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`: exit 0, no errors.
- `pnpm biome check packages/testkit packages/db 2>&1 | tail -30`: `Checked 89 files in 4s. No fixes applied.`, exit 0.

## 3. Acceptance (§7)

- [x] `0020_money.sql` is the §4 step 1 block, extracted byte for byte by script.
- [x] Journal parses, 16 entries, new `when` is the largest.
- [x] Ten factories registered; testkit and db typecheck and biome clean.
- [x] DB tests left to CI (no `DATABASE_URL` here; not run against Postgres).

## 4. Deviations

None to the brief's text. The step 4 edit was applied by a script with asserts on each anchor (each found once).

## 5. Questions and odd findings

- The new journal entry is tagged `0020_money` but follows `0052_purge_trash` (idx 15). The tag number is out of order with the journal; the brief asks for it, so it is left as written.
- The SQL was not run against a database. It references `organizations`, `source_files`, `inbound_emails`, `partners`, `categories`, `documents`, `review_questions`, `auth.users` and the `app.apply_tenant_rls*` helpers, none verified in this session. CI's DB run will confirm them.

## 6. Owner steps left

None in this session. Owner: review the PR when opened; CI runs the DB tests against Supabase.
