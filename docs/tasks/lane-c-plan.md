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
| Phase 3 P3-VAT-01..12 | `classifyPeriod`, `computeDphdp3/Kh/Shv`, `reconcileKhDp3`, row attrs `[verify]` against XSD (rows 40–50 `confirmed:false`), `epo.forms` versions, XML serializers (`packages/tax-xml`), filings tables (migration 0043+), obligations, edit-impact | 0311, 0310, 0325 | `domain/src/vat/*`, `packages/tax-xml`, migrations 0043–0046 |
| Phase 4 podklady | accountant workbook from both ledgers (`VAT_WORKBOOK`, income-tax summary), ZIP of evidence | 0325, Phase 3 | `apps/worker/src/podklady/*` |

Open items carried by TODOs in code: D-05 policy default (`issue_date` vs `service_period_end`), `categories.direction` two-valued vs `both`, `deduction_pct` semantics (0311), `validation.tol.sum` rule key for the tax-ledger remainder (0308), SH codes as a rule key, `XI` in `vat.eu_member_states`.
