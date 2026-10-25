# 0034: CI jobs `build` (turbo + bundle budget), `e2e` (Playwright, 3 projects) and `eval` (sticky PR comment)

Status: todo
Ticket: P0-CI-03 | Depends on: 0027 (db job, merged; its Status line is stale) and 0030c merged into phase/0 (0030d recommended first, see §2) | Base commit: head of phase/0 | Branch: task/0034-ci-build-e2e-eval | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: normal. Every file is given in full or as an exact anchor; the tests are the spec.

## 1. Objective

Every PR and push runs three more CI jobs (M12 §4.3 steps 5–7): `build` (`turbo build`, then `pnpm check:bundle`, which reads the Next build manifest and fails when `/inbox` or `/prehled` ship more than 170 kB gzip first-load JS, M11 §10), `e2e` (Playwright with axe, projects `desktop-chromium`, `mobile-webkit`, `mobile-chromium`, 0 skipped) and `eval` (`pnpm eval --quick`, report in the job summary and as one sticky PR comment; mandatory because `testdata/golden-v1/labels.json` exists, advisory only while it is missing).

## 2. Context

**How to work (strict):** every file is given in full or as an exact anchor. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0034 step k"`). Never `git add` `apps/web/next-env.d.ts`, `apps/web/.next/`, `test-results/` or `playwright-report/`. Never run `playwright install` (CI installs browsers; the sandbox has Chromium only, so run `--project desktop-chromium --project mobile-chromium`). If `tsc` or `next build` reports an error inside `apps/web/.next/`, run `rm -rf apps/web/.next` and rerun once.

**Already in phase/0 (do not change):** `.github/workflows/ci.yml` with jobs `setup`, `lint`, `typecheck`, `unit`, `secrets`, `pii`, `context-lint`, `depcruise`, `db`, `migration-lint` (P0-CI-01/02), the composite action `.github/actions/setup`, `playwright.config.ts` (projects `setup`, `desktop-chromium`, `mobile-webkit`, `mobile-chromium`; `retries: isCI ? 1 : 0`; the fake Auth + inbox server as the first `webServer`), `apps/web/e2e/fake-auth-server.mjs`, `apps/web/e2e/auth.setup.ts`, `scripts/eval.mjs` (`pnpm eval`), `testdata/golden-v1/labels.json`, `packages/db/scripts/local-pg.sh` (0031b). If `apps/web/e2e/fake-auth-server.mjs` is missing: STOP (0030c not merged).

**Which spec needs which env (read from `playwright.config.ts` and `apps/web/e2e/fixtures.ts`):** every spec (`shell`, `headers`, `health`, and from 0030d `auth`, `auth-live`) runs against the fake Auth + inbox server on port 54329 when `SUPABASE_URL` is unset; `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `INBOX_URL` then default to the fake values. Setting only some of the four would mix the fake and the real provider, so the CI job sets none of them. `health.spec.ts` takes its 200 branch only when `DATABASE_URL` is exported before `playwright test` (the Next server inherits it), so the job starts the local Supabase Postgres exactly like the `db` job. With 0030d merged the local run is 61 tests (1 setup + 2 × 30); without it 37 (1 setup + 2 × 18). Both are fine; quote the number in the report.

**Spec (pasted):** M12 §4.3: "5. `build`: `turbo build`, `check:bundle`. 6. `e2e`: Playwright against the local stack (web + worker + Supabase + fake registries + LLM replay), Phase 1 core flow (02) + a11y. 7. `eval`: `pnpm eval --quick` (replay); live eval on label `eval:live` or when `packages/extraction/prompts/**` or model config changed (§4.10). Posts the report as a PR comment." Target wall time ≤ 12 min. M12 §8 edge case 10: "CI eval job is `continue-on-error` only until the first `labels.json` commit, then mandatory." M11 §10: "JS (gzip) first load ≤ 170 KB for /inbox, /prehled; document detail ≤ 170 KB + lazy PDF viewer chunk ≤ 450 KB; `scripts/check-bundle-budget.ts` reads Next build manifest; CI fails on breach."

**Rules:** 7 (no new dependency, vendor or GitHub Action: the jobs use only `actions/checkout` and `./.github/actions/setup`, already pinned by digest; the PR comment uses the `gh` CLI preinstalled on the runner and `jq`), 8 (never push to `main`). Known issue K-P05 (`headers.spec.ts` theme test failed once locally): this brief adds **no** retries; the existing `retries: isCI ? 1 : 0` in `playwright.config.ts` stays as it is, and the new report check prints every test that only passed on its retry as a `::warning::` naming K-P05, so a flake is visible instead of hidden.

**Choices made by the brief writer (verified in a scratch copy: the bundle script and its test, a real `turbo run build` + `next build` manifest, a Playwright JSON report of 37 tests run through the `jq` check, `pnpm eval --quick`, and `actionlint` 1.7.7 on the new jobs; do not change):**
- First-load JS of a route = the JS files of its `page` entry plus every ancestor `layout` entry in `apps/web/.next/app-build-manifest.json`, each file once, gzip-compressed with `node:zlib` (kB = 1000 bytes, as Next prints). Today `/inbox` and `/prehled` measure 129 kB. A budgeted route that is not built yet prints `SKIP`; the document-detail route joins `BUDGETS` with its screen ticket (`TODO` in the file).
- The script runs with plain Node 22 (type stripping), no dependency, like `scripts/migration-lint.ts`.
- Default (confirm at gate): `e2e` runs against the fake Auth + inbox server and the local Supabase **Postgres** (not Supabase Auth + Kong + Mailpit), because the fake server is what 0030c/0030d verified and it needs no keys; the real-provider run stays owner step 1 of 0030d. Worker, fake registries and LLM replay join the job with the Phase 1 core-flow tickets.
- Default (confirm at gate): no `actions/upload-artifact` (a new action needs an owner line); failures are read from the `github` reporter annotations. Reporter in CI: `--reporter=github,json` (the CLI flag overrides the config's `github` + `html`).
- Default (confirm at gate): `eval` runs `--quick` only; the live run on label `eval:live` waits for the live `LlmClient` (P1; the CLI refuses `--live` today). `continue-on-error` is a step expression on the output of a "golden set delivered?" step, because `hashFiles()` is not allowed at job level. The sticky comment is found by the marker `<!-- shoebox:eval-report -->` and edited in place; it is skipped on pushes and on PRs from forks (read-only token).
- Locally `turbo run build` needs `--env-mode=loose`, because turbo's strict env mode drops the sandbox proxy CA variables and `next/font` then cannot fetch Inter. CI has no proxy and runs the plain command.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/check-bundle-budget.ts` | new | `BUDGETS`, `routeOf`, `firstLoadFiles`, `checkBudgets`, CLI |
| `scripts/test/check-bundle-budget.test.ts` | new | 4 unit tests on a fake manifest |
| `package.json` | edit | `check:bundle` runs the script (was a failing TODO stub) |
| `.github/workflows/ci.yml` | edit | jobs `build`, `e2e`, `eval` appended |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 56–166
Step 2 code: lines 174–228
Step 3 code: lines 236–236
Step 4 code: lines 244–356

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0034-ci-build-e2e-eval origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/web/e2e/fake-auth-server.mjs testdata/golden-v1/labels.json && grep -n 'check:bundle' package.json`. Expected: both paths listed and the line `"check:bundle": "echo 'TODO(P0-WEB): check:bundle' && exit 1",`. Otherwise STOP.

**Step 1: `scripts/check-bundle-budget.ts` (new).**

```ts
#!/usr/bin/env node
// Bundle budget (M11 §10 Performance budgets, M12 §4.3 step 5): first-load JS (gzip) per route,
// read from the Next build manifest of apps/web. CI fails on a breach. Runs with plain Node 22
// (type stripping), no dependencies. A budgeted route that is not built yet is reported as SKIP.
//
// Usage: node scripts/check-bundle-budget.ts   (after `pnpm --filter @shoebox/web build`)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export interface Budget {
  /** URL path as the user sees it, e.g. `/inbox` (route groups such as `(app)` removed). */
  route: string;
  /** First-load JS, gzip, in kB (1 kB = 1000 bytes, as Next prints it). */
  maxKb: number;
}

/** M11 §10: JS (gzip) first load ≤ 170 KB for /inbox, /prehled and the document detail. */
export const BUDGETS: readonly Budget[] = [
  { route: '/inbox', maxKb: 170 },
  { route: '/prehled', maxKb: 170 },
  // TODO(P1 document detail): the route name comes with the screen ticket (M11 §5); lazy PDF viewer chunk ≤ 450 KB.
];

export const MANIFEST = 'apps/web/.next/app-build-manifest.json';

export interface AppBuildManifest {
  pages: Record<string, readonly string[]>;
}

export type BudgetResult =
  | { route: string; status: 'PASS' | 'FAIL'; kb: number; maxKb: number; files: number }
  | { route: string; status: 'SKIP'; reason: string };

/** `/(app)/inbox/page` → `/inbox`; `/page` → `/`. */
export function routeOf(entry: string): string {
  const segments = entry
    .split('/')
    .filter((s) => s !== '' && !(s.startsWith('(') && s.endsWith(')')));
  segments.pop();
  return `/${segments.join('/')}`;
}

/** The page entry plus every ancestor layout entry, JS files only, without duplicates. */
export function firstLoadFiles(manifest: AppBuildManifest, pageEntry: string): string[] {
  const parts = pageEntry.split('/').slice(1, -1);
  const entries = [pageEntry];
  for (let i = 0; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    entries.push(prefix === '' ? '/layout' : `/${prefix}/layout`);
  }
  const files = new Set<string>();
  for (const entry of entries) {
    for (const file of manifest.pages[entry] ?? []) {
      if (file.endsWith('.js')) files.add(file);
    }
  }
  return [...files].sort();
}

export function checkBudgets(
  manifest: AppBuildManifest,
  gzipBytes: (file: string) => number,
  budgets: readonly Budget[] = BUDGETS,
): BudgetResult[] {
  const pageEntries = Object.keys(manifest.pages).filter((e) => e.endsWith('/page'));
  return budgets.map((budget) => {
    const entry = pageEntries.find((e) => routeOf(e) === budget.route);
    if (entry === undefined)
      return { route: budget.route, status: 'SKIP', reason: 'not built yet' };
    const files = firstLoadFiles(manifest, entry);
    const bytes = files.reduce((sum, file) => sum + gzipBytes(file), 0);
    const kb = Math.round(bytes / 100) / 10;
    return {
      route: budget.route,
      status: kb <= budget.maxKb ? 'PASS' : 'FAIL',
      kb,
      maxKb: budget.maxKb,
      files: files.length,
    };
  });
}

function main(): number {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) {
    console.error(`${MANIFEST} missing: run \`pnpm --filter @shoebox/web build\` first`);
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AppBuildManifest;
  const nextDir = join(root, 'apps/web/.next');
  const results = checkBudgets(
    manifest,
    (file) => gzipSync(readFileSync(join(nextDir, file))).length,
  );
  for (const r of results) {
    console.log(
      r.status === 'SKIP'
        ? `SKIP ${r.route}: ${r.reason}`
        : `${r.status} ${r.route}: ${r.kb} kB gzip (budget ${r.maxKb} kB, ${r.files} files)`,
    );
  }
  return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
```

Command: `node scripts/check-bundle-budget.ts; echo "exit=$?"`. Expected: without a build `apps/web/.next/app-build-manifest.json missing: …` and `exit=2`; if an earlier build is still in `apps/web/.next`, two `PASS` lines and `exit=0`. Commit.

**Step 2: `scripts/test/check-bundle-budget.test.ts` (new).** Do not edit the test file.

```ts
import { describe, expect, it } from 'vitest';
import {
  type AppBuildManifest,
  BUDGETS,
  checkBudgets,
  firstLoadFiles,
  routeOf,
} from '../check-bundle-budget';

/** M11 §10: first-load JS (gzip) ≤ 170 kB for /inbox and /prehled, read from the Next build manifest. */
const SHARED = ['static/chunks/webpack-1.js', 'static/chunks/main-app-1.js'];
const MANIFEST: AppBuildManifest = {
  pages: {
    '/layout': [...SHARED, 'static/css/app.css', 'static/chunks/app/layout-1.js'],
    '/(app)/layout': [...SHARED, 'static/chunks/902.js', 'static/chunks/app/(app)/layout-1.js'],
    '/(app)/inbox/page': [...SHARED, 'static/chunks/app/(app)/inbox/page-1.js'],
    '/(auth)/prihlaseni/page': [...SHARED, 'static/chunks/app/(auth)/prihlaseni/page-1.js'],
    '/api/health/route': [...SHARED, 'static/chunks/app/api/health/route-1.js'],
  },
};

describe('check-bundle-budget', () => {
  it('has the M11 §10 budgets', () => {
    expect(BUDGETS).toEqual([
      { route: '/inbox', maxKb: 170 },
      { route: '/prehled', maxKb: 170 },
    ]);
  });

  it('maps manifest entries to URL paths without route groups', () => {
    expect(routeOf('/(app)/inbox/page')).toBe('/inbox');
    expect(routeOf('/(auth)/prihlaseni/page')).toBe('/prihlaseni');
    expect(routeOf('/page')).toBe('/');
  });

  it('counts the page plus every ancestor layout, JS only, each file once', () => {
    expect(firstLoadFiles(MANIFEST, '/(app)/inbox/page')).toEqual([
      'static/chunks/902.js',
      'static/chunks/app/(app)/inbox/page-1.js',
      'static/chunks/app/(app)/layout-1.js',
      'static/chunks/app/layout-1.js',
      'static/chunks/main-app-1.js',
      'static/chunks/webpack-1.js',
    ]);
  });

  it('passes under the budget, fails over it, skips a route that is not built yet', () => {
    const results = checkBudgets(MANIFEST, () => 25_000);
    expect(results).toEqual([
      { route: '/inbox', status: 'PASS', kb: 150, maxKb: 170, files: 6 },
      { route: '/prehled', status: 'SKIP', reason: 'not built yet' },
    ]);
    expect(checkBudgets(MANIFEST, () => 30_000)[0]).toMatchObject({ status: 'FAIL', kb: 180 });
  });
});
```

Command: `pnpm exec vitest run --project unit scripts/test/check-bundle-budget.test.ts 2>&1 | tail -6 && pnpm exec biome ci scripts 2>&1 | tail -3`. Expected: `Tests  4 passed`; Biome `No fixes applied` without errors. Commit.

**Step 3: `package.json` (edit).** Anchor (verbatim): `    "check:bundle": "echo 'TODO(P0-WEB): check:bundle' && exit 1",`. Replace with:

```json
    "check:bundle": "node scripts/check-bundle-budget.ts",
```

Command: `NEXT_TELEMETRY_DISABLED=1 pnpm exec turbo run build --env-mode=loose 2>&1 | tail -4 && pnpm check:bundle 2>&1 | tail -4`. Expected: `Tasks:    1 successful, 1 total`, then `PASS /inbox: … kB gzip (budget 170 kB, … files)` and `PASS /prehled: …` (about 129 kB today). Commit.

**Step 4: `.github/workflows/ci.yml` (edit: append three jobs).** The file ends with the `migration-lint` job; its last line is (verbatim) `          node scripts/migration-lint.ts $files`. Append the block below after that line (a blank line first, then the jobs indented by two spaces under `jobs:`). Do not change any existing job.

```yaml

  build:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      NEXT_TELEMETRY_DISABLED: '1'
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Build every workspace (turbo build)
        run: pnpm exec turbo run build
      - name: Bundle budget (M11 §10, first-load JS gzip from the Next build manifest)
        run: pnpm check:bundle

  e2e:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    env:
      NEXT_TELEMETRY_DISABLED: '1'
      # Local Supabase Postgres (same as the db job): /api/health answers 200 with a DB ping.
      DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      PLAYWRIGHT_JSON_OUTPUT_NAME: test-results/e2e-report.json
      # SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and INBOX_URL stay unset on purpose:
      # playwright.config.ts then starts the fake Auth + inbox server (apps/web/e2e/fake-auth-server.mjs).
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Start local Supabase (Postgres only, as in the db job)
        run: >
          pnpm exec supabase start
          -x realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
      - name: Migrate from scratch (drizzle-kit, packages/db/migrations)
        run: pnpm db:migrate
      - name: Playwright browsers (Chromium, WebKit) with OS dependencies
        run: pnpm exec playwright install --with-deps chromium webkit
      - name: Playwright, 3 projects, axe on every test (M12 §4.3 step 6)
        run: pnpm exec playwright test --reporter=github,json
      - name: 0 skipped; flaky tests (passed on the CI retry) are annotated, see K-P05
        if: always()
        run: |
          report="$PLAYWRIGHT_JSON_OUTPUT_NAME"
          if [ ! -f "$report" ]; then
            echo '::error::no Playwright JSON report'; exit 1
          fi
          jq -r '.stats | "expected=\(.expected) unexpected=\(.unexpected) flaky=\(.flaky) skipped=\(.skipped)"' "$report"
          jq -r '[.. | objects | select(has("specs")) | .specs[] | select(any(.tests[]; .status == "flaky")) | "\(.file):\(.line) \(.title)"] | unique | .[] | "::warning::flaky e2e test (failed, then passed on retry; K-P05): \(.)"' "$report"
          skipped=$(jq '.stats.skipped' "$report")
          if [ "$skipped" != 0 ]; then
            echo "::error::$skipped e2e test(s) skipped; P0-CI-03 requires 0 skipped"; exit 1
          fi
      - name: Stop local Supabase
        if: always()
        run: pnpm exec supabase stop --no-backup

  eval:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Golden set delivered? (M12 §8 edge case 10)
        id: golden
        run: |
          if [ -f testdata/golden-v1/labels.json ]; then
            echo 'present=true' >> "$GITHUB_OUTPUT"
          else
            echo 'present=false' >> "$GITHUB_OUTPUT"
            echo '::warning::testdata/golden-v1/labels.json missing: the eval job is advisory until it is committed'
          fi
      - name: Eval, replay (pnpm eval --quick, M12 §4.10)
        # Mandatory once labels.json exists; continue-on-error only while the golden set is missing.
        continue-on-error: ${{ steps.golden.outputs.present != 'true' }}
        run: pnpm eval --quick --out "$RUNNER_TEMP/eval"
      - name: Eval report in the job summary
        if: always()
        run: |
          if [ -f "$RUNNER_TEMP/eval/eval-report.md" ]; then
            cat "$RUNNER_TEMP/eval/eval-report.md" >> "$GITHUB_STEP_SUMMARY"
          fi
      - name: Sticky PR comment with eval-report.md
        if: always() && github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: |
          report="$RUNNER_TEMP/eval/eval-report.md"
          if [ ! -f "$report" ]; then
            echo 'no eval-report.md (the CLI exits 2 without a report on a misconfiguration)'; exit 0
          fi
          marker='<!-- shoebox:eval-report -->'
          body="$(printf '%s\n%s\n' "$marker" "$(cat "$report")")"
          id=$(gh api --paginate "repos/$REPO/issues/$PR/comments" \
            --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | head -n 1)
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null
            echo "updated eval comment $id"
          else
            gh api -X POST "repos/$REPO/issues/$PR/comments" -f body="$body" > /dev/null
            echo 'created eval comment'
          fi
```

Command: `python3 -c "import yaml; d = yaml.safe_load(open('.github/workflows/ci.yml')); print(sorted(d['jobs'])); print(d['jobs']['eval']['permissions'])" && (command -v actionlint > /dev/null && actionlint .github/workflows/ci.yml 2>&1 | tail -10 || echo 'actionlint not installed')`. Expected: `['build', 'context-lint', 'db', 'depcruise', 'e2e', 'eval', 'lint', 'migration-lint', 'pii', 'secrets', 'setup', 'typecheck', 'unit']`, `{'contents': 'read', 'pull-requests': 'write'}`, and no actionlint output (or `actionlint not installed`). Commit.

**Step 5: run the e2e job's commands locally (no new file).** Commands, one Bash call:

`bash packages/db/scripts/local-pg.sh start 2>&1 | tail -1 && DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/e2e-report.json pnpm exec playwright test --project desktop-chromium --project mobile-chromium --reporter=line,json 2>&1 | tail -4 && jq -r '.stats | "expected=\(.expected) unexpected=\(.unexpected) flaky=\(.flaky) skipped=\(.skipped)"' test-results/e2e-report.json && jq '.stats.skipped' test-results/e2e-report.json`

Expected: `61 passed` (with 0030d) or `37 passed` (without), then `expected=61 unexpected=0 flaky=0 skipped=0` (or 37), then `0`. If `local-pg.sh` cannot start Postgres, run the same Playwright and `jq` commands without `DATABASE_URL` (health takes its 503 branch) and say so in the report. If a test fails, rerun once; a test that fails twice: STOP. Stop Postgres afterwards: `bash packages/db/scripts/local-pg.sh stop 2>&1 | tail -1`. Nothing to commit (`git status --short` lists nothing; `test-results/` is ignored).

**Step 6: eval, lint, context lint (no new file).** Command: `pnpm eval --quick --out /tmp/eval-0034 2>&1 | tail -3; echo "exit=$?" && head -3 /tmp/eval-0034/eval-report.md && pnpm lint 2>&1 | tail -4 && python3 scripts/context_lint.py 2>&1 | tail -3 && git status --short | tail -5`. Expected: `Result: PASS · …`, `Wrote …eval-report.json and …eval-report.md`, `exit=0`, the first lines of the Markdown report, lint without errors, context lint OK, `git status` empty. Commit if anything changed.

## 5. Do not touch

`playwright.config.ts` (no retries, reporters or projects change here), `apps/web/**`, `packages/**`, `scripts/eval.mjs`, `.github/actions/setup/action.yml`, every existing job in `ci.yml`, `turbo.json`. No new dependency and no new GitHub Action (hard rule 7). Never `playwright install`.

## 6. Commands

- `pnpm exec vitest run --project unit scripts/test/check-bundle-budget.test.ts 2>&1 | tail -30` → 4 passed.
- `pnpm exec biome ci scripts 2>&1 | tail -30` → no errors.
- `NEXT_TELEMETRY_DISABLED=1 pnpm exec turbo run build --env-mode=loose 2>&1 | tail -30 && pnpm check:bundle 2>&1 | tail -30` → 2 × PASS.
- `python3 -c "import yaml; …"` (step 4) → the 13 job names.
- Step 5 Playwright + `jq` → all passed, `skipped=0`.
- `pnpm eval --quick --out /tmp/eval-0034 2>&1 | tail -30` → `Result: PASS`.
- `python3 scripts/context_lint.py 2>&1 | tail -30` → OK.

## 7. Acceptance

- [ ] Job `build`: `pnpm exec turbo run build`, then `pnpm check:bundle`; the script reads `apps/web/.next/app-build-manifest.json` and fails (exit 1) on a budget breach (unit test), exit 2 without a build.
- [ ] Job `e2e`: Playwright with the 3 browser projects (+ `setup`), axe through the existing auto fixture, `0 skipped` enforced by the JSON report check; flaky tests annotated with K-P05, no retries added.
- [ ] Job `eval`: `pnpm eval --quick`; the report goes to the job summary and to one sticky PR comment (marker `<!-- shoebox:eval-report -->`, edited on every run); `continue-on-error` only while `testdata/golden-v1/labels.json` is missing, so today the job is mandatory (state this condition in the report).
- [ ] Only `actions/checkout` (existing digest) and `./.github/actions/setup`; `eval` alone gets `pull-requests: write`.
- [ ] `git diff --stat origin/phase/0` lists exactly the 4 files of §3.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found verbatim, or 0030c is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `pnpm check:bundle` prints `FAIL` (a real budget breach: report the numbers, do not raise the budget);
- `next build` fails to download Inter from Google even with `--env-mode=loose`: STOP;
- a Playwright test is skipped locally (`skipped` > 0);
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency or a GitHub Action beyond the ones above seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0034-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; the `check:bundle` lines; the Playwright total and the `jq` stats line; §7 ticked; the eval condition in one sentence; deviations; questions. Then `git add -A && git commit -qm "0034 report" && git push -u origin task/0034-ci-build-e2e-eval 2>&1 | tail -3`. The orchestrator opens the PR and merges it once the CI run of the PR itself is green (the first real run of the three jobs).

## Risk list (for the reviewer)

- `ci.yml`: the three jobs are appended only; no existing job changed (`git diff` shows additions only). `eval` is the only job with a write permission, and only `pull-requests: write`; the comment step skips pushes and fork PRs.
- `e2e`: `SUPABASE_*` and `INBOX_URL` are not set anywhere in the job (all four or none, see §2); `DATABASE_URL` points at the ephemeral local Supabase Postgres with its public default password, as in the `db` job.
- `check-bundle-budget.ts`: counts the page plus all ancestor layouts (stricter than Next's own "First Load JS" column); budgets are M11 §10 values with the source cited, not tax rules (hard rule 1 does not apply).
- Wall time: `e2e` is the long pole (Supabase start, browser install, `next build`, 3 projects); check it against the 12-minute target on the PR run.
- Not verified locally: `mobile-webkit`, `supabase start` in the e2e job, the `gh api` comment step (needs a real PR); `actionlint` 1.7.7 passed in the brief writer's scratch copy.

## Owner steps

1. Nothing to set up: the jobs need no secret (`github.token` is automatic). After the PR's first run, open the PR's "Checks" tab: `build`, `e2e` and `eval` are green and the PR has one comment starting with "Eval golden-v1".
2. Optional, later: GitHub → Settings → Branches → the rule for `main` (and `phase/*`) → "Require status checks" → add `build`, `e2e` and `eval`.
