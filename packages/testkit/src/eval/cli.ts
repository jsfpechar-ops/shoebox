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
