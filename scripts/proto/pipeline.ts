// Shared by `pnpm proto:score` and `pnpm proto:serve` (decisions 2026-10-18 [proto]): env and key,
// the disk cache of model answers (testkit cassettes under .cache/, gitignored), one document
// through extraction + checks, and the approximate cost. No document content is ever printed.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LegalDate, Money } from '@shoebox/domain';
import {
  buildProtoRequest,
  createLlmClientFromEnv,
  type LlmClient,
  type LlmEnvConfig,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
  loadDotEnvFile,
  type ProtoExtraction,
  type ProtoMediaType,
  parseProtoExtraction,
} from '@shoebox/extraction';
import type { Locale } from '@shoebox/i18n';
import { createCassetteClient, fsCassetteStore, MissingCassetteError } from '@shoebox/testkit';
import {
  type ProtoOrg,
  type RenderedProtoCheck,
  renderProtoChecks,
  runProtoChecks,
} from '@shoebox/validation';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROTO_CACHE_DIR = join(REPO_ROOT, '.cache', 'proto-cassettes');
export const PROTO_MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * List prices in USD per 1M tokens, by model id (decimal strings, never floats). Claude prices
 * from the claude-api reference (cached 2026-10-06). Gemini: TODO(verify) on ai.google.dev/pricing.
 */
export const PRICES_USD_PER_MTOK: Readonly<Record<string, { input: string; output: string }>> = {
  'claude-sonnet-5-5': { input: '2.00', output: '10.00' },
  'claude-haiku-5-5': { input: '0.10', output: '0.50' },
  'gemini-3.8-flash': { input: '0.30', output: '2.50' },
};
const USD = 'USD';
const MTOK = '1000000';

/** Reads `.env.local` at the repo root (shell wins), then builds the configured client. */
export function loadProtoEnv(): { client: LlmClient; config: LlmEnvConfig } {
  loadDotEnvFile(join(REPO_ROOT, '.env.local'), process.env);
  return createLlmClientFromEnv(process.env);
}

export interface CachingClient extends LlmClient {
  /** Answers served from the cache (identical request hash). */
  readonly hits: () => number;
}

/** Replays a cached answer when one exists, else calls `live` and records it. `fresh` always calls live. */
export function createCachingClient(
  live: LlmClient,
  fresh: boolean,
  root = PROTO_CACHE_DIR,
): CachingClient {
  const store = fsCassetteStore(root);
  const replay = createCassetteClient({ mode: 'replay', store });
  const record = createCassetteClient({ mode: 'record', store, live });
  let hits = 0;
  return {
    hits: () => hits,
    async complete(request) {
      if (!fresh) {
        try {
          const response = await replay.complete(request);
          hits += 1;
          return response;
        } catch (error) {
          if (!(error instanceof MissingCassetteError)) throw error;
        }
      }
      return record.complete(request);
    },
  };
}

export interface ProtoRunInput {
  readonly model: string;
  readonly bytes: Uint8Array;
  readonly mediaType: ProtoMediaType;
  readonly today: LegalDate;
  readonly locale?: Locale;
  /** The user's firm for the buyer check (SHOEBOX_PROTO_ORG_*); absent = skipped. */
  readonly org?: ProtoOrg;
}

export interface ProtoRunResult {
  readonly extraction: ProtoExtraction;
  readonly checks: RenderedProtoCheck[];
  readonly response: LlmResponse;
  readonly attempts: number;
}

export class ProtoRunError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ProtoRunError';
  }
}

export const ICO_RETRY_HINT =
  'Kontrolní číslice IČO dodavatele nesedí. Znovu pečlivě opiš číslice IČO z dokladu. Nic nedomýšlej: pokud IČO na dokladu není nebo ho nepřečteš, vrať "".';

const icoCheckFailed = (checks: readonly RenderedProtoCheck[]): boolean =>
  checks.some((check) => check.id === 'ico_checksum' && check.severity === 'fail');

function withHint(request: LlmRequest, hint: string): LlmRequest {
  const [first, ...rest] = request.messages;
  if (first === undefined) return request;
  return {
    ...request,
    messages: [{ ...first, content: [...first.content, { type: 'text', text: hint }] }, ...rest],
  };
}

/** Parses and checks one answer; null when the answer has no JSON. */
function judge(
  response: LlmResponse,
  input: ProtoRunInput,
): { extraction: ProtoExtraction; checks: RenderedProtoCheck[] } | null {
  if (response.json === null) return null;
  const extraction = parseProtoExtraction(response.json);
  const checks = renderProtoChecks(
    runProtoChecks(
      extraction,
      input.org === undefined ? { today: input.today } : { today: input.today, org: input.org },
    ),
    input.locale ?? 'cs',
  );
  return { extraction, checks };
}

/** One document: model call, normalization, deterministic checks with Czech (or `locale`) messages. */
export async function runProtoDocument(
  client: LlmClient,
  input: ProtoRunInput,
): Promise<ProtoRunResult> {
  const request = buildProtoRequest({
    model: input.model,
    file: { bytes: input.bytes, mediaType: input.mediaType },
  });
  let attempts = 1;
  let response = await client.complete(request);
  if (response.json === null && response.stopReason !== 'refusal') {
    attempts += 1;
    const again = await client.complete(request);
    response = { ...again, usage: addUsage(response.usage, again.usage) };
  }
  if (response.stopReason === 'refusal') throw new ProtoRunError('model refused the document');
  const judged = judge(response, input);
  if (judged === null) {
    throw new ProtoRunError(`no JSON in the answer (stop reason ${response.stopReason})`);
  }
  let best = { response, ...judged };
  let usage = response.usage;
  if (judged.extraction.supplier.ico !== null && icoCheckFailed(judged.checks)) {
    attempts += 1;
    try {
      const hinted = await client.complete(withHint(request, ICO_RETRY_HINT));
      usage = addUsage(usage, hinted.usage);
      const second = judge(hinted, input);
      if (
        second !== null &&
        (second.extraction.supplier.ico === null || !icoCheckFailed(second.checks))
      ) {
        best = { response: hinted, ...second };
      }
    } catch {
      // A failed hinted retry keeps the first answer.
    }
  }
  return {
    extraction: best.extraction,
    checks: best.checks,
    response: { ...best.response, usage },
    attempts,
  };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

export const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** `tokens × price / 1M` as Money (never a float), four decimals of a dollar. Unknown model = "n/a". */
export function estimateCostUsd(usage: LlmUsage, model: string): string {
  const price = PRICES_USD_PER_MTOK[model];
  if (price === undefined) return 'n/a';
  const input = Money.parse(price.input, USD).multiply(String(usage.inputTokens)).divide(MTOK);
  const output = Money.parse(price.output, USD).multiply(String(usage.outputTokens)).divide(MTOK);
  return input.add(output).toDecimal().toFixed(4);
}
