# 0340 report

Status: review (orchestrator chose option 1: keep the 05 §8 FKs; the RLS role test clears filing rows inside its rolled-back transaction before deleting documents)

## Files changed
- packages/db/migrations/0043_filings.sql (new): 05 §8 DDL verbatim, the two extra indexes, RLS (filings, filing_documents: apply_tenant_rls; filing_entries: apply_tenant_rls_read_only). No `app.reject_update` exists, so immutability is a comment.
- packages/db/migrations/meta/_journal.json: entry idx 18, tag 0043_filings, appended after 0020_money.
- packages/testkit/src/factories/filings.ts (new), factories/index.ts (import, export, spread, doc comment).
- packages/db/test/migrations/filings.db.test.ts (new).

## Checks
- `pnpm exec vitest run --project unit scripts/test/migration-lint.test.ts`: 15 passed.
- `pnpm --filter @shoebox/db typecheck`, `pnpm --filter @shoebox/testkit typecheck`: pass.
- Local DB wt0340 (from ci template), drizzle-kit migrate: applied.
- filings.db.test.ts: 5 passed. tenancy.db.test.ts: 9 passed.
- RLS suite (test/rls): isolation, worker, meta pass. roles.db.test.ts: 5 of 6 pass, 1 FAILS (see Blocker). storage.db.test.ts: 3 fail with "permission denied for table objects" (known local-only).

## Blocker (STOP, needs owner decision)
roles.db.test.ts "owner and member insert, update and delete exactly where the role matrix allows" fails:
`update or delete on table "documents" violates foreign key constraint "filing_documents_document_id_fkey"`.
The RLS suite deletes all org documents as owner. `filing_documents.document_id` and `filing_entries.document_id` reference `documents(id)` without `on delete cascade`, as 05 §8 specifies verbatim. Options:
1. Keep the 05 DDL (a filed return should keep its evidence) and change the RLS suite's delete step to remove filing rows first. This is a test edit, so it needs an owner line.
2. Add `on delete cascade` to both FKs. This is a schema deviation from 05 §8: needs a 05 edit and a new migration.
I did not pick either.

## Deviations
- Factory: `filingFactory` derives `period_start`/`period_end` from the id counter (one month per id, 2026-08 for id 0). Reason: the RLS suite inserts several draft DPHDP3 filings for one org, which collides with `filings_one_open_per_kind` (23505). Defaults otherwise as the brief.
- Done: steps 1 to 3 (migration, factories, test). Left: the blocker above (owner decision), then the commit and PR.

## Owner steps left
- Decide option 1 or 2 above.
