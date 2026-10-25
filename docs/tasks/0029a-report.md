# 0029a report

Status: review
Branch: task/0029-db-documents-core (off origin/phase/0 at 6de69cf)

## 1. Files changed (`git diff --stat origin/phase/0`)

- `docs/v3/05-data-model.md` (+2, §10.1 comment lines)
- `packages/db/migrations/0005_documents_core.sql` (+190, new)
- `packages/db/migrations/meta/_journal.json` (+7, entry 4)
- `packages/testkit/src/factories/documents.ts` (+95, new)
- `packages/testkit/src/factories/index.ts` (+13 -2)

Commits: `0029a step 1` (31e7504), `0029a step 2` (8bdd1a3), `0029a steps 3-4` (c4a3727), step 5 with this report (see branch head). Steps 3 and 4 were combined into one commit.

## 2. Commands (last lines)

- `grep -c "^select app.apply_tenant_rls" packages/db/migrations/0005_documents_core.sql` → `6`
- `pnpm --filter @shoebox/testkit typecheck` → `tsc -p tsconfig.json` (exit 0)
- `pnpm --filter @shoebox/testkit test` → `Tests  85 passed (85)`
- `pnpm exec biome ci packages/db packages/testkit` → `Checked 55 files in 2ms. No fixes applied.` (no errors)
- `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test` → `Test Files  9 passed (9)`, `Tests  79 passed (79)`
- Acceptance spot check: `pg_tables` public count → `16`; `ingest_items` policies → `ingest_items_select`, `ingest_items_worker` (no `_write`)
- `python3 scripts/context_lint.py` → `context lint: OK` (warning only: 4 commits touched apps/packages after last status.md update; orchestrator's job)

Not run: the §6 `pnpm --filter @shoebox/db test` without DATABASE_URL, and a `drizzle-kit migrate` second-run check (not in the brief's step commands; the db suite ran against the migrated database).

## 3. §7 ticked

- [x] 16 public tables; `ingest_items` policies correct (drizzle `__drizzle_migrations` count not checked)
- [x] meta, isolation, roles, worker suites green (db suite 79/79 with DATABASE_URL)
- [x] `tenantFactories` registration (33-line index.ts; documentFactories spread into the loop)
- [x] `apply_tenant_rls_read_only` present in 05 §10.1
- [ ] index names in `pg_indexes` not individually queried

## 4. Deviations

- None in code. Step 1 has no separate command in the brief; verified with the grep in its "Command" line.
- Sandbox Postgres started with `local-pg.sh start` (no root error).

## 5. Questions

- None.

## 6. Owner steps left

- None.
