# 0037a report

Status: review
Branch: task/0037-storage (from origin/phase/0). Local Postgres 16 cluster at 127.0.0.1:54399 (started by the executor, left running).

## 1. Files changed

- `packages/db/migrations/0008_storage.sql` (new): `app.storage_org_id`, bucket `org-files` (private), four `org_files_*` policies on `storage.objects`, all in a `do` block that no-ops without `storage.objects`.
- `packages/db/migrations/meta/_journal.json`: entry 7 (`0008_storage`).
- `packages/db/scripts/supabase-shim.sql`: storage stand-in (59 lines).
- `packages/db/test/rls/storage.db.test.ts` (new): 5 tests.
- `docs/v3/05-data-model.md`: storage paragraph before `## 11. Retention`.
- `docs/tasks/0037a-storage-bucket-policies.md`: Status line set to `review`.
- `docs/tasks/0037a-report.md` (new): this file.

## 2. Commands (last lines of output)

- Step 1: `grep -c "^  create policy org_files_"` → `4`; `migration-lint: OK (1 file(s))`; journal entries → `8`.
- Step 2: shim applied, no output; `to_regclass('storage.objects')` → `storage.objects`.
- Step 3: `biome ci packages/db` → `Checked 34 files ... No fixes applied.`; `typecheck` → no errors; `vitest run test/rls/storage.db.test.ts` → `Tests 5 passed (5)`.
- Step 4 (db suite, with DATABASE_URL), run 1: `Test Files 15 passed (15)`, `Tests 112 passed (112)`. Run 2: same counts.
- Step 4 without DATABASE_URL: `Tests 29 passed | 83 skipped (112)`.
- Step 5: `grep -c "migration 0008" docs/v3/05-data-model.md` → `1`; `context_lint.py` → `context lint: OK` (WARN about status.md, expected); `pii_guard.py --all` (the three new SQL/TS files) → `pii_guard: OK`.

## 3. Section 7 (acceptance)

- [x] Migration count 8 and public tables 29: not re-queried (migration count is the 8 journal entries; no public table added).
- [ ] pg_policies and bucket `public = f`: not queried by the executor, relying on the storage test (`bucket ... private` and the four policy names pass).
- [x] `app.storage_org_id` parse: covered by the test's name-parser assertion (passes).
- [x] storage.db.test.ts: 5 passed locally (not skipped); db suite 112 passed twice; `storage.objects` count after run = `0`.
- [x] `grep -c "migration 0008"` → 1; shim 59 lines.
- [ ] CI result for `storage.db.test.ts` (ran or skipped): NOT known to the executor. The GitHub tools were unavailable in this session, so the CI log could not be read. Reviewer must check the CI `db` job.

## 4. Deviations and findings

- Setup: the brief's `git checkout -b` was run as `git checkout -B` (the branch did not exist locally). No effect on content.
- Tool-call budget: the run went slightly past the 30-call guideline (about 34 calls) to finish the steps, commit, report and push. No STOP condition was hit.
- Brief §5 and §3 were respected: no file outside §3 changed. AGENTS.md was not modified.
- No `[verify]` items in this brief.

## 5. Questions

- Confirm the default that the bucket has no size or MIME limit (brief §2, default).
- Reviewer: decide whether `storage-api` should leave the CI exclude list, based on the CI log of `storage.db.test.ts`.

## 6. Owner steps left

- None for this brief. 0037b continues on the same branch.
