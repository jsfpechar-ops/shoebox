# 0363 report

Status: review. Branch wt-0363.

Files: packages/db/src/podklady.ts (new), packages/db/src/index.ts, packages/db/src/filings.ts (optional `inputs`), packages/db/test/podklady.db.test.ts (new).

Checks: podklady.db.test.ts 8/8, filings.db.test.ts 4/4, typecheck db/domain/worker clean, biome clean.

transactions columns used (0020_money.sql): org_id, category_code, booked_on, amount, match_state (id for ordering).

Deviations:
- filings.ts: added optional `inputs` to FilingInsert (authorized); `entries: []` passed.
- No Drizzle table for `transactions`: read with raw `sql` (no schema or migration change).
- `simple_check` is NOT NULL, so `{}` instead of the brief's `null`.
- `totals` stored = caller totals + ledgerHash + answersVersion.
- `deduction_allowed` is not a column: vatDeducted = profile at (vat_point_date ?? issue_date) is `platce` (same rule as worker ledger build).
- ledgerHash hashes the year's tax_ledger_entries (documentId, build_version) via ledgerHashOf; entries without a document are skipped in the hash and in the filing_documents snapshot.
- documentsFinalizedAfterBuild = 0, TODO(ledger-stale) (no build timestamp).
- car_regime answer shape assumed `{answer, businessSharePct}` (no writer exists yet).
- personal document amount = total_gross; partial-share totalCzk = line gross (no FX conversion).
- Entries with null document_id map to documentId ''.
