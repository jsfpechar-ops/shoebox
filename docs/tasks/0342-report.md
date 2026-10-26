# 0342 report

Status: review

## Files changed
- `packages/db/src/schema/filings.ts` (new): `filings`, `filingDocuments`, `filingEntries`
- `packages/db/src/schema/obligations.ts` (new): `obligations`
- `packages/db/src/schema/index.ts`: added `./filings` and `./obligations` exports

## Checks
- `pnpm --filter @shoebox/db typecheck`: clean, 0 errors
- `pnpm --filter @shoebox/db exec vitest run test/enums-parity.test.ts`: 27 passed
- `pnpm --filter @shoebox/db exec vitest run test/migrations/filings.db.test.ts` (plus the obligations DB test matched by the pattern): 8 passed, against a local DB after `drizzle-kit migrate`
- `pnpm exec biome check --write` on the 3 changed files: fixed formatting only
- Column parity: 62 columns in the SQL for `filings` (26), `filing_documents` (4), `filing_entries` (14), `obligations` (18) match the 62 Drizzle column names one to one

## Acceptance
- [x] Typecheck clean
- [x] Column names match 0043/0044 one to one

## Deviations
- Brief §2 names the 0340/0341 DDL but not the file; I read `packages/db/migrations/0043_filings.sql` and `0044_obligations.sql` (the source of the columns).
- Biome reformatted the new files (formatting only).
- Commit is one commit with the brief's message, not per step.

## Questions
None.

## Owner steps
None.
