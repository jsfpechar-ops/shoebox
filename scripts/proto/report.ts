/**
 * `pnpm proto:report`: reads proto-results-v2 JSON Lines files and prints the Markdown report
 * (packages/testkit/src/proto/results.ts). Results files live outside the repo (hard rule 4).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildProtoReport,
  type ProtoRunSelector,
  parseProtoResults,
  renderProtoReport,
} from '@shoebox/testkit';

export const USAGE =
  'Usage: pnpm proto:report <results.jsonl>... [--run <prompt>[@model]] [--compare-run <prompt>[@model]] [--out <report.md>]\n';

export interface ReportOptions {
  readonly paths: readonly string[];
  readonly run?: ProtoRunSelector;
  readonly compareRun?: ProtoRunSelector;
  readonly out?: string;
  readonly help: boolean;
}

function selectorOf(text: string | undefined, flag: string): ProtoRunSelector {
  if (text === undefined || text === '') throw new Error(`${flag} needs a value`);
  const [promptVersion, model] = text.split('@');
  if (!promptVersion) throw new Error(`${flag} needs a prompt version`);
  return model ? { promptVersion, model } : { promptVersion };
}

export function parseArgs(argv: readonly string[]): ReportOptions {
  const paths: string[] = [];
  let run: ProtoRunSelector | undefined;
  let compareRun: ProtoRunSelector | undefined;
  let out: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--run' || arg === '--compare-run' || arg === '--out') {
      const next = argv[i + 1];
      i += 1;
      if (arg === '--run') run = selectorOf(next, arg);
      else if (arg === '--compare-run') compareRun = selectorOf(next, arg);
      else if (next === undefined || next === '') throw new Error('--out needs a value');
      else out = next;
    } else if (arg === '--anonymized') {
      throw new Error('--anonymized is not built yet');
    } else if (arg === '--help' || arg === '-h') help = true;
    else if (arg.startsWith('--')) throw new Error(`unknown argument ${arg}`);
    else paths.push(arg);
  }
  if (!help && paths.length === 0) throw new Error('no results file given');
  return {
    paths,
    ...(run ? { run } : {}),
    ...(compareRun ? { compareRun } : {}),
    ...(out ? { out } : {}),
    help,
  };
}

const out = (text: string): void => {
  process.stdout.write(text);
};

export async function main(argv: readonly string[]): Promise<number> {
  let options: ReportOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }
  try {
    const text = options.paths.map((path) => readFileSync(path, 'utf8')).join('\n');
    const report = buildProtoReport(parseProtoResults(text), {
      ...(options.run ? { run: options.run } : {}),
      ...(options.compareRun ? { compareRun: options.compareRun } : {}),
    });
    const markdown = renderProtoReport(report);
    if (options.out) {
      writeFileSync(options.out, markdown, 'utf8');
      out(`report written to ${options.out}\n`);
    } else {
      out(markdown);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
