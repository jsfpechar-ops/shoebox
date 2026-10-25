// `pnpm proto:serve`: one local page at http://localhost:4000 (decisions 2026-10-18 [proto]). No login,
// no database, no storage: the uploaded file lives in memory for one request. Plain node:http.
// GET / is the page, GET /tokens.css the design-system tokens, POST /api/extract the pipeline.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pragueDateOf } from '@shoebox/domain';
import {
  isProtoMediaType,
  type LlmClient,
  LlmKeyMissingError,
  PROTO_PROMPT_VERSION,
} from '@shoebox/extraction';
import { catalogs, createT, type Locale, type MessageKey } from '@shoebox/i18n';
import { flattenProtoExtraction } from '@shoebox/testkit';
import { type ProtoOrg, parseProtoOrg } from '@shoebox/validation';
import { AUTH_REALM, isAuthorized, listenAddress } from './auth';
import {
  createCachingClient,
  estimateCostUsd,
  loadProtoEnv,
  PROTO_MAX_FILE_BYTES,
  REPO_ROOT,
  runProtoDocument,
} from './pipeline';

export const PROTO_PORT = 4000;

const PAGE_DIR = new URL('.', import.meta.url);
const TOKENS_CSS = join(REPO_ROOT, 'packages', 'ui', 'src', 'tokens.css');

/** Every string the page shows; injected as JSON so the browser code has no literal copy. */
export const PAGE_KEYS: readonly MessageKey[] = [
  'proto.page.title',
  'proto.page.subtitle',
  'proto.page.warning',
  'proto.page.drop',
  'proto.page.pick',
  'proto.page.processing',
  'proto.page.fields',
  'proto.page.checks',
  'proto.page.no_checks',
  'proto.page.usage',
  'proto.page.error_llm',
  'proto.page.error_type',
  'proto.page.error_size',
  'proto.page.empty',
  'proto.field.class',
  'proto.field.supplier_name',
  'proto.field.supplier_ico',
  'proto.field.supplier_dic',
  'proto.field.document_number',
  'proto.field.variable_symbol',
  'proto.field.issue_date',
  'proto.field.duzp',
  'proto.field.due_date',
  'proto.field.currency',
  'proto.field.total_gross',
  'proto.field.vat_lines',
  'proto.field.not_tax_document',
  'proto.review.queue',
  'proto.review.progress',
  'proto.review.status_waiting',
  'proto.review.status_reading',
  'proto.review.status_ready',
  'proto.review.status_labeled',
  'proto.review.status_error',
  'proto.review.empty_hint',
  'proto.review.note',
  'proto.review.save',
  'proto.review.reread',
  'proto.review.download',
  'proto.review.clear',
  'proto.review.clear_confirm',
  'proto.review.storage_error',
  'proto.review.download_nag',
  'proto.review.preview_none',
  'proto.class.received_invoice',
  'proto.class.received_receipt',
  'proto.class.non_document',
  'proto.class.received_credit_note',
  'proto.class.received_proforma',
  'proto.class.received_advance_tax_doc',
  'proto.class.order_confirmation',
  'proto.class.settlement_statement',
  'proto.class.government_filing',
  'proto.class.unknown',
  'proto.class.unreadable',
  'proto.review.duplicate',
];

/** page.html with the labels JSON and language filled in. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** page.html with `{{key}}` placeholders rendered, the labels JSON and the language filled in. */
export function pageHtml(locale: Locale): string {
  const labels: Record<string, string> = {};
  for (const key of PAGE_KEYS) labels[key] = catalogs[locale][key];
  const json = JSON.stringify(labels).replace(/</g, '\\u003c');
  return readFileSync(new URL('page.html', PAGE_DIR), 'utf8')
    .replace('<html lang="cs">', `<html lang="${locale}">`)
    .replace(/\{\{([a-z0-9_.]+)\}\}/g, (_match, key: string) => {
      const label = labels[key];
      if (label === undefined) throw new Error(`page.html uses an unknown key ${key}`);
      return escapeHtml(label);
    })
    .replace('"__LABELS__"', json);
}

export interface ProtoServerOptions {
  /** Resolved on the first upload, so the page opens without a key and the error shows there. */
  readonly getClient: () => { client: LlmClient; model: string; provider: string };
  readonly locale?: Locale;
  readonly now?: () => number;
  /** HTTP Basic password for the hosted page (PROTO_PASSWORD); unset or empty = open. */
  readonly password?: string | undefined;
  /** The user's firm for the buyer check; absent = skipped. */
  readonly org?: ProtoOrg;
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

/** The server's facts about one reading, the same for a success and a failure. */
function runFacts(
  target: { model: string; provider: string },
  answeredBy: string,
  mediaType: string,
): Record<string, unknown> {
  return {
    run_id: randomUUID(),
    provider: target.provider,
    model_requested: target.model,
    model: answeredBy,
    prompt_version: PROTO_PROMPT_VERSION,
    effort: null,
    input_mode: mediaType === 'application/pdf' ? 'pdf' : 'image',
    attempt: 1, // TODO(proto-eval): the adapters do not report retries yet
    extracted_at: new Date().toISOString(),
  };
}

export function createProtoServer(options: ProtoServerOptions): Server {
  const locale = options.locale ?? 'cs';
  const t = createT(locale);
  const now = options.now ?? Date.now;
  const html = pageHtml(locale);
  return createServer((request, response) => {
    if (!isAuthorized(request.headers.authorization, options.password)) {
      response.writeHead(401, {
        'www-authenticate': `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
      });
      response.end();
      return;
    }
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/';
    if (request.method === 'GET' && url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && url === '/tokens.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      response.end(readFileSync(TOKENS_CSS, 'utf8'));
      return;
    }
    if (request.method === 'POST' && url === '/api/extract') {
      const mediaType = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      if (!isProtoMediaType(mediaType)) {
        sendJson(response, 415, { error: t('proto.page.error_type') });
        return;
      }
      const body = await readBody(request, PROTO_MAX_FILE_BYTES);
      if (body === null) {
        sendJson(response, 413, {
          error: t('proto.page.error_size', { mb: PROTO_MAX_FILE_BYTES / (1024 * 1024) }),
        });
        return;
      }
      let target: { client: LlmClient; model: string; provider: string };
      try {
        target = options.getClient();
      } catch (error) {
        if (error instanceof LlmKeyMissingError) {
          sendJson(response, 503, { error: t('proto.cli.no_key', { keyEnv: error.keyEnv }) });
          return;
        }
        throw error;
      }
      const startedAt = now();
      try {
        const result = await runProtoDocument(target.client, {
          model: target.model,
          bytes: body,
          mediaType,
          today: pragueDateOf(now()),
          locale,
          ...(options.org === undefined ? {} : { org: options.org }),
        });
        const { response: answer, extraction } = result;
        sendJson(response, 200, {
          run: {
            ...runFacts(target, answer.model, mediaType),
            schema_version: extraction.schema_version,
            ok: true,
            error: null,
            stop_reason: answer.stopReason,
            input_tokens: answer.usage.inputTokens,
            output_tokens: answer.usage.outputTokens,
            cache_read_tokens: answer.usage.cacheReadInputTokens,
            cache_write_tokens: answer.usage.cacheCreationInputTokens,
            cost_usd: estimateCostUsd(answer.usage, target.model),
            latency_ms: answer.latencyMs,
            parse_issues: extraction.issues,
            checks: result.checks.map((check) => ({ id: check.id, severity: check.severity })),
            fields: flattenProtoExtraction(extraction),
            raw_response: answer.text,
          },
          checks: result.checks.map((check) => ({
            id: check.id,
            severity: check.severity,
            message: check.message,
          })),
        });
      } catch (error) {
        sendJson(response, 502, {
          error: t('proto.page.error_llm', { detail: (error as Error).message }),
          run: {
            ...runFacts(target, target.model, mediaType),
            schema_version: '',
            ok: false,
            error: (error as Error).message,
            stop_reason: null,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost_usd: '0.0000',
            latency_ms: Math.max(0, now() - startedAt),
            parse_issues: [],
            checks: [],
            fields: [],
            raw_response: null,
          },
        });
      }
      return;
    }
    sendJson(response, 404, { error: 'not found' });
  }
}

export function main(): Promise<number> {
  let resolved: { client: LlmClient; model: string; provider: string } | undefined;
  const getClient = (): { client: LlmClient; model: string; provider: string } => {
    if (resolved === undefined) {
      const env = loadProtoEnv();
      resolved = {
        client: createCachingClient(env.client, false),
        model: env.config.model,
        provider: env.config.provider,
      };
    }
    return resolved;
  };
  const org = parseProtoOrg(process.env.SHOEBOX_PROTO_ORG_ICO, process.env.SHOEBOX_PROTO_ORG_DIC);
  const server = createProtoServer({
    getClient,
    password: process.env.PROTO_PASSWORD,
    ...(org === undefined ? {} : { org }),
  });
  const { port, host } = listenAddress(process.env, PROTO_PORT);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      process.stdout.write(`proto page: http://localhost:${port}\n`);
    });
    const stop = (): void => {
      server.close(() => resolve(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
