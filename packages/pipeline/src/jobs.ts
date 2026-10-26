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
