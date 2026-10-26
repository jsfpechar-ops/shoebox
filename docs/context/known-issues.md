# Known issues

Grep this file for the file or area before reporting. One row per issue; delete the row when fixed (and add a decisions line if the fix changed behavior).

| ID | Area | Issue | Where | Next step |
|---|---|---|---|---|
| K-P01 | plan | Module specs propose schema changes not yet merged into 05 | `docs/v3/modules/` §schema | consistency review applies them |
| K-P02 | plan | Several [verify] items depend on official XSDs and Cloudflare limits | `docs/v3/22-open-questions.md` | executor verifies in the brief that uses them |
| K-P03 | plan | Sandbox db tests run on a plain Postgres 16 (only PG16 binaries installed); Supabase and CI run 17 | `packages/db/scripts/local-pg.sh` | P0-CI-02 runs the db tests on local Supabase (17) |
| K-P04 | plan | Frankfurt (`europe-west3`) is a Cloud Run Tier 2 region; earlier docs assumed it was the cheapest EU choice | M12 §deployment | fixed: `europe-west1` |
| K-P05 | test | e2e `headers.spec.ts` AC-8 (theme kept after reload, desktop) failed once locally, passed on rerun; CI has no e2e job yet | `apps/web/e2e/headers.spec.ts` | watch when P0-CI-03 adds the e2e job; add a wait if it recurs |
| K-P06 | test | `tenant-sql.test.ts` "passes on the repository" fails locally when run with the other lint tests (ENOENT on a `__lint-fixture-*.ts` another test writes in parallel); passes alone and in CI | `scripts/lint/test/` | unique fixture dir per test, or `fileParallelism: false` for scripts/lint |
| K-P07 | code | Documents read before 0052 have no `flags.*` fields, so a correction re-checks them without the VAT-payer and paid-stamp checks | `apps/web/src/documents/correction.ts` | re-read old documents, or accept for the MVP |
| K-P08 | test | The correction write sequence (`applyCorrection`) has no test; only `planCorrection` is unit-tested. Fix cannot edit VAT recap lines or the class yet | `apps/web/src/documents/correction-store.ts` | db test with a user session; recap/class editing in a later brief |
| K-D01 | code | Trash has no automatic purge yet: trashed documents and their files stay until restored (copy says so). Needs a `retention.trash_purge` system job that deletes rows and Storage objects after 30 days | `apps/web/src/documents/trash*.ts` | lane D brief after Phase 1 screens |
