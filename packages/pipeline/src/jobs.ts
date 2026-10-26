// Job catalog (03 ADR-003, 03 §3.1). Names are canonical: `<domain>.<action>`, only from 03 §3.1.
// Payloads are zod strict objects that carry ids only (never document content). Tenant jobs carry
// `orgId` and run inside withTenant in the worker. Pure: no pg-boss, no I/O, no wall clock.
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Every concrete job name of 03 §3.1 (events are not jobs and are not listed). */
export const JOB_NAMES = [
  // Pipeline stage jobs (M01, M02, M03, M04)
  'doc.split',
  'doc.classify',
  'doc.link_supporting',
  'doc.extract',
  'extract.llm',
  'extract.llm_escalated',
  'extract.learn_hints',
  'doc.validate',
  'validate.registry_retry',
  'validate.scope',
  'validate.catalog_upgrade',
  'doc.categorize',
  // Ingestion jobs (M01)
  'ingest.item.process',
  'ingest.expand',
  'ingest.bundle.assemble',
  'ingest.rescan',
  'ingest.cleanup',
  'email.received',
  'email.render_body',
  'expected.sweep',
  'import.spreadsheet.parse',
  'import.spreadsheet.run',
  'import.spreadsheet.undo',
  // Ledger jobs (M04)
  'ledger.rebuild_document',
  'ledger.rebuild_transaction',
  'ledger.rebuild_org',
  'ledger.verify',
  // Other module jobs (M05, M06, M09)
  'vat.period.evaluate',
  'vat.filing.generate',
  'vat.workbook.generate',
  'vat.amendment.detect',
  'podklady.generate',
  'podklady.reserve.refresh',
  'podklady.reserve.nightly',
  'obligations.generate',
  'obligations.nightly',
  'notifications.evaluate',
  'notifications.digest',
  'notifications.urgent',
  // Bank jobs (M07)
  'bank.import.statement',
] as const;

/** Families that 03 §3.1 owns as `<family>.*` (M07, M10, M12); members are named by the module. */
export const JOB_FAMILIES = ['bank', 'package', 'retention', 'privacy', 'ops'] as const;

export type JobFamily = (typeof JOB_FAMILIES)[number];
export type JobName = (typeof JOB_NAMES)[number] | `${JobFamily}.${string}`;

const FAMILY_MEMBER_RE =
  /^(bank|package|retention|privacy|ops)\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** True for a concrete 03 §3.1 name or a well-formed member of a 03 §3.1 family. */
export function isJobName(name: string): name is JobName {
  return (JOB_NAMES as readonly string[]).includes(name) || FAMILY_MEMBER_RE.test(name);
}

/** Crons run in Czech local time (03 ADR-003: rates, deadlines, bank polling). */
export const CRON_TIME_ZONE = 'Europe/Prague';

/** Retries with exponential backoff, then the dead-letter queue (03 ADR-003). */
export interface RetryPolicy {
  /** Retries after the first attempt; 4 means 5 attempts in total. */
  readonly retryLimit: number;
  /** First delay; doubles per retry when `retryBackoff` is true. */
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  /** Upper bound of one delay. */
  readonly retryDelayMaxSeconds: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  retryLimit: 4,
  retryDelaySeconds: 30,
  retryBackoff: true,
  retryDelayMaxSeconds: 3600,
};

/** Name of the dead-letter queue of a job. */
export function deadLetterName(name: JobName): string {
  return `${name}.dlq`;
}

/** The payload of every per-document pipeline stage job: ids only. */
export const documentStagePayload = z.strictObject({
  orgId: z.uuid(),
  documentId: z.uuid(),
});
export type DocumentStagePayload = z.infer<typeof documentStagePayload>;

/** A strict tenant payload: `orgId` plus the given id fields. Unknown keys are rejected. */
export function tenantPayload<S extends Record<string, z.ZodType>>(shape: S) {
  return z.strictObject({ orgId: z.uuid(), ...shape });
}

export interface IdempotencyParts {
  readonly orgId: string;
  /** The job name, e.g. `doc.split`. */
  readonly stage: string;
  readonly entityId: string;
  /** `stage_version` (03 §3): bump it to re-process after a prompt or rule upgrade. */
  readonly version: number;
}

const KEY_PART_RE = /^[^:\s]+$/;

/** `{org_id}:{stage}:{entity_id}:{version}` (03 ADR-003, 03 §3.1). */
export function idempotencyKey(parts: IdempotencyParts): string {
  const { orgId, stage, entityId, version } = parts;
  if (!z.uuid().safeParse(orgId).success) {
    throw new TypeError('idempotencyKey: orgId must be a UUID');
  }
  if (!KEY_PART_RE.test(stage) || !KEY_PART_RE.test(entityId)) {
    throw new TypeError('idempotencyKey: stage and entityId must be non-empty, without ":"');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError('idempotencyKey: version must be an integer >= 1');
  }
  return `${orgId}:${stage}:${entityId}:${version}`;
}

/** A job that touches one org's data: runs inside withTenant(payload.orgId). */
export interface TenantJobDefinition<P extends { orgId: string }> {
  readonly scope: 'tenant';
  readonly name: JobName;
  readonly payload: z.ZodType<P>;
  /** `stage_version`, the `{version}` of the idempotency key. */
  readonly version: number;
  /** The `{entity_id}` of the idempotency key. */
  readonly entityId: (payload: P) => string;
  readonly retry: RetryPolicy;
}

/** A job without a tenant (crons, maintenance). It iterates orgs itself through withTenant. */
export interface SystemJobDefinition<P extends object> {
  readonly scope: 'system';
  readonly name: JobName;
  readonly payload: z.ZodType<P>;
  /** Cron expression evaluated in CRON_TIME_ZONE; absent for jobs that are only enqueued. */
  readonly cron: string | null;
  readonly retry: RetryPolicy;
}

export type JobDefinition =
  // biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of definitions
  TenantJobDefinition<any> | SystemJobDefinition<any>;

function checkName(name: string): asserts name is JobName {
  if (!isJobName(name)) {
    throw new TypeError(`defineJob: "${name}" is not a job name of 03 §3.1`);
  }
}

export function defineTenantJob<P extends { orgId: string }>(def: {
  name: JobName;
  payload: z.ZodType<P>;
  version: number;
  entityId: (payload: P) => string;
  retry?: Partial<RetryPolicy>;
}): TenantJobDefinition<P> {
  checkName(def.name);
  if (!Number.isInteger(def.version) || def.version < 1) {
    throw new TypeError('defineTenantJob: version must be an integer >= 1');
  }
  return {
    scope: 'tenant',
    name: def.name,
    payload: def.payload,
    version: def.version,
    entityId: def.entityId,
    retry: { ...DEFAULT_RETRY, ...def.retry },
  };
}

export function defineSystemJob<P extends object>(def: {
  name: JobName;
  payload: z.ZodType<P>;
  cron?: string;
  retry?: Partial<RetryPolicy>;
}): SystemJobDefinition<P> {
  checkName(def.name);
  return {
    scope: 'system',
    name: def.name,
    payload: def.payload,
    cron: def.cron ?? null,
    retry: { ...DEFAULT_RETRY, ...def.retry },
  };
}

/** The idempotency key of one enqueue of a tenant job. */
export function jobKey<P extends { orgId: string }>(
  def: TenantJobDefinition<P>,
  payload: P,
): string {
  return idempotencyKey({
    orgId: payload.orgId,
    stage: def.name,
    entityId: def.entityId(payload),
    version: def.version,
  });
}

/** Worker heartbeat: a cron every minute; /healthz reports its last tick (M12 §4.2). */
export const opsHeartbeatJob = defineSystemJob({
  name: 'ops.heartbeat',
  payload: z.strictObject({}),
  cron: '* * * * *',
  retry: { retryLimit: 0 },
});

/** M12 §4.6: hard-delete documents trashed more than 30 days ago (never retained ones). */
export const retentionTrashPurgeJob = defineSystemJob({
  name: 'retention.trash_purge',
  payload: z.strictObject({}),
  cron: '30 3 * * *',
});

/** 06 §3: nightly EPO structure and XSD drift check (log alert; detection only). */
export const opsDriftMonitorsJob = defineSystemJob({
  name: 'ops.drift_monitors',
  payload: z.strictObject({}),
  cron: '15 4 * * *',
  retry: { retryLimit: 0 },
});

/** A UUID (version-5 layout) derived from an idempotency key: same key, same pg-boss job id. */
export function jobIdFromKey(key: string): string {
  const bytes = createHash('sha1').update(`shoebox.job:${key}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** M01 §4.1.2: turn one stored inbound e-mail into documents. Enqueued by the inbound-email webhook. */
export const emailReceivedJob = defineTenantJob({
  name: 'email.received',
  payload: tenantPayload({ inboundEmailId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.inboundEmailId,
});

/** M07 §6.2: import one uploaded bank statement file. Enqueued by the statement upload action. */
export const bankImportStatementJob = defineTenantJob({
  name: 'bank.import.statement',
  payload: tenantPayload({ sourceFileId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.sourceFileId,
});

/** M07 §6.2: match the transactions of one import (or an explicit batch). Enqueued after bank.import.statement. */
export const bankMatchTransactionsJob = defineTenantJob({
  name: 'bank.match.transactions',
  payload: tenantPayload({
    transactionIds: z.array(z.uuid()).min(1).max(5000).optional(),
    statementImportId: z.uuid().optional(),
  }).refine((p) => p.transactionIds !== undefined || p.statementImportId !== undefined, {
    message: 'transactionIds or statementImportId is required',
  }),
  version: 1,
  entityId: (p) =>
    p.statementImportId ??
    createHash('sha256')
      .update([...(p.transactionIds ?? [])].sort().join(','))
      .digest('hex')
      .slice(0, 32),
});

/** M07 §6.2: re-score the unmatched transactions of the lookback window for one document that became ready. `trigger` = the extraction run id. */
export const bankMatchDocumentJob = defineTenantJob({
  name: 'bank.match.document',
  payload: tenantPayload({ documentId: z.uuid(), trigger: z.string().min(1).max(64) }),
  version: 1,
  entityId: (p) => `${p.documentId}:${p.trigger}`,
});

/** M07 US9: the owner confirmed or rejected one suggested pairing; the worker writes the result. */
export const bankMatchDecideJob = defineTenantJob({
  name: 'bank.match.decide',
  payload: tenantPayload({
    suggestionId: z.uuid(),
    decision: z.enum(['accept', 'reject']),
    userId: z.uuid(),
  }),
  version: 1,
  entityId: (p) => p.suggestionId,
});

/** M02: read one document (Haiku 5.5), then run the checks. Enqueued by the upload API. */
export const docExtractJob = defineTenantJob({
  name: 'doc.extract',
  payload: documentStagePayload,
  version: 1,
  entityId: (payload) => payload.documentId,
});

/** M01 page sorting (replaces §4.7): sort the pages of one upload drop into documents, then queue their reads. */
export const docSplitJob = defineTenantJob({
  name: 'doc.split',
  payload: tenantPayload({ batchId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.batchId,
});
export type DocSplitPayload = z.infer<typeof docSplitJob.payload>;

/** M01 §4.13: import the valid rows of one uploaded spreadsheet, 200 rows per run. Enqueues itself for the next 200. */
export const importSpreadsheetRunJob = defineTenantJob({
  name: 'import.spreadsheet.run',
  payload: tenantPayload({ importId: z.uuid(), fromRow: z.number().int().min(0) }),
  version: 1,
  entityId: (payload) => `${payload.importId}:${payload.fromRow}`,
  retry: { retryLimit: 2 },
});
export type ImportSpreadsheetRunPayload = z.infer<typeof importSpreadsheetRunJob.payload>;

/** M01 §6: undo one spreadsheet import. The worker runs it (it needs the tenant transaction); the route checks the 30 days. */
export const importSpreadsheetUndoJob = defineTenantJob({
  name: 'import.spreadsheet.undo',
  payload: tenantPayload({ importId: z.uuid() }),
  version: 1,
  entityId: (payload) => payload.importId,
});
export type ImportSpreadsheetUndoPayload = z.infer<typeof importSpreadsheetUndoJob.payload>;

export const CATEGORIZE_TRIGGERS = [
  'pipeline',
  'question_answered',
  'vendor_memory_changed',
  'prior_changed',
  'profile_changed',
  'catalog_upgrade',
  'user_reprocess',
] as const;
export type CategorizeTrigger = (typeof CATEGORIZE_TRIGGERS)[number];
export const LEDGER_REASONS = [
  'categorized',
  'status_changed',
  'revised',
  'deleted',
  'partner_changed',
  'payment_link',
  'profile_changed',
  'fx_imported',
  'rules_changed',
  'verify',
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];
export const ORG_REBUILD_REASONS = ['profile_changed', 'rules_changed', 'manual'] as const;

/** Id-safe key part (no ':' or whitespace). */
const nonceField = z.number().int().min(0).optional();
/** Appends the per-request nonce so a repeat request gets a new job id (a finished job keeps its id). */
const withNonce = (base: string, nonce: number | undefined): string =>
  nonce === undefined ? base : `${base}-${nonce}`;

export const docCategorizePayload = tenantPayload({
  documentId: z.uuid(),
  revision: z.number().int().min(1),
  trigger: z.enum(CATEGORIZE_TRIGGERS),
  nonce: nonceField,
});
export type DocCategorizePayload = z.infer<typeof docCategorizePayload>;
/** M04 §4.6: cascade → LLM → VAT → questions → summary → status; enqueues ledger.rebuild_document. Version = categorize stage version. */
export const docCategorizeJob = defineTenantJob({
  name: 'doc.categorize',
  payload: docCategorizePayload,
  version: 1,
  entityId: (p) =>
    `${p.documentId}-${p.revision}-${p.trigger}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
});

export const ledgerRebuildDocumentPayload = tenantPayload({
  documentId: z.uuid(),
  reason: z.enum(LEDGER_REASONS),
  nonce: nonceField,
});
export type LedgerRebuildDocumentPayload = z.infer<typeof ledgerRebuildDocumentPayload>;
/** M04 §4.13: rebuild both ledgers for one document under an advisory lock; no-op when the input hash is unchanged. */
export const ledgerRebuildDocumentJob = defineTenantJob({
  name: 'ledger.rebuild_document',
  payload: ledgerRebuildDocumentPayload,
  version: 1,
  entityId: (p) => `${p.documentId}-${p.reason}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
});

export const ledgerRebuildOrgPayload = tenantPayload({
  from: z.iso.date().optional(),
  reason: z.enum(ORG_REBUILD_REASONS),
  nonce: nonceField,
});
export type LedgerRebuildOrgPayload = z.infer<typeof ledgerRebuildOrgPayload>;
/** M04 §4.13: enqueues ledger.rebuild_document for the org's documents (issue_date order, batches of 200). */
export const ledgerRebuildOrgJob = defineTenantJob({
  name: 'ledger.rebuild_org',
  payload: ledgerRebuildOrgPayload,
  version: 1,
  entityId: (p) =>
    `org-${p.reason}-${p.from ?? 'all'}${p.nonce === undefined ? '' : `-${p.nonce}`}`,
  retry: { retryLimit: 1 },
});

export const ledgerVerifyPayload = z.strictObject({
  samplePct: z.number().min(0).max(100).default(1),
});
export type LedgerVerifyPayload = z.infer<typeof ledgerVerifyPayload>;
/** M04 §4.13 determinism check: nightly dry-run rebuild of a sample; any diff is logged as an alert. */
export const ledgerVerifyJob = defineSystemJob({
  name: 'ledger.verify',
  payload: ledgerVerifyPayload,
  cron: '45 3 * * *',
  retry: { retryLimit: 0 },
});

/** M05 §6: evaluate the VAT obligations of one period for one family (IO or PAYER). */
export const vatPeriodEvaluatePayload = tenantPayload({
  periodStart: z.iso.date(),
  family: z.enum(['IO', 'PAYER']),
  nonce: nonceField,
});
export type VatPeriodEvaluatePayload = z.infer<typeof vatPeriodEvaluatePayload>;
export const vatPeriodEvaluateJob = defineTenantJob({
  name: 'vat.period.evaluate',
  payload: vatPeriodEvaluatePayload,
  version: 1,
  entityId: (p) => withNonce(p.periodStart, p.nonce),
});

/** M05 §6: generate one filing (radne, opravne, dodatecne, nasledne) for a period. */
export const vatFilingGeneratePayload = tenantPayload({
  periodStart: z.iso.date(),
  kind: z.enum(['radne', 'opravne', 'dodatecne', 'nasledne']),
  amendsFilingId: z.uuid().optional(),
  discoveredOn: z.iso.date().optional(),
  requestedBy: z.uuid(),
  nonce: nonceField,
});
export type VatFilingGeneratePayload = z.infer<typeof vatFilingGeneratePayload>;
export const vatFilingGenerateJob = defineTenantJob({
  name: 'vat.filing.generate',
  payload: vatFilingGeneratePayload,
  version: 1,
  entityId: (p) => withNonce(`${p.periodStart}-${p.kind}`, p.nonce),
});

/** M05 §6: build the period workbook (xlsx). */
export const vatWorkbookGeneratePayload = tenantPayload({
  periodStart: z.iso.date(),
  requestedBy: z.uuid().optional(),
  nonce: nonceField,
});
export type VatWorkbookGeneratePayload = z.infer<typeof vatWorkbookGeneratePayload>;
export const vatWorkbookGenerateJob = defineTenantJob({
  name: 'vat.workbook.generate',
  payload: vatWorkbookGeneratePayload,
  version: 1,
  entityId: (p) => withNonce(p.periodStart, p.nonce),
});

/** M05 §6: detect whether a period needs an amendment (opravne) after a ledger change. */
export const vatAmendmentDetectPayload = tenantPayload({
  periodStart: z.iso.date(),
  nonce: nonceField,
});
export type VatAmendmentDetectPayload = z.infer<typeof vatAmendmentDetectPayload>;
export const vatAmendmentDetectJob = defineTenantJob({
  name: 'vat.amendment.detect',
  payload: vatAmendmentDetectPayload,
  version: 1,
  entityId: (p) => withNonce(p.periodStart, p.nonce),
});

/** M06 §6: build the annual podklady (PDF + XLSX) for one tax year; idempotent per ledger hash and answers version. */
export const podkladyGeneratePayload = tenantPayload({
  year: z.number().int().min(2024),
  answersVersion: z.number().int().min(0),
  requestedBy: z.uuid(),
  nonce: nonceField,
});
export type PodkladyGeneratePayload = z.infer<typeof podkladyGeneratePayload>;
export const podkladyGenerateJob = defineTenantJob({
  name: 'podklady.generate',
  payload: podkladyGeneratePayload,
  version: 1,
  entityId: (p) => withNonce(`${p.year}-${p.answersVersion}`, p.nonce),
});

export const PODKLADY_RESERVE_REASONS = ['ledger_rebuilt', 'nightly', 'profile_changed'] as const;

/** M06 §6: recompute the tax reserve and the income-tax obligations of one org. */
export const podkladyReserveRefreshPayload = tenantPayload({
  reason: z.enum(PODKLADY_RESERVE_REASONS),
  nonce: nonceField,
});
export type PodkladyReserveRefreshPayload = z.infer<typeof podkladyReserveRefreshPayload>;
export const podkladyReserveRefreshJob = defineTenantJob({
  name: 'podklady.reserve.refresh',
  payload: podkladyReserveRefreshPayload,
  version: 1,
  entityId: (p) => withNonce(`reserve-${p.reason}`, p.nonce),
});

export const podkladyReserveNightlyPayload = z.strictObject({});
export type PodkladyReserveNightlyPayload = z.infer<typeof podkladyReserveNightlyPayload>;
/** M06 §6: nightly 02:30 Europe/Prague fan-out of podklady.reserve.refresh over the active organizations. */
export const podkladyReserveNightlyJob = defineSystemJob({
  name: 'podklady.reserve.nightly',
  payload: podkladyReserveNightlyPayload,
  cron: '30 2 * * *',
  retry: { retryLimit: 0 },
});

/** M07 §4.8: materialise the missing-documents radar of one organization as review questions. `at` (minute or nightly-date) makes the job id per request. */
export const bankRadarRefreshJob = defineTenantJob({
  name: 'bank.radar.refresh',
  payload: tenantPayload({ at: z.string().min(1).max(32) }),
  version: 1,
  entityId: (p) => p.at,
});
export type BankRadarRefreshPayload = z.infer<typeof bankRadarRefreshJob.payload>;

export const bankRadarNightlyPayload = z.strictObject({});
export type BankRadarNightlyPayload = z.infer<typeof bankRadarNightlyPayload>;
/** M07 §4.8: daily 03:20 Europe/Prague fan-out of bank.radar.refresh over the active organizations. */
export const bankRadarNightlyJob = defineSystemJob({
  name: 'bank.radar.nightly',
  payload: bankRadarNightlyPayload,
  cron: '20 3 * * *',
  retry: { retryLimit: 0 },
});
