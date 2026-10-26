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
| K-B01 | code | A user correction re-runs only the proto checks, so registry warnings and `PROTO_ICO_REPAIRED` vanish after any fix | `apps/web/src/documents/correction.ts` | keep non-proto rows on re-check |
| K-B02 | code | ISDOC export is CZK only (`buildIsdoc` returns null otherwise); `rememberSupplier` overwrites the partner name and falls back to the IČO | `packages/exports/src/isdoc/`, `packages/db/src/suppliers.ts` | foreign currency + name policy in a later brief |
| K-D01 | code | Trash has no automatic purge yet: trashed documents and their files stay until restored (copy says so). Needs a `retention.trash_purge` system job that deletes rows and Storage objects after 30 days | `apps/web/src/documents/trash*.ts` | lane D brief after Phase 1 screens |
| K-A01 | code | `email.received` queues `doc.split` inside its tenant transaction; if the split job starts before that transaction commits it finds no documents (2 s polling makes this rare) | `apps/worker/src/email-received/handler.ts` | queue after commit, or retry an empty batch once |
| K-A02 | code | E-mail intake skips HEIC/Office attachments and mails whose invoice is only in the body; quarantined (spoofed) mails have no release screen | `apps/worker/src/email-received/` | later briefs |
| K-C01 | spec | Payer with a partial business share: the tax ledger keeps VAT × (1 − share) in the basis and then multiplies by the share again, so a little private VAT lands in the business amount (M04 §4.11.2 uses deduction_pct = share) | `packages/domain/src/ledgers/tax.ts` | accountant review before Phase 4 totals; likely basis should exclude the private VAT |
| K-C02 | code | Vendor memory re-reads every answered relearn question and re-counts the dominant line on each `question_answered` run, so answering several questions on one document can add several confirmations or reset a newer relearn choice | `apps/worker/src/categorize/handler.ts` learnVendor | mark applied answers (e.g. an applied_at) in a later brief |
