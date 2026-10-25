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
