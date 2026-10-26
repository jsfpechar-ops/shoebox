# 0343 report

Status: review

## Files changed

- `packages/pipeline/src/jobs.ts`: four M05 job definitions (`vat.period.evaluate`, `vat.filing.generate`, `vat.workbook.generate`, `vat.amendment.detect`) with payload schemas and types.
- `packages/pipeline/test/jobs.test.ts`: imports and one `describe('M05 VAT jobs')` block.
- `packages/db/src/filings.ts` (new): all functions and interfaces from the brief.
- `packages/db/src/index.ts`: `export * from './filings';`
- `packages/db/test/filings.db.test.ts` (new): four DB cases.

## Commands

- `pnpm --filter @shoebox/pipeline exec vitest run test/jobs.test.ts`: `Tests 20 passed (20)`
- `pnpm --filter @shoebox/pipeline typecheck`: clean
- `pnpm --filter @shoebox/db exec vitest run test/filings.db.test.ts` (DB on 127.0.0.1:54322, db `wt0343`, migrated): `Tests 4 passed (4)`
- `pnpm --filter @shoebox/db typecheck`: clean
- `pnpm exec biome check --write <changed paths>`: clean after write

## Acceptance (§7)

- [x] Four job definitions validate the M05 payloads (one `it` added to `jobs.test.ts`).
- [x] db tests green; typecheck clean.

## Deviations

- `readFilingEntries` returns `FilingEntryRow[]`, a subset type matching the `filing_entries` snapshot columns. The brief's `PeriodEntryRow[]` cannot be satisfied: the snapshot table has no `periodStart`, `periodEnd`, `buildVersion` or FX columns.
- The brief's `ledgers.db.test.ts` does not exist. The test follows the setup pattern of `ledger-rebuild.db.test.ts` instead.
- `vatIdValid` is `null` with `TODO(P1-REG)`, as the brief says (no VIES column).
- `markFilingFiled` does not complete obligations. The caller uses `completeObligation`, because the mark-filed signature carries no obligation kind and `upsertVatObligations` never sets `filing_id`.
- `insertFiling` writes on the transaction it receives; the caller must pass a transaction.

## Questions

- Should `readFilingEntries` return the snapshot subset (as built) or should the snapshot table gain period and FX columns? The answer decides the 0344 read path.

## Owner steps left

None.
