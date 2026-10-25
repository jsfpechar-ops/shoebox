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
