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
