# 0341 report

Status: review

Both open points were settled by the coordinator and applied: the roles test has a separate update expectation for USER_UPDATE_ONLY tables, and obligationFactory derives period_start and period_end from the id counter as filingFactory does.

## Files changed
- `packages/db/migrations/0044_obligations.sql` (new): DDL, `apply_tenant_rls_read_only`, `obligations_user_update` policy, security definer trigger `app.obligations_user_columns`.
- `packages/db/migrations/meta/_journal.json`: entry `0044_obligations` (idx 19).
- `packages/db/src/rls-catalog.ts`: new `USER_UPDATE_ONLY = ['obligations']` (brief §2 conditional edit).
- `packages/db/test/rls/roles.db.test.ts`: USER_UPDATE_ONLY tables expect update for owner and member, and insert and delete denied. Other tables unchanged.
- `packages/db/test/rls/helpers.ts`: audit accepts select + update for `USER_UPDATE_ONLY` (brief §2 edit; the audit lives here, not in meta.db.test.ts).
- `packages/testkit/src/factories/filings.ts`: `obligationFactory`, registered in `filingFactories`.
- `packages/db/test/migrations/obligations.db.test.ts` (new).

## Checks
- `obligations`, `tenancy`, `test/rls`: 37 passed, 3 failed. All 3 are `storage.db.test.ts` (known local failure).
- `db` and `testkit` typecheck: clean. Biome: clean.

## Deviations
- Trigger is `security definer set search_path = public`, as `app.user_has_role` is. Without it, app_worker hit "permission denied for schema auth" on every obligations update.
- Test "member marks done": the brief's version reads the row after `asUser`, which rolls back. The update and the check now run in one transaction.
- The factory keeps the brief's due and legal dates (2026-09-25) for every month, so the due date is not after the period for later ids. Only period_start and period_end follow the id.
- The trigger compares `updated_at` too, so a user update must not change it.

## Questions
None open.

## Owner steps left
None. Migration 0044 is not applied to any shared database.
