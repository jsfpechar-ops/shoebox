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

## Planned later (not written)

| Ticket | Scope | Depends on | Files |
|---|---|---|---|
| P1-CAT-03 LLM categorizer | prompt builder, zod output schema, `applyLlmSuggestion` (pure); the worker call itself stays behind the M12 LLM gateway | 0303 | `domain/src/taxonomy/llm.ts`, `testkit` few-shots (8 golden) |
| P1-CAT-04 categorize stage | worker job `document.categorize`: load lines, run cascade → LLM → deterministic checks (M03), write `document_lines.category_code/…`, create `review_questions` (04 §9.1 kinds), `max_questions_per_document` | 0303, CAT-03, lane B's validation write path | `apps/worker/src/categorize/*`, no domain changes |
| P1-CAT-05 vendor memory | `vendor_profiles` updates on confirm ("Vždy"), `vendor_memory_min_confirmations`, H5 similarity input | CAT-04 | `apps/worker/src/categorize/vendor-memory.ts` |
| P1-LEDG-03 rebuilds | jobs `ledger.rebuild_document` / `ledger.rebuild_org` (M04 §6.3 reasons), `build_version` from the sequence, delete+insert per document, triggers (finalize, revision, delete/restore, partner change, profile change, fx import) | 0308, 0311, 0313, 0314, P0-DB-08 (payment_links/transactions FKs, forward-only alter) | `apps/worker/src/ledger/*`, migration 0042 (FKs) |
| Přehled from ledgers | overview loader reads `tax_ledger_entries` (income/expense meters, tax-year totals) instead of document sums; keeps `overview/totals.ts` contracts | LEDG-03; lane D owns the screen, lane C the loader query | `apps/web/src/server/overview-ledger.ts` (query only) |
| Phase 3 P3-VAT-01..12 | `classifyPeriod`, `computeDphdp3/Kh/Shv`, `reconcileKhDp3`, row attrs `[verify]` against XSD (rows 40–50 `confirmed:false`), `epo.forms` versions, XML serializers (`packages/tax-xml`), filings tables (migration 0043+), obligations | 0311, 0310 | `domain/src/vat/*`, `packages/tax-xml`, migrations 0043–0046 |
| Phase 4 podklady | accountant workbook from both ledgers (`VAT_WORKBOOK`, income-tax summary), ZIP of evidence | LEDG-03, Phase 3 | `apps/worker/src/podklady/*` |

Open items carried by TODOs in code: D-05 policy default (`issue_date` vs `service_period_end`), `categories.direction` two-valued vs `both`, `deduction_pct` semantics (0311), `validation.tol.sum` rule key for the tax-ledger remainder (0308), SH codes as a rule key, `XI` in `vat.eu_member_states`.
