# 0061 report: create_firm() migration 0015

Status: review

## Files changed (my commit only)

- `packages/db/migrations/0015_onboarding.sql` (new): `app.crockford8()` and `public.create_firm(p jsonb)`, verbatim from brief §4 step 2.
- `packages/db/migrations/meta/_journal.json`: one entry, idx 8, tag `0015_onboarding`, when 1760745600008.
- `packages/db/test/migrations/onboarding.db.test.ts` (new): 10 tests, all pass.
- `docs/v3/05-data-model.md`: paragraph "Creating a firm (0015)" at the end of §2.
- `docs/tasks/0061-report.md` (this file).

## Commands (last lines)

- `pnpm --filter @shoebox/db test -- migrations rls` (fresh DB): `Test Files 16 passed (16)`, `Tests 122 passed (122)`.
- `pnpm exec tsx scripts/migration-lint.ts packages/db/migrations/0015_onboarding.sql`: `migration-lint: OK (1 file(s))`.
- `pnpm exec biome ci packages/db`: `Checked 35 files ... No fixes applied.`
- `python3 scripts/context_lint.py`: `context lint: OK` (warnings only: test-map and workflow reference `packages/domain/rules`, not created yet; 14 commits touched apps/packages since status.md).

## Section 7

- [x] §6 commands pass; onboarding test file has 10 passing tests.
- [x] Changed files are the §3 files plus this report.

## Deviations

- Brief §4 step 1 start and step 2 apply: the SQL applies through the migration runner. A direct `psql -f` into a bare DB failed with `schema "app" does not exist` because 0001–0008 were not applied; that was my mistake, not a SQL error.
- Biome: `biome check --write` on my own test file (formatting only).
- Test DB hygiene: I dropped and recreated the local `shoebox_test` database (not in the repo) after parallel and partial runs left it half-migrated.

## Re-run fix (orchestrator-approved deviation)

`tenancy.db.test.ts` resets the DB by dropping tables, schema `app`, enums and schema `drizzle`, but not functions in `public`. Before the fix, a second db-suite run on the same DB failed with `PostgresError: function "create_firm" already exists with same argument types` (code 42723, `seedTenants`, `test/rls/helpers.ts:369`). The fix stays inside §3: `0015_onboarding.sql` now uses `create or replace` for `public.create_firm` and `app.crockford8`, with a comment line saying why. Tenancy's reset is unchanged.

Two runs on the same DB after the fix, each `pnpm --filter @shoebox/db test -- migrations rls`: `Test Files 16 passed (16)`, `Tests 122 passed (122)` both times.

## Questions

None.

## Owner steps left

None.
