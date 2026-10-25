# 0024b: Eval runner, CLI and `pnpm eval --quick`

Status: todo
Ticket: P0-EVAL-02 (part 2 of 2, after 0024a) | Depends on: 0024a merged (0020 merged) | Base commit: head of phase/0 after 0024a merged (if 0024a is still open, branch from `origin/task/0024a-eval-gates` instead) | Branch: task/0024b-eval-cli | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `runEval` (pluggable per-module adapters, the cassette LLM in `replay` / `record` / `live` mode, baseline comparison) and the CLI behind `pnpm eval --quick` with the flags `--module M01..M05`, `--record`, `--live`, so AGENTS.md's rule "M01–M05 changes run `pnpm eval --quick`" works today: offline, in about one second, writing `eval-report.json` and `eval-report.md`. No extraction pipeline exists yet, so no adapter is registered and every module is reported as `SKIP no adapter registered`; the runner never invents a metric.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read files you just wrote, do not explore the repo. Every code block in §4 was compiled, linted and run by the brief writer together with 0024a (30 eval tests pass; `pnpm eval --quick` exits 0 in about 1 s; `pnpm depcruise` clean).

**Spec, M12 §4.10 Evaluation harness (pasted):**

> Location: `packages/testkit/src/eval/` + CLI `apps/eval` (or `scripts/eval.ts` run by `pnpm eval`).
>
> **Runner.** `runEval({ set: 'golden-v1', mode: 'replay' | 'live' | 'record', modules?: ('M01'|'M02'|'M03'|'M04'|'M05')[] })`: 1. Seeds an in-memory org from `taxpayer` (… the pure pipeline with in-memory repositories in `--quick` mode). 2. Ingests every file through the real pipeline (`packages/pipeline`) with fake registries and the LLM in the chosen mode. 3. LLM cassettes: `testdata/golden-v1/cassettes/{model}/{prompt_version}/{sha256(request)}.json`. `replay` fails with "missing cassette, run `pnpm eval --record`" if absent; `record` calls the live endpoint (dev budget) and writes cassettes; `live` calls without writing. 4. Answers expected review questions with the labeled truth … 5. Computes metrics, writes `eval-report.json` + `eval-report.md`, compares with `testdata/golden-v1/baseline.json`.
>
> `pnpm eval --quick` = replay + in-memory (seconds, free; required in CI and in the test-map); `pnpm eval` = live (nightly on staging, on label `eval:live`, and mandatory for any model/prompt change). The CLI accepts `--module M01|M02|M03|M04|M05` (M03's `pnpm eval:golden --module validation` is an alias).

**Spec, M12 §8 edge cases (pasted):** "10. Golden set not yet delivered: loader fails with a clear message." · "11. Cassette drift (prompt changed, cassettes missing): replay fails loudly; developer runs `pnpm eval --record` (live, dev budget) and commits cassettes with the prompt change."

**Backlog note:** M12 leaves `apps/eval` vs `scripts/eval.ts` open; the ticket uses `scripts/eval.ts`.

**Decisions made in this brief (orchestrator):**

- Steps 1, 2 and 4 of the M12 runner need `packages/pipeline`, which is an empty stub. The runner therefore takes **module adapters** (`ModuleAdapter { module, run(ctx) }`); `DEFAULT_ADAPTERS` is an empty list with a comment, and the pipeline tickets register theirs there. With no adapter, a module's gates are `SKIP no adapter registered`, `pnpm eval --quick` exits 0 and the report says which modules did not run. A module named with `--module` that has no adapter is a setup error (exit 2), so a broken registration can never look like a pass.
- The CLI logic lives in `packages/testkit/src/eval/cli.ts` (typechecked and tested like any package code). `scripts/eval.mjs` is a 20-line bootstrap that loads it through Vite's SSR module loader (`vite` is already a root devDependency, approved in P0-OWN-01). No `tsx` or other TypeScript runner is added (hard rule 7); the ticket's `scripts/eval.ts` becomes `scripts/eval.mjs` for this reason.
- Root script: `"eval": "node scripts/eval.mjs"` replaces `turbo run eval -- --quick`, so `pnpm eval --quick` passes `--quick` through and `pnpm eval` (no flag) is the live run as M12 says. The `eval` task in `turbo.json` stays (unused, harmless).
- `--record` and `--live` need a live `LlmClient`; none exists until the Anthropic client ticket (P1). They exit 2 with a message saying so. `--update-baseline` writes `testdata/golden-v1/baseline.json`; the label `eval:baseline-change` is printed with it.
- Exit codes: 0 all gates passed or skipped, 1 a gate failed, 2 usage or setup error (invalid labels, no live client, unknown module). Reports go to the current directory by default (`--out <dir>`); both file names are git-ignored.
- Privacy (hard rule 4): the CLI prints the report (synthetic golden values) and error messages; it never prints a label value in an error path (loader messages carry paths only).

Excerpt the step-6 edit anchors on (root `package.json`, line 20):

```json
    "eval": "turbo run eval -- --quick",
```

Excerpt the step-7 edit anchors on (`.gitignore`, last line):

```
.DS_Store
```

Step 3 replaces the whole of `packages/testkit/src/eval/index.ts` (written by 0024a); its first three lines are:

```ts
export {
  BASELINE_FILE,
  type Baseline,
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/src/eval/run.ts` | new | `ModuleAdapter`, `EvalContext`, `DEFAULT_ADAPTERS`, `EvalSetupError`, `runEval` |
| `packages/testkit/src/eval/cli.ts` | new | `USAGE`, `parseArgs`, `main` (exit codes 0/1/2), `CliIo` |
| `packages/testkit/src/eval/index.ts` | edit | replace whole file: 0024a exports plus `cli` and `run` |
| `packages/testkit/test/eval-runner.test.ts` | new | the spec (14 tests) |
| `scripts/eval.mjs` | new | Vite bootstrap for `pnpm eval` |
| `package.json` (root) | edit | `"eval": "node scripts/eval.mjs"` |
| `.gitignore` | edit | add `eval-report.json` and `eval-report.md` |

No other file may change.

## 4. Steps

0. Setup: `git fetch origin phase/0 && git checkout -b task/0024b-eval-cli origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -5 && ls packages/testkit/src/eval/`. Expected: `Done in …`; the listing shows `baseline.ts gates.ts index.ts report.ts` (if not, 0024a is not merged: STOP and ask, or branch from `origin/task/0024a-eval-gates` if the orchestrator said so).

1. **New `packages/testkit/src/eval/run.ts`** (exact content):

```ts
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { LlmClient } from '@shoebox/extraction';
import {
  type GoldenLabels,
  type GoldenSetName,
  goldenSetDir,
  loadGoldenLabels,
} from '../golden/index';
import { createCassetteClient, fsCassetteStore } from '../llm/index';
import { baselineValues, loadBaseline } from './baseline';
import {
  EVAL_MODULES,
  type EvalMode,
  type EvalModule,
  evaluateGates,
  type GateId,
  type MetricValue,
  type ModuleStatus,
} from './gates';
import { type EvalReport, type ModuleReport, summarize } from './report';

/** What a module adapter gets: the checked labels and the LLM in the chosen mode (M12 §4.10 Runner). */
export interface EvalContext {
  readonly set: GoldenSetName;
  readonly setDir: string;
  readonly mode: EvalMode;
  readonly labels: GoldenLabels;
  /** Cassette client over `<setDir>/cassettes`; replay throws `MissingCassetteError`. */
  readonly llm: LlmClient;
}

export interface ModuleRunResult {
  /** Only the gate ids of this module; computed with the helpers in `metrics/`, never by hand. */
  readonly metrics: Readonly<Partial<Record<GateId, MetricValue>>>;
  readonly prompts?: Readonly<Record<string, string>>;
  readonly models?: readonly string[];
}

/** One per module. The pipeline tickets register theirs in `DEFAULT_ADAPTERS`. */
export interface ModuleAdapter {
  readonly module: EvalModule;
  run(ctx: EvalContext): Promise<ModuleRunResult>;
}

/** No pipeline exists yet (packages/pipeline is a stub), so nothing is registered: every module SKIPs. */
export const DEFAULT_ADAPTERS: readonly ModuleAdapter[] = [];

/** A misconfiguration, not a failed gate: the CLI exits 2 and writes no report. */
export class EvalSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalSetupError';
  }
}

export interface RunEvalOptions {
  readonly set?: GoldenSetName;
  readonly mode: EvalMode;
  /** Modules to run; default all five. A named module without an adapter is an error. */
  readonly modules?: readonly EvalModule[];
  readonly adapters?: readonly ModuleAdapter[];
  /** Directory with `labels.json`, `cassettes/`, `baseline.json`. Default: the committed set. */
  readonly setDir?: string;
  /** The real LLM client; required for `record` and `live`. */
  readonly live?: LlmClient;
  readonly generatedAt?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * M12 §4.10 Runner: loads the labels, runs the registered adapters with the cassette LLM, evaluates
 * every gate against `baseline.json` and returns the report (the CLI writes the files).
 */
export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const start = performance.now();
  const set: GoldenSetName = options.set ?? 'golden-v1';
  const setDir = options.setDir ?? goldenSetDir(set);
  const labels = loadGoldenLabels({ dir: setDir });
  if (options.mode !== 'replay' && options.live === undefined) {
    throw new EvalSetupError(
      `mode ${options.mode} needs a live LlmClient and none is available yet (the Anthropic client is a P1 ticket); use --quick`,
    );
  }
  const adapters = new Map((options.adapters ?? DEFAULT_ADAPTERS).map((a) => [a.module, a]));
  const selected = new Set<EvalModule>(options.modules ?? EVAL_MODULES);
  for (const module of selected) {
    if (options.modules !== undefined && !adapters.has(module)) {
      throw new EvalSetupError(`no adapter registered for ${module}`);
    }
  }
  const llm = createCassetteClient({
    mode: options.mode,
    store: fsCassetteStore(join(setDir, 'cassettes')),
    ...(options.live === undefined ? {} : { live: options.live }),
  });
  const ctx: EvalContext = { set, setDir, mode: options.mode, labels, llm };

  const metrics: Partial<Record<GateId, MetricValue>> = {};
  const statuses = {} as Record<EvalModule, ModuleStatus>;
  const modules: ModuleReport[] = [];
  for (const module of EVAL_MODULES) {
    const adapter = adapters.get(module);
    let status: ModuleStatus;
    let prompts: Readonly<Record<string, string>> = {};
    let models: readonly string[] = [];
    if (!selected.has(module)) {
      status = { kind: 'skipped', reason: 'not selected' };
    } else if (adapter === undefined) {
      status = { kind: 'skipped', reason: 'no adapter registered' };
    } else {
      try {
        const result = await adapter.run(ctx);
        Object.assign(metrics, result.metrics);
        prompts = result.prompts ?? {};
        models = result.models ?? [];
        status = { kind: 'ran' };
      } catch (error) {
        status = { kind: 'failed', reason: `adapter error: ${errorMessage(error)}` };
      }
    }
    statuses[module] = status;
    modules.push({ module, status, prompts, models });
  }

  const baseline = loadBaseline(setDir);
  const gates = evaluateGates({
    mode: options.mode,
    metrics,
    modules: statuses,
    baseline: baselineValues(baseline),
  });
  return {
    version: 1,
    set,
    mode: options.mode,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    duration_ms: Math.round(performance.now() - start),
    baseline_found: baseline !== null,
    modules,
    gates,
    summary: summarize(gates),
  };
}
```

   Commit `0024b step 1`.

2. **New `packages/testkit/src/eval/cli.ts`** (exact content):

```ts
import { mkdirSync } from 'node:fs';
import type { LlmClient } from '@shoebox/extraction';
import { GoldenLabelsError, goldenSetDir } from '../golden/index';
import { BaselineError, baselineFromRows, writeBaseline } from './baseline';
import { BASELINE_CHANGE_LABEL, EVAL_MODULES, type EvalMode, type EvalModule } from './gates';
import { renderMarkdown, writeReports } from './report';
import { EvalSetupError, type ModuleAdapter, runEval } from './run';

export const USAGE = `Usage: pnpm eval [--quick | --record | --live] [--module M01..M05]... [--out <dir>]
                 [--update-baseline] [--set-dir <dir>]

  --quick            replay cassettes, in-memory pipeline (CI and test-map; seconds, free)
  --record           call the live LLM and write missing cassettes (dev budget)
  --live             call the live LLM, write nothing (nightly, model/prompt changes)
  --module <M>       run only this module (repeatable or comma-separated; 'validation' = M03)
  --out <dir>        where eval-report.json and eval-report.md go (default: current directory)
  --update-baseline  write <set>/baseline.json from this run (PR label eval:baseline-change)
  --set-dir <dir>    golden set directory (default: testdata/golden-v1)

Exit codes: 0 every gate passed or skipped · 1 a gate failed · 2 usage or setup error
`;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export interface CliOptions {
  readonly mode: EvalMode;
  readonly modules?: readonly EvalModule[];
  readonly out: string;
  readonly updateBaseline: boolean;
  readonly setDir?: string;
  readonly help: boolean;
}

const MODULE_ALIASES: Readonly<Record<string, EvalModule>> = {
  classification: 'M01',
  extraction: 'M02',
  validation: 'M03',
  categorization: 'M04',
  vat: 'M05',
};

function parseModule(text: string): EvalModule {
  const upper = text.toUpperCase();
  const found = EVAL_MODULES.find((m) => m === upper);
  if (found !== undefined) return found;
  const alias = MODULE_ALIASES[text.toLowerCase()];
  if (alias !== undefined) return alias;
  throw new CliUsageError(`unknown module '${text}' (expected M01..M05)`);
}

/** Parses `process.argv.slice(2)`. `pnpm eval` with no mode flag is the live run (M12 §4.10). */
export function parseArgs(argv: readonly string[]): CliOptions {
  const modes = new Set<EvalMode>();
  const modules: EvalModule[] = [];
  let out = '.';
  let setDir: string | undefined;
  let updateBaseline = false;
  let help = false;
  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) {
      throw new CliUsageError(`${flag} needs a value`);
    }
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--quick':
        modes.add('replay');
        break;
      case '--record':
        modes.add('record');
        break;
      case '--live':
        modes.add('live');
        break;
      case '--module':
        for (const part of value(arg, argv[i + 1]).split(',')) modules.push(parseModule(part));
        i += 1;
        break;
      case '--out':
        out = value(arg, argv[i + 1]);
        i += 1;
        break;
      case '--set-dir':
        setDir = value(arg, argv[i + 1]);
        i += 1;
        break;
      case '--update-baseline':
        updateBaseline = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new CliUsageError(`unknown argument '${arg ?? ''}'`);
    }
  }
  if (modes.size > 1) {
    throw new CliUsageError('use only one of --quick, --record, --live');
  }
  const mode: EvalMode = modes.values().next().value ?? 'live';
  return {
    mode,
    ...(modules.length > 0 ? { modules: [...new Set(modules)] } : {}),
    out,
    updateBaseline,
    ...(setDir === undefined ? {} : { setDir }),
    help,
  };
}

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Overrides `DEFAULT_ADAPTERS` (tests). */
  readonly adapters?: readonly ModuleAdapter[];
  /** The live LLM client for `--record` / `--live` (none exists yet). */
  readonly live?: LlmClient;
}

const processIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Entry point of `scripts/eval.mjs`. Returns the exit code; never throws for a known error. */
export async function main(argv: readonly string[], io: CliIo = processIo): Promise<0 | 1 | 2> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }
  try {
    const report = await runEval({
      mode: options.mode,
      ...(options.modules === undefined ? {} : { modules: options.modules }),
      ...(io.adapters === undefined ? {} : { adapters: io.adapters }),
      ...(options.setDir === undefined ? {} : { setDir: options.setDir }),
      ...(io.live === undefined ? {} : { live: io.live }),
    });
    mkdirSync(options.out, { recursive: true });
    const paths = writeReports(report, options.out);
    io.stdout(renderMarkdown(report));
    io.stdout(`Wrote ${paths.json} and ${paths.md}\n`);
    if (options.updateBaseline) {
      const dir = options.setDir ?? goldenSetDir(report.set);
      const baseline = baselineFromRows(report.gates, {
        mode: report.mode,
        generatedAt: report.generated_at,
      });
      const path = writeBaseline(dir, baseline);
      io.stdout(
        `Wrote ${path}; commit it with the PR label ${BASELINE_CHANGE_LABEL} and a reason\n`,
      );
    }
    return report.summary.exit_code;
  } catch (error) {
    if (error instanceof GoldenLabelsError) {
      io.stderr(`golden set not loadable (M12 §8 edge case 10): ${error.message}\n`);
      return 2;
    }
    if (error instanceof EvalSetupError || error instanceof BaselineError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
```

   Commit `0024b step 2`.

3. **Edit `packages/testkit/src/eval/index.ts`.** Check the anchor (§2) with `head -3`, then replace the **whole file** with this exact content (Biome sorts the export blocks by module path, which is why `./cli` sits between `./baseline` and `./gates`):

```ts
export {
  BASELINE_FILE,
  type Baseline,
  BaselineError,
  BaselineSchema,
  baselineFromRows,
  baselineValues,
  loadBaseline,
  writeBaseline,
} from './baseline';
export { type CliIo, type CliOptions, CliUsageError, main, parseArgs, USAGE } from './cli';
export {
  BASELINE_CHANGE_LABEL,
  type BaselineValues,
  type CrossGateId,
  EVAL_MODULES,
  type EvalMode,
  type EvalModule,
  type EvaluateGatesInput,
  evaluateGates,
  type FailureRow,
  formatDelta,
  formatMetric,
  GATES,
  type GateDef,
  type GateId,
  type GateRow,
  type GateRule,
  type GateStatus,
  isDrift,
  type MetricValue,
  type ModuleStatus,
  percent,
  rulePasses,
  ruleText,
} from './gates';
export {
  type EvalReport,
  type ModuleReport,
  REPORT_JSON,
  REPORT_MD,
  renderMarkdown,
  summarize,
  writeReports,
} from './report';
export {
  DEFAULT_ADAPTERS,
  type EvalContext,
  EvalSetupError,
  type ModuleAdapter,
  type ModuleRunResult,
  type RunEvalOptions,
  runEval,
} from './run';
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30`. Expected: exit 0. Commit `0024b step 3`.

4. **New `packages/testkit/test/eval-runner.test.ts`** (exact content; never edit it):

```ts
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmRequest } from '@shoebox/extraction';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CliIo,
  CliUsageError,
  DEFAULT_ADAPTERS,
  type EvalContext,
  EvalSetupError,
  type GateId,
  GoldenLabelsError,
  goldenSetDir,
  type MetricValue,
  MISSING_CASSETTE_MESSAGE,
  type ModuleAdapter,
  main,
  parseArgs,
  runEval,
  USAGE,
  writeBaseline,
} from '../src/index';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-runner-'));
  tempDirs.push(dir);
  return dir;
};
/** A set directory with the committed labels and nothing else (no cassettes, no baseline). */
const tempSet = (): string => {
  const dir = tempDir();
  copyFileSync(join(goldenSetDir(), 'labels.json'), join(dir, 'labels.json'));
  return dir;
};

const metric = (hits: number, total: number | null = null): MetricValue => ({
  hits,
  total,
  failures: [],
});

const m02Passing: Partial<Record<GateId, MetricValue>> = {
  'M02.field_accuracy': metric(100, 100),
  'M02.invented_values': metric(0),
  'M02.line_sign': metric(4, 4),
  'M02.partner_name_similarity': metric(12, 12),
};

const adapter = (
  module: ModuleAdapter['module'],
  run: (ctx: EvalContext) => Promise<Partial<Record<GateId, MetricValue>>>,
): ModuleAdapter => ({
  module,
  run: async (ctx) => ({
    metrics: await run(ctx),
    prompts: { extract: 'm02-v1' },
    models: ['haiku-5.5'],
  }),
});

const request: LlmRequest = {
  model: 'claude-haiku-5-5',
  promptVersion: 'm02-v1',
  maxTokens: 10,
  system: [{ type: 'text', text: 'x' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'y' }] }],
};

const io = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
};

describe('runEval', () => {
  it('ships with no adapters: every module SKIPs, no gate fails, labels are still checked', async () => {
    expect(DEFAULT_ADAPTERS).toEqual([]);
    const report = await runEval({ mode: 'replay', setDir: tempSet(), generatedAt: 't' });
    expect(report.modules.map((m) => m.status)).toEqual(
      Array(5).fill({ kind: 'skipped', reason: 'no adapter registered' }),
    );
    expect(report.summary).toEqual({ pass: 2, fail: 0, skip: 20, report: 0, exit_code: 0 });
    expect(report.baseline_found).toBe(false);
    expect(report.generated_at).toBe('t');
  });

  it('runs a registered adapter with the labels and the cassette LLM of the set', async () => {
    const setDir = tempSet();
    let seen: EvalContext | undefined;
    const report = await runEval({
      mode: 'replay',
      setDir,
      adapters: [
        adapter('M02', (ctx) => {
          seen = ctx;
          return Promise.resolve(m02Passing);
        }),
      ],
    });
    expect(seen?.labels.documents).toHaveLength(20);
    expect(seen?.setDir).toBe(setDir);
    expect(seen?.mode).toBe('replay');
    await expect(seen?.llm.complete(request)).rejects.toThrow(MISSING_CASSETTE_MESSAGE);
    const m02 = report.modules.find((m) => m.module === 'M02');
    expect(m02).toMatchObject({
      status: { kind: 'ran' },
      prompts: { extract: 'm02-v1' },
      models: ['haiku-5.5'],
    });
    expect(report.gates.find((g) => g.id === 'M02.field_accuracy')?.status).toBe('PASS');
    expect(report.gates.find((g) => g.id === 'M02.escalation_rate')?.status).toBe('SKIP');
    expect(report.gates.find((g) => g.id === 'M03.math_gate')?.reason).toBe(
      'no adapter registered',
    );
    expect(report.summary.exit_code).toBe(0);
  });

  it('an adapter that throws (e.g. a missing cassette) fails its gates and names the cause', async () => {
    const report = await runEval({
      mode: 'replay',
      setDir: tempSet(),
      adapters: [
        adapter('M02', async (ctx) => ({
          'M02.field_accuracy': metric((await ctx.llm.complete(request)).usage.inputTokens, 1),
        })),
      ],
    });
    const row = report.gates.find((g) => g.id === 'M02.invented_values');
    expect(row?.status).toBe('FAIL');
    expect(row?.reason).toContain(`adapter error: ${MISSING_CASSETTE_MESSAGE}`);
    expect(report.summary.exit_code).toBe(1);
  });

  it('--module selects modules; a selected module without an adapter is a setup error', async () => {
    const adapters = [
      adapter('M02', () => Promise.resolve(m02Passing)),
      adapter('M03', () => Promise.resolve({})),
    ];
    const report = await runEval({ mode: 'replay', setDir: tempSet(), adapters, modules: ['M02'] });
    expect(report.modules.find((m) => m.module === 'M03')?.status).toEqual({
      kind: 'skipped',
      reason: 'not selected',
    });
    expect(report.modules.find((m) => m.module === 'M02')?.status).toEqual({ kind: 'ran' });
    await expect(
      runEval({ mode: 'replay', setDir: tempSet(), adapters, modules: ['M01'] }),
    ).rejects.toThrow(new EvalSetupError('no adapter registered for M01'));
  });

  it('record and live need a live client, which does not exist yet', async () => {
    await expect(runEval({ mode: 'record', setDir: tempSet() })).rejects.toThrow(EvalSetupError);
    await expect(runEval({ mode: 'live', setDir: tempSet() })).rejects.toThrow(/live LlmClient/);
    const report = await runEval({
      mode: 'live',
      setDir: tempSet(),
      live: { complete: () => Promise.reject(new Error('not called')) },
    });
    expect(report.mode).toBe('live');
  });

  it('a broken golden set fails loudly before anything runs (M12 §8 edge case 10)', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'labels.json'), '{"version":"golden-v1"}', 'utf8');
    await expect(runEval({ mode: 'replay', setDir: dir })).rejects.toThrow(GoldenLabelsError);
  });

  it('compares with baseline.json of the set: a passed-then-failed gate is a regression', async () => {
    const setDir = tempSet();
    writeBaseline(setDir, {
      version: 1,
      set: 'golden-v1',
      mode: 'replay',
      generated_at: 't0',
      metrics: { 'M02.field_accuracy': { hits: 100, total: 100 } },
      statuses: { 'M02.field_accuracy': 'PASS' },
    });
    const report = await runEval({
      mode: 'replay',
      setDir,
      adapters: [
        adapter('M02', () =>
          Promise.resolve({ ...m02Passing, 'M02.field_accuracy': metric(97, 100) }),
        ),
      ],
    });
    expect(report.baseline_found).toBe(true);
    expect(report.gates.find((g) => g.id === 'all.regression')).toMatchObject({
      status: 'FAIL',
      reason: expect.stringContaining('M02.field_accuracy'),
    });
    expect(report.summary.exit_code).toBe(1);
  });
});

describe('parseArgs', () => {
  it('maps the flags of the ticket', () => {
    expect(parseArgs(['--quick'])).toEqual({
      mode: 'replay',
      out: '.',
      updateBaseline: false,
      help: false,
    });
    expect(parseArgs([]).mode).toBe('live');
    expect(parseArgs(['--record']).mode).toBe('record');
    expect(parseArgs(['--live']).mode).toBe('live');
    expect(parseArgs(['--quick', '--module', 'M02,m03', '--module', 'validation']).modules).toEqual(
      ['M02', 'M03'],
    );
    expect(parseArgs(['--quick', '--out', 'x', '--set-dir', 'y', '--update-baseline'])).toEqual({
      mode: 'replay',
      out: 'x',
      setDir: 'y',
      updateBaseline: true,
      help: false,
    });
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rejects unknown flags, bad modules and two modes', () => {
    expect(() => parseArgs(['--fast'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--module', 'M09'])).toThrow(/unknown module/);
    expect(() => parseArgs(['--module'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--quick', '--live'])).toThrow(/only one of/);
  });
});

describe('main', () => {
  it('--quick writes both reports in the out dir, prints the markdown and exits 0 in seconds', async () => {
    const setDir = tempSet();
    const out = tempDir();
    const started = Date.now();
    const o = io();
    const code = await main(['--quick', '--out', join(out, 'reports'), '--set-dir', setDir], o);
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(existsSync(join(out, 'reports', 'eval-report.json'))).toBe(true);
    const md = readFileSync(join(out, 'reports', 'eval-report.md'), 'utf8');
    expect(md).toContain('Eval golden-v1 · mode=replay · prompts=none · models=none');
    expect(md).toContain('Modules not run: M01 (no adapter registered)');
    expect(md).toContain('Result: PASS');
    expect(o.out.join('')).toContain(md);
    expect(o.err).toEqual([]);
  });

  it('exits 1 when a gate fails and the markdown names document and field', async () => {
    const failure = {
      file: '4021738955.pdf',
      field: 'lines[3].gross',
      expected: '-16.53',
      got: '16.53',
      source: 'llm',
    };
    const o = io();
    const code = await main(['--quick', '--out', tempDir(), '--set-dir', tempSet()], {
      ...o,
      adapters: [
        adapter('M02', () =>
          Promise.resolve({
            ...m02Passing,
            'M02.line_sign': { hits: 3, total: 4, failures: [failure] },
          }),
        ),
      ],
    });
    expect(code).toBe(1);
    const text = o.out.join('');
    expect(text).toContain('Line sign correctness');
    expect(text).toContain('FAIL (all)');
    expect(text).toContain(
      '- 4021738955.pdf  lines[3].gross  expected -16.53  got 16.53  source=llm',
    );
  });

  it('exits 2 with the usage on a bad flag, on --record without a live client and on a named module with no adapter', async () => {
    const a = io();
    expect(await main(['--nope'], a)).toBe(2);
    expect(a.err.join('')).toContain(USAGE);
    const b = io();
    expect(await main(['--record', '--set-dir', tempSet()], b)).toBe(2);
    expect(b.err.join('')).toContain('live LlmClient');
    const c = io();
    expect(
      await main(['--quick', '--module', 'M02', '--out', tempDir(), '--set-dir', tempSet()], c),
    ).toBe(2);
    expect(c.err.join('')).toContain('no adapter registered for M02');
    expect(existsSync(join(tempDirs[tempDirs.length - 1] ?? '', 'eval-report.json'))).toBe(false);
  });

  it('exits 2 and names the issue paths when labels.json is invalid', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'labels.json'), '{"version":"golden-v1","documents":[]}', 'utf8');
    const o = io();
    expect(await main(['--quick', '--out', tempDir(), '--set-dir', dir], o)).toBe(2);
    expect(o.err.join('')).toContain('golden set not loadable');
    expect(o.err.join('')).toContain('documents');
  });

  it('--update-baseline writes baseline.json into the set directory', async () => {
    const setDir = tempSet();
    const o = io();
    const code = await main(
      ['--quick', '--out', tempDir(), '--set-dir', setDir, '--update-baseline'],
      {
        ...o,
        adapters: [adapter('M02', () => Promise.resolve(m02Passing))],
      },
    );
    expect(code).toBe(0);
    const baseline = JSON.parse(readFileSync(join(setDir, 'baseline.json'), 'utf8')) as {
      metrics: Record<string, unknown>;
      statuses: Record<string, string>;
    };
    expect(Object.keys(baseline.metrics)).toEqual([
      'M02.field_accuracy',
      'M02.invented_values',
      'M02.line_sign',
      'M02.partner_name_similarity',
    ]);
    expect(baseline.statuses['M02.partner_name_similarity']).toBe('REPORT');
    expect(o.out.join('')).toContain('eval:baseline-change');
  });
});
```

   Run `pnpm --filter @shoebox/testkit test eval-runner 2>&1 | tail -30`. Expected: `Tests  14 passed (14)`. Commit `0024b step 4`.

5. **New `scripts/eval.mjs`** (exact content):

```js
// `pnpm eval`: runs the TypeScript eval CLI through Vite's SSR module loader (an approved
// dependency), so no extra TS runner is needed. The logic lives in packages/testkit/src/eval/cli.ts.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: [/^@shoebox\//] },
});
try {
  const cli = await server.ssrLoadModule('/packages/testkit/src/eval/cli.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} finally {
  await server.close();
}
```

   Commit `0024b step 5`.

6. **Edit root `package.json`.** Replace the anchor (§2) with:

```json
    "eval": "node scripts/eval.mjs",
```

   Run `pnpm eval --quick 2>&1 | tail -30`. Expected: the markdown report with every module row `SKIP no adapter registered`, the three live-only rows `SKIP live only`, `Regression … PASS`, `Metric drift > 0.5 pp … PASS`, then `Result: PASS · 2 pass · 0 fail · 20 skip · 0 report · <n> ms` and `Wrote eval-report.json and eval-report.md`; exit code 0 (`echo $?` right after, without the `tail`, if unsure). Commit `0024b step 6`.

7. **Edit `.gitignore`.** After the anchor line (§2) add two lines so the file ends:

```
.DS_Store
eval-report.json
eval-report.md
```

   Run `git status --short 2>&1 | tail -10`. Expected: `eval-report.json` and `eval-report.md` are not listed. Commit `0024b step 7`.

8. Run the remaining §6 commands, write the report (§9), commit `0024b report`, push.

## 5. Do not touch

- `testdata/**` (do not commit a `baseline.json` or any report), `packages/testkit/src/golden/**`, `packages/testkit/src/llm/**`, `packages/testkit/src/registries/**`, `packages/testkit/src/eval/gates.ts`, `baseline.ts`, `report.ts` and `test/eval-gates.test.ts` (0024a), `packages/testkit/package.json`, `pnpm-lock.yaml`, `turbo.json`, `biome.json`, `vitest.*`, `.github/**`, any other package, `docs/v3/**`.
- Hard rules: 1 (metrics stay integers; nothing here computes money), 4 (no real documents; never print label values in errors), 7 (no new dependency: `vite` is already installed at the root; if `node scripts/eval.mjs` cannot import `vite`, STOP and report), 8 (never push to `main`).

## 6. Commands

```
pnpm --filter @shoebox/testkit test eval-runner 2>&1 | tail -30   # Tests 14 passed (14)
pnpm --filter @shoebox/testkit test 2>&1 | tail -30               # all testkit files pass (85 tests)
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30          # exit 0
pnpm exec biome ci packages/testkit scripts/eval.mjs package.json 2>&1 | tail -30   # no errors
pnpm depcruise 2>&1 | tail -5                                     # no dependency violations found
pnpm eval --quick 2>&1 | tail -30                                 # Result: PASS … · 20 skip; exit 0
pnpm eval --quick --module M02 2>&1 | tail -5                     # "no adapter registered for M02", exit 2
pnpm eval 2>&1 | tail -5                                          # "mode live needs a live LlmClient …", exit 2
python3 scripts/context_lint.py 2>&1 | tail -8                    # after writing the report
```

## 7. Acceptance

Ticket P0-EVAL-02 acceptance, the part this brief covers:

- [ ] `pnpm eval --quick` runs offline in < 60 s (about 1 s) on the current repo and writes `eval-report.json` and `eval-report.md`; the markdown is the M12 format (`--quick writes both reports …`).
- [ ] A FAIL row names document and field (`exits 1 when a gate fails …`: `- 4021738955.pdf  lines[3].gross  expected -16.53  got 16.53  source=llm`).
- [ ] CLI flags `--module M01..M05` (and `validation` = M03), `--record`, `--live` are parsed (`maps the flags of the ticket`); `--record`/`--live` without a live client exit 2.
- [ ] Pluggable module adapters: a registered adapter receives the checked labels and the cassette LLM over `<set>/cassettes` (`runs a registered adapter …`); an adapter error, including a missing cassette, fails that module's gates with the cause (`an adapter that throws …`).
- [ ] No pipeline registered: every module `SKIP`, exit 0, and the report says so; a `--module` with no adapter exits 2 (M12 §8 edge case 10 analog, no faked metric).
- [ ] Baseline comparison end to end (`compares with baseline.json of the set …`); `--update-baseline` writes it.
- [ ] Files per §3 only; §6 commands pass.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found, or `packages/testkit/src/eval/` lacks the 0024a files;
- a test fails twice, or a test this brief wrote seems wrong;
- `node scripts/eval.mjs` fails to import `vite` or to load the TypeScript entry (paste the last 10 lines);
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0024b-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -15`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Commit `0024b report`, then `git push -u origin task/0024b-eval-cli 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `packages/testkit/src/eval/run.ts`: `EvalSetupError` for `record`/`live` without a client and for a named module without an adapter; an adapter exception becomes `failed` (never a pass); the cassette store root is `<setDir>/cassettes`.
- `packages/testkit/src/eval/cli.ts`: exit codes; no report is written on exit 2; `--update-baseline` targets the set directory only.
- `scripts/eval.mjs` and root `package.json`: `pnpm eval` no longer goes through turbo; `pnpm eval` without a flag is the live run and exits 2 until the Anthropic client exists.
- Orchestrator follow-ups after merge: one decisions line "`scripts/eval.mjs` runs the TS CLI through Vite's SSR loader; no tsx" and a known-issues line "`pnpm eval --quick` reports every module SKIP until the first pipeline adapter is registered in `DEFAULT_ADAPTERS`"; the P0-CI-02 eval job should treat exit 2 as a failure and post `eval-report.md` as the sticky comment.

## Owner steps

None. The orchestrator opens and merges the PR into `phase/0`.
