import type { LlmClient, LlmRequest, LlmResponse, LlmUsage } from '../llm/client';
import {
  buildCategorizeJsonSchema,
  CATEGORIZE_DESCRIPTION_MAX,
  CATEGORIZE_MAX_LINES,
  CATEGORIZE_MAX_TOKENS,
  CATEGORIZE_PROMPT_VERSION,
  CATEGORIZE_SYSTEM_PROMPT,
  type CategorizeCategory,
  CategorizeParseError,
  type CategorizeOutput,
  parseCategorizeOutput,
} from './schema';

export interface CategorizeRequestLine {
  readonly position: number;
  readonly description: string | null;
  readonly gross: string | null;
  readonly lineType: string;
}

export interface CategorizeRequestInput {
  readonly model: string;
  readonly document: {
    readonly class: string;
    readonly direction: 'in' | 'out';
    readonly supplier: { name: string | null; country: string | null; vatPayer: boolean | null; nace: string | null } | null;
    readonly taxDocStatus: string;
    readonly currency: string;
    readonly issueDate: string | null;
    readonly servicePeriod: readonly [string, string] | null;
  };
  readonly business: { readonly activities: readonly string[]; readonly nace: string | null; readonly vatStatus: string };
  readonly lines: readonly CategorizeRequestLine[];
  readonly resolved: Readonly<Record<string, string | null>>; // position → category code already decided, or null
  readonly categories: readonly CategorizeCategory[]; // already filtered by direction and validity by the caller
  readonly fewShots?: string; // optional <examples> body; default ''
}

export interface CategorizeRequest {
  readonly request: LlmRequest;
  readonly codes: readonly string[];
  readonly positions: readonly number[];
}

/** Truncates descriptions, keeps at most CATEGORIZE_MAX_LINES lines (beyond that: identical descriptions grouped, first position kept). */
function compactLines(lines: readonly CategorizeRequestLine[]): CategorizeRequestLine[] {
  const shaped = lines.map((l) => ({
    ...l,
    description: l.description === null ? null : l.description.slice(0, CATEGORIZE_DESCRIPTION_MAX),
  }));
  if (shaped.length <= CATEGORIZE_MAX_LINES) return shaped;
  const seen = new Set<string | null>();
  const grouped: CategorizeRequestLine[] = [];
  for (const l of shaped) {
    if (seen.has(l.description)) continue;
    seen.add(l.description);
    grouped.push(l);
  }
  return grouped.slice(0, CATEGORIZE_MAX_LINES);
}

/** Truncates descriptions to CATEGORIZE_DESCRIPTION_MAX, keeps at most CATEGORIZE_MAX_LINES lines, builds the system block (static text + <categories> + <examples>, `cache: true`) and one user text block. `positions` are the unresolved ones (resolved[pos] === null). */
export function buildCategorizeRequest(input: CategorizeRequestInput): CategorizeRequest {
  const codes = input.categories.map((c) => c.code);
  const schema = buildCategorizeJsonSchema(codes);
  const lines = compactLines(input.lines);
  const positions = lines.filter((l) => input.resolved[String(l.position)] === null).map((l) => l.position);

  const categoryLines = input.categories.map(
    (c) => `${c.code} | ${c.direction} | ${c.taxEffect} | ${c.label} | ${c.explanation}`,
  );
  const systemText = [
    CATEGORIZE_SYSTEM_PROMPT,
    '',
    '<categories>',
    ...categoryLines,
    '</categories>',
    `<examples>${input.fewShots ?? ''}</examples>`,
  ].join('\n');

  const payload = {
    document: {
      class: input.document.class,
      direction: input.document.direction,
      supplier:
        input.document.supplier === null
          ? null
          : {
              name: input.document.supplier.name,
              country: input.document.supplier.country,
              vat_payer: input.document.supplier.vatPayer,
              nace: input.document.supplier.nace,
            },
      tax_doc_status: input.document.taxDocStatus,
      currency: input.document.currency,
      issue_date: input.document.issueDate,
      service_period: input.document.servicePeriod,
    },
    business: {
      activities: input.business.activities,
      nace: input.business.nace,
      vat_status: input.business.vatStatus,
    },
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      gross: l.gross,
      line_type: l.lineType,
    })),
    resolved: input.resolved,
  };

  const request: LlmRequest = {
    model: input.model,
    promptVersion: CATEGORIZE_PROMPT_VERSION,
    maxTokens: CATEGORIZE_MAX_TOKENS,
    effort: 'low',
    system: [{ type: 'text', text: systemText, cache: true }],
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
    output: { type: 'json_schema', name: 'm04_categorize_v1', schema },
  };

  return { request, codes, positions };
}

export interface CategorizeAttempt {
  readonly model: string;
  readonly promptVersion: string;
  readonly attempt: number;
  readonly usage: LlmUsage;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly error: string | null;
}

export type CategorizeRunResult =
  | { readonly ok: true; readonly output: CategorizeOutput; readonly attempts: readonly CategorizeAttempt[] }
  | { readonly ok: false; readonly error: string; readonly attempts: readonly CategorizeAttempt[] };

const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** Calls `llm.complete` at most twice: a CategorizeParseError on the first answer triggers one retry with the same request (attempt 2); a second failure returns ok:false with error 'parse'. A thrown provider error is recorded as attempt with ok:false, error = error.name, and re-thrown (pg-boss retries). */
export async function runCategorize(llm: LlmClient, built: CategorizeRequest): Promise<CategorizeRunResult> {
  const attempts: CategorizeAttempt[] = [];
  const { model, promptVersion } = built.request;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: LlmResponse;
    try {
      response = await llm.complete(built.request);
    } catch (error) {
      attempts.push({
        model,
        promptVersion,
        attempt,
        usage: ZERO_USAGE,
        latencyMs: 0,
        ok: false,
        error: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
    try {
      const output = parseCategorizeOutput(response.json, built.codes, built.positions);
      attempts.push({
        model,
        promptVersion,
        attempt,
        usage: response.usage,
        latencyMs: response.latencyMs,
        ok: true,
        error: null,
      });
      return { ok: true, output, attempts };
    } catch (error) {
      if (!(error instanceof CategorizeParseError)) throw error;
      attempts.push({
        model,
        promptVersion,
        attempt,
        usage: response.usage,
        latencyMs: response.latencyMs,
        ok: false,
        error: 'parse',
      });
    }
  }
  return { ok: false, error: 'parse', attempts };
}
