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
