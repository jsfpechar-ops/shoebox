# 0035: Sentry (EU) scrubber and OpenTelemetry baseline (traces web → job → worker, M12 metrics)

Status: todo
Ticket: P0-PLAT-02 | Depends on: P0-PLAT-01 (logger) and P0-PLAT-04 (job registry), both in phase/0 | Base commit: head of phase/0 | Branch: task/0035-sentry-otel | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
Risk: normal (privacy-relevant: the scrubber decides what leaves the process). Every file is given in full or as an exact anchor; the tests are the spec.

**Dependencies (approved, no new owner decision):** the owner line of 2026-10-18 (P0-OWN-01) in `docs/context/decisions.md` approves "Sentry SDK (EU), OpenTelemetry SDK". This brief pins `@sentry/node@11.4.0`, `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.222.0`: the newest releases at least 14 days old (`renovate.json` `minimumReleaseAge: "14 days"`); the newest overall are `@sentry/node@11.8.0` (2026-10-15) and `@opentelemetry/sdk-node@0.223.0` (2026-10-06). The orchestrator records the exact versions in decisions (as for Playwright 1.56.1).

## 1. Objective

`packages/platform` gains two Node-only modules behind subpath exports: `@shoebox/platform/sentry` (EU-only DSN, every Sentry data-collection category off, a `beforeSend` scrubber that redacts e-mail, IBAN, Czech account numbers, rodné číslo and amounts, and drops request bodies, cookies, headers, user and extra data) and `@shoebox/platform/telemetry` (`startTelemetry(service)` with the OTel Node SDK, 10 % head sampling, the 11 M12 metric instruments, and `traceparent` carried in `job.data.$meta` beside, never inside, the zod payload). The worker's job registry propagates the trace from the enqueuing span to the handler span, and the worker entry point starts both.

## 2. Context

**How to work (strict):** every file is given in full or as an exact anchor. Write each new file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0035 step k"`). Test filter: `pnpm --filter @shoebox/<pkg> test <name>` (no `--`). `pnpm add` prints `Ignored build scripts: protobufjs` (a version-check postinstall of an OTel dependency): that is expected; never run `pnpm approve-builds`.

**Already in phase/0 (do not change beyond this brief):** `packages/platform` (`src/logger/**`, `src/webhooks/**`, `src/index.ts`, `package.json` with `pino` 10.4.0), `apps/worker/src/registry.ts` (`createJobRegistry`, P0-PLAT-04), `apps/worker/src/main.ts`, `apps/worker/test/registry.test.ts` (asserts `boss.send` gets the bare payload outside a span; must keep passing), `.env.example` with `SENTRY_DSN=`. If `apps/worker/src/registry.ts` is missing: STOP.

**Spec M12 §4.7 (pasted):** "Tracing: OpenTelemetry SDK (`@opentelemetry/sdk-node`) in web and worker, OTLP → Google Cloud Trace (same vendor). Trace context propagated web → pg-boss job (`traceparent` in job metadata, not payload) → worker → LLM gateway → registries. Sampling: 10 % default, 100 % for errors and for spans > 5 s. Errors: Sentry (EU), `sendDefaultPii: false`, `beforeSend` scrubber (removes request bodies, cookies, query strings except allowlisted keys, and redacts patterns: e-mail, IBAN, Czech account numbers, RČ, amounts paired with names). Release = git SHA; source maps uploaded in CI, not served. Metrics (OTel → Cloud Monitoring): `pipeline_stage_duration_seconds{stage,method}`, `upload_to_ready_seconds` (histogram), `documents_total{status}`, `jobs_failed_total{name}`, `job_queue_depth{name}`, `dlq_size{name}`, `llm_calls_total{model,stage}`, `llm_cost_usd_total{model}`, `registry_requests_total{source,outcome}`, `web_request_duration_seconds{route}`, `inbound_emails_total{outcome}`." **§9 AC-9:** "Sentry `beforeSend` redacts an RČ and an e-mail in an error message." **§4.13:** `SENTRY_DSN` is env for web, worker, CI.

**Rules:** 4 (no document content or personal data in Sentry or traces; EU region only), 7 (dependencies above only), 1 (`llm_cost_usd_total` is a monitoring counter; ledger amounts stay `Money`). Test values are synthetic: the RČ, IBAN and account number in `sentry-scrub.test.ts` fail their checksums on purpose, so `scripts/pii_guard.py` does not flag them.

**Choices made by the brief writer (verified in a scratch copy with the three packages installed: platform typecheck, the 11 platform tests, the registry tests including the new trace test, Biome, depcruise; do not change):**
- Default (confirm at gate): **`@sentry/node` 11 has no `sendDefaultPii` any more**; it was replaced by `dataCollection`, whose defaults collect user info, cookies, headers, all HTTP bodies, query params, DB query data, queue job arguments, gen-AI inputs/outputs and **stack-frame local variables**. `sentryOptions()` sets every one of them off (`urlQueryParams` to the allowlist), which is the v11 form of `sendDefaultPii: false`; the test asserts each field. The backlog acceptance wording "`sendDefaultPii: false`" is met by this equivalent (the orchestrator may reword the backlog line). Staying on Sentry 10 (`10.76.0`, which still has `sendDefaultPii`) is the alternative.
- Sentry handles errors only: `enableOpenTelemetrySetup: false` and no `tracesSampleRate`, so it registers no competing tracer provider; traces go through the OTel SDK.
- EU only: a DSN whose host is not `o<digits>.ingest.de.sentry.io` throws at start. No DSN = Sentry disabled (local, tests, CI).
- Redaction is pattern-based and errs towards over-redaction: every amount with a currency is redacted (names cannot be told apart reliably), an `NN/YYYY` shaped number is treated as an account number.
- Default (confirm at gate): "job metadata" = the reserved top-level key `$meta` of `job.data` (pg-boss 12 has no metadata column). The registry strips it before the zod parse, so handlers and schemas never see it; outside a span (or without telemetry) `job.data` is the bare payload, byte-identical to today.
- Default (confirm at gate): head sampling 10 % (`ParentBasedSampler` + `TraceIdRatioBasedSampler`); "100 % for errors and spans > 5 s" needs tail sampling in an OTel collector, left as `TODO(P0-PLAT-02 gate)`.
- Exporters come from the standard `OTEL_*` variables only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (Cloud Run, deploy ticket); otherwise nothing is exported and nothing dials out. OTel logs are off (`logRecordProcessors: []`): logs stay on pino. No auto-instrumentation package.
- Default (confirm at gate): web wiring (`apps/web/instrumentation.ts`, possibly `@sentry/nextjs`) is a follow-up brief; this one wires the worker. Subpath exports keep `@sentry/node` and the OTel SDK out of every import of `@shoebox/platform`.

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/platform/package.json` + `pnpm-lock.yaml` | edit (by `pnpm add` + one anchor) | 3 dependencies; subpath exports `./sentry`, `./telemetry` |
| `packages/platform/src/sentry.ts` | new | `redact`, `scrubEvent`, `sentryOptions`, `initSentry` |
| `packages/platform/test/sentry-scrub.test.ts` | new | scrubber and options (6 tests) |
| `packages/platform/src/telemetry.ts` | new | `startTelemetry`, `METRIC_NAMES`, `withJobMeta`, `splitJobData`, `runInJobSpan`, `withSpan` |
| `packages/platform/test/telemetry.test.ts` | new | metric names, `traceparent` in metadata (5 tests) |
| `apps/worker/src/registry.ts` | edit (4 anchors) | `$meta` on enqueue, span around each handler |
| `apps/worker/test/registry-trace.test.ts` | new | enqueue in a span → handler span in the same trace |
| `apps/worker/src/main.ts` | edit (whole file) | start telemetry and Sentry before the worker |

No other file may change.

## 4. Steps

Line map of this brief (read a step's code with `Read offset/limit`, not the whole file):
Step 1 code: lines 63–81
Step 2 code: lines 89–330
Step 3 code: lines 338–654
Step 4 code: lines 664–818
Step 5 code: lines 826–851

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0035-sentry-otel origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3 && ls apps/worker/src/registry.ts packages/platform/src/logger/index.ts`. Expected: both paths listed. Otherwise STOP.

**Step 1: dependencies and subpath exports (`packages/platform/package.json`).** First: `pnpm --filter @shoebox/platform add @sentry/node@11.4.0 @opentelemetry/api@1.9.1 @opentelemetry/sdk-node@0.222.0 2>&1 | tail -5`. Expected: `Done in …` (and the `protobufjs` build-script notice). Then edit the exports. Anchor (verbatim):

```json
      "default": "./src/index.ts"
    }
  },
```

Replace with:

```json
      "default": "./src/index.ts"
    },
    "./sentry": {
      "types": "./src/sentry.ts",
      "default": "./src/sentry.ts"
    },
    "./telemetry": {
      "types": "./src/telemetry.ts",
      "default": "./src/telemetry.ts"
    }
  },
```

Command: `node -e "const p = JSON.parse(require('fs').readFileSync('packages/platform/package.json', 'utf8')); console.log(Object.keys(p.exports), p.dependencies)"`. Expected: `[ '.', './sentry', './telemetry' ]` and `{ '@opentelemetry/api': '1.9.1', '@opentelemetry/sdk-node': '0.222.0', '@sentry/node': '11.4.0', pino: '10.4.0' }` (exact versions, no `^`). Commit (includes `pnpm-lock.yaml`).

**Step 2: `packages/platform/src/sentry.ts` and `packages/platform/test/sentry-scrub.test.ts` (new).** Do not edit the test file.

```ts
import type { ErrorEvent, NodeOptions } from '@sentry/node';

/**
 * Sentry (EU), M12 §4.7 Errors: no personal data and no document content ever leaves the process.
 * `@sentry/node` 11 replaced `sendDefaultPii` with `dataCollection`; every category is switched off
 * here, and `beforeSend` scrubs what is left (messages, exception values, breadcrumbs, request).
 */

/** Sentry EU (Frankfurt) ingest host; a DSN for any other region is refused (hard rule 4). */
export const SENTRY_EU_INGEST_HOST = /^o\d+\.ingest\.de\.sentry\.io$/;

/** Query-string keys kept on a request URL; everything else is dropped. */
export const QUERY_ALLOWLIST: readonly string[] = ['page', 'status', 'tab'];

export const REDACTED = '[redacted]';

/** Patterns redacted from every string (M12 §4.7). Order matters: IBAN before account numbers. */
export const REDACTION_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g],
  // Rodné číslo: YYMMDD (month +50 for women, +20/+70 since 2004) with an optional slash, 3–4 digits.
  [
    'rc',
    /\b\d{2}(?:0[1-9]|1[0-2]|2[1-9]|3[0-2]|5[1-9]|6[0-2]|7[1-9]|8[0-2])(?:0[1-9]|[12]\d|3[01])\/?\d{3,4}\b/g,
  ],
  // Czech account number: [prefix-]number/bank code.
  ['account', /\b(?:\d{1,6}-)?\d{2,10}\/\d{4}\b/g],
  // Amounts with a currency: redacted wherever they appear (names cannot be told apart reliably).
  ['amount', /\d[\d  .,]*\s?(?:Kč|CZK|EUR|€|USD|\$)/g],
];

/** Redacts every M12 §4.7 pattern in `text`. */
export function redact(text: string): string {
  let out = text;
  for (const [, pattern] of REDACTION_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

function scrubUrl(url: string): string {
  const [base, query] = url.split('?', 2);
  if (query === undefined) return redact(url);
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(query)) {
    if (QUERY_ALLOWLIST.includes(key)) kept.set(key, value);
  }
  const rest = kept.toString();
  return redact(rest === '' ? (base ?? '') : `${base ?? ''}?${rest}`);
}

/**
 * `beforeSend`: drops request bodies, cookies, headers, user and extra data; keeps only allowlisted
 * query keys; redacts the M12 §4.7 patterns in the message, exception values and breadcrumbs.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  if (scrubbed.message !== undefined) scrubbed.message = redact(scrubbed.message);
  if (scrubbed.logentry !== undefined) {
    scrubbed.logentry = {
      ...scrubbed.logentry,
      ...(scrubbed.logentry.message === undefined
        ? {}
        : { message: redact(scrubbed.logentry.message) }),
      params: [],
    };
  }
  if (scrubbed.exception?.values !== undefined) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((value) =>
        value.value === undefined ? value : { ...value, value: redact(value.value) },
      ),
    };
  }
  if (scrubbed.request !== undefined) {
    const { url, method } = scrubbed.request;
    scrubbed.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url: scrubUrl(url) }),
    };
  }
  if (scrubbed.breadcrumbs !== undefined) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(({ data: _data, message, ...crumb }) =>
      message === undefined ? crumb : { ...crumb, message: redact(message) },
    );
  }
  delete scrubbed.user;
  delete scrubbed.extra;
  delete scrubbed.server_name;
  return scrubbed;
}

export interface SentryConfig {
  /** `SENTRY_DSN`; undefined or empty disables Sentry (local, tests). */
  dsn: string | undefined;
  /** `local` | `staging` | `production`. */
  environment: string;
  /** Git SHA of the build (M12 §4.7: release = git SHA). */
  release: string | undefined;
}

/** The `Sentry.init` options; throws for a DSN outside the EU region. */
export function sentryOptions(config: SentryConfig): NodeOptions {
  const enabled = config.dsn !== undefined && config.dsn !== '';
  if (enabled && !SENTRY_EU_INGEST_HOST.test(new URL(config.dsn ?? '').hostname)) {
    throw new Error('sentry: SENTRY_DSN must point to the EU region (*.ingest.de.sentry.io)');
  }
  return {
    ...(enabled ? { dsn: config.dsn } : {}),
    enabled,
    environment: config.environment,
    ...(config.release === undefined ? {} : { release: config.release }),
    // Errors only: traces go through OpenTelemetry (telemetry.ts), so Sentry registers no tracer provider.
    enableOpenTelemetrySetup: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: { allow: [...QUERY_ALLOWLIST] },
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => {
      const { data: _data, ...rest } = crumb;
      return rest.message === undefined ? rest : { ...rest, message: redact(rest.message) };
    },
  };
}

/** Initializes Sentry for a service; a no-op without `SENTRY_DSN`. */
export async function initSentry(config: SentryConfig): Promise<void> {
  const options = sentryOptions(config);
  if (options.enabled !== true) return;
  const Sentry = await import('@sentry/node');
  Sentry.init(options);
}
```

```ts
import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { REDACTED, redact, scrubEvent, sentryOptions } from '../src/sentry';

// M12 §4.7 Errors and §9 AC-9. Synthetic values only: the RČ, IBAN and account number below fail
// their checksums on purpose (scripts/pii_guard.py), the e-mail is on example.cz.
const RC = '855231/1234';
const IBAN = 'CZ00 0800 0000 0020 0014 5398';
const ACCOUNT = '18-2000145398/0800';
const EMAIL = 'jana.novakova@example.cz';
const EU_DSN = 'https://public@o123456.ingest.de.sentry.io/4500000000000001';

function event(message: string): ErrorEvent {
  return {
    type: undefined,
    message,
    exception: { values: [{ type: 'Error', value: message }] },
    request: {
      method: 'POST',
      url: `https://app.example.cz/inbox?page=2&email=${encodeURIComponent(EMAIL)}`,
      data: '{"partnerName":"Alza.cz a.s."}',
      cookies: { 'sb-access-token': 'secret' },
      headers: { authorization: 'Bearer secret' },
      query_string: `email=${EMAIL}`,
    },
    user: { email: EMAIL, ip_address: '192.0.2.1' },
    extra: { text: 'document text' },
    breadcrumbs: [{ message: `sent to ${EMAIL}`, data: { iban: IBAN } }],
  };
}

describe('Sentry beforeSend scrubber (M12 §4.7, AC-9)', () => {
  it('redacts an RČ, an IBAN, a CZ account number and an e-mail in a message', () => {
    const message = `match failed: rc ${RC}, iban ${IBAN}, account ${ACCOUNT}, mail ${EMAIL}`;
    const out = scrubEvent(event(message));
    expect(out.message).toBe(
      `match failed: rc ${REDACTED}, iban ${REDACTED}, account ${REDACTED}, mail ${REDACTED}`,
    );
    expect(out.exception?.values?.[0]?.value).toBe(out.message);
    const serialized = JSON.stringify(out);
    for (const value of [RC, IBAN, ACCOUNT, EMAIL, '855231', '2000145398']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('redacts an RČ without the slash and an amount with a currency', () => {
    expect(redact('rc 8552311234 owes 12 345,50 Kč')).toBe(`rc ${REDACTED} owes ${REDACTED}`);
  });

  it('drops request body, cookies, headers, user, extra and breadcrumb data; keeps allowlisted query keys', () => {
    const out = scrubEvent(event('boom'));
    expect(out.request).toEqual({ method: 'POST', url: 'https://app.example.cz/inbox?page=2' });
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.breadcrumbs).toEqual([{ message: `sent to ${REDACTED}` }]);
  });
});

describe('sentryOptions', () => {
  it('collects no personal data (the Sentry 11 form of sendDefaultPii: false)', () => {
    const options = sentryOptions({ dsn: EU_DSN, environment: 'staging', release: 'abc123' });
    expect(options).toMatchObject({
      dsn: EU_DSN,
      enabled: true,
      environment: 'staging',
      release: 'abc123',
      enableOpenTelemetrySetup: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
        genAI: { inputs: false, outputs: false },
      },
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(typeof options.beforeSend).toBe('function');
  });

  it('refuses a DSN outside the EU region', () => {
    expect(() =>
      sentryOptions({
        dsn: 'https://public@o123456.ingest.us.sentry.io/1',
        environment: 'production',
        release: undefined,
      }),
    ).toThrow(/EU region/);
  });

  it('is disabled without a DSN', () => {
    const options = sentryOptions({ dsn: undefined, environment: 'local', release: undefined });
    expect(options.enabled).toBe(false);
    expect(options).not.toHaveProperty('dsn');
  });
});
```

Command: `pnpm --filter @shoebox/platform test sentry 2>&1 | tail -6 && pnpm --filter @shoebox/platform typecheck 2>&1 | tail -5`. Expected: `Tests  6 passed`; no `error TS`. Commit.

**Step 3: `packages/platform/src/telemetry.ts` and `packages/platform/test/telemetry.test.ts` (new).** Do not edit the test file.

```ts
import {
  type Context,
  type Counter,
  context,
  type Gauge,
  type Histogram,
  metrics as metricsApi,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { type metrics, NodeSDK, tracing } from '@opentelemetry/sdk-node';

/**
 * OpenTelemetry baseline (M12 §4.7 Tracing, Metrics). Traces: OTLP → Google Cloud Trace, configured
 * by the standard `OTEL_*` environment variables at deploy; sampled 10 % at the root, children follow
 * their parent. Trace context travels web → pg-boss job → worker as `traceparent` in the job's
 * metadata (`job.data.$meta`), never inside the zod payload.
 */

export type ServiceName = 'web' | 'worker';

/**
 * M12 §4.7: head sampling ratio for new traces. TODO(P0-PLAT-02 gate): "100 % for errors and for
 * spans > 5 s" needs tail sampling (an OTel collector); errors reach Sentry in full meanwhile.
 */
export const TRACE_SAMPLE_RATIO = 0.1;

/** The M12 §4.7 metric names, in spec order. */
export const METRIC_NAMES = [
  'pipeline_stage_duration_seconds',
  'upload_to_ready_seconds',
  'documents_total',
  'jobs_failed_total',
  'job_queue_depth',
  'dlq_size',
  'llm_calls_total',
  'llm_cost_usd_total',
  'registry_requests_total',
  'web_request_duration_seconds',
  'inbound_emails_total',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export interface Instruments {
  pipeline_stage_duration_seconds: Histogram;
  upload_to_ready_seconds: Histogram;
  documents_total: Counter;
  jobs_failed_total: Counter;
  job_queue_depth: Gauge;
  dlq_size: Gauge;
  llm_calls_total: Counter;
  /** USD for monitoring only; the ledger amount stays a `Money` (ADR-007). */
  llm_cost_usd_total: Counter;
  registry_requests_total: Counter;
  web_request_duration_seconds: Histogram;
  inbound_emails_total: Counter;
}

export interface TelemetryOptions {
  /** Tests: an in-memory exporter. Default: the OTLP exporter from `OTEL_*` env (none when unset). */
  traceExporter?: tracing.SpanExporter;
  /** Tests: a reader to collect from. Default: none (the deploy ticket adds the Cloud Monitoring exporter). */
  metricReader?: metrics.MetricReader;
  /** Default `TRACE_SAMPLE_RATIO`. */
  sampleRatio?: number;
}

export interface Telemetry {
  readonly instruments: Instruments;
  /** Waits until every ended span is exported (tests read the in-memory exporter after it). */
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** Test helper re-export, so apps need no direct SDK dependency. */
export const InMemorySpanExporter = tracing.InMemorySpanExporter;

function registerInstruments(): Instruments {
  const meter = metricsApi.getMeter('@shoebox/platform');
  const seconds = (name: string, description: string) =>
    meter.createHistogram(name, { unit: 's', description });
  const count = (name: string, description: string) => meter.createCounter(name, { description });
  const gauge = (name: string, description: string) => meter.createGauge(name, { description });
  return {
    pipeline_stage_duration_seconds: seconds(
      'pipeline_stage_duration_seconds',
      'per stage, method',
    ),
    upload_to_ready_seconds: seconds('upload_to_ready_seconds', 'upload to ready'),
    documents_total: count('documents_total', 'documents by status'),
    jobs_failed_total: count('jobs_failed_total', 'failed jobs by name'),
    job_queue_depth: gauge('job_queue_depth', 'queued jobs by name'),
    dlq_size: gauge('dlq_size', 'dead-letter jobs by name'),
    llm_calls_total: count('llm_calls_total', 'LLM calls by model, stage'),
    llm_cost_usd_total: count('llm_cost_usd_total', 'LLM cost in USD by model'),
    registry_requests_total: count('registry_requests_total', 'registry calls by source, outcome'),
    web_request_duration_seconds: seconds('web_request_duration_seconds', 'per route'),
    inbound_emails_total: count('inbound_emails_total', 'inbound e-mails by outcome'),
  };
}

/** Starts the SDK once per process (call before anything else in main). */
export function startTelemetry(service: ServiceName, options: TelemetryOptions = {}): Telemetry {
  // Without an OTLP endpoint (local, tests) nothing is exported; with one (Cloud Run) the SDK builds
  // the OTLP trace and metric exporters from the standard OTEL_* variables.
  const otlp = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const spanProcessors =
    options.traceExporter !== undefined
      ? [new tracing.SimpleSpanProcessor(options.traceExporter)]
      : otlp
        ? undefined
        : [];
  const metricReaders =
    options.metricReader !== undefined ? [options.metricReader] : otlp ? undefined : [];
  const sdk = new NodeSDK({
    serviceName: `shoebox-${service}`,
    sampler: new tracing.ParentBasedSampler({
      root: new tracing.TraceIdRatioBasedSampler(options.sampleRatio ?? TRACE_SAMPLE_RATIO),
    }),
    ...(spanProcessors === undefined ? {} : { spanProcessors }),
    ...(metricReaders === undefined ? {} : { metricReaders }),
    // Logs stay on pino → stdout → Cloud Logging (M12 §4.7 Logs).
    logRecordProcessors: [],
    instrumentations: [],
  });
  sdk.start();
  return {
    instruments: registerInstruments(),
    flush: async () => {
      await Promise.all((spanProcessors ?? []).map((processor) => processor.forceFlush()));
    },
    shutdown: () => sdk.shutdown(),
  };
}

/** Reserved key of `job.data` that carries trace context next to (not inside) the payload. */
export const JOB_META_KEY = '$meta';

export interface JobMeta {
  traceparent?: string;
  tracestate?: string;
}

/** The active trace context as job metadata; empty outside a span or without telemetry. */
export function currentJobMeta(ctx: Context = context.active()): JobMeta {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  const meta: JobMeta = {};
  if (carrier.traceparent !== undefined) meta.traceparent = carrier.traceparent;
  if (carrier.tracestate !== undefined) meta.tracestate = carrier.tracestate;
  return meta;
}

/** `job.data` for pg-boss: the payload plus `$meta` when a trace is active. */
export function withJobMeta<P extends object>(payload: P): P | (P & { [JOB_META_KEY]: JobMeta }) {
  const meta = currentJobMeta();
  return meta.traceparent === undefined ? payload : { ...payload, [JOB_META_KEY]: meta };
}

/** Splits `job.data` into the payload (for the zod schema) and the trace metadata. */
export function splitJobData(data: unknown): { payload: unknown; meta: JobMeta } {
  if (data === null || typeof data !== 'object' || !(JOB_META_KEY in data)) {
    return { payload: data, meta: {} };
  }
  const { [JOB_META_KEY]: raw, ...payload } = data as Record<string, unknown>;
  const meta: JobMeta = {};
  if (raw !== null && typeof raw === 'object') {
    const { traceparent, tracestate } = raw as Record<string, unknown>;
    if (typeof traceparent === 'string') meta.traceparent = traceparent;
    if (typeof tracestate === 'string') meta.tracestate = tracestate;
  }
  return { payload, meta };
}

/** Runs a job handler in a consumer span whose parent is the enqueuing span. */
export function runInJobSpan<T>(jobName: string, meta: JobMeta, run: () => Promise<T>): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, { ...meta });
  const tracer = trace.getTracer('@shoebox/platform');
  return tracer.startActiveSpan(
    `job ${jobName}`,
    { kind: SpanKind.CONSUMER, attributes: { 'messaging.destination.name': jobName } },
    parent,
    async (span) => {
      try {
        return await run();
      } catch (error) {
        // Class name only: messages may carry document content (M12 §4.7).
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : 'unknown',
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** Runs `run` in an active internal span (e.g. a web request that enqueues jobs). */
export function withSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  return trace.getTracer('@shoebox/platform').startActiveSpan(name, async (span) => {
    try {
      return await run();
    } finally {
      span.end();
    }
  });
}
```

```ts
import { trace } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/sdk-node';
import { afterAll, describe, expect, it } from 'vitest';
import {
  InMemorySpanExporter,
  JOB_META_KEY,
  METRIC_NAMES,
  runInJobSpan,
  splitJobData,
  startTelemetry,
  TRACE_SAMPLE_RATIO,
  withJobMeta,
} from '../src/telemetry';

// M12 §4.7 Tracing and Metrics. One SDK per test file (vitest isolates files).
const spans = new InMemorySpanExporter();
const reader = new metrics.PeriodicExportingMetricReader({
  exporter: new metrics.InMemoryMetricExporter(metrics.AggregationTemporality.CUMULATIVE),
  exportIntervalMillis: 3_600_000,
});
const telemetry = startTelemetry('worker', {
  traceExporter: spans,
  metricReader: reader,
  sampleRatio: 1,
});
afterAll(() => telemetry.shutdown());

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;
const PAYLOAD = {
  orgId: 'aaaaaaaa-0000-4000-8000-000000000001',
  documentId: 'bbbbbbbb-0000-4000-8000-000000000002',
};

describe('startTelemetry (M12 §4.7 Metrics)', () => {
  it('samples 10 % of new traces by default', () => {
    expect(TRACE_SAMPLE_RATIO).toBe(0.1);
  });

  it("startTelemetry('worker') registers the M12 metric names", async () => {
    expect(Object.keys(telemetry.instruments).sort()).toEqual([...METRIC_NAMES].sort());
    telemetry.instruments.documents_total.add(1, { status: 'ready' });
    telemetry.instruments.jobs_failed_total.add(1, { name: 'doc.split' });
    telemetry.instruments.job_queue_depth.record(3, { name: 'doc.split' });
    telemetry.instruments.pipeline_stage_duration_seconds.record(0.4, {
      stage: 'split',
      method: 'pdf',
    });
    const { resourceMetrics, errors } = await reader.collect();
    expect(errors).toEqual([]);
    const names = resourceMetrics.scopeMetrics.flatMap((s) =>
      s.metrics.map((m) => m.descriptor.name),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'documents_total',
        'jobs_failed_total',
        'job_queue_depth',
        'pipeline_stage_duration_seconds',
      ]),
    );
    expect(resourceMetrics.resource.attributes['service.name']).toBe('shoebox-worker');
  });
});

describe('trace context in job metadata (M12 §4.7 Tracing)', () => {
  it('a job enqueued inside a span carries traceparent in metadata, not payload', async () => {
    const tracer = trace.getTracer('test');
    const data = tracer.startActiveSpan('web request', (span) => {
      const out = withJobMeta(PAYLOAD);
      span.end();
      return { out, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId };
    });
    const meta = (data.out as Record<string, unknown>)[JOB_META_KEY] as { traceparent: string };
    expect(meta.traceparent).toMatch(TRACEPARENT_RE);
    expect(meta.traceparent).toBe(`00-${data.traceId}-${data.spanId}-01`);

    const { payload } = splitJobData(data.out);
    expect(payload).toEqual(PAYLOAD);
    expect(JSON.stringify(payload)).not.toContain('traceparent');
  });

  it('outside a span the job data is the bare payload', () => {
    expect(withJobMeta(PAYLOAD)).toEqual(PAYLOAD);
    expect(splitJobData(PAYLOAD)).toEqual({ payload: PAYLOAD, meta: {} });
  });

  it('the worker span continues the enqueuing trace', async () => {
    const tracer = trace.getTracer('test');
    const enqueued = tracer.startActiveSpan('web request', (span) => {
      span.end();
      return withJobMeta(PAYLOAD);
    });
    const { meta } = splitJobData(enqueued);
    const [, traceId, spanId] = meta.traceparent?.split('-') ?? [];
    await runInJobSpan('doc.split', meta, async () => undefined);
    await telemetry.flush();
    const job = spans.getFinishedSpans().find((s) => s.name === 'job doc.split');
    expect(job?.spanContext().traceId).toBe(traceId);
    expect(job?.parentSpanContext?.spanId).toBe(spanId);
  });
});
```

Command: `pnpm --filter @shoebox/platform test 2>&1 | tail -6 && pnpm --filter @shoebox/platform typecheck 2>&1 | tail -5`. Expected: `Test Files  5 passed`, `Tests  40 passed` (29 existing + 6 + 5); no `error TS`. Commit.

**Step 4: `apps/worker/src/registry.ts` (edit, 4 anchors) and `apps/worker/test/registry-trace.test.ts` (new).**

Anchor A (verbatim): `import type { Logger } from '@shoebox/platform';`. Replace with:

```ts
import type { Logger } from '@shoebox/platform';
import { runInJobSpan, splitJobData, withJobMeta } from '@shoebox/platform/telemetry';
```

Anchor B (verbatim, in `registerTenant`):

```ts
        const payload = def.payload.parse(job.data);
        await timed({ jobName: def.name, jobId: job.id, orgId: payload.orgId }, () =>
          db.withTenant(payload.orgId, (tx) =>
            handler(payload, {
              tx,
              jobId: job.id,
              attempt: job.retryCount + 1,
              signal: job.signal,
            }),
          ),
        );
```

Replace with:

```ts
        const { payload: data, meta } = splitJobData(job.data);
        const payload = def.payload.parse(data);
        await runInJobSpan(def.name, meta, () =>
          timed({ jobName: def.name, jobId: job.id, orgId: payload.orgId }, () =>
            db.withTenant(payload.orgId, (tx) =>
              handler(payload, {
                tx,
                jobId: job.id,
                attempt: job.retryCount + 1,
                signal: job.signal,
              }),
            ),
          ),
        );
```

Anchor C (verbatim, in `registerSystem`):

```ts
        const payload = def.payload.parse(job.data ?? {});
        await timed({ jobName: def.name, jobId: job.id }, () =>
          handler(payload, { jobId: job.id, attempt: job.retryCount + 1, signal: job.signal }),
        );
```

Replace with:

```ts
        const { payload: data, meta } = splitJobData(job.data ?? {});
        const payload = def.payload.parse(data);
        await runInJobSpan(def.name, meta, () =>
          timed({ jobName: def.name, jobId: job.id }, () =>
            handler(payload, { jobId: job.id, attempt: job.retryCount + 1, signal: job.signal }),
          ),
        );
```

Anchor D (verbatim, in `enqueue`):

```ts
        return boss.send(def.name, data, { id: jobIdFromKey(key), singletonKey: key });
      }
      return boss.send(def.name, data);
```

Replace with:

```ts
        return boss.send(def.name, withJobMeta(data), { id: jobIdFromKey(key), singletonKey: key });
      }
      return boss.send(def.name, withJobMeta(data));
```

Then the new test (do not edit it):

```ts
import type { TenantTx } from '@shoebox/db';
import { defineTenantJob, documentStagePayload } from '@shoebox/pipeline';
import {
  currentJobMeta,
  InMemorySpanExporter,
  JOB_META_KEY,
  startTelemetry,
  withSpan,
} from '@shoebox/platform/telemetry';
import type { Job } from 'pg-boss';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type Boss, createJobRegistry } from '../src/registry';

// M12 §4.7 Tracing: web → pg-boss job → worker. `traceparent` rides in `job.data.$meta`; the handler
// sees only the zod payload and runs in a span of the enqueuing trace. Fake pg-boss, fake withTenant.
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC = 'bbbbbbbb-0000-4000-8000-000000000002';
const split = defineTenantJob({
  name: 'doc.split',
  payload: documentStagePayload,
  version: 1,
  entityId: (p) => p.documentId,
});

const spans = new InMemorySpanExporter();
const telemetry = startTelemetry('worker', { traceExporter: spans, sampleRatio: 1 });
afterAll(() => telemetry.shutdown());

describe('job registry trace propagation', () => {
  it('enqueue inside a span stores traceparent beside the payload; the handler continues the trace', async () => {
    const sent: unknown[][] = [];
    let work: ((jobs: Job<unknown>[]) => Promise<unknown>) | undefined;
    const boss = {
      createQueue: vi.fn(async () => undefined),
      send: vi.fn(async (...args: unknown[]) => {
        sent.push(args);
        return 'job-1';
      }),
      work: vi.fn(async (_name: string, _o: unknown, handler: typeof work) => {
        work = handler;
        return 'worker-1';
      }),
      schedule: vi.fn(async () => undefined),
    };
    const registry = createJobRegistry({
      boss: boss as unknown as Boss,
      db: { withTenant: async (_orgId, fn) => fn({} as TenantTx) },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const seen: unknown[] = [];
    registry.registerTenant(split, async (payload) => {
      seen.push(payload);
    });
    await registry.start();

    const webTraceId = await withSpan('web request', async () => {
      await registry.enqueue(split, { orgId: ORG, documentId: DOC });
      return currentJobMeta().traceparent?.split('-')[1];
    });
    expect(webTraceId).toMatch(/^[0-9a-f]{32}$/);

    const data = sent[0]?.[1] as Record<string, unknown>;
    expect(data).toMatchObject({ orgId: ORG, documentId: DOC });
    expect((data[JOB_META_KEY] as { traceparent: string }).traceparent).toMatch(
      new RegExp(`^00-${webTraceId}-[0-9a-f]{16}-01$`),
    );

    await work?.([
      { id: 'job-1', name: 'doc.split', data, retryCount: 0, signal: new AbortController().signal },
    ] as unknown as Job<unknown>[]);
    expect(seen).toEqual([{ orgId: ORG, documentId: DOC }]);
    await telemetry.flush();
    const job = spans.getFinishedSpans().find((s) => s.name === 'job doc.split');
    expect(job?.spanContext().traceId).toBe(webTraceId);
  });
});
```

Command: `pnpm --filter @shoebox/worker test registry 2>&1 | tail -6 && pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5`. Expected: `Tests  12 passed | 4 skipped` (11 existing unit + 1 trace; the 4 skipped are `registry.db.test.ts` without a database); no `error TS`. Commit.

**Step 5: `apps/worker/src/main.ts` (edit: replace the whole file).**

```ts
// Entry point of the worker container (Cloud Run worker pool, M12 §4.2). Not imported by index.ts.
// Telemetry and Sentry start before the worker (M12 §4.7); both are no-ops without their env vars.
import { logger } from '@shoebox/platform';
import { initSentry } from '@shoebox/platform/sentry';
import { startTelemetry } from '@shoebox/platform/telemetry';
import { loadWorkerConfig, startWorker } from './worker';

const telemetry = startTelemetry('worker');
await initSentry({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV ?? 'local',
  release: process.env.RELEASE,
});
const worker = await startWorker(loadWorkerConfig(process.env), { logger });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void worker
      .stop()
      .then(() => telemetry.shutdown())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  });
}
```

Command: `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -5 && pnpm --filter @shoebox/worker test 2>&1 | tail -5`. Expected: no `error TS`; all worker tests pass (db tests skipped without `DATABASE_URL`). Commit.

**Step 6: format, lint, boundaries, privacy guard (no new file).** Command: `pnpm exec biome check --write packages/platform apps/worker 2>&1 | tail -2 && pnpm lint 2>&1 | tail -6 && pnpm depcruise 2>&1 | tail -2 && python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -3 && pnpm typecheck 2>&1 | tail -4 && git status --short | tail -5`. Expected: lint without errors, `no dependency violations found`, the PII guard reports no hit, typecheck without errors, `git status` empty. Commit if Biome changed anything.

## 5. Do not touch

`packages/platform/src/index.ts` (no re-export: the SDKs stay behind the subpaths), `packages/platform/src/logger/**`, `packages/platform/test/logger.test.ts`, `apps/worker/src/worker.ts`, `apps/worker/test/registry.test.ts`, `apps/web/**`, `packages/pipeline/**`, `.env.example`, `.github/**`. No dependency beyond the three above (hard rule 7). No Sentry DSN, token or real personal data anywhere (hard rule 4).

## 6. Commands

- `pnpm --filter @shoebox/platform test 2>&1 | tail -30` → 40 passed.
- `pnpm --filter @shoebox/worker test registry 2>&1 | tail -30` → 12 passed, 4 skipped.
- `pnpm --filter @shoebox/platform typecheck 2>&1 | tail -30` and `pnpm --filter @shoebox/worker typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30`, `pnpm depcruise 2>&1 | tail -30` → no errors, no violations.
- `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -30` → no hit.

## 7. Acceptance

- [ ] `sentry-scrub.test.ts`: `beforeSend` redacts an RČ, an IBAN, a CZ account number and an e-mail in a message (and in the exception value); request body, cookies, headers, user, extra and breadcrumb data are dropped; only allowlisted query keys survive.
- [ ] `sentryOptions`: every `dataCollection` category off (the Sentry 11 form of `sendDefaultPii: false`), no tracing in Sentry, EU-only DSN enforced, disabled without a DSN.
- [ ] `telemetry.test.ts`: `startTelemetry('worker')` registers the 11 M12 metric names (collected through a reader, `service.name` = `shoebox-worker`); a job enqueued inside a span carries `traceparent` in `$meta`, not in the payload; the worker span continues the trace.
- [ ] `registry-trace.test.ts`: through the real registry with a fake pg-boss, the handler receives the bare payload and its span has the enqueuing trace id; `registry.test.ts` passes unchanged.
- [ ] `git diff --stat origin/phase/0` lists exactly the files of §3.

## 8. Stop and ask

Stop, and write the report, if:

- `pnpm add` fails (network, peer-dependency error with `strict-peer-dependencies=true`) or resolves other versions than the pinned ones;
- an anchor is not found verbatim, or P0-PLAT-04's registry is not in phase/0;
- a test fails twice, or a test this brief wrote seems wrong;
- `registry.test.ts` fails (the bare-payload contract changed);
- the PII guard flags a value in a file this brief wrote;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- a dependency beyond the three seems needed;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0035-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; the resolved versions from `pnpm-lock.yaml` (`grep -n "'@sentry/node@\|'@opentelemetry/sdk-node@" pnpm-lock.yaml | head -4`); §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0035 report" && git push -u origin task/0035-sentry-otel 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `sentry.ts`: `dataCollection` has every category off; `stackFrameVariables: false` matters most (local variables would carry document content). `beforeSend` rebuilds `request` from `method` and the scrubbed `url` only; `user`, `extra`, `server_name` deleted; breadcrumb `data` dropped.
- `sentry.ts`: the DSN check accepts only `o<digits>.ingest.de.sentry.io` (Sentry EU, Frankfurt).
- `telemetry.ts`: span attributes are the job name only; an error in a handler sets the span status to the error class name, never the message. Nothing is exported unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- `registry.ts`: the idempotency key and job id are computed from the parsed payload before `$meta` is added; `$meta` is stripped before the zod parse.
- `pnpm-lock.yaml`: only the three packages and their transitive dependencies; `@opentelemetry/api` 1.9.1 satisfies every OTel and Sentry peer range (`>=1.3.0 <1.10.0`, `^1.9.0`).
- Not verified: a real Sentry project and a real OTLP endpoint (owner steps); web wiring (follow-up).

## Owner steps

1. Sentry: create (or open) the organisation in the **EU** region (sentry.io → sign up → Data Storage Location "European Union"); create one project per service (`shoebox-web`, `shoebox-worker`, platform Node.js). Project Settings → Security & Privacy: turn on "Data Scrubber" and "Use Default Scrubbers", turn off "Store Native Crash Reports" (defence in depth on top of the code). Copy each DSN; it must contain `ingest.de.sentry.io`.
2. Put each DSN into Secret Manager / the Cloud Run env of the matching service as `SENTRY_DSN` when the deploy ticket (P0-CI-04) sets up the services; also set `APP_ENV` (`staging` / `production`) and `RELEASE` (the git SHA, the deploy pipeline sets it).
3. Nothing to do locally: without `SENTRY_DSN` and `OTEL_EXPORTER_OTLP_ENDPOINT` both stay off.
