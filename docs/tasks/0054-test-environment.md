# 0054: Start command for the worker and a Render file for the test environment

Status: todo
Ticket: Phase 1 test environment (owner request 2026-10-25) | Depends on: 0053 merged into phase/0 | Base commit: 1e90c0d | Branch: claude/project-thread-2s0mp2 | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

The owner wants to try the Phase 1 core loop on a hosted test environment (Supabase Frankfurt + Render Frankfurt). The worker has no start command (its `src/main.ts` is TypeScript with extensionless imports, so plain `node` cannot run it), and Render has no file that creates the website and worker; this brief adds both.

## 2. Context

- Owner decision 2026-10-25 (in `docs/context/decisions.md`, written by the orchestrator): Render Frankfurt hosts the test environment; `tsx` is allowed as a runtime dependency of `@shoebox/worker`. Production stays on Cloud Run europe-west1.
- `tsx@4.23.15` is already in `pnpm-lock.yaml` (pulled in by drizzle-kit). Use exactly that version.
- Checked by the orchestrator: `node --import tsx apps/worker/src/main.ts` with unreachable database URLs gets as far as `ECONNREFUSED`, so every import resolves.
- `apps/worker/package.json` today:

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
```

- Environment the apps read (from the code): web needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `APP_URL`; worker needs `DATABASE_URL`, `WORKER_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, optional `SHOEBOX_LLM_MODEL`. `apps/web` `start` is `next start --port 3000`.
- Migrations: `pnpm db:migrate` (root script, runs drizzle-kit with `DATABASE_URL`). It runs as the worker's Render pre-deploy command.
- The existing `render.yaml` is the prototype; do not touch it. The new file lives at `deploy/render-test.yaml` and the owner points a Render Blueprint at that path.

## 3. Files

| Path | Action | What |
|---|---|---|
| `apps/worker/package.json` | edit | `start` script, `tsx` dependency |
| `pnpm-lock.yaml` | regenerated | by `pnpm install` only |
| `deploy/render-test.yaml` | new | two Render services |

No other file may change.

## 4. Steps

1. `apps/worker/package.json`: replace the scripts block above with

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node --import tsx src/main.ts"
  },
```

and add `"tsx": "4.23.15"` to `"dependencies"` (keep the keys sorted). Run `npx --yes pnpm@10.28.0 install 2>&1 | tail -5`. Expected: success; `git diff --stat` shows only `apps/worker/package.json` and `pnpm-lock.yaml`.

2. Check the start command: `DATABASE_URL=postgresql://x:y@127.0.0.1:1/p WORKER_DATABASE_URL=postgresql://x:y@127.0.0.1:1/p timeout 30 npx --yes pnpm@10.28.0 --filter @shoebox/worker start 2>&1 | tail -8`. Expected: ends with `ECONNREFUSED` (no `ERR_MODULE_NOT_FOUND`, no `Unknown file extension`).

3. Create `deploy/render-test.yaml` with exactly this content:

```yaml
# Render blueprint for the Phase 1 test environment (owner decision 2026-10-25 [test-env]).
# Blueprint Path in Render: deploy/render-test.yaml. Production stays on Cloud Run europe-west1.
# Secrets (sync: false) are pasted in the Render dashboard, never committed.
services:
  - type: web
    name: shoebox-web
    runtime: node
    region: frankfurt
    plan: free
    branch: phase/0
    autoDeploy: true
    buildCommand: npx --yes pnpm@10.28.0 install --frozen-lockfile && npx --yes pnpm@10.28.0 --filter @shoebox/web build
    startCommand: npx --yes pnpm@10.28.0 --filter @shoebox/web start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: PORT
        value: "3000"
      - key: APP_ENV
        value: test
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: DATABASE_URL
        sync: false
      - key: APP_URL
        sync: false
  - type: worker
    name: shoebox-worker
    runtime: node
    region: frankfurt
    plan: starter
    branch: phase/0
    autoDeploy: true
    buildCommand: npx --yes pnpm@10.28.0 install --frozen-lockfile
    preDeployCommand: npx --yes pnpm@10.28.0 db:migrate
    startCommand: npx --yes pnpm@10.28.0 --filter @shoebox/worker start
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: APP_ENV
        value: test
      - key: SHOEBOX_LLM_PROVIDER
        value: anthropic
      - key: SHOEBOX_LLM_MODEL
        value: claude-haiku-5-5
      - key: DATABASE_URL
        sync: false
      - key: WORKER_DATABASE_URL
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
```

Check: `python3 -c "import yaml,sys; d=yaml.safe_load(open('deploy/render-test.yaml')); print([s['name'] for s in d['services']])" 2>&1 | tail -3`. Expected: `['shoebox-web', 'shoebox-worker']`.

4. `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/worker test 2>&1 | tail -30`. Expected: both pass.

## 5. Do not touch

`render.yaml`, every file under `apps/*/src`, `packages/`, migrations. Hard rules 4 (no secrets, EU only), 7 (no dependency beyond `tsx`), 8 (never push to `main`, never deploy).

## 6. Commands

As in §4 steps 1 to 4, then `python3 scripts/context_lint.py 2>&1 | tail -30`.

## 7. Acceptance

- [ ] `pnpm --filter @shoebox/worker start` with unreachable URLs ends in `ECONNREFUSED`.
- [ ] `deploy/render-test.yaml` parses and names two services.
- [ ] `git diff --stat origin/phase/0` lists only the files in §3 plus this brief and its report.

## 8. Stop and ask

As in the template: an excerpt not found, a test failing twice, 25 tool calls or about 50k tokens, any other dependency, any file outside §3, or anything that needs secrets, accounts or a deploy.

## 9. Report

Write `docs/tasks/0054-report.md` (600 tokens at most) and set `Status: review`: files changed (`git diff --stat`), each command with the last 5 lines of output, anything that surprised you.
