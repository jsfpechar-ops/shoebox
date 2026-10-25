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
