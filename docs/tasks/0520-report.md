# 0520 report: pipeline_events

Status: blocked

## Files changed
- `packages/db/migrations/0063_pipeline_events.sql` (new, step 1)
- `docs/tasks/0520-pipeline-events.md` (status line only)

## Commands
- `node scripts/migration-lint.ts packages/db/migrations/0063_pipeline_events.sql` → `migration-lint: OK (1 file(s))`
- Steps 2 to 12 and the test commands were not run (see Deviations).

## Deviations
Done: step 1. Left: steps 2 to 12.

Stopped at step 2 because the brief's premise does not match the repo. `packages/db/migrations/meta/_journal.json` has 21 entries and its last one is `0045_tax_reserve` (idx 20). The migration folder goes up to `0062_documents_many_per_page.sql`, so migrations 0046 to 0062 are not in the journal. `packages/db/src/migrate.ts` runs only journal entries. Step 2 says to append 0063 "after the last entry", which would make 0063 run without 0046 to 0062 and would not match how the rest of the migrations are tracked. I did not guess.

## Questions
1. Should the journal be fixed first (add entries 0046 to 0062 in order, then 0063), or is the journal intentionally stopped at 0045 and the other migrations are applied another way? Please confirm which before step 2.
2. The brief's step 3 imports `./document-details`, `./documents` and `./tenancy` and the step 7 test uses `entry_mode`. These were not checked because the run stopped first.

## Owner steps left
None until the question above is answered.
