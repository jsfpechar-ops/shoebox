# 0024a: Eval gates, baseline comparison and regression report

Status: todo
Ticket: P0-EVAL-02 (part 1 of 2, part 2 is 0024b) | Depends on: 0020 merged | Base commit: head of phase/0 | Branch: task/0024a-eval-gates | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add the M12 §4.10 gate table, the gate evaluator (PASS / FAIL / SKIP / REPORT per row, plus the cross-cutting regression and drift rows), the `baseline.json` reader/writer and the `eval-report.json` / `eval-report.md` writer to `@shoebox/testkit` under `src/eval/`. Brief 0024b then adds `runEval`, the CLI and `pnpm eval --quick` on top of these pure, fully tested pieces, so a prompt, model or rule change can never pass CI while a golden-set check silently got worse.

## 2. Context

Work mechanically: write each new file with **one Write call** using the exact content below, do not re-read files you just wrote, do not explore the repo. Every code block in §4 was compiled, linted and run by the brief writer on the head of `task/0020-golden-labels` (16 tests pass, typecheck and `biome ci` clean).

**Spec, M12 §4.10 Evaluation harness (pasted, the parts this brief implements):**

> **Metrics and CI gates** (golden-v1 has 20 documents: 12 bookable, 6 decoys, 2 duplicates). The harness implements the metrics once in `packages/testkit/src/eval/metrics/` and the CLI accepts `--module M01|M02|M03|M04|M05`.
>
> | Module | Metric | Gate |
> |---|---|---|
> | M01 | Decoys booked | **= 0** |
> | M01 | Bookable recall | **12/12** |
> | M01 | Class accuracy | ≥ 18/20, report per doc |
> | M01 | Duplicates | **2/2** |
> | M02 | Field accuracy (gated set) | **≥ 98 %** |
> | M02 | Invented values (label null, output non-null, dates and ids) | **= 0** |
> | M02 | Line sign correctness | **100 %** |
> | M02 | Partner name similarity | report only |
> | M03 | Expected validations | recall **100 %** |
> | M03 | False blocking | **= 0** |
> | M03 | Math gate | **100 %** |
> | M04 | VAT treatment | **12/12** |
> | M04 | Category | **≥ 95 %** |
> | M04 | Business flag / question | **100 %** |
> | M04 | Touchless rate | report (target ≥ 80 %) |
> | M05 | DPHDP3 | **exact** |
> | M05 | XSD | **100 %** |
> | all | Regression: a check that passed in `baseline.json` fails now | **= 0** unless the PR updates the baseline and carries label `eval:baseline-change` with a written reason |
> | M02 | Escalation rate (live) | **≤ 5 %** |
> | all | Metric drift: any reported metric worse than baseline | **≤ 0.5 pp** |
> | all | Cost / latency (live) | cost ≤ +20 % vs baseline; latency warn > 1.25 × |
>
> **Regression report** (`eval-report.md`, posted as a sticky PR comment by the CI job):
> ```
> Eval golden-v1 · mode=replay · prompts=extract@7 classify@4 · models=haiku-5.5/sonnet-5.5
> Gate                     Baseline   Now     Δ     Status
> Decoys booked            0          0       0     PASS
> Field accuracy (gated)   98.9 %     97.8 %  −1.1  FAIL (≥ 98 %)
> ...
> Failures
> - 07_booking_aug.pdf  duzp  expected 2026-08-31  got 2026-09-03  source=llm  conf=0.71
> - 15_alza_117.pdf     lines[3].gross  expected -16.53  got 16.53  source=llm
> Cost: 0.0041 USD/doc (baseline 0.0039) · p95 extract 6.2 s
> ```

**Spec, M02 §4.12 (pasted):** "Gates for a prompt/model/schema change: golden field accuracy ≥ 98 % on totals, dates, IČO/DIČ; critical hallucinations = 0; no metric worse by > 0.5 pp vs the current version; mean cost ≤ +20 %; escalation rate ≤ 5 %."

**Decisions made in this brief (orchestrator):**

- A metric is two integers, `{ hits, total | null }` (`total === null` is a plain count). Every gate comparison and the 0.5 pp drift test use integer cross-multiplication; no float ever decides a gate (hard rule 1 spirit). Percentages are formatted only for display.
- Gate ids are `<module>.<name>` strings (`GateId` union); `≥ 18/20` is encoded as `min_pct 90`, `12/12`, `2/2`, `100 %` and `exact` as rule `all` (hits must equal total). Live-only rows (escalation rate, cost, latency) are `SKIP live only` in replay. A module with no adapter gives `SKIP no adapter registered`; a module whose adapter threw gives `FAIL adapter error: …`; a module that ran but did not report a gate's metric gives `FAIL metric not reported` (never a silent pass).
- `baseline.json` lives in `testdata/golden-v1/` next to `labels.json` (0024b writes it with `--update-baseline`); it keeps only measured gates. No file means "first run": regression and drift compare against nothing and the report says so.
- Report values are the synthetic golden labels, so `expected`/`got` in failure rows are allowed in the report (hard rule 4 is about real documents; the set is anonymized per `testdata/golden-v1/README.md`).
- No new dependency: `zod` (already in testkit) and `node:` modules only.

Excerpt the step-6 edit anchors on (`packages/testkit/src/index.ts`, lines 2–3):

```ts
export * from './clock';
export * from './factories/index';
```

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/testkit/src/eval/gates.ts` | new | modules, `MetricValue`, the gate table, `evaluateGates` with regression and drift rows |
| `packages/testkit/src/eval/baseline.ts` | new | `baseline.json` zod schema, `loadBaseline`, `baselineFromRows`, `writeBaseline` |
| `packages/testkit/src/eval/report.ts` | new | `EvalReport` type, `renderMarkdown` (M12 format), `writeReports` |
| `packages/testkit/src/eval/index.ts` | new | re-exports |
| `packages/testkit/src/index.ts` | edit | add exactly one line `export * from './eval/index';` |
| `packages/testkit/test/eval-gates.test.ts` | new | the spec (16 tests) |

No other file may change.

## 4. Steps

0. Setup: `git fetch origin phase/0 && git checkout -b task/0024a-eval-gates origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -5`. Expected: `Done in …`.

1. **New `packages/testkit/src/eval/gates.ts`** (exact content):

```ts
import type { LlmMode } from '@shoebox/extraction';

/** The modules the harness gates (M12 §4.10). */
export const EVAL_MODULES = ['M01', 'M02', 'M03', 'M04', 'M05'] as const;
export type EvalModule = (typeof EVAL_MODULES)[number];
export type EvalMode = LlmMode;

/** PR label that allows a regression or a baseline change (M12 §4.10 gate table, row "Regression"). */
export const BASELINE_CHANGE_LABEL = 'eval:baseline-change';

/** One line of the "Failures" section: which document and field missed, and what was seen. */
export interface FailureRow {
  readonly file: string;
  readonly field: string;
  readonly expected: string;
  readonly got: string;
  /** Where the value came from, e.g. `llm`, `isdoc`, `rule`. */
  readonly source?: string;
  /** Model confidence as reported, already formatted (e.g. `0.71`). */
  readonly confidence?: string;
}

/**
 * A metric as integers: `total === null` is a plain count (`hits` items), otherwise a ratio
 * `hits / total`. Never a float, so gate comparisons and drift are exact.
 */
export interface MetricValue {
  readonly hits: number;
  readonly total: number | null;
  readonly failures: readonly FailureRow[];
}

export type GateId =
  | 'M01.decoys_booked'
  | 'M01.bookable_recall'
  | 'M01.class_accuracy'
  | 'M01.duplicates'
  | 'M02.field_accuracy'
  | 'M02.invented_values'
  | 'M02.line_sign'
  | 'M02.partner_name_similarity'
  | 'M02.escalation_rate'
  | 'M03.expected_validations'
  | 'M03.false_blocking'
  | 'M03.math_gate'
  | 'M04.vat_treatment'
  | 'M04.category'
  | 'M04.business_flag'
  | 'M04.touchless_rate'
  | 'M05.dphdp3'
  | 'M05.xsd'
  | 'all.cost'
  | 'all.latency';

export type CrossGateId = 'all.regression' | 'all.drift';

/**
 * `zero`: count must be 0 · `all`: hits must equal total · `min_pct`: hits/total ≥ pct % ·
 * `max_pct`: hits/total ≤ pct % · `report`: never fails.
 */
export type GateRule =
  | { readonly kind: 'zero' }
  | { readonly kind: 'all' }
  | { readonly kind: 'min_pct'; readonly pct: number }
  | { readonly kind: 'max_pct'; readonly pct: number }
  | { readonly kind: 'report' };

export interface GateDef {
  readonly id: GateId;
  readonly module: EvalModule | 'all';
  readonly label: string;
  readonly rule: GateRule;
  /** Direction of improvement, for the drift gate. */
  readonly better: 'higher' | 'lower';
  /** Only measurable with the live LLM; SKIP in replay. */
  readonly liveOnly?: true;
}

/** The M12 §4.10 gate table, in report order. */
export const GATES: readonly GateDef[] = [
  {
    id: 'M01.decoys_booked',
    module: 'M01',
    label: 'Decoys booked',
    rule: { kind: 'zero' },
    better: 'lower',
  },
  {
    id: 'M01.bookable_recall',
    module: 'M01',
    label: 'Bookable recall',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M01.class_accuracy',
    module: 'M01',
    label: 'Class accuracy',
    rule: { kind: 'min_pct', pct: 90 },
    better: 'higher',
  },
  {
    id: 'M01.duplicates',
    module: 'M01',
    label: 'Duplicates',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M02.field_accuracy',
    module: 'M02',
    label: 'Field accuracy (gated)',
    rule: { kind: 'min_pct', pct: 98 },
    better: 'higher',
  },
  {
    id: 'M02.invented_values',
    module: 'M02',
    label: 'Invented values',
    rule: { kind: 'zero' },
    better: 'lower',
  },
  {
    id: 'M02.line_sign',
    module: 'M02',
    label: 'Line sign correctness',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M02.partner_name_similarity',
    module: 'M02',
    label: 'Partner name similarity',
    rule: { kind: 'report' },
    better: 'higher',
  },
  {
    id: 'M03.expected_validations',
    module: 'M03',
    label: 'Expected validations',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M03.false_blocking',
    module: 'M03',
    label: 'False blocking',
    rule: { kind: 'zero' },
    better: 'lower',
  },
  {
    id: 'M03.math_gate',
    module: 'M03',
    label: 'Math gate',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M04.vat_treatment',
    module: 'M04',
    label: 'VAT treatment',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M04.category',
    module: 'M04',
    label: 'Category',
    rule: { kind: 'min_pct', pct: 95 },
    better: 'higher',
  },
  {
    id: 'M04.business_flag',
    module: 'M04',
    label: 'Business flag / question',
    rule: { kind: 'all' },
    better: 'higher',
  },
  {
    id: 'M04.touchless_rate',
    module: 'M04',
    label: 'Touchless rate',
    rule: { kind: 'report' },
    better: 'higher',
  },
  { id: 'M05.dphdp3', module: 'M05', label: 'DPHDP3', rule: { kind: 'all' }, better: 'higher' },
  { id: 'M05.xsd', module: 'M05', label: 'XSD', rule: { kind: 'all' }, better: 'higher' },
  {
    id: 'M02.escalation_rate',
    module: 'M02',
    label: 'Escalation rate',
    rule: { kind: 'max_pct', pct: 5 },
    better: 'lower',
    liveOnly: true,
  },
  {
    id: 'all.cost',
    module: 'all',
    label: 'Cost per doc',
    rule: { kind: 'report' },
    better: 'lower',
    liveOnly: true,
  },
  {
    id: 'all.latency',
    module: 'all',
    label: 'p95 stage latency',
    rule: { kind: 'report' },
    better: 'lower',
    liveOnly: true,
  },
];

export type GateStatus = 'PASS' | 'FAIL' | 'SKIP' | 'REPORT';

export interface GateRow {
  readonly id: GateId | CrossGateId;
  readonly module: EvalModule | 'all';
  readonly label: string;
  /** Human form of the rule, e.g. `= 0`, `all`, `≥ 98 %`, `report`. */
  readonly rule: string;
  readonly status: GateStatus;
  readonly now: MetricValue | null;
  readonly baseline: MetricValue | null;
  /** `null` when either side is missing. Count: difference. Ratio: percentage points, one decimal. */
  readonly delta: string | null;
  readonly reason: string | null;
}

export type ModuleStatus =
  | { readonly kind: 'ran' }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** Baseline values keyed by gate id; only gates that were measured appear. */
export interface BaselineValues {
  readonly metrics: Readonly<Partial<Record<GateId, MetricValue>>>;
  readonly statuses: Readonly<Partial<Record<GateId, GateStatus>>>;
}

export interface EvaluateGatesInput {
  readonly mode: EvalMode;
  readonly metrics: Readonly<Partial<Record<GateId, MetricValue>>>;
  readonly modules: Readonly<Record<EvalModule, ModuleStatus>>;
  readonly baseline: BaselineValues | null;
}

export function ruleText(rule: GateRule): string {
  switch (rule.kind) {
    case 'zero':
      return '= 0';
    case 'all':
      return 'all';
    case 'min_pct':
      return `≥ ${rule.pct} %`;
    case 'max_pct':
      return `≤ ${rule.pct} %`;
    case 'report':
      return 'report';
  }
}

/** `hits/total` as a percentage with one decimal, exact in integers until the last step. */
export function percent(hits: number, total: number): string {
  if (total === 0) return 'n/a';
  const tenths = Math.round((hits * 1000) / total);
  return `${(tenths / 10).toFixed(1)} %`;
}

export function formatMetric(value: MetricValue | null, rule: GateRule): string {
  if (value === null) return '–';
  if (value.total === null) return String(value.hits);
  if (rule.kind === 'all') return `${value.hits}/${value.total}`;
  return percent(value.hits, value.total);
}

/** Whether a measured value satisfies the rule. Pure integer arithmetic. */
export function rulePasses(rule: GateRule, value: MetricValue): boolean {
  switch (rule.kind) {
    case 'zero':
      return value.hits === 0;
    case 'all':
      return value.total !== null && value.hits === value.total;
    case 'min_pct':
      return value.total !== null && value.total > 0 && value.hits * 100 >= rule.pct * value.total;
    case 'max_pct':
      return value.total !== null && value.total > 0 && value.hits * 100 <= rule.pct * value.total;
    case 'report':
      return true;
  }
}

/** Signed difference now − baseline: a count difference, or percentage points (one decimal). */
export function formatDelta(now: MetricValue, baseline: MetricValue): string {
  if (now.total === null || baseline.total === null) {
    const diff = now.hits - baseline.hits;
    return diff > 0 ? `+${diff}` : String(diff);
  }
  if (now.total === 0 || baseline.total === 0) return 'n/a';
  const tenths =
    Math.round((now.hits * 1000) / now.total) - Math.round((baseline.hits * 1000) / baseline.total);
  const text = (Math.abs(tenths) / 10).toFixed(1);
  return tenths > 0 ? `+${text}` : tenths < 0 ? `-${text}` : '0.0';
}

/**
 * M12 "Metric drift": worse than baseline by more than 0.5 pp (ratios) or by at least one (counts).
 * Integer cross-multiplication, no floats: worse_by > 0.005 ⇔ (b·nT − n·bT)·200 > bT·nT.
 */
export function isDrift(def: GateDef, now: MetricValue, baseline: MetricValue): boolean {
  if (now.total === null || baseline.total === null) {
    const diff = now.hits - baseline.hits;
    return def.better === 'higher' ? diff < 0 : diff > 0;
  }
  if (now.total === 0 || baseline.total === 0) return false;
  const worse =
    def.better === 'higher'
      ? baseline.hits * now.total - now.hits * baseline.total
      : now.hits * baseline.total - baseline.hits * now.total;
  return worse * 200 > baseline.total * now.total;
}

function rowFor(def: GateDef, input: EvaluateGatesInput): GateRow {
  const base = {
    id: def.id,
    module: def.module,
    label: def.label,
    rule: ruleText(def.rule),
    baseline: input.baseline?.metrics[def.id] ?? null,
  };
  const now = input.metrics[def.id] ?? null;
  const moduleStatus: ModuleStatus =
    def.module === 'all' ? { kind: 'ran' } : input.modules[def.module];
  if (def.liveOnly && input.mode === 'replay') {
    return { ...base, status: 'SKIP', now, delta: null, reason: 'live only' };
  }
  if (moduleStatus.kind === 'skipped') {
    return { ...base, status: 'SKIP', now: null, delta: null, reason: moduleStatus.reason };
  }
  if (moduleStatus.kind === 'failed') {
    return { ...base, status: 'FAIL', now: null, delta: null, reason: moduleStatus.reason };
  }
  if (now === null) {
    if (def.module === 'all') {
      return { ...base, status: 'SKIP', now: null, delta: null, reason: 'not reported' };
    }
    return { ...base, status: 'FAIL', now: null, delta: null, reason: 'metric not reported' };
  }
  const delta = base.baseline === null ? null : formatDelta(now, base.baseline);
  if (def.rule.kind === 'report') {
    return { ...base, status: 'REPORT', now, delta, reason: null };
  }
  const passes = rulePasses(def.rule, now);
  return {
    ...base,
    status: passes ? 'PASS' : 'FAIL',
    now,
    delta,
    reason: passes ? null : `(${ruleText(def.rule)})`,
  };
}

function countRow(
  id: CrossGateId,
  label: string,
  count: number,
  names: readonly string[],
  hint: string,
): GateRow {
  return {
    id,
    module: 'all',
    label,
    rule: '= 0',
    status: count === 0 ? 'PASS' : 'FAIL',
    now: { hits: count, total: null, failures: [] },
    baseline: null,
    delta: null,
    reason: count === 0 ? null : `${names.join(', ')}; ${hint}`,
  };
}

/**
 * Evaluates every M12 gate on the measured metrics, then the two cross-cutting rows:
 * regression (PASS in baseline, FAIL now) and drift (worse than baseline by > 0.5 pp).
 */
export function evaluateGates(input: EvaluateGatesInput): GateRow[] {
  const rows = GATES.map((def) => rowFor(def, input));
  const regressions: string[] = [];
  const drifts: string[] = [];
  for (const [index, def] of GATES.entries()) {
    const row = rows[index];
    if (row === undefined || input.baseline === null) continue;
    if (input.baseline.statuses[def.id] === 'PASS' && row.status === 'FAIL') {
      regressions.push(def.id);
    }
    const before = input.baseline.metrics[def.id];
    if (row.now !== null && before !== undefined && isDrift(def, row.now, before)) {
      drifts.push(def.id);
    }
  }
  const hint = `update baseline.json in the same PR and add label ${BASELINE_CHANGE_LABEL} with a written reason`;
  rows.push(countRow('all.regression', 'Regression', regressions.length, regressions, hint));
  rows.push(countRow('all.drift', 'Metric drift > 0.5 pp', drifts.length, drifts, hint));
  return rows;
}
```

   Commit `0024a step 1`.

2. **New `packages/testkit/src/eval/baseline.ts`** (exact content):

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { BaselineValues, EvalMode, GateId, GateRow, MetricValue } from './gates';

export const BASELINE_FILE = 'baseline.json';

const MetricValueSchema = z.object({
  hits: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
});

/** `testdata/<set>/baseline.json`: the last accepted metrics, only measured gates appear. */
export const BaselineSchema = z.object({
  version: z.literal(1),
  set: z.literal('golden-v1'),
  mode: z.enum(['replay', 'record', 'live']),
  generated_at: z.string(),
  metrics: z.record(z.string(), MetricValueSchema),
  statuses: z.record(z.string(), z.enum(['PASS', 'FAIL', 'SKIP', 'REPORT'])),
});
export type Baseline = z.output<typeof BaselineSchema>;

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

/** Reads `baseline.json` from `dir`; `null` when the file does not exist (first run). */
export function loadBaseline(dir: string): Baseline | null {
  const path = join(dir, BASELINE_FILE);
  if (!existsSync(path)) return null;
  const parsed = BaselineSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
    throw new BaselineError(`${path}: invalid baseline at ${issues.join(', ')}`);
  }
  return parsed.data;
}

/** The comparison view of a baseline: metrics and statuses by gate id (failure rows are not kept). */
export function baselineValues(baseline: Baseline | null): BaselineValues | null {
  if (baseline === null) return null;
  const metrics: Partial<Record<GateId, MetricValue>> = {};
  for (const [id, value] of Object.entries(baseline.metrics)) {
    metrics[id as GateId] = { hits: value.hits, total: value.total, failures: [] };
  }
  return { metrics, statuses: baseline.statuses as BaselineValues['statuses'] };
}

/** A new baseline from evaluated gate rows: only rows with a measured value (never SKIP). */
export function baselineFromRows(
  rows: readonly GateRow[],
  options: { readonly mode: EvalMode; readonly generatedAt: string },
): Baseline {
  const metrics: Baseline['metrics'] = {};
  const statuses: Baseline['statuses'] = {};
  for (const row of rows) {
    if (row.id === 'all.regression' || row.id === 'all.drift') continue;
    if (row.now === null || row.status === 'SKIP') continue;
    metrics[row.id] = { hits: row.now.hits, total: row.now.total };
    statuses[row.id] = row.status;
  }
  return {
    version: 1,
    set: 'golden-v1',
    mode: options.mode,
    generated_at: options.generatedAt,
    metrics,
    statuses,
  };
}

export function writeBaseline(dir: string, baseline: Baseline): string {
  const path = join(dir, BASELINE_FILE);
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return path;
}
```

   Commit `0024a step 2`.

3. **New `packages/testkit/src/eval/report.ts`** (exact content):

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type EvalMode,
  type EvalModule,
  type FailureRow,
  formatMetric,
  GATES,
  type GateRow,
  type ModuleStatus,
} from './gates';

export const REPORT_JSON = 'eval-report.json';
export const REPORT_MD = 'eval-report.md';

export interface ModuleReport {
  readonly module: EvalModule;
  readonly status: ModuleStatus;
  /** Prompt versions the module used, e.g. `{ extract: 'm02-v1' }`. */
  readonly prompts: Readonly<Record<string, string>>;
  readonly models: readonly string[];
}

/** `eval-report.json` (M12 §4.10 Regression report). */
export interface EvalReport {
  readonly version: 1;
  readonly set: 'golden-v1';
  readonly mode: EvalMode;
  readonly generated_at: string;
  readonly duration_ms: number;
  readonly baseline_found: boolean;
  readonly modules: readonly ModuleReport[];
  readonly gates: readonly GateRow[];
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
    readonly skip: number;
    readonly report: number;
    /** 0 when no gate failed. */
    readonly exit_code: 0 | 1;
  };
}

export function summarize(rows: readonly GateRow[]): EvalReport['summary'] {
  const count = (status: GateRow['status']) => rows.filter((row) => row.status === status).length;
  const fail = count('FAIL');
  return {
    pass: count('PASS'),
    fail,
    skip: count('SKIP'),
    report: count('REPORT'),
    exit_code: fail === 0 ? 0 : 1,
  };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function header(report: EvalReport): string {
  const prompts = report.modules.flatMap((m) =>
    Object.entries(m.prompts).map(([name, version]) => `${name}@${version}`),
  );
  const models = [...new Set(report.modules.flatMap((m) => m.models))];
  return [
    `Eval ${report.set}`,
    `mode=${report.mode}`,
    `prompts=${prompts.length === 0 ? 'none' : prompts.join(' ')}`,
    `models=${models.length === 0 ? 'none' : models.join('/')}`,
  ].join(' · ');
}

function failureLine(failure: FailureRow): string {
  const parts = [
    `- ${failure.file}`,
    failure.field,
    `expected ${failure.expected}`,
    `got ${failure.got}`,
  ];
  if (failure.source !== undefined) parts.push(`source=${failure.source}`);
  if (failure.confidence !== undefined) parts.push(`conf=${failure.confidence}`);
  return parts.join('  ');
}

/** The sticky-comment text of M12 §4.10: header, gate table, failures, skipped modules. */
export function renderMarkdown(report: EvalReport): string {
  const rules = new Map(GATES.map((def) => [def.id, def.rule]));
  const lines: string[] = [header(report), '```'];
  lines.push(`${pad('Gate', 26)}${pad('Baseline', 11)}${pad('Now', 10)}${pad('Δ', 7)}Status`);
  for (const row of report.gates) {
    const rule = rules.get(row.id as (typeof GATES)[number]['id']) ?? { kind: 'zero' as const };
    const status = row.reason === null ? row.status : `${row.status} ${row.reason}`;
    lines.push(
      `${pad(row.label, 26)}${pad(formatMetric(row.baseline, rule), 11)}${pad(
        formatMetric(row.now, rule),
        10,
      )}${pad(row.delta ?? '–', 7)}${status}`,
    );
  }
  lines.push('```');
  const failures = report.gates.flatMap((row) =>
    row.status === 'FAIL' && row.now !== null ? row.now.failures : [],
  );
  if (failures.length > 0) {
    lines.push('', 'Failures', ...failures.map(failureLine));
  }
  const skipped = report.modules.filter((m) => m.status.kind !== 'ran');
  if (skipped.length > 0) {
    lines.push(
      '',
      `Modules not run: ${skipped
        .map((m) => `${m.module} (${m.status.kind === 'ran' ? '' : m.status.reason})`)
        .join(', ')}`,
    );
  }
  if (!report.baseline_found) {
    lines.push('', 'No baseline.json: regression and drift compare against nothing.');
  }
  const s = report.summary;
  lines.push(
    '',
    `Result: ${s.fail === 0 ? 'PASS' : 'FAIL'} · ${s.pass} pass · ${s.fail} fail · ${s.skip} skip · ${s.report} report · ${report.duration_ms} ms`,
  );
  return `${lines.join('\n')}\n`;
}

/** Writes `eval-report.json` and `eval-report.md` into `dir`; returns both paths. */
export function writeReports(report: EvalReport, dir: string): { json: string; md: string } {
  const json = join(dir, REPORT_JSON);
  const md = join(dir, REPORT_MD);
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(md, renderMarkdown(report), 'utf8');
  return { json, md };
}
```

   Commit `0024a step 3`.

4. **New `packages/testkit/src/eval/index.ts`** (exact content):

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
```

   Commit `0024a step 4`.

5. **New `packages/testkit/test/eval-gates.test.ts`** (exact content; never edit it):

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASELINE_CHANGE_LABEL,
  BaselineError,
  type BaselineValues,
  baselineFromRows,
  baselineValues,
  EVAL_MODULES,
  type EvalModule,
  type EvalReport,
  evaluateGates,
  formatDelta,
  formatMetric,
  GATES,
  type GateId,
  type GateRow,
  isDrift,
  loadBaseline,
  type MetricValue,
  type ModuleStatus,
  percent,
  renderMarkdown,
  rulePasses,
  summarize,
  writeBaseline,
  writeReports,
} from '../src/index';

const metric = (hits: number, total: number | null = null): MetricValue => ({
  hits,
  total,
  failures: [],
});

const allRan = Object.fromEntries(
  EVAL_MODULES.map((m) => [m, { kind: 'ran' } as ModuleStatus]),
) as Record<EvalModule, ModuleStatus>;

const noneRan = Object.fromEntries(
  EVAL_MODULES.map((m) => [
    m,
    { kind: 'skipped', reason: 'no adapter registered' } as ModuleStatus,
  ]),
) as Record<EvalModule, ModuleStatus>;

/** Every gated metric at its passing value (replay mode has no live-only metrics). */
const passing: Partial<Record<GateId, MetricValue>> = {
  'M01.decoys_booked': metric(0),
  'M01.bookable_recall': metric(12, 12),
  'M01.class_accuracy': metric(19, 20),
  'M01.duplicates': metric(2, 2),
  'M02.field_accuracy': metric(99, 100),
  'M02.invented_values': metric(0),
  'M02.line_sign': metric(4, 4),
  'M02.partner_name_similarity': metric(11, 12),
  'M03.expected_validations': metric(6, 6),
  'M03.false_blocking': metric(0),
  'M03.math_gate': metric(12, 12),
  'M04.vat_treatment': metric(12, 12),
  'M04.category': metric(38, 40),
  'M04.business_flag': metric(1, 1),
  'M04.touchless_rate': metric(10, 12),
  'M05.dphdp3': metric(1, 1),
  'M05.xsd': metric(1, 1),
};

const rowById = (rows: readonly GateRow[], id: string): GateRow => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-gates-'));
  tempDirs.push(dir);
  return dir;
};

describe('gate table', () => {
  it('has every M12 §4.10 row once, in modules M01–M05 plus cross-cutting', () => {
    const ids = GATES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'M01.decoys_booked',
      'M01.bookable_recall',
      'M01.class_accuracy',
      'M01.duplicates',
      'M02.field_accuracy',
      'M02.invented_values',
      'M02.line_sign',
      'M02.partner_name_similarity',
      'M03.expected_validations',
      'M03.false_blocking',
      'M03.math_gate',
      'M04.vat_treatment',
      'M04.category',
      'M04.business_flag',
      'M04.touchless_rate',
      'M05.dphdp3',
      'M05.xsd',
      'M02.escalation_rate',
      'all.cost',
      'all.latency',
    ]);
  });

  it('each rule passes and fails on synthetic values', () => {
    expect(rulePasses({ kind: 'zero' }, metric(0))).toBe(true);
    expect(rulePasses({ kind: 'zero' }, metric(1))).toBe(false);
    expect(rulePasses({ kind: 'all' }, metric(12, 12))).toBe(true);
    expect(rulePasses({ kind: 'all' }, metric(11, 12))).toBe(false);
    expect(rulePasses({ kind: 'all' }, metric(0, 0))).toBe(true);
    expect(rulePasses({ kind: 'min_pct', pct: 98 }, metric(98, 100))).toBe(true);
    expect(rulePasses({ kind: 'min_pct', pct: 98 }, metric(979, 1000))).toBe(false);
    expect(rulePasses({ kind: 'min_pct', pct: 90 }, metric(18, 20))).toBe(true);
    expect(rulePasses({ kind: 'min_pct', pct: 90 }, metric(17, 20))).toBe(false);
    expect(rulePasses({ kind: 'max_pct', pct: 5 }, metric(1, 20))).toBe(true);
    expect(rulePasses({ kind: 'max_pct', pct: 5 }, metric(2, 20))).toBe(false);
    expect(rulePasses({ kind: 'report' }, metric(0, 12))).toBe(true);
  });

  it('formats counts, fractions, percentages and deltas without floats in the comparison', () => {
    expect(formatMetric(metric(3), { kind: 'zero' })).toBe('3');
    expect(formatMetric(metric(11, 12), { kind: 'all' })).toBe('11/12');
    expect(formatMetric(metric(989, 1000), { kind: 'min_pct', pct: 98 })).toBe('98.9 %');
    expect(formatMetric(null, { kind: 'zero' })).toBe('–');
    expect(percent(0, 0)).toBe('n/a');
    expect(formatDelta(metric(978, 1000), metric(989, 1000))).toBe('-1.1');
    expect(formatDelta(metric(1), metric(0))).toBe('+1');
    expect(formatDelta(metric(12, 12), metric(12, 12))).toBe('0.0');
  });

  it('drift: worse by more than 0.5 pp, in the direction of the gate', () => {
    const higher = GATES[4];
    const lower = GATES[0];
    if (higher === undefined || lower === undefined) throw new Error('gate table');
    expect(isDrift(higher, metric(985, 1000), metric(990, 1000))).toBe(false);
    expect(isDrift(higher, metric(984, 1000), metric(990, 1000))).toBe(true);
    expect(isDrift(higher, metric(995, 1000), metric(990, 1000))).toBe(false);
    expect(isDrift(lower, metric(1), metric(0))).toBe(true);
    expect(isDrift(lower, metric(0), metric(1))).toBe(false);
  });
});

describe('evaluateGates', () => {
  it('passes every gate on a passing synthetic report, live-only rows SKIP in replay', () => {
    const rows = evaluateGates({
      mode: 'replay',
      metrics: passing,
      modules: allRan,
      baseline: null,
    });
    expect(rows.map((r) => r.id)).toEqual([
      ...GATES.map((g) => g.id),
      'all.regression',
      'all.drift',
    ]);
    const byStatus = summarize(rows);
    expect(byStatus).toEqual({ pass: 17, fail: 0, skip: 3, report: 2, exit_code: 0 });
    expect(rowById(rows, 'M02.escalation_rate').reason).toBe('live only');
    expect(rowById(rows, 'M04.touchless_rate').status).toBe('REPORT');
  });

  it('fails each gate row on its failing value and names the rule', () => {
    const failing: Partial<Record<GateId, MetricValue>> = {
      ...passing,
      'M01.decoys_booked': metric(1),
      'M01.bookable_recall': metric(11, 12),
      'M01.class_accuracy': metric(17, 20),
      'M01.duplicates': metric(1, 2),
      'M02.field_accuracy': metric(97, 100),
      'M02.invented_values': metric(2),
      'M02.line_sign': metric(3, 4),
      'M03.expected_validations': metric(5, 6),
      'M03.false_blocking': metric(1),
      'M03.math_gate': metric(11, 12),
      'M04.vat_treatment': metric(11, 12),
      'M04.category': metric(37, 40),
      'M04.business_flag': metric(0, 1),
      'M05.dphdp3': metric(0, 1),
      'M05.xsd': metric(0, 1),
      'M02.escalation_rate': metric(2, 20),
    };
    const rows = evaluateGates({ mode: 'live', metrics: failing, modules: allRan, baseline: null });
    const failed = rows.filter((r) => r.status === 'FAIL').map((r) => r.id);
    expect(failed).toEqual([
      'M01.decoys_booked',
      'M01.bookable_recall',
      'M01.class_accuracy',
      'M01.duplicates',
      'M02.field_accuracy',
      'M02.invented_values',
      'M02.line_sign',
      'M03.expected_validations',
      'M03.false_blocking',
      'M03.math_gate',
      'M04.vat_treatment',
      'M04.category',
      'M04.business_flag',
      'M05.dphdp3',
      'M05.xsd',
      'M02.escalation_rate',
    ]);
    expect(rowById(rows, 'M02.field_accuracy').reason).toBe('(≥ 98 %)');
    expect(rowById(rows, 'M02.escalation_rate').reason).toBe('(≤ 5 %)');
    expect(rowById(rows, 'all.cost').status).toBe('SKIP');
    expect(summarize(rows).exit_code).toBe(1);
  });

  it('skips the gates of a module with no adapter and fails those of a module whose adapter threw', () => {
    const modules: Record<EvalModule, ModuleStatus> = {
      ...noneRan,
      M02: { kind: 'failed', reason: 'adapter error: missing cassette, run `pnpm eval --record`' },
    };
    const rows = evaluateGates({ mode: 'replay', metrics: {}, modules, baseline: null });
    expect(rowById(rows, 'M01.decoys_booked')).toMatchObject({
      status: 'SKIP',
      now: null,
      reason: 'no adapter registered',
    });
    expect(rowById(rows, 'M02.field_accuracy')).toMatchObject({
      status: 'FAIL',
      reason: 'adapter error: missing cassette, run `pnpm eval --record`',
    });
    expect(rowById(rows, 'all.regression').status).toBe('PASS');
  });

  it('fails a gate whose module ran but did not report the metric', () => {
    const rows = evaluateGates({
      mode: 'replay',
      metrics: Object.fromEntries(Object.entries(passing).filter(([id]) => id !== 'M03.math_gate')),
      modules: allRan,
      baseline: null,
    });
    expect(rowById(rows, 'M03.math_gate')).toMatchObject({
      status: 'FAIL',
      reason: 'metric not reported',
    });
  });

  it('a check that passed in the baseline and fails now is a regression, with the label in the reason', () => {
    const baseline: BaselineValues = {
      metrics: { 'M02.field_accuracy': metric(989, 1000) },
      statuses: { 'M02.field_accuracy': 'PASS' },
    };
    const rows = evaluateGates({
      mode: 'replay',
      metrics: { ...passing, 'M02.field_accuracy': metric(978, 1000) },
      modules: allRan,
      baseline,
    });
    const field = rowById(rows, 'M02.field_accuracy');
    expect(field.status).toBe('FAIL');
    expect(field.delta).toBe('-1.1');
    const regression = rowById(rows, 'all.regression');
    expect(regression.status).toBe('FAIL');
    expect(regression.now?.hits).toBe(1);
    expect(regression.reason).toContain('M02.field_accuracy');
    expect(regression.reason).toContain(BASELINE_CHANGE_LABEL);
    expect(BASELINE_CHANGE_LABEL).toBe('eval:baseline-change');
    const drift = rowById(rows, 'all.drift');
    expect(drift.status).toBe('FAIL');
    expect(drift.reason).toContain('M02.field_accuracy');
  });

  it('a gate that still passes but is worse by more than 0.5 pp is drift, not regression', () => {
    const baseline: BaselineValues = {
      metrics: { 'M04.category': metric(40, 40) },
      statuses: { 'M04.category': 'PASS' },
    };
    const rows = evaluateGates({
      mode: 'replay',
      metrics: { ...passing, 'M04.category': metric(39, 40) },
      modules: allRan,
      baseline,
    });
    expect(rowById(rows, 'M04.category').status).toBe('PASS');
    expect(rowById(rows, 'all.regression').status).toBe('PASS');
    expect(rowById(rows, 'all.drift')).toMatchObject({
      status: 'FAIL',
      reason: expect.stringContaining('M04.category'),
    });
  });

  it('a gate that failed in the baseline and fails now is not a regression', () => {
    const baseline: BaselineValues = {
      metrics: { 'M01.class_accuracy': metric(17, 20) },
      statuses: { 'M01.class_accuracy': 'FAIL' },
    };
    const rows = evaluateGates({
      mode: 'replay',
      metrics: { ...passing, 'M01.class_accuracy': metric(17, 20) },
      modules: allRan,
      baseline,
    });
    expect(rowById(rows, 'M01.class_accuracy').status).toBe('FAIL');
    expect(rowById(rows, 'all.regression').status).toBe('PASS');
    expect(rowById(rows, 'all.drift').status).toBe('PASS');
  });
});

describe('baseline file', () => {
  it('round-trips through baseline.json and keeps only measured gates', () => {
    const dir = tempDir();
    expect(loadBaseline(dir)).toBeNull();
    const rows = evaluateGates({
      mode: 'replay',
      metrics: passing,
      modules: allRan,
      baseline: null,
    });
    const baseline = baselineFromRows(rows, {
      mode: 'replay',
      generatedAt: '2026-10-18T00:00:00Z',
    });
    expect(Object.keys(baseline.metrics)).toHaveLength(17);
    expect(baseline.metrics['M02.escalation_rate']).toBeUndefined();
    expect(baseline.statuses['M04.touchless_rate']).toBe('REPORT');
    writeBaseline(dir, baseline);
    const loaded = loadBaseline(dir);
    expect(loaded).toEqual(baseline);
    expect(baselineValues(loaded)?.metrics['M02.field_accuracy']).toEqual(metric(99, 100));
    expect(baselineValues(null)).toBeNull();
  });

  it('rejects a malformed baseline.json naming the path only', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ version: 2 }), 'utf8');
    expect(() => loadBaseline(dir)).toThrow(BaselineError);
    expect(() => loadBaseline(dir)).toThrow(/invalid baseline at version/);
  });
});

describe('report', () => {
  const report = (rows: readonly GateRow[], modules: EvalReport['modules']): EvalReport => ({
    version: 1,
    set: 'golden-v1',
    mode: 'replay',
    generated_at: '2026-10-18T00:00:00Z',
    duration_ms: 42,
    baseline_found: true,
    modules,
    gates: rows,
    summary: summarize(rows),
  });

  it('renders the M12 regression report with a FAIL row naming document and field', () => {
    const failure = {
      file: '07_booking_aug.pdf',
      field: 'duzp',
      expected: '2026-08-31',
      got: '2026-09-03',
      source: 'llm',
      confidence: '0.71',
    };
    const metrics: Partial<Record<GateId, MetricValue>> = {
      ...passing,
      'M02.field_accuracy': { hits: 978, total: 1000, failures: [failure] },
    };
    const baseline: BaselineValues = {
      metrics: { 'M02.field_accuracy': metric(989, 1000), 'M01.decoys_booked': metric(0) },
      statuses: { 'M02.field_accuracy': 'PASS', 'M01.decoys_booked': 'PASS' },
    };
    const rows = evaluateGates({ mode: 'replay', metrics, modules: allRan, baseline });
    const md = renderMarkdown(
      report(rows, [
        {
          module: 'M02',
          status: { kind: 'ran' },
          prompts: { extract: '7' },
          models: ['haiku-5.5'],
        },
      ]),
    );
    expect(
      md.startsWith('Eval golden-v1 · mode=replay · prompts=extract@7 · models=haiku-5.5\n'),
    ).toBe(true);
    expect(md).toContain('Gate                      Baseline   Now       Δ      Status');
    expect(md).toContain('Decoys booked             0          0         0      PASS');
    expect(md).toContain('Field accuracy (gated)    98.9 %     97.8 %    -1.1   FAIL (≥ 98 %)');
    expect(md).toContain('Escalation rate           –          –         –      SKIP live only');
    expect(md).toContain('\nFailures\n');
    expect(md).toContain(
      '- 07_booking_aug.pdf  duzp  expected 2026-08-31  got 2026-09-03  source=llm  conf=0.71',
    );
    expect(md).toContain('Result: FAIL');
  });

  it('says which modules did not run and that no baseline exists', () => {
    const rows = evaluateGates({ mode: 'replay', metrics: {}, modules: noneRan, baseline: null });
    const md = renderMarkdown({
      ...report(
        rows,
        EVAL_MODULES.map((module) => ({
          module,
          status: { kind: 'skipped', reason: 'no adapter registered' },
          prompts: {},
          models: [],
        })),
      ),
      baseline_found: false,
    });
    expect(md).toContain('prompts=none · models=none');
    expect(md).toContain(
      'Modules not run: M01 (no adapter registered), M02 (no adapter registered)',
    );
    expect(md).toContain('No baseline.json');
    expect(md).not.toContain('Failures');
    expect(md).toContain('Result: PASS · 2 pass · 0 fail · 20 skip · 0 report');
  });

  it('writes eval-report.json and eval-report.md', () => {
    const dir = tempDir();
    const rows = evaluateGates({
      mode: 'replay',
      metrics: passing,
      modules: allRan,
      baseline: null,
    });
    const paths = writeReports(report(rows, []), dir);
    expect(paths).toEqual({ json: join(dir, 'eval-report.json'), md: join(dir, 'eval-report.md') });
    const parsed = JSON.parse(readFileSync(paths.json, 'utf8')) as EvalReport;
    expect(parsed.summary).toEqual({ pass: 17, fail: 0, skip: 3, report: 2, exit_code: 0 });
    expect(parsed.gates).toHaveLength(22);
    expect(readFileSync(paths.md, 'utf8')).toContain('Result: PASS');
  });
});
```

   Commit `0024a step 5`.

6. **Edit `packages/testkit/src/index.ts`.** Replace the anchor (§2) so the lines read:

```ts
export * from './clock';
export * from './eval/index';
export * from './factories/index';
```

   Run `pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30 && pnpm --filter @shoebox/testkit test eval-gates 2>&1 | tail -30`.
   Expected: typecheck exits 0; `Tests  16 passed (16)`. Commit `0024a step 6`.

7. Run the remaining §6 commands, write the report (§9), commit `0024a report`, push.

## 5. Do not touch

- `testdata/**`, `packages/testkit/src/golden/**`, `packages/testkit/src/llm/**`, `packages/testkit/src/registries/**`, `packages/testkit/package.json`, `pnpm-lock.yaml`, root config (`package.json`, `turbo.json`, `biome.json`, `.gitignore`), `scripts/**`, any other package, `docs/v3/**`. Brief 0024b owns `run.ts`, `cli.ts`, `scripts/eval.mjs` and the root script: do not create them here.
- Hard rules: 1 (no float decides a gate; metrics are integers), 4 (no real document content; tests use synthetic values only), 7 (no new dependency), 8 (never push to `main`).

## 6. Commands

```
pnpm --filter @shoebox/testkit test eval-gates 2>&1 | tail -30   # Tests 16 passed (16)
pnpm --filter @shoebox/testkit test 2>&1 | tail -30              # all testkit files pass (71 tests)
pnpm --filter @shoebox/testkit typecheck 2>&1 | tail -30         # exit 0
pnpm exec biome ci packages/testkit 2>&1 | tail -30              # no errors (one pre-existing info about biome.json is fine)
python3 scripts/context_lint.py 2>&1 | tail -8                   # after writing the report
```

## 7. Acceptance

Ticket P0-EVAL-02 acceptance, the part this brief covers:

- [ ] `packages/testkit/test/eval-gates.test.ts`: every M12 gate row PASS and FAIL on synthetic reports (`passes every gate …`, `fails each gate row …`).
- [ ] A check that passed in `baseline.json` and fails now is a regression (`… is a regression, with the label in the reason`); the label `eval:baseline-change` is the exported constant `BASELINE_CHANGE_LABEL` and appears in the FAIL reason.
- [ ] Drift > 0.5 pp is a separate FAIL row and never a float comparison (`isDrift`).
- [ ] A FAIL row names document and field in `eval-report.md` in the M12 format (`renders the M12 regression report …`).
- [ ] `baseline.json` round-trips and keeps only measured gates.
- [ ] Files per §3 only; §6 commands pass.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test this brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0024a-report.md` (600 tokens at most) and set `Status: review` in this file. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -15`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left.

Commit `0024a report`, then `git push -u origin task/0024a-eval-gates 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `packages/testkit/src/eval/gates.ts`: the gate table against the M12 table (thresholds, `all` vs `min_pct`, live-only flags), `rulePasses` and `isDrift` integer arithmetic, the "metric not reported" FAIL.
- `packages/testkit/src/eval/baseline.ts`: only measured rows enter a baseline; `SKIP` never does.
- `packages/testkit/src/eval/report.ts`: failure lines carry file and field; nothing else is printed.

## Owner steps

None. The orchestrator opens and merges the PR into `phase/0`.
