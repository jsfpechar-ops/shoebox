// `pnpm proto:score [--fresh] [--set-dir <dir>]`: every golden-v1 document through the prototype
// extraction and checks, compared with labels.json. Sequential (free-tier rate limits), answers
// cached under .cache/proto-cassettes so a rerun is free; `--fresh` calls the model again.
// Output: per-field accuracy, per-document mismatches (field values only), check counts, cost.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLegalDate } from '@shoebox/domain';
import { LlmKeyMissingError, protoMediaTypeOf } from '@shoebox/extraction';
import { t } from '@shoebox/i18n';
import {
  compareProtoDocument,
  goldenSetDir,
  loadGoldenLabels,
  type ProtoDocumentScore,
  protoAccuracy,
  renderProtoAccuracy,
  renderProtoMismatches,
} from '@shoebox/testkit';
import {
  addUsage,
  createCachingClient,
  estimateCostUsd,
  loadProtoEnv,
  runProtoDocument,
  ZERO_USAGE,
} from './pipeline';

export const USAGE = `Usage: pnpm proto:score [--fresh] [--set-dir <dir>]

  --fresh          ignore cached answers and call the model again
  --set-dir <dir>  golden set directory (default: testdata/golden-v1)
`;

export interface ScoreOptions {
  readonly fresh: boolean;
  readonly setDir: string;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): ScoreOptions {
  let fresh = false;
  let setDir = goldenSetDir();
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fresh') fresh = true;
    else if (arg === '--set-dir') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--set-dir needs a value');
      setDir = next;
      i += 1;
    } else if (arg === '--help' || arg === '-h') help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return { fresh, setDir, help };
}

const out = (text: string): void => {
  process.stdout.write(text);
};

export async function main(argv: readonly string[]): Promise<number> {
  let options: ScoreOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    out(USAGE);
    return 0;
  }
  let env: ReturnType<typeof loadProtoEnv>;
  try {
    env = loadProtoEnv();
  } catch (error) {
    if (error instanceof LlmKeyMissingError) {
      out(`${t('proto.cli.no_key', { keyEnv: error.keyEnv })}\n`);
      return 2;
    }
    throw error;
  }
  const client = createCachingClient(env.client, options.fresh);
  const labels = loadGoldenLabels({ dir: options.setDir });
  const today = parseLegalDate(labels.taxpayer.today);
  const docs: ProtoDocumentScore[] = [];
  const checkLines: string[] = [];
  const failures: string[] = [];
  let usage = ZERO_USAGE;
  let calls = 0;
  out(
    `${env.config.provider} ${env.config.model}, ${labels.documents.length} labels, today ${today}\n`,
  );
  for (const label of labels.documents) {
    if (label.duplicate_of !== null) continue;
    const mediaType = protoMediaTypeOf(label.file);
    if (mediaType === null) {
      failures.push(
        t('proto.cli.document_failed', { file: label.file, detail: 'unsupported type' }),
      );
      continue;
    }
    const bytes = readFileSync(join(options.setDir, 'docs', label.file));
    try {
      const result = await runProtoDocument(client, {
        model: env.config.model,
        bytes,
        mediaType,
        today,
      });
      calls += 1;
      usage = addUsage(usage, result.response.usage);
      docs.push({ file: label.file, fields: compareProtoDocument(label, result.extraction) });
      const counts = { pass: 0, warn: 0, fail: 0 };
      for (const check of result.checks) counts[check.severity] += 1;
      const failing = result.checks
        .filter((check) => check.severity !== 'pass')
        .map((check) => `  ${check.severity} ${check.id}: ${check.message}`);
      checkLines.push(`${label.file}: ${counts.pass}/${counts.warn}/${counts.fail}`, ...failing);
      out('.');
    } catch (error) {
      failures.push(
        t('proto.cli.document_failed', { file: label.file, detail: (error as Error).message }),
      );
      out('x');
    }
  }
  out('\n\n');
  out(renderProtoAccuracy(protoAccuracy(docs), t('proto.cli.table_header')));
  out(`\n${t('proto.cli.mismatches')}\n${renderProtoMismatches(docs) || '-\n'}`);
  out(`\n${t('proto.cli.checks')}\n${checkLines.join('\n')}\n`);
  if (failures.length > 0) out(`\n${failures.join('\n')}\n`);
  out(
    `\n${t('proto.cli.cost', {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cost: estimateCostUsd(usage, env.config.model),
      cached: client.hits(),
    })}\n`,
  );
  return failures.length === 0 && calls > 0 ? 0 : 1;
}
