# 0364 report

Status: review. Branch wt-0364.

Checks: pipeline jobs 23/23; worker podklady-job 10/10; worker full unit 168 passed; db filings+podklady db tests 12/12; typecheck worker/db/domain/exports/pipeline clean; biome clean; depcruise clean.

Registry debounce: no 60 s option (only `startAfterSeconds`); `entityId` `reserve-{reason}` dedupes queued jobs per reason.

Deviations:
- JOB_NAMES gained `podklady.reserve.refresh` and `podklady.reserve.nightly` (count 38 to 40).
- `podklady.generate` entityId is `{year}-{answersVersion}` (the ledger hash is not in the payload); the hash check is in the service.
- `registerPodkladyJobs(registry, db, env, logger)` takes `env` (Supabase blobs, `APP_URL` origin) and skips with a warning when Supabase env is missing, like `registerVatJobs`.
- `@shoebox/i18n` added as worker workspace dependency (lockfile updated) for the en translator.
- `@shoebox/exports` index now exports `PDF_MIME` and `Translate`.
- `FilingRow` gained optional `inputs` (the draft answers are read from it); `upsertVatObligations` widened as the brief says (no `note` column, `isOptional` written on insert).
- `readPodkladyRows` gets `BigInt(LEDGER_ALGO_VERSION)` as the brief says; its parameter is named build version.
- `refreshReserve` takes the store (service role inside `upsertReserve`, reason `admin`), not a serviceTx. Return-required and income total come from `buildPodkladySummary` with empty answers instead of calling `checkPausalniDan` directly.
- `serialize` reads Money from `this[key]` in the replacer, because `Money.toJSON` runs before the replacer.
- `PodkladyDeps.pdf` optional test seam added. `apps/worker/test/helpers/vat-store.ts`: one cast after the type widening.
