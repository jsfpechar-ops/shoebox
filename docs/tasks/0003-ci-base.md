# 0003: CI base workflow and context-lint job

Status: done
Ticket: P0-CI-01 | Depends on: none (P0-REPO-01 merged) | Base commit: head of phase/0 | Branch: task/0003-ci-base | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add a GitHub Actions workflow that runs install, lint, typecheck, unit tests with coverage gates and the agent-context lint on every PR to `main` or `phase/**` and on every push to those branches. This stops broken code, falling coverage on money and tax packages, and broken agent context from being merged.

## 2. Context

Spec, M12 §4.3 CI/CD (GitHub Actions), steps 1–2 (pasted; only these parts are in scope):

> `ci.yml`; target wall time ≤ 12 min:
> 1. `setup`: checkout, Corepack pnpm, `pnpm install --frozen-lockfile` (cache by lockfile hash).
> 2. Parallel jobs: `lint` (`biome ci`, …), `typecheck`, `unit` (Vitest `unit` + `ui`, coverage gates: `packages/domain` ≥ 90 % lines, `packages/validation` ≥ 90 %, `packages/tax-xml` ≥ 85 %, others report-only).

Ticket acceptance (P0-CI-01): jobs `setup`, `lint`, `typecheck`, `unit`, `context-lint` (`python3 scripts/context_lint.py`); action versions pinned by digest (full 40-character commit SHA, version in a comment).

Orchestrator decisions for this brief:

- Triggers: `pull_request` and `push`, both on branches `main` and `phase/**`. No secrets are used. `permissions: contents: read`.
- Node 22 (root `engines` is `>=22 <23`); pnpm comes from Corepack, which reads the pinned `packageManager` in the root `package.json`. Do not install pnpm any other way.
- Jobs do not share `node_modules`, so a local composite action `.github/actions/setup/action.yml` does setup-node, Corepack, the pnpm store cache (key = hash of `pnpm-lock.yaml`) and the frozen install. The `setup` job runs it first and saves the cache; `lint`, `typecheck` and `unit` need `setup` and restore it. `context-lint` needs only Python and runs in parallel without setup.
- Coverage lives in the root `vitest.config.ts`: Vitest 4 reads `coverage` only from the root config, not from a project. `vitest.workspace.ts` (named in the ticket) only exports the `projects` list and stays unchanged.
- Coverage needs `@vitest/coverage-v8`, the Vitest coverage provider, same version as `vitest` (4.1.11). It is covered by the decisions line "Vitest for unit, db and ui test projects" (same vendor, required by the spec's coverage gates). Add it through the root catalog.
- Out of scope, later tickets: `depcruise` job (P0-REPO-02), `check:i18n` in `lint` (P0-I18N-01), `secrets` / gitleaks, `db`, `migration-lint` (P0-CI-02), `build`, `e2e`, `eval`, `preview`. Do not add them, not even as placeholders: the root scripts for them still `exit 1`.
- `turbo.json` has `"agentGuidance": false` and must stay as it is. CI sets `TURBO_TELEMETRY_DISABLED=1`.

Pinned action digests (checked by the orchestrator, all at least 14 days old):

| Action | Version | Commit SHA |
|---|---|---|
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7.0.0 | 820762786026740c76f36085b0efc47a31fe5020 |
| actions/cache | v6.1.0 | 55cc8345863c7cc4c66a329aec7e433d2d1c52a9 |

Existing excerpts (from P0-REPO-01; if one is not found verbatim, STOP, §8):

Root `vitest.config.ts` (whole file):

```ts
import { defineConfig } from 'vitest/config';
import { projects } from './vitest.workspace';

export default defineConfig({
  test: {
    projects,
  },
});
```

Root `package.json`, script anchor: `    "test:db": "vitest run --project db",` and devDependency anchor: `    "@types/node": "catalog:",`

`pnpm-workspace.yaml`, catalog anchor: `  '@types/node': 22.20.5`

## 3. Files

| Path | Action | What |
|---|---|---|
| `pnpm-workspace.yaml` | edit | catalog entry `@vitest/coverage-v8` |
| `package.json` | edit | script `test:unit`, devDependency `@vitest/coverage-v8` |
| `pnpm-lock.yaml` | regenerate | by `pnpm install` only |
| `vitest.config.ts` | edit | coverage provider, include, thresholds |
| `.github/actions/setup/action.yml` | new | composite: Node 22, Corepack, store cache, frozen install |
| `.github/workflows/ci.yml` | new | jobs setup, lint, typecheck, unit, context-lint |
| `docs/tasks/0003-report.md` | new | report |
| `docs/tasks/0003-ci-base.md` | edit | Status line only |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0003-ci-base origin/phase/0`. Commit after each step as `0003 step k`.

Work rules: write each new file with one Write call; do not re-read a file you just wrote; do not explore the repo; run only the command given in each step.

**Step 1. `pnpm-workspace.yaml`.** After the anchor line `  '@types/node': 22.20.5` insert one line:

```yaml
  '@vitest/coverage-v8': 4.1.11
```

Command: `grep -n "coverage-v8" pnpm-workspace.yaml 2>&1 | tail -3` → one line `'@vitest/coverage-v8': 4.1.11`.

**Step 2. `package.json`.** Two inserts, nothing else changes.

a) Before the anchor `    "test:db": "vitest run --project db",` insert:

```json
    "test:unit": "vitest run --project unit --project ui --coverage",
```

b) After the anchor `    "@types/node": "catalog:",` insert:

```json
    "@vitest/coverage-v8": "catalog:",
```

Command: `node -e "const p=require('./package.json');console.log(p.scripts['test:unit'],p.devDependencies['@vitest/coverage-v8'])" 2>&1 | tail -3` → `vitest run --project unit --project ui --coverage catalog:`

**Step 3. Install.** Command: `pnpm install 2>&1 | tail -15` → ends with `Done`, lists `+ @vitest/coverage-v8 4.1.11` under devDependencies, no `ERR_`. Commit `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` together. If pnpm reports a peer conflict with `vitest`, STOP (§8).

**Step 4. `vitest.config.ts`.** Replace the whole file with:

```ts
import { defineConfig } from 'vitest/config';
import { projects } from './vitest.workspace';

export default defineConfig({
  test: {
    projects,
    // Coverage is read only from the root config (M12 §4.3). Gated packages fail CI below
    // their line threshold; every other package is report-only.
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        'packages/domain/src/**': { lines: 90 },
        'packages/validation/src/**': { lines: 90 },
        'packages/tax-xml/src/**': { lines: 85 },
      },
    },
  },
});
```

Command: `pnpm test:unit 2>&1 | tail -30` → all test files pass (projects `unit` and `ui`), a `Coverage summary` block is printed, no line starting `ERROR: Coverage`.

**Step 5. `.github/actions/setup/action.yml`** (new, whole file):

```yaml
name: Setup workspace
description: Node 22, pnpm via Corepack, pnpm store cached by lockfile hash, frozen install.
runs:
  using: composite
  steps:
    - name: Node 22
      uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
      with:
        node-version: 22
        package-manager-cache: false
    - name: Enable Corepack (pnpm from packageManager)
      shell: bash
      run: corepack enable && pnpm --version
    - name: Locate pnpm store
      id: store
      shell: bash
      run: echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"
    - name: Cache pnpm store
      uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
      with:
        path: ${{ steps.store.outputs.path }}
        key: pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
        restore-keys: pnpm-store-${{ runner.os }}-
    - name: Install
      shell: bash
      run: pnpm install --frozen-lockfile
```

Command: `grep -cE 'uses: actions/[a-z-]+@[0-9a-f]{40} # v' .github/actions/setup/action.yml 2>&1 | tail -3` → `2`.

**Step 6. `.github/workflows/ci.yml`** (new, whole file):

```yaml
name: CI

on:
  pull_request:
    branches: [main, 'phase/**']
  push:
    branches: [main, 'phase/**']

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0'
  TURBO_TELEMETRY_DISABLED: '1'

jobs:
  setup:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup

  lint:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Biome
        run: pnpm lint

  typecheck:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Typecheck
        run: pnpm typecheck

  unit:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Unit and ui tests with coverage gates
        run: pnpm test:unit

  context-lint:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: Agent context lint
        run: python3 scripts/context_lint.py
```

`fetch-depth: 0` is needed because the lint reads git history for its staleness check.

Command: `grep -cE 'uses: actions/[a-z-]+@[0-9a-f]{40} # v' .github/workflows/ci.yml 2>&1 | tail -3` → `5`. Then `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]];print('yaml ok')" .github/workflows/ci.yml .github/actions/setup/action.yml 2>&1 | tail -3` → `yaml ok` (if it says `No module named 'yaml'`, note that in the report and go on; GitHub validates on push).

**Step 7. Local checks.** Run each command in §6 and copy the last 5 lines of each into the report. Nothing to commit unless a check fails; a failing check whose fix is outside §3 → STOP (§8).

**Step 8. Report.** §9.

## 5. Do not touch

- `turbo.json` (keep `"agentGuidance": false`), `vitest.workspace.ts`, `biome.json`, `tsconfig.base.json`, every file under `apps/` and `packages/`, `scripts/`, `AGENTS.md`, `docs/context/`.
- Do not run `pnpm` or `turbo` commands other than those in this brief (turbo must not rewrite `AGENTS.md`).
- Hard rule 7: no dependency other than `@vitest/coverage-v8`; no other GitHub action than the three pinned above.
- Hard rule 8: never push to `main`; no secrets in the workflow.

## 6. Commands

From the repo root:

1. `pnpm lint 2>&1 | tail -30` → `Checked … files`, no errors.
2. `pnpm typecheck 2>&1 | tail -30` → every `typecheck` task succeeds.
3. `pnpm test:unit 2>&1 | tail -30` → all pass, coverage summary, no `ERROR: Coverage`.
4. `python3 scripts/context_lint.py 2>&1 | tail -8` → `context lint: OK` (warnings allowed).
5. Broken-link proof (local, nothing is committed): `printf '\n[x](no-such-file.md)\n' >> docs/context/known-issues.md; python3 scripts/context_lint.py > cl.out 2>&1; echo "exit=$?"; tail -4 cl.out; rm cl.out; git checkout -- docs/context/known-issues.md` → `exit=1` and an error naming `no-such-file.md`. Then `git status --short 2>&1 | tail -5` → `docs/context/known-issues.md` is not listed.

## 7. Acceptance

- [ ] `.github/workflows/ci.yml` has jobs `setup`, `lint`, `typecheck`, `unit`, `context-lint` (`python3 scripts/context_lint.py`); every `uses: actions/…` is pinned by a 40-character SHA (step 5 and 6 greps return 2 and 5).
- [ ] Coverage thresholds configured in `vitest.config.ts`: `packages/domain` ≥ 90 %, `packages/validation` ≥ 90 %, `packages/tax-xml` ≥ 85 % lines; `pnpm test:unit` passes locally.
- [ ] A PR run is green; a test PR with a broken link in `docs/context/` fails `context-lint`. The executor cannot open PRs: it proves the lint fails locally (§6 command 5) and pushes the branch; the orchestrator opens the PR to `phase/0` (its CI run is the green run) and does the broken-link PR (Owner steps). Run links go in the review.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0003-report.md` (600 tokens at most) and set `Status: review` in this brief. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -12`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

Commit as `0003 report`, then `git push -u origin task/0003-ci-base 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `.github/workflows/ci.yml`: triggers (`main`, `phase/**`), `permissions: contents: read`, `persist-credentials: false`, every action pinned by SHA, no secrets.
- `.github/actions/setup/action.yml`: Corepack must pick pnpm from `packageManager`; an old Corepack in the runner's Node 22 can fail signature checks for new pnpm releases (if so: pin `node-version` to a newer 22.x, not a new install path).
- `vitest.config.ts`: thresholds are glob keys; check a gated package below its threshold really fails (the orchestrator can try it on a scratch branch). With today's one-line `src/index.ts` per package, coverage is 100 %.
- `pnpm-lock.yaml`: only `@vitest/coverage-v8` 4.1.11 and its own dependencies added.

## Owner steps

The orchestrator does 1–3; Josef only 4.

1. Open the PR `task/0003-ci-base` → `phase/0`. Wait for the "CI" checks: `setup`, `lint`, `typecheck`, `unit`, `context-lint` must all be green. Copy the run link into the review.
2. Broken-link proof on GitHub: from `task/0003-ci-base`, create branch `test/0003-broken-link`, add the line `[x](no-such-file.md)` to the end of `docs/context/known-issues.md`, commit, push, open a draft PR to `phase/0`. Check that `context-lint` is red. Copy the run link into the review, then close the PR without merging and delete the branch.
3. Merge the 0003 PR into `phase/0`.
4. (Josef, later, when `main` gets its first merge) On GitHub: Settings → Branches → Add branch ruleset for `main` and `phase/*` → tick "Require status checks to pass" → add `setup`, `lint`, `typecheck`, `unit`, `context-lint` → Save.
