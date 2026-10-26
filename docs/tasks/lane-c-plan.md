# 0300: lane C plan (sorting and money)

Status: in-progress | Base commit: 496b1e9 | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Lane C owns briefs 0300–0399 and migrations 0040–0049. It never touches `apps/web` screens (lane D), intake/ingestion (lane A) or extraction/validation checks (lane B). All wave-1 code is pure (`packages/domain`) except two migrations.

## Wave 1 (briefs written, executor Haiku 5.5)

| # | Brief | Depends on | Files (owned) |
|---|---|---|---|
| 0301 | Category taxonomy | — | `domain/src/taxonomy/categories.ts`, `test/taxonomy.test.ts`, `src/index.ts` |
| 0302 | Lane C rule seeds (classification.*, vat lists) | 0301 | `domain/src/rules/cz/classification.ts`, `cz/2025.ts`, `cz/2026.ts`, `cz/index.ts`, `rules/index.ts`, `test/rules-values.test.ts`, `test/rules-classification.test.ts` |
| 0303 | P1-CAT-01 cascade (H1–H5, soft rules, asset check, share, deductibility) | 0302 | `domain/src/taxonomy/cascade.ts`, `test/cascade.test.ts`, `src/index.ts` |
| 0304 | P1-CAT-02a `deriveVatTreatment` | 0302 | `domain/src/vat/treatment.ts`, `test/vat-treatment.test.ts`, `src/index.ts` |
| 0305 | P1-CAT-02b VAT point date + period | 0302 | `domain/src/vat/point-date.ts`, `test/vat-point-date.test.ts`, `src/index.ts` |
| 0306 | P1-CAT-02c `resolveFxRate`, `convertToCzk` | 0302 | `domain/src/fx.ts`, `test/fx.test.ts`, `src/index.ts` |
| 0307 | P1-LEDG-01a `allocateProRata` (fast-check) | — | `domain/src/ledgers/allocate.ts`, `test/allocate.test.ts`, `src/index.ts` |
| 0308 | P1-LEDG-01b `buildTaxLedgerEntries` | 0301, 0305, 0306, 0307 | `domain/src/ledgers/tax.ts`, `test/tax-ledger.test.ts`, `src/index.ts` |
| 0309 | P1-LEDG-02a EPO row map + KH routing data and resolvers | — | `domain/src/rules/cz/epo.ts`, `rules/law.ts` (attrs optional), `test/epo-rows.test.ts`, `test/kh-routing.test.ts` |
| 0310 | P1-LEDG-02a seeds `epo.*` into 2025/2026 | 0302, 0309 | `cz/2025.ts`, `cz/2026.ts`, `test/rules-values.test.ts`, `src/index.ts` |
| 0311 | P1-LEDG-02b `buildVatLedgerEntries` (golden) | 0301, 0305, 0306, 0310 | `domain/src/vat/ledger.ts`, `test/vat-ledger.test.ts`, `src/index.ts` |
| 0312 | Migration 0040 categories seed | 0301 | `db/migrations/0040_categories_seed.sql`, `meta/_journal.json`, `db/test/migrations/categories-seed.db.test.ts` |
| 0313 | Migration 0041 ledger tables + RLS + factories | 0312 | `db/migrations/0041_ledgers.sql`, `meta/_journal.json`, `testkit/src/factories/ledgers.ts`, `factories/index.ts`, `db/test/migrations/ledgers.db.test.ts` |
| 0314 | Drizzle mirror of 0041 | 0313 | `db/src/schema/ledgers.ts`, `schema/index.ts` |

Order and parallelism (merge each into the lane branch before its dependants start):

1. 0301, 0307, 0309 in parallel (disjoint files; 0309 edits `law.ts`, nobody else does).
2. 0302 alone (touches the shared seed files and `rules-values.test.ts`).
3. 0303, 0304, 0305, 0306, 0312 in parallel. Every brief appends one line to `domain/src/index.ts` at a named anchor; rebase conflicts there are trivial (keep all lines).
4. 0308, 0310 in parallel (0310 edits the seed files and `rules-values.test.ts` again: no other brief in this wave does).
5. 0311, 0313 in parallel; then 0314.

## Wave 2 (briefs written, executor Haiku 5.5)

| # | Brief | Depends on | Files (owned) |
|---|---|---|---|
| 0315 | P1-CAT-03a LLM categorizer: `m04-categorize-v1` prompt, schema, parser, `runCategorize` (one retry) | 0303 | `extraction/src/categorize/{schema,run}.ts`, `src/index.ts`, `test/categorize-llm.test.ts` |
| 0316 | P1-CAT-03b `buildSummary` (English, `TODO(i18n-cs)`) | 0301 | `domain/src/taxonomy/summary.ts`, `test/summary.test.ts`, `src/index.ts` |
| 0317 | P1-CAT-04a job defs `doc.categorize`, `ledger.*` + `loadDocumentForCategorize`/`saveCategorization` | 0314 | `pipeline/src/jobs.ts`, `test/jobs.test.ts`, `db/src/document-categorize.ts`, `db/src/index.ts` |
| 0318 | P1-CAT-04b `applyAnswers`, `buildQuestions`, question copy | 0317, 0303 | `worker/src/categorize/{answers,questions}.ts`, `i18n/messages/en.json`, `worker/test/categorize-questions.test.ts` |
| 0319 | P1-CAT-04c `planCategorization` (pure stage flow) | 0315, 0316, 0317, 0318 | `worker/src/categorize/plan.ts`, `worker/test/categorize-plan.test.ts` |
| 0320 | P1-CAT-04d `doc.categorize` handler, registration, ledger enqueue | 0319 | `worker/src/categorize/{handler,register}.ts`, `worker/src/main.ts`, `worker/test/categorize-job.test.ts` |
| 0321 | P1-CAT-04e routes: answer question, edit line classification; `enqueueDocCategorize` | 0317, 0318 | `web/src/documents/{classification,enqueue}.ts`, `web/app/api/review-questions/[id]/answer/route.ts`, `web/app/api/documents/[id]/lines/[lineId]/classification/route.ts`, `web/test/classification.test.ts` |
| 0322 | P1-CAT-05a vendor memory learning, relearn, retroactive re-queue | 0320, 0321 | `worker/src/categorize/vendor-memory.ts`, `worker/src/categorize/handler.ts` (edit), `db/src/vendor-memory.ts`, `worker/test/vendor-memory.test.ts` |
| 0323 | P1-CAT-05b `GET /vendor-profiles`, `DELETE /vendor-profiles/{id}/memory?reprocess=` | 0321, 0322 | `web/src/documents/vendor-memory.ts`, `web/app/api/vendor-profiles/**`, `web/test/vendor-memory-route.test.ts` |
| 0324 | P1-LEDG-03a ledger I/O: inputs, locked replace, build_version, stage_version hash | 0314, 0317 | `db/src/ledger-rebuild.ts`, `db/src/index.ts`, `db/test/ledger-rebuild.db.test.ts` |
| 0325 | P1-LEDG-03b jobs `ledger.rebuild_document|_org|verify` | 0308, 0311, 0317, 0324 | `worker/src/ledger/{build,handler,register}.ts`, `worker/src/main.ts`, `worker/test/ledger-rebuild.test.ts` |
| 0326 | Přehled (a) `computeLedgerTotals`, `mergeOverviewTotals` | — | `domain/src/overview/ledger-totals.ts`, `test/overview-ledger-totals.test.ts`, `src/index.ts` |
| 0327 | Přehled (b) loader reads `tax_ledger_entries` | 0326, 0313 | `web/src/overview/{ledger,view,load}.ts`, `web/test/overview-ledger.test.ts` |

Order and parallelism (merge each into the lane branch before its dependants):

1. 0315, 0316, 0317, 0326 in parallel (disjoint packages; 0316 and 0326 both append one line to `domain/src/index.ts`: keep both).
2. 0318, 0324, 0327 in parallel (0318 needs 0317 types; 0324 needs 0317's row types; 0327 needs 0326).
3. 0319 alone, then 0320 and 0321 in parallel (0321 edits `web/src/documents/enqueue.ts` only), 0325 in parallel with them (needs 0324; edits `worker/src/main.ts` like 0320: keep both lines, categorize first).
4. 0322 alone (edits `categorize/handler.ts` after 0320), then 0323.

Deferred from LEDG-03 (needs other lanes/phases): `POST /documents/{id}/edit-impact`, `document_revisions` on finalized edits and `PERIOD_LOCKED` (M05 filings, Phase 3); `ledger.rebuild_transaction` and migration 0042 FKs (P0-DB-08); `car_regime` answer effect (`organizations.settings.car`), auto-finalize after `ready` (03 §3 owner decision), M03 `post_categorize` checks wiring (P1-VAL-08: `postChecks` hook in 0319). Lane B enqueues `doc.categorize {trigger:'pipeline'}` when its read stage finishes; lane D's deck either calls `POST /api/review-questions/{id}/answer` or enqueues `doc.categorize` itself after writing an answer.

## Planned later (not written)

| Ticket | Scope | Depends on | Files |
|---|---|---|---|
| Phase 3 P3-VAT-01..12 | written: see Phase 3 below | 0311, 0310, 0325 | — |
| Phase 4 podklady | accountant workbook from both ledgers (`VAT_WORKBOOK`, income-tax summary), ZIP of evidence | 0325, Phase 3 | `apps/worker/src/podklady/*` |

Open items carried by TODOs in code: D-05 policy default (`issue_date` vs `service_period_end`), `categories.direction` two-valued vs `both`, `deduction_pct` semantics (0311), `validation.tol.sum` rule key for the tax-ledger remainder (0308), SH codes as a rule key, `XI` in `vat.eu_member_states`.

## Phase 3 VAT (briefs written, executor Haiku 5.5 unless noted)

| # | Brief | Depends on | Files (owned) |
|---|---|---|---|
| 0328 | Rule seeds: `vat.simple_period_policy`, `return_rounding`, `shv_rounding`, `amendment_windows`, `epo.forms` | — | `rules/cz/vat-phase3.ts`, `cz/2025.ts`, `cz/2026.ts`, `test/rules-values.test.ts` |
| 0329 | P3-VAT-01 `buildEpoHeader`, `missingVetaP`, `formaCode` | — | `domain/src/vat/header.ts`, `test/epo-header.test.ts` |
| 0330 | P3-VAT-02 `vatDueDate`, `vatObligationsFor` | 0328 | `domain/src/vat/{period,obligations}.ts`, `test/vat-obligations.test.ts` |
| 0331 | P3-VAT-03a `classifyPeriod` core + needs_accountant checks | 0328 | `domain/src/vat/{classify-period,checks-accountant}.ts`, `test/classify-period.test.ts` |
| 0332 | P3-VAT-03b not_ready checks | 0331 | `domain/src/vat/checks-ready.ts`, `classify-period.ts` (edit), `test/classify-period-ready.test.ts` |
| 0333 | P3-VAT-04 `computeDphdp3` (golden 13 700 / 2 877) | 0328 | `domain/src/vat/dphdp3.ts`, `test/dphdp3.test.ts` |
| 0334 | P3-VAT-05a `computeKh`, `computeShv` | 0333 | `domain/src/vat/{kh,shv}.ts`, `test/kh.test.ts` |
| 0335 | P3-VAT-05b `reconcileKhDp3` + P1–P8 property tests | 0334 | `domain/src/vat/reconcile.ts`, `test/kh-dp3.property.test.ts` |
| 0336 | P3-VAT-06a tax-xml core: writer, form rules, `validateXml`, manifests | — | `tax-xml/src/{xml,forms,validate}.ts`, `xsd/*/manifest.json`, `test/validate.test.ts` |
| 0337 | P3-VAT-06b `ops.drift_monitors` + runbook | 0328, 0336 | `pipeline/src/jobs.ts`, `worker/src/jobs/ops/drift-monitors.ts`, `worker/src/main.ts`, `docs/runbooks/epo-version-bump.md` |
| 0338 | P3-VAT-07 `serializeDphdp3` + 4 golden XML | 0329, 0333, 0336 | `tax-xml/src/dphdp3.ts`, `rules/cz/epo.ts` (derived rows), `testdata/golden-v1/expected/vat/dphdp3-*.xml` |
| 0339 | P3-VAT-08 `serializeKh`, `serializeShv` + golden + P9 | 0334, 0336, 0338 | `tax-xml/src/{kh,shv}.ts`, `expected/vat/dph{kh1,shv}-payer-2026-09.xml` |
| 0340 | Migration 0043 filings tables + RLS + factories | — | `db/migrations/0043_filings.sql`, journal, `testkit/factories/filings.ts`, `db/test/migrations/filings.db.test.ts` |
| 0341 | Migration 0044 obligations (column-limited user update) | 0340 | `db/migrations/0044_obligations.sql`, journal, factories, `db/test/migrations/obligations.db.test.ts` |
| 0342 | Drizzle mirrors | 0340, 0341 | `db/src/schema/{filings,obligations}.ts` |
| 0343 | P3-VAT-09a filing I/O + M05 job defs | 0342, 0330 | `db/src/filings.ts`, `pipeline/src/jobs.ts`, `db/test/filings.db.test.ts` |
| 0344 | P3-VAT-09b `vat.period.evaluate`, `vat.filing.generate` (**Sonnet 5.5**) | 0332, 0335, 0338, 0339, 0343 | `worker/src/vat/{map,service,register}.ts`, `worker/src/main.ts`, `worker/src/ledger/handler.ts` (hook), `worker/test/filing-lifecycle.test.ts` |
| 0345 | P3-VAT-09c routes: filing, download (409), mark-filed | 0343, 0344 | `web/src/vat/filings.ts`, `web/app/api/v1/filings/[id]/**`, `web/test/vat-filings.test.ts` |
| 0346 | P3-VAT-09d imported own return + match | 0343, 0344 | `domain/src/vat/imported.ts`, `worker/src/vat/imported.ts`, tests |
| 0347 | P3-VAT-10a `diffFilings`, `chooseAmendmentKind` | 0330, 0333 | `domain/src/vat/amend.ts`, `test/amendments.test.ts` |
| 0348 | P3-VAT-10b `vat.amendment.detect` | 0344, 0347 | `worker/src/vat/amendment-detect.ts`, `service.ts` (refactor), `db/src/filings.ts` (edit) |
| 0349 | P3-VAT-11a `buildPeriodPreview` + `vat.row.*` labels (English) | 0334 | `domain/src/vat/preview.ts`, `i18n/messages/en.json` |
| 0350 | P3-VAT-11b VAT workbook XLSX + `vat.workbook.generate` | 0344, 0349 | `exports/src/{xlsx,vat-workbook}.ts`, `worker/src/vat/workbook.ts` |
| 0351 | P3-VAT-12 API: cards, preview, generate, workbook routes | 0345, 0349, 0350 | `web/src/vat/periods.ts`, `web/app/api/v1/vat/periods/**`, `db/src/filings.ts` (`entryRowToDraft`) |

Order and parallelism (merge each into the lane branch before its dependants start):

1. 0328, 0329, 0336, 0340 in parallel (disjoint).
2. 0330, 0331, 0333, 0337, 0341, 0347 in parallel (0330/0331/0333 append one line each to `domain/src/index.ts`: keep all; 0337 and 0343 both append to `pipeline/src/jobs.ts`: 0337 first).
3. 0332, 0334, 0338, 0342 in parallel; then 0335, 0339, 0343, 0349 in parallel.
4. 0344 alone (Sonnet), then 0345, 0346, 0348, 0350 in parallel (0346 and 0348 both touch `worker/src/vat/service.ts`: 0348 first, then 0346 rebases), then 0351.

Phase 3 facts the briefs fix (report them in the gate): no official XSD in the repo (owner downloads; filings stay `draft`/unvalidated until then, `TODO(decision-xsd)`); derived DPHDP3 attrs 44/46/62–66 `confirmed:false`; Cloudflare is an October entry under `issue_date` (M05 §9 #2 says September); English labels/sheets (rule 6) against M05's Czech; `obligations` rows are written by lane C until M09's generator exists; MFA, preview PDF and all screens are lane D / owner decisions.
