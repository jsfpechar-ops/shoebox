# 0014c report: Supabase CLI (continuation 1)

Status: blocked
Done: steps 1 to 2 of 0014c-cont-1. Left: decision on `db.major_version` (see Deviations), then acceptance §7.

## Files changed

- Step 1 (commit 3139e94): `supabase/config.toml` (415 lines, `project_id = "shoebox"`, `major_version = 16`, `[db] port = 54322`), `supabase/.gitignore` (8 lines, unchanged from `supabase init`).
- Earlier 0014c steps (on branch): `package.json`, `pnpm-lock.yaml`, `.gitignore`.

## Commands (last lines)

- `pnpm exec supabase --version`: `2.119.0`
- grep config: `5:project_id = "shoebox"`, `41:major_version = 16`, `32:[db]`, `34:port = 54322`
- `pnpm lint`: `Checked 156 files in 4s. No fixes applied.` / `Found 1 info.` (biome config-migration hint)
- `pnpm --filter @shoebox/db test`: `Tests 28 passed | 9 skipped (37)`
- `pnpm typecheck`: `Tasks: 16 successful, 16 total`
- `pnpm db:start`: `{"_tag":"Error","error":{"code":"StartInvalidConfigError","message":"Failed reading config: Invalid db.major_version: 16."}}`

## §7 acceptance

- [x] `supabase/config.toml` exists with `project_id = "shoebox"`; `supabase/.temp/` ignored
- [x] Root scripts `db:start`, `db:reset`, `db:migrate`, `test:db` present (0014c steps 1 to 2)
- [ ] `pnpm db:start` works: BLOCKED by the config value below
- [x] `supabase --version` 2.119.0; lint and typecheck pass

## Deviations / STOP

- STOP: CLI 2.119.0 rejects `major_version = 16` at config read ("Invalid db.major_version: 16"), before any Docker call. The brief's value cannot run. I did not change it: the CLI default is 17, which breaks rules.md (Postgres 16), and the accepted list was not verified.

## Questions

- Which Postgres majors does CLI 2.119.0 accept for local `db.major_version`, and is there a Postgres-16-compatible way (other CLI version or a local Postgres 16 for tests)? Decide before `config.toml` is final.

## Owner steps left

- None until the orchestrator decides the version. Then owner runs `pnpm db:start`, `pnpm db:reset`, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db`.

## fix-2

Status: review (Postgres 17, owner decision 2026-10-18).

- Merge: `origin/phase/0` merged into `fix14c` (merge commit `8aeb83c`), no conflicts. `pnpm install --frozen-lockfile` succeeded; `pnpm-lock.yaml` not regenerated.
- Config: `supabase/config.toml` `major_version = 16` changed to `17` (commit `4a0f45e`, `0014c-fix-2 step 2`).
- Grep: `5:project_id = "shoebox"`, `41:major_version = 17`.
- `pnpm exec supabase db start`: `{"_tag":"Error","error":{"code":"LocalDbRunningError","message":"failed to inspect service: failed to connect to the docker API at unix:///var/run/docker.sock ... no such file or directory"}}`. Fails on Docker only, no `major_version` error.
- `git diff --stat` for step 2: `supabase/config.toml | 2 +-`.
- `pnpm lint` (last lines): `Test Files 3 passed (3)`, `Tests 24 passed (24)`.
- `python3 scripts/context_lint.py`: `context lint: OK`, plus WARN: 22 commits touched apps/ or packages/ after the last status.md update (orchestrator to update status at review).
