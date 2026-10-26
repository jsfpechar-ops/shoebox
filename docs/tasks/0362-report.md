# 0362 report

Status: review (orchestrator: worker RLS test replaces the seeded row for one-row-per-org tables inside its rolled-back transaction)
Commit: ac40c1c (branch wt-0362, not pushed)

## Files changed
packages/db/migrations/0045_tax_reserve.sql (new), packages/db/migrations/meta/_journal.json, packages/db/src/schema/reserve.ts (new), packages/db/src/schema/index.ts, packages/db/src/rls-catalog.ts, packages/testkit/src/factories/reserve.ts (new), packages/testkit/src/factories/index.ts, packages/db/test/migrations/tax-reserve.db.test.ts (new), docs/v3/05-data-model.md (§7 block).

## Checks
- drizzle-kit migrate on wt0362: applied.
- `vitest run test/migrations/tax-reserve.db.test.ts`: 4 passed.
- `vitest run test/migrations/tenancy.db.test.ts`: 9 passed.
- `vitest run test/rls`: 24 passed, 4 failed. 3 are storage.db.test.ts (known local failure). 1 is worker.db.test.ts: "with app.org_id = A an insert for org B raises 42501 and an insert for A succeeds", for tax_reserve_estimates: insert for org A as worker of A gets 23505 (expected null).
- `pnpm --filter @shoebox/db typecheck` and testkit typecheck: clean.
- `biome check --write` on changed TS files: clean.

## Deviations
- Blocker: the brief's design makes `org_id` the primary key (one row per org). seedTenants in test/rls/helpers.ts inserts one factory row per tenant table per org, and the generic worker test then inserts a second row for org A, which collides on the primary key. No existing tenant table is one-row-per-org, so the generic test has never covered this shape. Every one-row-per-org design (including `id` pk + unique org_id) collides the same way. Options for the owner: (a) composite key (org_id, as_of) with the factory varying as_of by ctx.ids, plus a 05 edit; (b) an exception in the RLS worker test for org-unique tables; (c) another design. I did not edit the RLS suite or change the spec key.
- Used `app.apply_tenant_rls_read_only` (not `apply_tenant_rls` as the brief's SQL shows). It is the 0041/0043 convention for select-only tables.
- Journal entry idx 20, when 1792993314573, tag 0045_tax_reserve.
- Read-only catalog entry appended at the end of READ_ONLY_FOR_USERS (the list is not sorted).

## Questions
Which option above should the executor take? The migration commit is left as is; I did not revert it.

## Owner steps left
None.
