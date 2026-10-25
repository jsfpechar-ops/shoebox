# 0010a: dependency-cruiser import boundaries

Status: done
Ticket: P0-REPO-02 (part a of 2) | Depends on: none (P0-REPO-01, P0-CI-01 merged) | Base commit: head of phase/0 | Branch: task/0010a-depcruise | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Make `pnpm depcruise` real: a `.dependency-cruiser.cjs` with the five M12 §4.1 boundary rules, a test that proves `packages/domain` cannot import `packages/db` or `node:fs`, and a `depcruise` CI job. Part b (0010b) adds the Biome GritQL rules.

## 2. Context

Spec (M12 §4.1, dependency-cruiser rules, CI error):

- `domain-is-pure`: `packages/domain` may import only `decimal.js`, `zod` and itself (no `node:*` except `node:assert` in tests).
- `no-cross-internals`: `packages/<a>/src/**` may import `packages/<b>` only through its `package.json` `exports` (no deep imports).
- `apps-are-leaves`: nothing imports from `apps/*`.
- `ui-no-server`: `packages/ui` may not import `db`, `pipeline`, `registries`, `extraction`.
- `no-circular`.

M12 §9 AC-4: dependency-cruiser fails a PR where `packages/domain` imports `packages/db` or `node:fs`. M12 §4.3 step 2: `depcruise` is a parallel CI job.

Facts the brief writer verified in a scratch copy (dependency-cruiser 18.5.0, pnpm 10.28.0, Node 22):

- pnpm symlinks resolve to real paths, so `@shoebox/db` resolves to `packages/db/src/index.ts` and `zod` to `node_modules/.pnpm/zod@…/node_modules/zod/…`; the regexes below match those paths.
- `node:fs` is reported as module `fs` with dependency type `core`.
- On the current tree `pnpm depcruise` reports `55 modules, 39 dependencies cruised`, no violations.
- The test file below passed as written (10 tests). It writes fixture files at real paths under `apps/` and `packages/`, cruises them, and deletes them in `finally`. Fixture names start with `__depcruise-fixture-`.
- Every package's `package.json` exports only `.` → `./src/index.ts`, so the only legal cross-package import target is `packages/<b>/src/index.ts`.

Approved dependency (decisions.md, owner, P0-OWN-01): dependency-cruiser for the import boundary rules in CI. Version 18.5.0 (published 2026-09-30, ≥ 14 days old). No other new dependency.

Root `package.json` today (excerpt):

```json
    "depcruise": "echo 'TODO(P0-REPO-02): dependency-cruiser' && exit 1",
```

```json
  "devDependencies": {
    "@biomejs/biome": "catalog:",
```

Root `vitest.workspace.ts` today (excerpt):

```ts
      name: 'unit',
      environment: 'node',
      include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
```

`.github/workflows/ci.yml` ends with (this is the anchor; brief 0011 also appends after it, so append only, change nothing above):

```yaml
      - name: Agent context lint
        run: python3 scripts/context_lint.py
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `package.json` | edit | `dependency-cruiser` devDependency, real `depcruise` script |
| `pnpm-lock.yaml` | regenerated | by `pnpm install` |
| `.dependency-cruiser.cjs` | new | the five rules |
| `vitest.workspace.ts` | edit | unit project also includes `scripts/lint/test` |
| `scripts/lint/test/depcruise.test.ts` | new | AC-4 fixtures, one failing and one passing per rule |
| `.github/workflows/ci.yml` | edit | append the `depcruise` job |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0010a-depcruise origin/phase/0`. Write each new file with one Write call; do not re-read files you just wrote; do not explore. Commit after each step as `0010a step k` (step 1 commits `pnpm-lock.yaml` too).

### Step 1: `package.json`

Replace

```json
    "depcruise": "echo 'TODO(P0-REPO-02): dependency-cruiser' && exit 1",
```

with

```json
    "depcruise": "depcruise --config .dependency-cruiser.cjs apps packages",
```

and replace

```json
  "devDependencies": {
    "@biomejs/biome": "catalog:",
```

with

```json
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "dependency-cruiser": "18.5.0",
```

Command: `pnpm install 2>&1 | tail -5` → contains `+ dependency-cruiser 18.5.0` and `Done in …`.

### Step 2: `.dependency-cruiser.cjs` (new, exact content)

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'M12 §4.1: no import cycles.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'M12 §4.1: packages/domain imports only decimal.js, zod and itself (no node:*, no I/O).',
      from: { path: '^packages/domain/src/' },
      to: { pathNot: ['^packages/domain/src/', 'node_modules/(decimal\\.js|zod)/'] },
    },
    {
      name: 'no-cross-internals',
      severity: 'error',
      comment:
        'M12 §4.1: another package is imported only through its package.json exports (its src/index.ts), never deep.',
      from: { path: '^packages/([^/]+)/src/' },
      to: { path: '^packages/(?!$1/)[^/]+/src/', pathNot: '^packages/[^/]+/src/index\\.tsx?$' },
    },
    {
      name: 'apps-are-leaves',
      severity: 'error',
      comment: 'M12 §4.1: nothing imports from apps/*.',
      from: { pathNot: '^apps/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-are-leaves-cross-app',
      severity: 'error',
      comment: 'M12 §4.1: one app never imports another app.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/(?!$1/)' },
    },
    {
      name: 'ui-no-server',
      severity: 'error',
      comment: 'M12 §4.1: packages/ui may not import db, pipeline, registries, extraction.',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/(db|pipeline|registries|extraction)/' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['\\.turbo/', '/dist/', '\\.next/', '/coverage/'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'default'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
```

Command: `pnpm depcruise 2>&1 | tail -5` → `✔ no dependency violations found (55 modules, 39 dependencies cruised)` (module count may differ slightly; "no dependency violations" is what counts).

### Step 3: `vitest.workspace.ts`

Replace

```ts
      include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
```

with

```ts
      include: [
        'apps/*/test/**/*.test.ts',
        'packages/*/test/**/*.test.ts',
        'scripts/lint/test/**/*.test.ts',
      ],
```

Command: `pnpm lint 2>&1 | tail -5` → `Checked … files`, `Found 4 warnings.` (pre-existing ignore-pattern warnings, fixed in 0010b), `Found 1 info.`, exit 0.

### Step 4: `scripts/lint/test/depcruise.test.ts` (new, full test file; implement nothing else, do not edit it)

```ts
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Import boundaries (M12 §4.1, AC-4): .dependency-cruiser.cjs. Each case writes fixture modules
 * at the real paths the rules cover, cruises them with the repo config, and removes them again.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const depcruise = join(root, 'node_modules', '.bin', 'depcruise');

type Violation = { from: string; to: string; rule: { name: string; severity: string } };

function cruise(files: Record<string, string>, entry: string): string[] {
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content);
  }
  let stdout = '';
  try {
    stdout = execFileSync(
      depcruise,
      ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', entry],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? '');
  } finally {
    for (const rel of Object.keys(files)) {
      rmSync(join(root, rel), { force: true });
    }
  }
  const parsed = JSON.parse(stdout) as { summary: { violations: Violation[] } };
  return parsed.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
}

describe('domain-is-pure (AC-4)', () => {
  it('fails when packages/domain imports node:fs', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-fs.ts';
    const violations = cruise({ [entry]: "import 'node:fs';\nexport const a = 1;\n" }, entry);
    expect(violations).toEqual([`domain-is-pure: ${entry} -> fs`]);
  });

  it('fails when packages/domain imports packages/db', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-db.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const b = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`domain-is-pure: ${entry} -> packages/db/src/index.ts`]);
  });

  it('passes when packages/domain imports itself', () => {
    const entry = 'packages/domain/src/__depcruise-fixture-self.ts';
    const violations = cruise(
      { [entry]: "import { packageName } from './index.ts';\nexport const c = packageName;\n" },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('no-cross-internals', () => {
  it('fails on a deep import of another package', () => {
    const entry = 'packages/pipeline/src/__depcruise-fixture-deep.ts';
    const internal = 'packages/db/src/__depcruise-fixture-internal.ts';
    const violations = cruise(
      {
        [internal]: 'export const internal = 1;\n',
        [entry]:
          "import { internal } from '../../db/src/__depcruise-fixture-internal.ts';\nexport const d = internal;\n",
      },
      entry,
    );
    expect(violations).toEqual([`no-cross-internals: ${entry} -> ${internal}`]);
  });

  it('passes an import through the package entry point', () => {
    const entry = 'packages/pipeline/src/__depcruise-fixture-entry.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const e = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('apps-are-leaves', () => {
  it('fails when a package imports an app', () => {
    const entry = 'packages/platform/src/__depcruise-fixture-app.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../../apps/web/src/index.ts';\nexport const f = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`apps-are-leaves: ${entry} -> apps/web/src/index.ts`]);
  });

  it('passes when an app imports a package', () => {
    const entry = 'apps/web/src/__depcruise-fixture-pkg.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../../packages/domain/src/index.ts';\nexport const g = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('ui-no-server', () => {
  it('fails when packages/ui imports packages/db', () => {
    const entry = 'packages/ui/src/__depcruise-fixture-db.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../db/src/index.ts';\nexport const h = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([`ui-no-server: ${entry} -> packages/db/src/index.ts`]);
  });

  it('passes when packages/ui imports packages/domain', () => {
    const entry = 'packages/ui/src/__depcruise-fixture-domain.ts';
    const violations = cruise(
      {
        [entry]:
          "import { packageName } from '../../domain/src/index.ts';\nexport const i = packageName;\n",
      },
      entry,
    );
    expect(violations).toEqual([]);
  });
});

describe('no-circular', () => {
  it('fails on an import cycle', () => {
    const a = 'packages/domain/src/__depcruise-fixture-a.ts';
    const b = 'packages/domain/src/__depcruise-fixture-b.ts';
    const violations = cruise(
      {
        [a]: "import { y } from './__depcruise-fixture-b.ts';\nexport const x = y;\n",
        [b]: "import { x } from './__depcruise-fixture-a.ts';\nexport const y = x;\n",
      },
      a,
    );
    expect(violations.some((v) => v.startsWith('no-circular: '))).toBe(true);
  });
});
```

Command: `pnpm vitest run --project unit scripts/lint 2>&1 | tail -30` → `Test Files  1 passed (1)`, `Tests  10 passed (10)`. Then `git status --porcelain | grep fixture` → prints nothing (no fixture left behind).

### Step 5: `.github/workflows/ci.yml`

Append after the anchor (the last two lines of the file, quoted in §2), keeping one blank line before the new job and changing nothing above:

```yaml

  depcruise:
    needs: setup
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - name: Import boundaries (dependency-cruiser)
        run: pnpm depcruise
```

Command: `grep -n '^  [a-z-]*:$' .github/workflows/ci.yml | tail -8` → lists `setup`, `lint`, `typecheck`, `unit`, `context-lint`, `depcruise`.

### Step 6: report and push (§9)

## 5. Do not touch

`apps/**`, `packages/**` (the test creates and deletes its own fixture files there at run time; you never commit any), `biome.json`, `tools/`, `docs/` other than your report, `turbo.json`, any job above `context-lint` in `ci.yml`. Hard rules: 7 (only `dependency-cruiser@18.5.0` is added), 8 (never push to `main`).

## 6. Commands

- `pnpm depcruise 2>&1 | tail -5` → no dependency violations.
- `pnpm vitest run --project unit scripts/lint 2>&1 | tail -30` → 10 passed.
- `pnpm lint 2>&1 | tail -5` → exit 0 (4 pre-existing warnings, 1 info).
- `pnpm typecheck 2>&1 | tail -10` → all tasks successful (unchanged packages).

## 7. Acceptance

- [ ] `.dependency-cruiser.cjs` has `domain-is-pure`, `no-cross-internals`, `apps-are-leaves`, `ui-no-server`, `no-circular`; `pnpm depcruise` passes.
- [ ] `scripts/lint/test/depcruise.test.ts` proves a fixture importing `packages/db` or `node:fs` from domain fails (AC-4), 10 tests green, no fixture file left in the tree.
- [ ] `ci.yml` gains the `depcruise` job, appended after `context-lint`.
- [ ] Ticket items for the Biome rules (no-jsx-literal-text etc., `custom-rules.test.ts`, T-17 note) are done in 0010b, not here.

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

Write `docs/tasks/0010a-report.md` (600 tokens at most) and set `Status: review`. Push with `git push -u origin task/0010a-depcruise`; the orchestrator opens and merges the PR. The report has:

1. The files changed (`git diff --stat origin/phase/0`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

`.dependency-cruiser.cjs` (a too-loose regex silently allows the import it should block; check `domain-is-pure` `pathNot` and the `$1` back-reference in `no-cross-internals`), `.github/workflows/ci.yml` (append-only, nothing above `context-lint` changed), `pnpm-lock.yaml` (only `dependency-cruiser@18.5.0` and its transitive deps added).

## Owner steps

None. The orchestrator merges the PR into `phase/0`.
