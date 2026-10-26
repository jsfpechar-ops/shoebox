# 0362: Migration 0045 `tax_reserve_estimates` + RLS + Drizzle + 05 edit

Status: todo
Ticket: P4-POD-03 (storage of the cached estimate) | Depends on: — | Branch: claude/project-thread-uzgfn4 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 16 tool calls, 45k tokens

## 1. Objective

One small table that caches the dashboard tax-reserve estimate per org (M06 §4.11: "computed on request, cached per org", recomputed by `podklady.reserve.refresh`). Users read it; only the worker writes it. Rule 3: RLS policies and an RLS test in the same PR. Rule 5: a schema change is a new migration plus a 05 edit.

## 2. Context

Lane C owns migrations 0040–0049; 0042 is reserved, 0043/0044 exist. Conventions: look at `packages/db/migrations/0044_obligations.sql` for the file shape (`create table` + `select app.apply_tenant_rls('…')` + comments), `packages/db/migrations/meta/_journal.json` for the journal entry, `packages/db/src/schema/obligations.ts` for the Drizzle mirror style and `packages/db/src/schema/index.ts` for the export line, `packages/db/src/rls-catalog.ts` `READ_ONLY_FOR_USERS` (tables users may only read: add the new one), and `packages/db/test/migrations/obligations.db.test.ts` for the test harness (`runMigrations`, tenant session, factories).

Table (05 §7 Ledgers gets it, since it is derived and rebuilt by a job):
```sql
-- 0045_tax_reserve: M06 §4.11 cached "how much to set aside" estimate; one row per org, worker-written.
create table tax_reserve_estimates (
  org_id uuid primary key references organizations(id) on delete cascade,
  as_of date not null,                                              -- Europe/Prague date the estimate is for
  tax_year smallint not null,
  kind text not null check (kind in ('estimate','pausalni_dan')),
  payload jsonb not null default '{}',                              -- TaxReserveEstimate | PausalniDanReserve, Money as decimal strings
  ledger_hash text,                                                 -- hash of the entries used (M04 build_version), for debouncing
  computed_at timestamptz not null default now()
);
select app.apply_tenant_rls('tax_reserve_estimates');
-- users: select only (05 §10.2); the worker role writes.
```
If `app.apply_tenant_rls` grants users insert/update by default, add the explicit revoke/policy the way `0041_ledgers.sql` does for `tax_ledger_entries` (open that file for the exact statements; copy them, do not invent).

05 edit: append a `tax_reserve_estimates` block at the end of §7 (before `## 8. Outputs`) with the DDL above and one sentence of purpose.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/db/migrations/0045_tax_reserve.sql` | create | DDL above |
| `packages/db/migrations/meta/_journal.json` | edit | next entry (copy the 0044 entry's shape, idx + 1, tag `0045_tax_reserve`) |
| `packages/db/src/schema/reserve.ts` | create | `taxReserveEstimates` pgTable mirror |
| `packages/db/src/schema/index.ts` | edit | `export * from './reserve';` |
| `packages/db/src/rls-catalog.ts` | edit | add `'tax_reserve_estimates'` to `READ_ONLY_FOR_USERS` (alphabetical) |
| `packages/testkit/src/factories/reserve.ts` + `factories/index.ts` | create/edit | `taxReserveEstimateFactory` (`org_id`, `as_of '2026-09-30'`, `tax_year 2026`, `kind 'estimate'`, `payload {}`) |
| `packages/db/test/migrations/tax-reserve.db.test.ts` | create | below |
| `docs/v3/05-data-model.md` | edit | §7 block |

## 4. Steps

1. Migration + journal. Command: `pnpm --filter @shoebox/db migrate:local 2>&1 | tail -30` (or the script the 0044 brief/test uses; read `packages/db/package.json` scripts).
2. Drizzle mirror + index export + rls-catalog. `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`.
3. Factory (same shape as `obligationFactory` in `testkit/src/factories/filings.ts` or wherever 0341 put it; grep `obligationFactory`).
4. Test (follow the harness of `obligations.db.test.ts` exactly for connection, migration and the two orgs):
```ts
describe('0045 tax_reserve_estimates', () => {
  it('worker inserts; org A user reads its own row only; org B sees nothing', …);           // RLS select
  it('a user session cannot insert or update (insufficient_privilege or RLS violation)', …); // READ_ONLY_FOR_USERS
  it('kind outside (estimate, pausalni_dan) is rejected by the check', …);
  it('deleting the organization cascades the row', …);
});
```
Command: `pnpm --filter @shoebox/db test -- tax-reserve 2>&1 | tail -30`. Also the catalog test that checks every tenant table has RLS (`pnpm --filter @shoebox/db test -- rls 2>&1 | tail -30`).
5. 05 edit.
6. Commit `feat(db): migration 0045 tax_reserve_estimates (0362)`.

## 5. Do not touch

Other migrations, `apps/`, `packages/domain`.

## 6. Commands

`pnpm --filter @shoebox/db test -- tax-reserve 2>&1 | tail -30` · `pnpm --filter @shoebox/db test -- rls 2>&1 | tail -30` · `pnpm --filter @shoebox/db typecheck 2>&1 | tail -30`

## 7. Acceptance

- [ ] Migration applies on the local Postgres (K-P03: PG16 locally, 17 in CI); RLS test green; the table is in 05 §7.

## 8. Stop and ask

TEMPLATE §8. Stop if the local database is not available (report `Status: blocked`, the orchestrator runs it in CI).

## 9. Report

`docs/tasks/0362-report.md`.

## Risk list

RLS (rule 3).

## Owner steps

None.
