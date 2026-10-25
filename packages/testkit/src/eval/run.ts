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
