# 0341 report

Status: blocked

Reason: two RLS suite cases fail because of obligations, and fixing them needs changes the brief does not name (brief §8 stop rule).

## Files changed
- `packages/db/migrations/0044_obligations.sql` (new): DDL, `apply_tenant_rls_read_only`, `obligations_user_update` policy, security definer trigger `app.obligations_user_columns`.
- `packages/db/migrations/meta/_journal.json`: entry `0044_obligations` (idx 19).
- `packages/db/src/rls-catalog.ts`: new `USER_UPDATE_ONLY = ['obligations']` (brief §2 conditional edit).
- `packages/db/test/rls/helpers.ts`: audit accepts select + update for `USER_UPDATE_ONLY` (brief §2 edit; the audit lives here, not in meta.db.test.ts).
- `packages/testkit/src/factories/filings.ts`: `obligationFactory`, registered in `filingFactories`.
- `packages/db/test/migrations/obligations.db.test.ts` (new).

## Checks
- `obligations.db.test.ts`, `rls/meta.db.test.ts`: 11 passed.
- `db` and `testkit` typecheck: clean. Biome: clean.
- Full RLS run (`migrations/obligations`, `migrations/tenancy`, `test/rls`): 35 passed, 5 failed:
  - `roles.db.test.ts` "owner and member insert, update and delete": `obligations: insert as owner` gets 42501, expected success. `mayWrite` (roles test) treats every non-read-only table as writable. Obligations needs insert/delete false but update true for owner and member, so the test needs a separate update check.
  - `worker.db.test.ts` "insert for org A": `23505`. The brief's fixed factory values (`period_start 2026-08-01`) collide with the fixture row. The filings factory avoids this with a per-id month (`monthOf`).
  - `storage.db.test.ts` (3): known local failure.

## Deviations
- Trigger is `security definer set search_path = public`, as `app.user_has_role` is. Without it, app_worker hit "permission denied for schema auth" on every obligations update.
- Test "member marks done": the brief's version reads the row after `asUser`, which rolls back. The update and the check now run in one transaction.
- The trigger compares `updated_at` too, so a user update must not change it.

## Questions
1. Roles test: may I add a separate `mayUpdate` for `USER_UPDATE_ONLY` tables (insert and delete false for users)?
2. Factory: may `obligationFactory` derive `period_start` from the id counter, as `filingFactory` does?

## Owner steps left
None. Migration 0044 is not applied to any shared database.
