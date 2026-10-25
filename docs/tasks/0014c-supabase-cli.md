# 0014c: Supabase CLI, `supabase/config.toml` and the root db scripts

Status: blocked
Ticket: P0-DB-01 (part c of a/b/c) | Depends on: 0014b (same branch) | Base commit: head of task/0014-db-scaffold after 0014b | Branch: task/0014-db-scaffold | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the Supabase CLI as a root dev dependency, generate `supabase/config.toml` pinned to Postgres 16, and make the root scripts `db:start`, `db:reset`, `db:migrate`, `test:db` real. With this the owner (and later CI, P0-CI-02) can run `pnpm db:start && pnpm db:reset && pnpm test:db` on a machine with Docker.

## 2. Context

- Approved (decisions.md 2026-10-18 [deps]): "@supabase/ssr + Supabase CLI". The CLI is the npm package `supabase`; exact version `2.119.0` (published 2026-09-30). `pnpm-workspace.yaml` already lists `supabase` under `onlyBuiltDependencies`, so its postinstall (binary download) is allowed.
- rules.md Database: Postgres 16. `supabase init` writes `major_version = 17` by default; step 3 changes it to 16.
- Migrations live in `packages/db/migrations` and are applied by `drizzle-kit migrate` (0014a); Supabase's own `supabase/migrations` folder stays empty. `supabase db reset` recreates the local database (empty public schema), then `pnpm db:migrate` applies ours. The test `packages/db/test/migrations/tenancy.db.test.ts` (0014b) reads `DATABASE_URL`; local Supabase's URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Docker is not available in the executor sandbox: `supabase start` and `supabase db reset` cannot be run here. The executor verifies the CLI version, the config file and `pnpm lint`; the owner runs `db:start` once (Owner steps).
- `supabase init` is non-interactive when stdin is not a terminal (`< /dev/null`); it creates `supabase/config.toml` and a `supabase/.temp/` cache folder that must not be committed.

Current root `package.json` scripts and devDependencies (anchors for step 1):

```json
    "dev": "supabase start && turbo run dev --filter=@shoebox/web --filter=@shoebox/worker",
    "db:start": "supabase start",
    "db:reset": "supabase db reset",
```

```json
  "devDependencies": {
    "@biomejs/biome": "catalog:",
```

Current root `.gitignore` tail (anchor for step 2):

```
!.env.example
.DS_Store
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `package.json` | edit | `supabase` devDependency, `db:reset` + `db:migrate` scripts |
| `pnpm-lock.yaml` | edit (by `pnpm install`) | lockfile |
| `.gitignore` | edit | ignore `supabase/.temp/` |
| `supabase/config.toml` | create (generated) | Supabase local stack config, Postgres 16 |

No other file may change.

## 4. Steps

Setup (once): `git fetch origin task/0014-db-scaffold && git checkout task/0014-db-scaffold && pnpm install --frozen-lockfile 2>&1 | tail -3`

Rules for every step: one Write or one Edit per file. Do not re-read a file you just wrote. Do not explore other files. After the step's command shows the expected result, commit: `git add -A && git commit -qm "0014c step k" && git log --oneline -1`. All commands run from the repo root.

### Step 1: edit `package.json` (root)

Replace the first anchor block (§2) with:

```json
    "dev": "supabase start && turbo run dev --filter=@shoebox/web --filter=@shoebox/worker",
    "db:start": "supabase start",
    "db:migrate": "pnpm --filter @shoebox/db migrate",
    "db:reset": "supabase db reset && pnpm db:migrate",
```

Replace the second anchor block with:

```json
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "supabase": "2.119.0",
```

Command: `pnpm install 2>&1 | tail -5` → `Done in …` (the postinstall downloads the CLI binary through the proxy; if it fails, retry once, then stop per §8). Then `pnpm exec supabase --version 2>&1 | tail -1` → `2.119.0`. Commit (includes `pnpm-lock.yaml`).

### Step 2: edit `.gitignore` (root)

After the anchor lines (§2) append:

```
supabase/.temp/
```

Command: `tail -2 .gitignore` → `.DS_Store` then `supabase/.temp/`. Commit.

### Step 3: create `supabase/config.toml` by running the CLI, then pin Postgres 16

Commands, in order:

```
pnpm exec supabase init < /dev/null 2>&1 | tail -2
sed -i 's/^project_id = .*/project_id = "shoebox"/; s/^major_version = 17$/major_version = 16/' supabase/config.toml
grep -n '^project_id\|^major_version\|^\[db\]' supabase/config.toml
git status --short | head -5
```

Expected: `Finished supabase init.`; the grep prints `project_id = "shoebox"`, `[db]` and `major_version = 16` (three lines); `git status` shows only `?? supabase/config.toml` (no `.temp`). If `supabase init` asks a question or refuses because `supabase/config.toml` exists, stop (§8). Commit.

## 5. Do not touch

`packages/**`, `apps/**`, `supabase/config.toml` beyond the two `sed` substitutions (the generated defaults are kept so `supabase start` works; tuning the stack is a later ticket), `pnpm-workspace.yaml`, `vitest.workspace.ts`, `turbo.json`, `.github/**`. Hard rules: 7 (only the `supabase` package), 8 (never push to `main`). Never run `supabase link`, `supabase login` or anything that touches a remote project (owner only).

## 6. Commands

```
pnpm exec supabase --version 2>&1 | tail -1                                   # 2.119.0
grep -n '^project_id\|^major_version' supabase/config.toml                    # project_id = "shoebox" / major_version = 16
pnpm lint 2>&1 | tail -30                                                     # No fixes applied
pnpm --filter @shoebox/db test 2>&1 | tail -30                                # 28 passed, 9 skipped (no DATABASE_URL)
pnpm typecheck 2>&1 | tail -30                                                # all packages pass
pnpm db:start 2>&1 | tail -3                                                  # NOT runnable here (no Docker); expected error mentions docker. Record it, do not retry.
```

Agent-context row: none of `docs/context/` changes in this brief.

## 7. Acceptance

- [ ] `supabase/config.toml` exists with `major_version = 16` and `project_id = "shoebox"`; `supabase/.temp/` is ignored.
- [ ] Root scripts `db:start` (`supabase start`), `db:reset` (`supabase db reset && pnpm db:migrate`), `db:migrate`, `test:db` (`vitest run --project db`, already present) exist in `package.json`.
- [ ] `pnpm exec supabase --version` prints `2.119.0`; `pnpm lint` and `pnpm typecheck` pass.
- Not verifiable in the sandbox (no Docker): `pnpm db:start`, `pnpm db:reset`, `pnpm test:db` against local Supabase. Owner step 1 covers it; P0-CI-02 automates it. The same test passed against a plain Postgres 16 in 0014b.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- `pnpm install` fails twice (binary download through the proxy);
- `supabase init` does not finish non-interactively, or writes anything other than `supabase/config.toml` and `supabase/.temp/`;
- a file outside §3 needs a change;
- §5 would be touched;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`);
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0014c-report.md` (600 tokens at most) and set `Status: review`. Then `git push origin task/0014-db-scaffold 2>&1 | tail -3`. The orchestrator opens one PR `task/0014-db-scaffold → phase/0` covering 0014a/b/c. The report has:

1. The files changed (`git diff --stat origin/phase/0 | tail -25`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

- `package.json`: only `supabase` added; `db:reset` must call `pnpm db:migrate` after `supabase db reset` or the local database stays empty.
- `supabase/config.toml`: generated file (about 415 lines). Review only the diff of the two edited keys and that `[db] port = 54322` (the URL in drizzle.config.ts and in 0014b's test comment). Everything else is the CLI default and is tuned when the auth/storage tickets arrive (M12).
- `pnpm-lock.yaml`: the `supabase` package adds a few transitive packages (`bin-links`, `tar`, …); nothing else should change.

## Owner steps

1. On your machine with Docker running, in the repo on branch `task/0014-db-scaffold` (or `phase/0` after the merge): run `pnpm install`, then `pnpm db:start` (first run downloads the Supabase images, several minutes). It prints the local URLs.
2. Run `pnpm db:reset` (recreates the local database and applies `packages/db/migrations`), then `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db`. Expected: `Tests  9 passed (9)`. If it fails, paste the last 30 lines to the orchestrator.
3. `pnpm exec supabase stop` when done. Nothing was linked to a remote Supabase project; that happens in the deploy tickets.
